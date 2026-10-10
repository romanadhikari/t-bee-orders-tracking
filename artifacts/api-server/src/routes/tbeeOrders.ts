import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  CreateAdminOrderBody,
  CreateAdminOrderResponse,
  DeleteAdminOrderParams,
  GetAdminDashboardResponse,
  GetAdminOrderParams,
  GetAdminOrderResponse,
  GetNewTrackingIdResponse,
  ListAdminOrdersQueryParams,
  ListAdminOrdersResponse,
  TrackOrderBody,
  TrackOrderResponse,
  UpdateAdminOrderBody,
  UpdateAdminOrderParams,
  UpdateAdminOrderResponse,
  UpdateAdminOrderStatusBody,
  UpdateAdminOrderStatusParams,
  UpdateAdminOrderStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  orderItemsTable,
  ordersTable,
  orderStatusHistoryTable,
} from "@workspace/db";
import type { DeliveryOption, OrderStatus } from "../lib/tbeeOrders";
import {
  calculateTotals,
  generateAvailableTrackingId,
  hashNetworkAddress,
  isOrderStatus,
  statusCanShowDeliveryContacts,
  toCents,
  toIso,
} from "../lib/tbeeOrders";
import { checkSameOrigin, requireTbeeAdmin } from "../middlewares/tbeeAdmin";
import { validateUploadedProductImages } from "./tbeeStorage";

const router: IRouter = Router();
const MAX_PUBLIC_TRACKS_PER_MINUTE = 60;
const publicTrackWindows = new Map<string, { count: number; resetAt: number }>();
const deliveryContacts = [
  {
    name: "T-Bee Delivery",
    phone: "+977 9825933188",
  },
];

type ProductInput = {
  productName: string;
  quantity: number;
  unitPrice: number;
  imagePath?: string | null;
};

function isSameOrigin(req: Request, res: Response): boolean {
  return checkSameOrigin(req, res);
}

function publicTrackAllowed(req: Request, res: Response): boolean {
  const now = Date.now();
  const ip = hashNetworkAddress(req.ip ?? req.socket.remoteAddress ?? "unknown");
  const current = publicTrackWindows.get(ip);
  const window =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : current;
  window.count += 1;
  publicTrackWindows.set(ip, window);

  if (window.count <= MAX_PUBLIC_TRACKS_PER_MINUTE) {
    return true;
  }

  const retrySeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  res.setHeader("Retry-After", String(retrySeconds));
  res.status(429).json({
    error: `Too many tracking requests. Try again in ${retrySeconds} seconds.`,
  });
  return false;
}

async function loadOrder(
  trackingId: string,
  includeArchived = false,
) {
  const where = includeArchived
    ? eq(ordersTable.trackingId, trackingId)
    : and(
        eq(ordersTable.trackingId, trackingId),
        isNull(ordersTable.archivedAt),
      );
  const [order] = await db.select().from(ordersTable).where(where).limit(1);
  if (!order) {
    return null;
  }

  const [items, history] = await Promise.all([
    db
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id))
      .orderBy(asc(orderItemsTable.sortOrder), asc(orderItemsTable.id)),
    db
      .select()
      .from(orderStatusHistoryTable)
      .where(eq(orderStatusHistoryTable.orderId, order.id))
      .orderBy(asc(orderStatusHistoryTable.updatedAt), asc(orderStatusHistoryTable.id)),
  ]);
  return { order, items, history };
}

function toTrackingOrder(
  data: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
) {
  const { order, items, history } = data;
  const status = order.status as OrderStatus;
  return {
    trackingId: order.trackingId,
    createdAt: toIso(order.createdAt)!,
    customerName: order.customerName,
    deliveryAddress: order.deliveryAddress,
    landmark: order.landmark,
    status,
    items: items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineSubtotal: Number(item.lineSubtotal),
      imageUrl: item.imagePath ? `/api/storage${item.imagePath}` : null,
    })),
    productSubtotal: Number(order.productSubtotal),
    deliveryOption: order.deliveryOption,
    deliveryCharge: Number(order.deliveryCharge),
    discountAmount: Number(order.discountAmount),
    finalTotal: Number(order.finalTotal),
    statusHistory: history.map((event) => ({
      status: event.status,
      updatedAt: toIso(event.updatedAt)!,
    })),
    deliveryMessage: order.deliveryMessage,
    deliveryMessageUpdatedAt: toIso(order.deliveryMessageUpdatedAt),
    deliveryContacts: statusCanShowDeliveryContacts(status)
      ? deliveryContacts
      : null,
  };
}

