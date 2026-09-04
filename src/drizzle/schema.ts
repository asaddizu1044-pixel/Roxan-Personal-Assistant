import { bigint, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const activityRecords = mysqlTable("activity_records", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  source: mysqlEnum("source", ["phone", "watch", "wearable", "manual"]).notNull(),
  externalId: varchar("externalId", { length: 128 }).notNull(),
  recordedAt: bigint("recordedAt", { mode: "number" }).notNull(),
  activityType: mysqlEnum("activityType", ["stationary", "walking", "running", "cycling", "exercise"]).notNull(),
  steps: int("steps").notNull().default(0),
  distanceMeters: int("distanceMeters").notNull().default(0),
  activeSeconds: int("activeSeconds").notNull().default(0),
  calories: int("calories").notNull().default(0),
  avgHeartRate: int("avgHeartRate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userRecordedAtIdx: index("activity_user_recorded_at_idx").on(table.userId, table.recordedAt),
  userExternalIdUnique: uniqueIndex("activity_user_external_id_unique").on(table.userId, table.externalId),
}));

export const syncCursors = mysqlTable("sync_cursors", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  source: mysqlEnum("source", ["phone", "watch", "wearable"]).notNull(),
  deviceId: varchar("deviceId", { length: 128 }).notNull(),
  cursor: varchar("cursor", { length: 512 }),
  lastSyncedAt: bigint("lastSyncedAt", { mode: "number" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userDeviceUnique: uniqueIndex("sync_user_device_unique").on(table.userId, table.source, table.deviceId),
}));

export type ActivityRecord = typeof activityRecords.$inferSelect;
export type InsertActivityRecord = typeof activityRecords.$inferInsert;
export type SyncCursor = typeof syncCursors.$inferSelect;
export type InsertSyncCursor = typeof syncCursors.$inferInsert;