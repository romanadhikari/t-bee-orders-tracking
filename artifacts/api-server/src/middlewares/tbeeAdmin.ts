import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  adminSessionsTable,
  db,
  loginAttemptsTable,
} from "@workspace/db";
import { hashNetworkAddress, hashSessionToken } from "../lib/tbeeOrders";

const COOKIE_NAME = "tbee_admin_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_LOCK_MINUTES = 24 * 60;

declare global {
  namespace Express {
    interface Request {
      tbeeAdminUsername?: string;
    }
  }
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function tbeeAdminUsername(): string {
  return process.env.T_BEE_ADMIN_USERNAME ?? "roman*0030";
}

export function checkSameOrigin(req: Request, res: Response): boolean {
  const origin = req.get("origin");
  if (!origin) {
    return true;
  }
  try {
    if (new URL(origin).host === req.get("host")) {
      return true;
    }
  } catch {
    // A malformed Origin is not trusted.
  }
  res.status(403).json({ error: "Request origin is not allowed." });
  return false;
}

export function adminSessionToken(req: Request): string | undefined {
  const signedCookies = req.signedCookies as
    | Record<string, string | false>
    | undefined;
  const token = signedCookies?.[COOKIE_NAME];
  return typeof token === "string" ? token : undefined;
}

export async function requireTbeeAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = adminSessionToken(req);
    if (!token) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const [session] = await db
      .select({
        username: adminSessionsTable.username,
      })
      .from(adminSessionsTable)
      .where(
        and(
          eq(adminSessionsTable.tokenHash, tokenHash),
          gt(adminSessionsTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!session) {
      res.clearCookie(COOKIE_NAME, { path: "/" });
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    req.tbeeAdminUsername = session.username;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to validate T-Bee administrator session");
    res.status(500).json({ error: "Could not validate the current session." });
  }
}

export function getTbeeAdminSession(req: Request): {
  authenticated: boolean;
  username: string | null;
} {
  const username = req.tbeeAdminUsername;
  return {
    authenticated: Boolean(username),
    username: username ?? null,
  };
}

export async function hasLoginLock(
  accountScope: string,
  ipScope: string,
  now = new Date(),
): Promise<Date | null> {
  const rows = await db
    .select({ lockedUntil: loginAttemptsTable.lockedUntil })
    .from(loginAttemptsTable)
    .where(
      and(
        inArray(loginAttemptsTable.scopeKey, [accountScope, ipScope]),
        gt(loginAttemptsTable.lockedUntil, now),
      ),
    );
  return rows.reduce<Date | null>((latest, row) => {
    if (!row.lockedUntil) {
      return latest;
    }
    return !latest || row.lockedUntil > latest ? row.lockedUntil : latest;
  }, null);
}

function lockDurationMinutes(failureCount: number): number {
  if (failureCount === 3) {
    return 5;
  }
  if (failureCount === 6) {
    return 10;
  }
  if (failureCount >= 7) {
    return Math.min(
      MAX_LOCK_MINUTES,
      20 * 2 ** Math.floor((failureCount - 7) / 2),
    );
  }
  return 0;
}

export async function recordFailedLogin(
  accountScope: string,
  ipScope: string,
  now = new Date(),
): Promise<Date | null> {
  let longestLock = 0;
  await db.transaction(async (tx) => {
    for (const scopeKey of [accountScope, ipScope]) {
      const [entry] = await tx
        .insert(loginAttemptsTable)
        .values({ scopeKey, failureCount: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: loginAttemptsTable.scopeKey,
          set: {
            failureCount: sql`${loginAttemptsTable.failureCount} + 1`,
            updatedAt: now,
          },
        })
        .returning({ failureCount: loginAttemptsTable.failureCount });

      const duration = lockDurationMinutes(entry.failureCount);
      longestLock = Math.max(longestLock, duration);
      await tx
        .update(loginAttemptsTable)
        .set({
          lockedUntil:
            duration > 0
              ? new Date(now.getTime() + duration * 60 * 1000)
              : null,
        })
        .where(eq(loginAttemptsTable.scopeKey, scopeKey));
    }
  });
  return longestLock > 0
    ? new Date(now.getTime() + longestLock * 60 * 1000)
    : null;
}

export async function clearLoginFailures(
  accountScope: string,
  ipScope: string,
): Promise<void> {
  await db
    .delete(loginAttemptsTable)
    .where(inArray(loginAttemptsTable.scopeKey, [accountScope, ipScope]));
}

export function loginScopes(username: string, ipAddress: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const accountScope = `account:${hashNetworkAddress(normalizedUsername)}`;
  const ipScope = `ip:${hashNetworkAddress(ipAddress || "unknown")}`;
  return { accountScope, ipScope };
}

export function verifyAdminCredentials(
  username: string,
  password: string,
): boolean {
  const expectedPassword = process.env.T_BEE_ADMIN_PASSWORD;
  if (!expectedPassword) {
    return false;
  }
  const expectedUsername = tbeeAdminUsername().trim().toLowerCase();
  return (
    safeEqual(username.trim().toLowerCase(), expectedUsername) &&
    safeEqual(password, expectedPassword)
  );
}

export async function createAdminSession(
  username: string,
  res: Response,
): Promise<void> {
  sessionSecret();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(adminSessionsTable).values({
    tokenHash: hashSessionToken(token),
    username,
    expiresAt,
  });
  res.cookie(COOKIE_NAME, token, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_DURATION_MS,
    path: "/",
  });
}

export async function destroyAdminSession(req: Request, res: Response): Promise<void> {
  const token = adminSessionToken(req);
  if (token) {
    await db
      .delete(adminSessionsTable)
      .where(eq(adminSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

