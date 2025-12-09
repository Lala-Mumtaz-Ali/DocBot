import { MongoClient } from "mongodb";
import dotenv from "dotenv";

// Load environment variables from .env.local (for dev / scripts)
dotenv.config({ path: ".env.local" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "DocBot"; // reuse same DB as embeddings

if (!uri) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
}

let cachedClient = null;
let cachedDb = null;

export async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  try {
    await client.connect();
    const db = client.db(dbName);

    cachedClient = client;
    cachedDb = db;

    return { client, db };
  } catch (error) {
    try {
      await client.close();
    } catch {}
    throw error;
  }
}
