import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orderStatusEnum = pgEnum("tbee_order_status", [
  "pending",
  "verified",
  "processing",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

export const deliveryOptionEnum = pgEnum("tbee_delivery_option", [
  "birtamode",
  "outside_birtamode",
]);

export const ordersTable = pgTable(
  "tbee_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackingId: text("tracking_id").notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    landmark: text("landmark"),
    status: orderStatusEnum("status").notNull().default("pending"),
    deliveryOption: deliveryOptionEnum("delivery_option").notNull(),
    productSubtotal: numeric("product_subtotal", {
      precision: 12,
      scale: 2,
    }).notNull(),
    deliveryCharge: numeric("delivery_charge", { precision: 10, scale: 2 })
      .notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    finalTotal: numeric("final_total", { precision: 12, scale: 2 }).notNull(),
    deliveryMessage: text("delivery_message"),
    deliveryMessageUpdatedAt: timestamp("delivery_message_updated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tbee_orders_tracking_id_uq").on(table.trackingId),
    index("tbee_orders_status_idx").on(table.status),
    index("tbee_orders_created_at_idx").on(table.createdAt),
  ],
);

export const orderItemsTable = pgTable(
  "tbee_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineSubtotal: numeric("line_subtotal", {
      precision: 12,
      scale: 2,
    }).notNull(),
    imagePath: text("image_path"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("tbee_order_items_order_id_idx").on(table.orderId)],
);

export const orderStatusHistoryTable = pgTable(
  "tbee_order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tbee_order_status_history_order_id_idx").on(table.orderId),
  ],
);

export const adminSessionsTable = pgTable(
  "tbee_admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    username: text("username").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("tbee_admin_sessions_expires_idx").on(table.expiresAt)],
);

export const loginAttemptsTable = pgTable("tbee_login_attempts", {
  scopeKey: text("scope_key").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
export type OrderStatusHistory = typeof orderStatusHistoryTable.$inferSelect;