function toAdminOrder(
  data: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
) {
  return {
    ...toTrackingOrder(data),
    customerPhone: data.order.customerPhone,
    archivedAt: toIso(data.order.archivedAt),
  };
}

function normalizeItems(items: ProductInput[]) {
  return items.map((item, index) => ({
    productName: item.productName.trim(),
    quantity: item.quantity,
    unitPrice: (toCents(item.unitPrice) / 100).toFixed(2),
    lineSubtotal: (
      (item.quantity * toCents(item.unitPrice)) /
      100
    ).toFixed(2),
    imagePath: item.imagePath || null,
    sortOrder: index,
  }));
}

function productsForTotals(items: ProductInput[]) {
  return items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));
}

function trackingIdPath(trackingId: unknown): string | null {
  if (typeof trackingId !== "string") {
    return null;
  }
  return /^T-BEE-[A-Z]{4}[0-9]{3}$/.test(trackingId) ? trackingId : null;
}

async function createOrder(
  input: {
    trackingId: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    landmark: string | null;
    items: ProductInput[];
    deliveryOption: DeliveryOption;
    discountAmount: number;
    deliveryMessage: string | null;
    totals: ReturnType<typeof calculateTotals>;
  },
) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(ordersTable)
      .values({
        trackingId: input.trackingId,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone.trim(),
        deliveryAddress: input.deliveryAddress.trim(),
        landmark: input.landmark?.trim() || null,
        status: "pending",
        deliveryOption: input.deliveryOption,
        productSubtotal: input.totals.productSubtotal,
        deliveryCharge: input.totals.deliveryCharge,
        discountAmount: input.totals.discountAmount,
        finalTotal: input.totals.finalTotal,
        deliveryMessage: input.deliveryMessage?.trim() || null,
        deliveryMessageUpdatedAt: input.deliveryMessage?.trim() ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(orderItemsTable).values(
      normalizeItems(input.items).map((item) => ({
        ...item,
        orderId: order.id,
      })),
    );
    await tx.insert(orderStatusHistoryTable).values({
      orderId: order.id,
      status: "pending",
      updatedAt: now,
    });
    return order;
  });
}

router.post("/public/track", async (req, res) => {
  if (!publicTrackAllowed(req, res)) {
    return;
  }
  const parsed = TrackOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid T-Bee tracking ID." });
    return;
  }

  try {
    const data = await loadOrder(parsed.data.trackingId);
    if (!data) {
      res.status(404).json({
        error: "We couldn't find that order. Check the ID and try again.",
      });
      return;
    }
    res.json(TrackOrderResponse.parse(toTrackingOrder(data)));
  } catch (error) {
    req.log.error({ err: error }, "T-Bee public tracking lookup failed");
    res.status(500).json({ error: "Order tracking is temporarily unavailable." });
  }
});

