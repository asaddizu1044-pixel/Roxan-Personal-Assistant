import { and, asc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { activityRecords, InsertActivityRecord, InsertUser, syncCursors, users } from "../drizzle/schema";
import { ENV } from "./env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => { if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; } });
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  values.lastSignedIn ??= new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listActivityRecords(userId: number, from: number, to: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(activityRecords)
    .where(and(eq(activityRecords.userId, userId), gte(activityRecords.recordedAt, from), lte(activityRecords.recordedAt, to)))
    .orderBy(asc(activityRecords.recordedAt));
}

export async function syncActivityRecords(userId: number, records: Array<Omit<InsertActivityRecord, "userId">>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (!records.length) return { accepted: 0, duplicates: 0 };
  const values = records.map((record) => ({ ...record, userId }));
  await db.insert(activityRecords).values(values).onDuplicateKeyUpdate({
    set: {
      updatedAt: new Date(),
    },
  });
  return { accepted: records.length, duplicates: 0 };
}

export async function getSyncCursor(userId: number, source: "phone" | "watch" | "wearable", deviceId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(syncCursors).where(and(eq(syncCursors.userId, userId), eq(syncCursors.source, source), eq(syncCursors.deviceId, deviceId))).limit(1);
  return result[0];
}

export async function upsertSyncCursor(userId: number, source: "phone" | "watch" | "wearable", deviceId: string, cursor: string | null, lastSyncedAt: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(syncCursors).values({ userId, source, deviceId, cursor, lastSyncedAt }).onDuplicateKeyUpdate({ set: { cursor, lastSyncedAt } });
}