/*import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { connectMongoDB, getDb } from './mongodb.js';

// ✅ Session storage - Initialize as null
let currentUser: any = null;

// Initialize tRPC
const t = initTRPC.create();

// Create router
const appRouter = t.router({
  auth: t.router({
    me: t.procedure.query(async () => {
      console.log("📡 ME query - currentUser:", currentUser?.name || "null");
      // ✅ Return null if no session
      if (!currentUser) {
        return null;
      }
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
    }),
    
    login: t.procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => {
        console.log("🔑 Login request for:", input.name);
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
        
        // ✅ Store user in session
        currentUser = user;
        console.log("✅ Session stored for:", currentUser.name);
        
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
      }),
      
    logout: t.procedure.mutation(() => {
      console.log("🔑 Logout request - clearing session");
      // ✅ Clear session
      currentUser = null;
      console.log("✅ Session cleared");
      return { success: true };
    }),
  }),

  activity: t.router({
    history: t.procedure
      .input(z.object({ from: z.number(), to: z.number() }))
      .query(async ({ input }) => {
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
      .input(
        z.object({
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
        })
      )
      .mutation(async ({ input }) => {
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

export type AppRouter = typeof appRouter;

// Create Express server
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Roxan Personal Assistant API',
    version: '1.0.0',
    status: 'running',
    database: 'MongoDB Atlas',
    endpoints: {
      health: '/api/health',
      trpc: '/api/trpc',
    },
  });
});

// Health check
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
    res.status(500).json({ 
      status: 'error', 
      error: 'Database connection failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// tRPC endpoint
app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => {
      console.log(`📡 ${req.method} ${req.url}`);
      return {};
    },
  })
);

// Handle OPTIONS
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(200);
  } else {
    next();
  }
});

const PORT = 4000;
app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🔄 Database: MongoDB Atlas`);
  console.log(`📡 tRPC: http://localhost:${PORT}/api/trpc`);
  console.log('='.repeat(50));
  
  try {
    await connectMongoDB();
    console.log('✅ MongoDB Atlas connection verified!');
  } catch (error) {
    console.error('❌ MongoDB Atlas connection failed:', error);
  }
});
|*/



import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { connectMongoDB, getDb } from './mongodb.js';

let currentUser: any = null;

const t = initTRPC.create();

