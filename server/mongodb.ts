import { MongoClient, Db } from 'mongodb';

// MongoDB Atlas Connection String
const MONGODB_URI = 'mongodb+srv://mddilkaah9036_db_user:0SZDop4mQR0CC1Gs@cluster0.1hbvk6a.mongodb.net/personal-assistant';

let client: MongoClient | null = null;
let db: Db | null = null;
let isConnected = false;

export async function connectMongoDB(): Promise<Db> {
  if (db) {
    return db;
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    isConnected = true;
    console.log('✅ Connected to MongoDB Atlas!');
    
    await createIndexes(db);
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

async function createIndexes(db: Db) {
  try {
    await db.collection('activity_records').createIndex(
      { userId: 1, externalId: 1 }, 
      { unique: true }
    );
    await db.collection('activity_records').createIndex(
      { userId: 1, recordedAt: 1 }
    );
    
    await db.collection('sync_cursors').createIndex(
      { userId: 1, source: 1, deviceId: 1 }, 
      { unique: true }
    );
    
    await db.collection('users').createIndex(
      { openId: 1 }, 
      { unique: true }
    );
    await db.collection('users').createIndex(
      { name: 1 }
    );
    
    console.log('✅ MongoDB indexes created');
  } catch (error) {
    console.warn('⚠️ Index creation warning:', error);
  }
}

export async function getDb(): Promise<Db> {
  if (!db) {
    await connectMongoDB();
  }
  return db!;
}

export async function closeMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    isConnected = false;
    console.log('🔌 MongoDB connection closed');
  }
}

export function isMongoDBConnected(): boolean {
  return isConnected;
}

export function getCollection(name: string) {
  return getDb().then(db => db.collection(name));
}

export const activityRecords = {
  async create(data: any) {
    const db = await getDb();
    return db.collection('activity_records').insertOne(data);
  },
  
  async find(query: any = {}) {
    const db = await getDb();
    return db.collection('activity_records').find(query).toArray();
  },
  
  async findOne(query: any) {
    const db = await getDb();
    return db.collection('activity_records').findOne(query);
  },
  
  async update(query: any, data: any) {
    const db = await getDb();
    return db.collection('activity_records').updateOne(query, data, { upsert: true });
  },
  
  async upsert(query: any, data: any) {
    const db = await getDb();
    return db.collection('activity_records').updateOne(
      query,
      {
        $set: { ...data, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  },
  
  async findByDateRange(userId: any, from: number, to: number) {
    const db = await getDb();
    return db.collection('activity_records')
      .find({
        userId,
        recordedAt: { $gte: from, $lte: to }
      })
      .sort({ recordedAt: 1 })
      .toArray();
  }
};

export const syncCursors = {
  async upsert(query: any, data: any) {
    const db = await getDb();
    return db.collection('sync_cursors').updateOne(
      query,
      {
        $set: { ...data, updatedAt: new Date() },
      },
      { upsert: true }
    );
  },
  
  async findOne(query: any) {
    const db = await getDb();
    return db.collection('sync_cursors').findOne(query);
  },
  
  async findByUser(userId: any) {
    const db = await getDb();
    return db.collection('sync_cursors').find({ userId }).toArray();
  }
};

export const users = {
  async create(data: any) {
    const db = await getDb();
    return db.collection('users').insertOne(data);
  },
  
  async findOne(query: any) {
    const db = await getDb();
    return db.collection('users').findOne(query);
  },
  
  async findByName(name: string) {
    const db = await getDb();
    return db.collection('users').findOne({ name });
  },
  
  async findByOpenId(openId: string) {
    const db = await getDb();
    return db.collection('users').findOne({ openId });
  },
  
  async findAll() {
    const db = await getDb();
    return db.collection('users').find().toArray();
  },
  
  async upsert(query: any, data: any) {
    const db = await getDb();
    return db.collection('users').updateOne(
      query,
      {
        $set: { ...data, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  },
  
  async updateLastSignedIn(name: string) {
    const db = await getDb();
    return db.collection('users').updateOne(
      { name },
      { $set: { lastSignedIn: new Date(), updatedAt: new Date() } }
    );
  }
};

export default {
  connectMongoDB,
  getDb,
  closeMongoDB,
  isMongoDBConnected,
  getCollection,
  activityRecords,
  syncCursors,
  users,
};