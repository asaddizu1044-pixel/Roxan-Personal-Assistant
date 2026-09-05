import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { connectMongoDB, getDb } from '../server/mongodb.js';

let currentUser: any = null;

const t = initTRPC.create();

// ✅ Complete Router
const appRouter = t.router({
  auth: t.router({
    me: t.procedure.query(async () => {
      console.log("📡 ME query called - currentUser:", currentUser?.name || "null");
      if (currentUser) {
        return {
          id: currentUser._id.toString(),
          openId: currentUser.openId,
          name: currentUser.name,
          email: currentUser.email,
          loginMethod: currentUser.loginMethod,
          role: currentUser.role,
          createdAt: currentUser.createdAt,
          updatedAt: currentUser.updatedAt,
          lastSignedIn: currentUser.lastSignedIn,
        };
      }
      return null;
    }),

    login: t.procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => {
        console.log("🔑 Login request for:", input.name);
        try {
          const db = await getDb();
          const now = new Date();

          let user = await db.collection('users').findOne({ name: input.name });

          if (!user) {
            const newUser = {
              openId: `user-${Date.now()}`,
              name: input.name,
              email: `${input.name.toLowerCase().replace(/\s/g, '.')}@example.com`,
              loginMethod: "manual",
              role: "user",
              createdAt: now,
              updatedAt: now,
              lastSignedIn: now,
            };
            const result = await db.collection('users').insertOne(newUser);
            user = { _id: result.insertedId, ...newUser };
            console.log("✅ New user created:", input.name);
          } else {
            await db.collection('users').updateOne(
              { _id: user._id },
              { $set: { lastSignedIn: now, updatedAt: now } }
            );
            console.log("✅ Existing user logged in:", input.name);
          }

          currentUser = user;
          console.log("✅ Login successful for:", input.name);

          return {
            id: user._id.toString(),
            openId: user.openId,
            name: user.name,
            email: user.email,
            loginMethod: user.loginMethod,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastSignedIn: user.lastSignedIn,
          };
        } catch (error) {
          console.error("❌ Login error:", error);
          throw new Error("Login failed");
        }
      }),

    logout: t.procedure.mutation(() => {
      console.log("🔑 Logout called");
      currentUser = null;
      return { success: true };
    }),
  }),

  activity: t.router({
    history: t.procedure
      .input(z.object({ from: z.number(), to: z.number() }))
      .query(async ({ input }) => {
        console.log("📊 History request:", input.from, input.to);
        const db = await getDb();
        const records = await db.collection('activity_records')
          .find({
            recordedAt: { $gte: input.from, $lte: input.to }
          })
          .sort({ recordedAt: 1 })
          .toArray();

        return records.map((r: any) => ({
          id: r._id.toString(),
          ...r,
          _id: undefined,
        }));
      }),

    sync: t.procedure
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
          avgHeartRate: z.number().nullable().optional(),
          route: z.array(z.any()).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        console.log("📤 Sync request:", input.records.length, "records");
        const db = await getDb();
        const now = new Date();

        const allUsers = await db.collection('users').find().toArray();
        const userId = allUsers.length > 0 ? allUsers[0]._id : 1;

        let accepted = 0;
        for (const record of input.records || []) {
          const result = await db.collection('activity_records').updateOne(
            { externalId: record.externalId },
            {
              $set: {
                ...record,
                source: input.source,
                userId: userId,
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            { upsert: true }
          );
          if (result.upsertedCount || result.modifiedCount) {
            accepted++;
          }
        }

        await db.collection('sync_cursors').updateOne(
          { source: input.source, deviceId: input.deviceId },
          {
            $set: {
              source: input.source,
              deviceId: input.deviceId,
              cursor: input.cursor || null,
              lastSyncedAt: Date.now(),
              updatedAt: now,
              userId: userId,
            },
          },
          { upsert: true }
        );

        console.log(`📤 Synced ${accepted} records to MongoDB`);

        return {
          accepted,
          duplicates: input.records?.length - accepted || 0,
          lastSyncedAt: Date.now(),
        };
      }),

    syncStatus: t.procedure
      .input(z.object({ source: z.enum(["phone", "watch", "wearable"]), deviceId: z.string() }))
      .query(async ({ input }) => {
        console.log("📡 Sync status for:", input.source, input.deviceId);
        const db = await getDb();
        const cursor = await db.collection('sync_cursors').findOne({
          source: input.source,
          deviceId: input.deviceId,
        });
        return {
          lastSyncedAt: cursor?.lastSyncedAt || null,
          cursor: cursor?.cursor || null,
        };
      }),
  }),
});

// ✅ Create Express app
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ✅ Health check
app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({
      status: 'ok',
      database: 'MongoDB Atlas',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("❌ Health check error:", error);
    res.status(500).json({
      status: 'error',
      error: 'Database connection failed'
    });
  }
});

// ✅ tRPC middleware
app.use('/api/trpc', createExpressMiddleware({
  router: appRouter,
  createContext: ({ req, res }) => {
    console.log("📡 tRPC request:", req.method, req.url);
    return { req, res };
  },
}));

// ✅ Export for Vercel
export default app;