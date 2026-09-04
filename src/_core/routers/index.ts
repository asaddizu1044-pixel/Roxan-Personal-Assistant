import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { listActivityRecords, syncActivityRecords, getSyncCursor, upsertSyncCursor } from "../db";

const t = initTRPC.context<{ user: any }>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new Error("UNAUTHORIZED");
  }
  return next({ ctx });
});

const activityRouter = router({
  history: protectedProcedure
    .input(z.object({ from: z.number(), to: z.number() }))
    .query(async ({ ctx, input }) => {
      return listActivityRecords(ctx.user.id, input.from, input.to);
    }),
  
  sync: protectedProcedure
    .input(z.object({
      source: z.enum(["phone", "watch", "wearable"]),
      deviceId: z.string(),
      cursor: z.string().optional(),
      records: z.array(z.object({
        externalId: z.string(),
        recordedAt: z.number(),
        activityType: z.enum(["stationary", "walking", "running", "cycling", "exercise"]),
        steps: z.number(),
        distanceMeters: z.number(),
        activeSeconds: z.number(),
        calories: z.number(),
        avgHeartRate: z.number().nullable(),
        source: z.enum(["phone", "watch", "wearable", "manual"]).optional(),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const recordsWithSource = input.records.map((record) => ({
        ...record,
        source: record.source || input.source,
      }));
      const result = await syncActivityRecords(ctx.user.id, recordsWithSource);
      await upsertSyncCursor(ctx.user.id, input.source, input.deviceId, input.cursor || null, Date.now());
      return result;
    }),
  
  syncStatus: protectedProcedure
    .input(z.object({ source: z.enum(["phone", "watch", "wearable"]), deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getSyncCursor(ctx.user.id, input.source, input.deviceId);
    }),
});

const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),
  
  // ✅ ADD THIS - Login procedure
  login: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // This will be handled by the backend
      // The backend (server/index.ts) will actually create the user
      return {
        id: 1,
        openId: `user-${Date.now()}`,
        name: input.name,
        email: `${input.name.toLowerCase().replace(/\s/g, '.')}@example.com`,
        loginMethod: "manual",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      };
    }),
    
  logout: protectedProcedure.mutation(async () => {
    // Clear session logic here
    return { success: true };
  }),
});

export const appRouter = router({
  activity: activityRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;