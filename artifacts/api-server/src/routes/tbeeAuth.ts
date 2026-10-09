import { Router, type IRouter } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import {
  AdminLoginBody,
  AdminLoginResponse,
  GetAdminSessionResponse,
} from "@workspace/api-zod";
import { adminSessionsTable, db } from "@workspace/db";
import {
  adminSessionToken,
  checkSameOrigin,
  clearLoginFailures,
  createAdminSession,
  hasLoginLock,
  loginScopes,
  recordFailedLogin,
  tbeeAdminUsername,
  verifyAdminCredentials,
} from "../middlewares/tbeeAdmin";
import { hashSessionToken } from "../lib/tbeeOrders";

const router: IRouter = Router();
const SESSION_COOKIE = "tbee_admin_session";

router.get("/admin/session", async (req, res) => {
  try {
    const token = adminSessionToken(req);
    if (!token) {
      res.json(
        GetAdminSessionResponse.parse({
          authenticated: false,
          username: null,
        }),
      );
      return;
    }

    const [session] = await db
      .select({ username: adminSessionsTable.username })
      .from(adminSessionsTable)
      .where(
        and(
          eq(adminSessionsTable.tokenHash, hashSessionToken(token)),
          gt(adminSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json(
        GetAdminSessionResponse.parse({
          authenticated: false,
          username: null,
        }),
      );
      return;
    }

    res.json(
      GetAdminSessionResponse.parse({
        authenticated: true,
        username: session.username,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not read T-Bee administrator session");
    res.status(500).json({ error: "Could not read the current session." });
  }
});

router.post("/admin/login", async (req, res) => {
  if (!checkSameOrigin(req, res)) {
    return;
  }

  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a username and password." });
    return;
  }

  if (!process.env.T_BEE_ADMIN_PASSWORD) {
    res.status(503).json({ error: "Administrator sign-in is not configured." });
    return;
  }

  try {
    const username = parsed.data.username.trim();
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const { accountScope, ipScope } = loginScopes(username, ipAddress);
    const activeLock = await hasLoginLock(accountScope, ipScope);

    if (activeLock) {
      const seconds = Math.max(
        1,
        Math.ceil((activeLock.getTime() - Date.now()) / 1000),
      );
      res.setHeader("Retry-After", String(seconds));
      res.status(429).json({
        error: `Sign-in is temporarily locked. Try again in ${seconds} seconds.`,
      });
      return;
    }

    if (!verifyAdminCredentials(username, parsed.data.password)) {
      const lockUntil = await recordFailedLogin(accountScope, ipScope);
      if (lockUntil) {
        const seconds = Math.max(
          1,
          Math.ceil((lockUntil.getTime() - Date.now()) / 1000),
        );
        res.setHeader("Retry-After", String(seconds));
        res.status(429).json({
          error: `Sign-in is temporarily locked. Try again in ${seconds} seconds.`,
        });
        return;
      }

      res.status(401).json({ error: "The username or password is incorrect." });
      return;
    }

    await clearLoginFailures(accountScope, ipScope);
    await db
      .delete(adminSessionsTable)
      .where(lt(adminSessionsTable.expiresAt, new Date()));
    const administrator = tbeeAdminUsername();
    await createAdminSession(administrator, res);
    res.json(
      AdminLoginResponse.parse({
        authenticated: true,
        username: administrator,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "T-Bee administrator sign-in failed");
    res.status(500).json({ error: "Sign-in could not be completed." });
  }
});

router.post("/admin/logout", async (req, res) => {
  if (!checkSameOrigin(req, res)) {
    return;
  }

  const token = adminSessionToken(req);
  try {
    if (token) {
      await db
        .delete(adminSessionsTable)
        .where(eq(adminSessionsTable.tokenHash, hashSessionToken(token)));
    }
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "T-Bee administrator sign-out failed");
    res.status(500).json({ error: "Sign-out could not be completed." });
  }
});

export default router;