const appRouter = t.router({
  auth: t.router({
    me: t.procedure.query(async () => {
      console.log("📡 ME query - currentUser:", currentUser?.name || "null");
      if (!currentUser) {
        return null;
      }
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
    }),

    login: t.procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => {
        console.log("🔑 Login request for:", input.name);
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
        console.log("✅ Session stored for:", currentUser.name);

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
      }),

    logout: t.procedure.mutation(() => {
      console.log("🔑 Logout request - clearing session");
      currentUser = null;
      console.log("✅ Session cleared");
      return { success: true };
    }),
  }),

  activity: t.router({
    history: t.procedure
      .input(z.object({ from: z.number(), to: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();

        const allUsers = await db.collection('users').find().toArray();
        const userId = currentUser?._id ?? (allUsers.length > 0 ? allUsers[0]._id : null);

        if (!userId) {
          console.warn("⚠️ No user available for activity history; returning empty.");
          return [];
        }

        const records = await db
          .collection('activity_records')
          .find({
            userId,
            recordedAt: { $gte: input.from, $lte: input.to },
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
      .input(
        z.object({
          source: z.enum(["phone", "watch", "wearable"]),
          deviceId: z.string(),
          cursor: z.string().optional(),
          records: z.array(
            z.object({
              externalId: z.string(),
              recordedAt: z.number(),
              activityType: z.enum([
                "stationary",
                "walking",
                "running",
                "cycling",
                "exercise",
              ]),
              steps: z.number(),
              distanceMeters: z.number(),
              activeSeconds: z.number(),
              calories: z.number(),
              avgHeartRate: z.number().nullable().optional(),
              route: z.array(z.any()).optional(),
            }),
          ),
        }),
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        const now = new Date();

        const allUsers = await db.collection('users').find().toArray();
        const userId = currentUser?._id ?? (allUsers.length > 0 ? allUsers[0]._id : null);

        if (!userId) {
          throw new Error("No user available for activity sync");
        }

        let accepted = 0;
        for (const record of input.records || []) {
          const result = await db.collection('activity_records').updateOne(
            {
              externalId: record.externalId,
              userId,
            },
            {
              $set: {
                ...record,
                source: input.source,
                deviceId: input.deviceId,
                userId,
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            { upsert: true },
          );
          if (result.upsertedCount || result.modifiedCount) {
            accepted++;
          }
        }

        await db.collection('sync_cursors').updateOne(
          {
            source: input.source,
            deviceId: input.deviceId,
            userId,
          },
          {
            $set: {
              source: input.source,
              deviceId: input.deviceId,
              cursor: input.cursor || null,
              lastSyncedAt: Date.now(),
              updatedAt: now,
              userId,
            },
          },
          { upsert: true },
        );

        console.log(`📤 Synced ${accepted} records to MongoDB`);

        return {
          accepted,
          duplicates: input.records?.length - accepted || 0,
          lastSyncedAt: Date.now(),
        };
      }),

    syncStatus: t.procedure
      .input(
        z.object({
          source: z.enum(["phone", "watch", "wearable"]),
          deviceId: z.string(),
        }),
      )
      .query(async ({ input }) => {
        const db = await getDb();

        const allUsers = await db.collection('users').find().toArray();
        const userId = currentUser?._id ?? (allUsers.length > 0 ? allUsers[0]._id : null);

        if (!userId) {
          return {
            lastSyncedAt: null,
            cursor: null,
          };
        }

        const cursor = await db.collection('sync_cursors').findOne({
          source: input.source,
          deviceId: input.deviceId,
          userId,
        });

        return {
          lastSyncedAt: cursor?.lastSyncedAt || null,
          cursor: cursor?.cursor || null,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'Roxan Personal Assistant API',
    version: '1.0.0',
    status: 'running',
    database: 'MongoDB Atlas',
    endpoints: {
      health: '/api/health',
      trpc: '/api/trpc',
    },
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({
      status: 'ok',
      database: 'MongoDB Atlas',
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: 'Database connection failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/activity/sync', async (req, res) => {
  try {
    const input = req.body;

    console.log(
      "📤 REST activity sync request:",
      input?.records?.length || 0,
      "records",
    );

    const db = await getDb();
    const now = new Date();

    if (
      !input ||
      !["phone", "watch", "wearable"].includes(input.source) ||
      typeof input.deviceId !== "string" ||
      !Array.isArray(input.records)
    ) {
      return res.status(400).json({
        error: "Invalid activity sync payload",
      });
    }

    const allUsers = await db.collection("users").find().toArray();
    const userId = currentUser?._id ?? (allUsers.length > 0 ? allUsers[0]._id : null);

    console.log("🔍 REST sync userId:", userId, "currentUser:", currentUser?.name || null);

    if (!userId) {
      return res.status(401).json({
        error: "No user available for activity sync",
      });
    }

    let accepted = 0;

    for (const record of input.records) {
      if (
        typeof record.externalId !== "string" ||
        typeof record.recordedAt !== "number" ||
        !Number.isFinite(record.recordedAt)
      ) {
        console.warn("⚠️ Skipping invalid activity record:", record);
        continue;
      }

      const result = await db.collection("activity_records").updateOne(
        {
          externalId: record.externalId,
          userId,
        },
        {
          $set: {
            ...record,
            source: input.source,
            deviceId: input.deviceId,
            userId,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      );

      if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        accepted++;
      }
    }

    const lastSyncedAt = Date.now();

    await db.collection("sync_cursors").updateOne(
      {
        source: input.source,
        deviceId: input.deviceId,
        userId,
      },
      {
        $set: {
          source: input.source,
          deviceId: input.deviceId,
          cursor: input.cursor ?? null,
          lastSyncedAt,
          updatedAt: now,
          userId,
        },
      },
      {
        upsert: true,
      },
    );

    console.log(
      `✅ REST sync completed: ${accepted}/${input.records.length} records`,
    );

    return res.status(200).json({
      accepted,
      duplicates: Math.max(0, input.records.length - accepted),
      lastSyncedAt,
    });
  } catch (error) {
    console.error("❌ REST activity sync error:", error);

    return res.status(500).json({
      error: "Activity sync failed",
      message: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => {
      console.log(`📡 ${req.method} ${req.url}`);
      return {};
    },
  }),
);

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS',
    );
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(200);
  } else {
    next();
  }
});

const PORT = 4000;
app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🔄 Database: MongoDB Atlas`);
  console.log(`📡 tRPC: http://localhost:${PORT}/api/trpc`);
  console.log('='.repeat(50));

  try {
    await connectMongoDB();
    console.log('✅ MongoDB Atlas connection verified!');
  } catch (error) {
    console.error('❌ MongoDB Atlas connection failed:', error);
  }
});