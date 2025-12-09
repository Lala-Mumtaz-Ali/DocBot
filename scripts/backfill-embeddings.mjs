#!/usr/bin/env node
/*
  Backfill embeddings for documents missing or having empty embeddings.
  - Loads .env.local
  - Connects to MongoDB
  - Uses Ollama embeddings (OLLAMA_EMBED_MODEL) to compute vectors for `text`
  - Updates documents' `embedding` field
*/
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { MongoClient } from 'mongodb';

// Ensure .env.local is loaded in addition to default .env
(function loadLocalEnv() {
  const envLocal = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocal)) {
    // dotenv/config already loaded, but we want to ensure .env.local variables take precedence
    const content = fs.readFileSync(envLocal, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
})();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
const COLLECTION = process.env.MONGODB_COLLECTION || 'medical_embeddings';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
const EMB_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment');
  process.exit(1);
}

async function embed(text) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Ollama embeddings error (${res.status}): ${msg}`);
  }
  const data = await res.json();
  const emb = data?.embedding || data?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error('Empty embedding returned');
  return emb;
}

function normalizeText(val) {
  if (typeof val === 'string') return val;
  if (val == null) return '';
  try { return JSON.stringify(val); } catch { return String(val); }
}

async function run() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  let processed = 0, updated = 0, skipped = 0, errors = 0;
  let embDim = null;
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // Use a cursor and filter in code to robustly detect empty/missing embeddings
    const cursor = col.find({}, { batchSize: 50 });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      processed++;
      const text = normalizeText(doc?.[TEXT_KEY]);
      const emb = doc?.[EMB_KEY];
      const needs = !Array.isArray(emb) || emb.length === 0 || typeof emb[0] !== 'number';
      if (!needs) { skipped++; continue; }
      if (!text || text.trim().length === 0) { skipped++; continue; }

      const input = text.length > 8000 ? text.slice(0, 8000) : text; // trim very long text

      try {
        const vector = await embed(input);
        if (embDim == null) embDim = vector.length;
        await col.updateOne({ _id: doc._id }, { $set: { [EMB_KEY]: vector } });
        updated++;
        if (updated % 25 === 0) {
          console.log(`[progress] updated=${updated} processed=${processed} skipped=${skipped} errors=${errors} embDim=${embDim}`);
        }
      } catch (e) {
        errors++;
        console.error(`[error] _id=${doc?._id} ${e?.message || e}`);
      }
    }

    console.log(`[done] updated=${updated} processed=${processed} skipped=${skipped} errors=${errors} embDim=${embDim}`);
    if (embDim != null) {
      console.log(`Embedding dimension detected: ${embDim}. Ensure your Atlas vector index is configured with this dimension on path '${EMB_KEY}'.`);
    }
  } finally {
    try { await client.close(); } catch {}
  }
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
