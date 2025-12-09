// scripts/ingest-smallTalk.ts
import { MongoClient } from 'mongodb';
// Use local Ollama for embeddings
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// --- Configuration ---
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
const collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings'; // reuse existing collection
const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
const TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
const EMBEDDING_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';

// @ts-ignore
import pdfParse from 'pdf-parse';

// --- File/Chunk Configuration ---
const dataDir = path.resolve(process.cwd(), 'data', 'smallTalk');
const chunkSize = 1000;
const chunkOverlap = 150;

// Match ingest.ts PDF parsing logic
async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text || '';
  } catch (error) {
    console.error(`Error reading PDF file ${filePath}:`, error);
    return '';
  }
}

// Robust Ollama embeddings client compatible with LangChain Embeddings interface
class OllamaEmbeddings {
  private model: string;
  private baseUrl: string;
  private batchSize: number;
  private delayMs: number;
  private requestDelayMs: number;

  constructor(opts?: { model?: string; baseUrl?: string; batchSize?: number; delayMs?: number; requestDelayMs?: number }) {
    this.model = opts?.model || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
    this.baseUrl = opts?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.batchSize = opts?.batchSize || 10;
    this.delayMs = opts?.delayMs || 500;
    this.requestDelayMs = opts?.requestDelayMs || 200;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const totalBatches = Math.ceil(texts.length / this.batchSize);

    console.log(`Processing ${texts.length} embeddings in ${totalBatches} batches of ${this.batchSize}...`);

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchNum = Math.floor(i / this.batchSize) + 1;

      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} embeddings)...`);

      for (let j = 0; j < batch.length; j++) {
        const text = batch[j];
        let retries = 3;
        while (retries > 0) {
          try {
            const embedding = await this.embed(text);
            results.push(embedding);
            break;
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error(`Failed to embed text after 3 retries: "${text.substring(0, 50)}..."`);
              console.warn("Skipping problematic chunk by inserting zero-vector.");
              results.push(new Array(768).fill(0));
              break;
            }
            console.warn(`Retry ${3 - retries}/3 for embedding...`);
            await this.sleep(2000);
          }
        }

        if (j < batch.length - 1) {
          await this.sleep(this.requestDelayMs);
        }
      }

      if (i + this.batchSize < texts.length) {
        await this.sleep(this.delayMs);
      }
    }

    console.log(`Completed processing ${results.length} embeddings.`);
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Ollama embeddings error (${res.status}): ${msg}`);
    }
    const data = await res.json();
    const embedding: number[] = data?.embedding || data?.data?.[0]?.embedding;
    if (!embedding) throw new Error('Invalid embeddings response from Ollama');
    return embedding;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function ingestSmallTalk() {
  let client: MongoClient | null = null;

  try {
    console.log('Starting smallTalk ingestion...');

    // 1) Connect to DB
    if (!MONGODB_URI) {
      throw new Error('Please define MONGODB_URI in .env.local');
    }
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(collectionName);
    console.log(`Connected. Using collection: ${collectionName}`);

    // 2) Initialize embeddings + splitter
    const embeddings = new OllamaEmbeddings({
      model: process.env.OLLAMA_EMBED_MODEL,
      baseUrl: process.env.OLLAMA_BASE_URL,
    });

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    // 3) Gather documents from data/smallTalk
    const documents: Document[] = [];
    console.log(`Using embedding model: ${embeddings['model']}`);

    let files: string[] = [];
    try {
      files = await fs.readdir(dataDir);
    } catch {
      console.error(`Directory not found: ${dataDir}`);
      process.exit(1);
    }

    console.log(`Found ${files.length} files in smallTalk`);

    for (const file of files) {
      try {
        const filePath = path.join(dataDir, file);

        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch (statErr) {
          console.warn(`Could not stat file ${file}:`, statErr);
          continue;
        }

        if (!stats.isFile()) continue;

        const ext = path.extname(file).toLowerCase();

        if (ext === '.json') {
          console.log(`Processing JSON: ${file}`);
          try {
            const jsonContent = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(jsonContent);
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
              if (item.term && item.definition) {
                documents.push(new Document({
                  pageContent: `What is ${item.term}?\n\n${item.definition}`,
                  metadata: {
                    source: path.join('smallTalk', file),
                    lastModified: stats.mtime,
                    term: item.term,
                    type: 'definition'
                  }
                }));
              }
            }
            console.log(`Extracted ${items.length} definitions from ${file}`);
          } catch (e) {
            console.error(`Error parsing JSON ${file}:`, e);
          }
          continue;
        }

        if (ext !== '.pdf') {
          console.log(`Skipping unsupported file: ${file}`);
          continue;
        }

        console.log(`Processing PDF: ${file}`);
        const textContent = await extractTextFromPdf(filePath);
        if (!textContent) continue;

        documents.push(
          new Document({
            pageContent: textContent,
            metadata: {
              source: path.join('smallTalk', file),
              lastModified: stats.mtime,
            },
          })
        );
      } catch (fileLoopError) {
        console.error(`Unexpected error processing file ${file}:`, fileLoopError);
      }
    }

    if (documents.length === 0) {
      console.error('No PDF content extracted from data/smallTalk');
      return;
    }

    console.log(`Total smallTalk documents: ${documents.length}`);

    // 4) Split into chunks
    const chunks = await textSplitter.splitDocuments(documents);
    console.log(`Total chunks: ${chunks.length}`);
    if (chunks.length === 0) return;

    // 5) Clean up prior smallTalk docs only (do not wipe the whole collection)
    console.log('Removing previous smallTalk docs from collection...');
    await collection.deleteMany({ 'metadata.source': { $regex: '^smallTalk/' } });

    // 6) Insert into vector store in BATCHES
    console.log('Adding chunks to MongoDB Atlas Vector Search...');

    // Process chunks in batches to avoid overwhelming Ollama
    const CHUNK_BATCH_SIZE = 100;
    const totalChunkBatches = Math.ceil(chunks.length / CHUNK_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
      const chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
      const batchNum = Math.floor(i / CHUNK_BATCH_SIZE) + 1;

      console.log(`\nProcessing chunk batch ${batchNum}/${totalChunkBatches} (${chunkBatch.length} chunks)...`);

      // Manual embedding generation and insertion to avoid vectorStore silent failures
      try {
        const texts = chunkBatch.map(c => c.pageContent);
        const vectors = await embeddings.embedDocuments(texts);

        if (vectors.length !== chunkBatch.length) {
          throw new Error(`Vector count mismatch in batch ${batchNum}: ${vectors.length} vs ${chunkBatch.length}`);
        }

        const docsToInsert = chunkBatch.map((chunk, idx) => ({
          [TEXT_KEY]: chunk.pageContent,
          [EMBEDDING_KEY]: vectors[idx],
          metadata: chunk.metadata // Explicit nesting for backend compatibility
        }));

        console.log(`Inserting batch ${batchNum} manually...`);
        await collection.insertMany(docsToInsert);
        console.log(`Batch ${batchNum}/${totalChunkBatches} completed.`);

      } catch (batchError) {
        console.error(`Error processing batch ${batchNum}:`, batchError);
        // Optional: continue or throw? Throwing is safer for data integrity.
        throw batchError;
      }
    }

    // Safety net: Backfill
    console.log('Verifying and backfilling empty/missing embeddings for smallTalk...');
    let checked = 0;
    let fixed = 0;
    const cur = collection.find({ 'metadata.source': { $regex: '^smallTalk/' } }, { batchSize: 100 });
    while (await cur.hasNext()) {
      const doc = await cur.next();
      if (!doc) { continue; }
      checked++;
      const emb = doc?.[EMBEDDING_KEY];
      const needs = !Array.isArray(emb) || emb.length === 0 || typeof emb[0] !== 'number';
      if (!needs) continue;
      const txt: string = (doc?.[TEXT_KEY] ?? doc?.pageContent ?? '').toString();
      if (!txt || txt.trim().length === 0) continue;
      try {
        const vec = await embeddings.embedQuery(txt);
        await collection.updateOne({ _id: doc._id }, { $set: { [EMBEDDING_KEY]: vec } });
        fixed++;
        if (fixed % 25 === 0) console.log(`[backfill-smallTalk] fixed=${fixed}`);
      } catch (e) {
        console.error(`[backfill-smallTalk-error] _id=${doc?._id} ${(e as Error)?.message || e}`);
      }
    }
    console.log(`Backfill smallTalk complete. Checked=${checked}, fixed=${fixed}`);
    console.log('Ingestion complete for smallTalk');
  } catch (error) {
    console.error('Error during smallTalk ingestion:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('Database connection closed.');
    }
  }
}

ingestSmallTalk();
