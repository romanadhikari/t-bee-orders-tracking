import { createHash, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const orderStatuses = [
  "pending",
  "verified",
  "confirmed",
  "processing",
  "ready_for_dispatch",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type DeliveryOption = "birtamode" | "outside_birtamode";

export function isOrderStatus(value: string): value is OrderStatus {
  return (orderStatuses as readonly string[]).includes(value);
}

export function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Amounts must be valid non-negative numbers.");
  }
  return Math.round(value * 100);
}

export function asMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function calculateTotals(
  items: Array<{ quantity: number; unitPrice: number }>,
  deliveryOption: DeliveryOption,
  discountAmount: number,
) {
  const productSubtotalCents = items.reduce(
    (sum, item) => sum + item.quantity * toCents(item.unitPrice),
    0,
  );
  const deliveryChargeCents = deliveryOption === "birtamode" ? 5000 : 15000;
  const discountCents = toCents(discountAmount);

  if (discountCents > productSubtotalCents) {
    throw new Error("Discount cannot exceed the product subtotal.");
  }

  const finalTotalCents =
    productSubtotalCents + deliveryChargeCents - discountCents;
  if (finalTotalCents < 0) {
    throw new Error("Final total cannot be negative.");
  }

  return {
    productSubtotal: asMoney(productSubtotalCents),
    deliveryCharge: asMoney(deliveryChargeCents),
    discountAmount: asMoney(discountCents),
    finalTotal: asMoney(finalTotalCents),
  };
}

export function generateTrackingIdCandidate(): string {
  let letters = "";
  for (let index = 0; index < 4; index += 1) {
    letters += alphabet[randomInt(alphabet.length)];
  }
  const digits = randomInt(100, 1000).toString();
  return `T-BEE-${letters}${digits}`;
}

export async function generateAvailableTrackingId(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const trackingId = generateTrackingIdCandidate();
    const [existing] = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.trackingId, trackingId))
      .limit(1);
    if (!existing) {
      return trackingId;
    }
  }
  throw new Error("Could not reserve a tracking ID. Please try again.");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashNetworkAddress(address: string): string {
  return createHash("sha256").update(address).digest("hex");
}

export function statusCanShowDeliveryContacts(status: OrderStatus): boolean {
  return status === "out_for_delivery";
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