router.get("/admin/dashboard", requireTbeeAdmin, async (req, res) => {
  try {
    const [stats] = await db
      .select({
        totalOrders: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null)::int`,
        pending: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} = 'pending')::int`,
        processing: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} in ('confirmed', 'processing', 'ready_for_dispatch'))::int`,
        outForDelivery: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} in ('shipped', 'out_for_delivery'))::int`,
        delivered: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} = 'delivered')::int`,
        cancelled: sql<number>`count(*) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} = 'cancelled')::int`,
        deliveredSales: sql<number>`coalesce(sum(${ordersTable.finalTotal}::numeric) filter (where ${ordersTable.archivedAt} is null and ${ordersTable.status} = 'delivered'), 0)::float`,
      })
      .from(ordersTable);
    res.json(
      GetAdminDashboardResponse.parse({
        totalOrders: Number(stats.totalOrders),
        pending: Number(stats.pending),
        processing: Number(stats.processing),
        outForDelivery: Number(stats.outForDelivery),
        delivered: Number(stats.delivered),
        cancelled: Number(stats.cancelled),
        deliveredSales: Number(stats.deliveredSales),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load T-Bee dashboard");
    res.status(500).json({ error: "Could not load the order overview." });
  }
});

router.get("/admin/orders", requireTbeeAdmin, async (req, res) => {
  const parsed = ListAdminOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "The order filters are invalid." });
    return;
  }

  try {
    const search = parsed.data.search?.trim();
    if (search && search.length > 100) {
      res.status(400).json({ error: "Search text is too long." });
      return;
    }
    const conditions = [isNull(ordersTable.archivedAt)];
    if (parsed.data.status) {
      conditions.push(eq(ordersTable.status, parsed.data.status));
    }
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(ordersTable.trackingId, term),
          ilike(ordersTable.customerName, term),
        )!,
      );
    }

    const rows = await db
      .select({
        trackingId: ordersTable.trackingId,
        createdAt: ordersTable.createdAt,
        customerName: ordersTable.customerName,
        status: ordersTable.status,
        finalTotal: ordersTable.finalTotal,
        itemCount: count(orderItemsTable.id),
      })
      .from(ordersTable)
      .leftJoin(orderItemsTable, eq(ordersTable.id, orderItemsTable.orderId))
      .where(and(...conditions))
      .groupBy(ordersTable.id)
      .orderBy(desc(ordersTable.createdAt));

    res.json(
      ListAdminOrdersResponse.parse(
        rows.map((row) => ({
          trackingId: row.trackingId,
          createdAt: toIso(row.createdAt)!,
          customerName: row.customerName,
          status: row.status,
          finalTotal: Number(row.finalTotal),
          itemCount: Number(row.itemCount),
        })),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not list T-Bee orders");
    res.status(500).json({ error: "Could not load the order list." });
  }
});

router.get(
  "/admin/orders/tracking-id",
  requireTbeeAdmin,
  async (req, res) => {
    try {
      res.json(
        GetNewTrackingIdResponse.parse({
          trackingId: await generateAvailableTrackingId(),
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not generate a T-Bee tracking ID");
      res.status(500).json({ error: "Could not create a tracking ID." });
    }
  },
);

router.post("/admin/orders", requireTbeeAdmin, async (req, res) => {
  if (!isSameOrigin(req, res)) {
    return;
  }
  const parsed = CreateAdminOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the customer, delivery and product details." });
    return;
  }

  try {
    const input = parsed.data;
    await validateUploadedProductImages(input.items.map((item) => item.imagePath));
    const totals = calculateTotals(
      productsForTotals(input.items),
      input.deliveryOption,
      input.discountAmount,
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const trackingId = await generateAvailableTrackingId();
      try {
        const created = await createOrder({
          trackingId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          deliveryAddress: input.deliveryAddress,
          landmark: input.landmark ?? null,
          items: input.items,
          deliveryOption: input.deliveryOption,
          discountAmount: input.discountAmount,
          deliveryMessage: input.deliveryMessage ?? null,
          totals,
        });
        const data = await loadOrder(created.trackingId);
        res.status(201).json(
          CreateAdminOrderResponse.parse(data ? toAdminOrder(data) : null),
        );
        return;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          continue;
        }
        throw error;
      }
    }
    res.status(503).json({ error: "Could not reserve a unique tracking ID. Try again." });
  } catch (error) {
    if (error instanceof Error && /Discount|image|Image|Product image/i.test(error.message)) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not create T-Bee order");
    res.status(500).json({ error: "Could not save the order." });
  }
});

router.get(
  "/admin/orders/:trackingId",
  requireTbeeAdmin,
  async (req, res) => {
    const params = GetAdminOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "The tracking ID is invalid." });
      return;
    }
    try {
      const data = await loadOrder(params.data.trackingId);
      if (!data) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.json(GetAdminOrderResponse.parse(toAdminOrder(data)));
    } catch (error) {
      req.log.error({ err: error }, "Could not load T-Bee order details");
      res.status(500).json({ error: "Could not load the order details." });
    }
  },
);

router.patch(
  "/admin/orders/:trackingId",
  requireTbeeAdmin,
  async (req, res) => {
    if (!isSameOrigin(req, res)) {
      return;
    }
    const params = UpdateAdminOrderParams.safeParse(req.params);
    const parsed = UpdateAdminOrderBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Check the order details and try again." });
      return;
    }

    try {
      const current = await loadOrder(params.data.trackingId);
      if (!current) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      const input = parsed.data;
      const items: ProductInput[] =
        input.items ??
        current.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          imagePath: item.imagePath,
        }));
      await validateUploadedProductImages(items.map((item) => item.imagePath));
      const deliveryOption =
        input.deliveryOption ?? (current.order.deliveryOption as DeliveryOption);
      const discountAmount =
        input.discountAmount ?? Number(current.order.discountAmount);
      const totals = calculateTotals(
        productsForTotals(items),
        deliveryOption,
        discountAmount,
      );
      const now = new Date();
      const nextMessage =
        input.deliveryMessage === undefined
          ? current.order.deliveryMessage
          : input.deliveryMessage?.trim() || null;
      const messageChanged = nextMessage !== current.order.deliveryMessage;

      await db.transaction(async (tx) => {
        await tx
          .update(ordersTable)
          .set({
            customerName: input.customerName?.trim() ?? current.order.customerName,
            customerPhone: input.customerPhone?.trim() ?? current.order.customerPhone,
            deliveryAddress:
              input.deliveryAddress?.trim() ?? current.order.deliveryAddress,
            landmark:
              input.landmark === undefined
                ? current.order.landmark
                : input.landmark?.trim() || null,
            deliveryOption,
            productSubtotal: totals.productSubtotal,
            deliveryCharge: totals.deliveryCharge,
            discountAmount: totals.discountAmount,
            finalTotal: totals.finalTotal,
            deliveryMessage: nextMessage,
            deliveryMessageUpdatedAt: messageChanged
              ? nextMessage
                ? now
                : null
              : current.order.deliveryMessageUpdatedAt,
            updatedAt: now,
          })
          .where(eq(ordersTable.id, current.order.id));

        if (input.items !== undefined) {
          await tx
            .delete(orderItemsTable)
            .where(eq(orderItemsTable.orderId, current.order.id));
          await tx.insert(orderItemsTable).values(
            normalizeItems(items).map((item) => ({
              ...item,
              orderId: current.order.id,
            })),
          );
        }
      });

      const updated = await loadOrder(params.data.trackingId);
      res.json(
        UpdateAdminOrderResponse.parse(updated ? toAdminOrder(updated) : null),
      );
    } catch (error) {
      if (error instanceof Error && /Discount|image|Image|Product image/i.test(error.message)) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Could not update T-Bee order details");
      res.status(500).json({ error: "Could not save the order changes." });
    }
  },
);

router.patch(
  "/admin/orders/:trackingId/status",
  requireTbeeAdmin,
  async (req, res) => {
    if (!isSameOrigin(req, res)) {
      return;
    }
    const params = UpdateAdminOrderStatusParams.safeParse(req.params);
    const parsed = UpdateAdminOrderStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success || !isOrderStatus(parsed.data.status)) {
      res.status(400).json({ error: "Choose a valid order status." });
      return;
    }

    try {
      const data = await loadOrder(params.data.trackingId);
      if (!data) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      if (data.order.status !== parsed.data.status) {
        const now = new Date();
        await db.transaction(async (tx) => {
          await tx
            .update(ordersTable)
            .set({ status: parsed.data.status, updatedAt: now })
            .where(eq(ordersTable.id, data.order.id));
          await tx.insert(orderStatusHistoryTable).values({
            orderId: data.order.id,
            status: parsed.data.status,
            updatedAt: now,
          });
        });
      }

      const updated = await loadOrder(params.data.trackingId);
      res.json(
        UpdateAdminOrderStatusResponse.parse(updated ? toAdminOrder(updated) : null),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not update T-Bee order status");
      res.status(500).json({ error: "Could not update the order status." });
    }
  },
);

router.delete(
  "/admin/orders/:trackingId",
  requireTbeeAdmin,
  async (req, res) => {
    if (!isSameOrigin(req, res)) {
      return;
    }
    const params = DeleteAdminOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "The tracking ID is invalid." });
      return;
    }
    try {
      const [archived] = await db
        .update(ordersTable)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.trackingId, params.data.trackingId),
            isNull(ordersTable.archivedAt),
          ),
        )
        .returning({ id: ordersTable.id });
      if (!archived) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.status(204).end();
    } catch (error) {
      req.log.error({ err: error }, "Could not archive T-Bee order");
      res.status(500).json({ error: "Could not archive the order." });
    }
  },
);

export default router;
