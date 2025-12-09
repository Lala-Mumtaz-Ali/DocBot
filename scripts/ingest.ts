// scripts/ingest.ts
import { MongoClient } from 'mongodb';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import * as fs from 'fs/promises'; // Use promise-based fs
import * as path from 'path';
// Use proper import with esModuleInterop
// @ts-ignore
import pdfParse from 'pdf-parse';
import { parseStringPromise } from 'xml2js'; // xml2js library
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// --- Configuration ---
const dataDir = path.resolve(process.cwd(), 'data'); // Root data directory
const subDirsToProcess = ['books', 'medguides', 'medlineplus_xml']; // Specify subdirectories
const chunkSize = 1000; // Size of text chunks
const chunkOverlap = 150; // Overlap between chunks
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
const collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings';
const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
const TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
const EMBEDDING_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';

// Minimal Ollama embeddings client compatible with LangChain Embeddings interface
class OllamaEmbeddings {
  private model: string;
  private baseUrl: string;
  private batchSize: number;
  private delayMs: number;
  private requestDelayMs: number;

  constructor(opts?: { model?: string; baseUrl?: string; batchSize?: number; delayMs?: number; requestDelayMs?: number }) {
    this.model = opts?.model || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
    this.baseUrl = opts?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.batchSize = opts?.batchSize || 10; // Process 10 embeddings at a time (reduced from 50)
    this.delayMs = opts?.delayMs || 500; // 500ms delay between batches (increased from 100ms)
    this.requestDelayMs = opts?.requestDelayMs || 200; // 200ms delay between individual requests
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const totalBatches = Math.ceil(texts.length / this.batchSize);

    console.log(`Processing ${texts.length} embeddings in ${totalBatches} batches of ${this.batchSize}...`);

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchNum = Math.floor(i / this.batchSize) + 1;

      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} embeddings)...`);

      // Process batch with retry logic
      for (let j = 0; j < batch.length; j++) {
        const text = batch[j];
        let retries = 3;
        while (retries > 0) {
          try {
            const embedding = await this.embed(text);
            results.push(embedding);
            break; // Success, exit retry loop
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error(`Failed to embed text after 3 retries: "${text.substring(0, 50)}..."`);
              console.warn("Skipping problematic chunk by inserting zero-vector.");
              // Return a zero-vector of dimension 768 (standard for nomic-embed-text)
              // This allows the process to continue even if one chunk fails
              results.push(new Array(768).fill(0));
              break;
            }
            console.warn(`Retry ${3 - retries}/3 for embedding...`);
            await this.sleep(2000); // Wait 2 seconds before retry (increased from 1s)
          }
        }

        // Add small delay between individual requests within a batch
        if (j < batch.length - 1) {
          await this.sleep(this.requestDelayMs);
        }
      }

      // Add delay between batches to avoid overwhelming Ollama
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
    // Ollama returns { embedding: number[] }
    const embedding: number[] = data?.embedding || data?.data?.[0]?.embedding;
    if (!embedding) throw new Error('Invalid embeddings response from Ollama');
    return embedding;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// --- Helper Functions ---

/**
 * Reads and extracts text from a PDF file.
 * @param filePath Full path to the PDF file.
 * @returns Extracted text content.
 */
async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = await fs.readFile(filePath);
    // Use the imported pdfParse module
    const data = await pdfParse(dataBuffer);
    // console.log(`Extracted ${data.numpages} pages from ${path.basename(filePath)}`);
    return data.text;
  } catch (error) {
    console.error(`Error reading PDF file ${filePath}:`, error);
    return ''; // Return empty string on error
  }
}

/**
 * Reads and extracts relevant text content from a MedlinePlus XML file.
 * This is a basic example and might need adjustment based on the exact XML structure.
 * It assumes health topics are within <health-topic> tags and extracts title/summary.
 * @param filePath Full path to the XML file.
 * @returns Extracted text content.
 */
async function extractTextFromXml(filePath: string): Promise<string> {
  try {
    const xmlString = await fs.readFile(filePath, 'utf-8');
    const result = await parseStringPromise(xmlString, {
      explicitArray: false, // Don't put single elements into arrays
      tagNameProcessors: [(name) => name.toLowerCase()], // Normalize tag names
    });

    let extractedText = '';

    // --- Adjust this logic based on the actual MedlinePlus XML structure ---
    // The XML structure is: health-topics > health-topic (array)
    const healthTopics = result['health-topics'];
    const topics = healthTopics?.['health-topic'];

    if (Array.isArray(topics)) {
      console.log(`Found ${topics.length} health topics`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topics.forEach((topic: any, index: number) => {
        const title = topic.title || '';
        const summary = topic['full-summary'] || topic.summary || ''; // Use full-summary tag
        if (title) extractedText += `Topic: ${title}\n`;
        if (summary) {
          // Clean up HTML entities and tags
          const cleanSummary = summary
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/<[^>]*>/g, ' ') // Remove HTML tags
            .replace(/\s+/g, ' ')     // Normalize whitespace
            .trim();
          extractedText += `Summary: ${cleanSummary}\n\n`;
        }
        if (index < 5) console.log(`Processed topic: ${title}`);
      });
    } else if (topics) {
      // Handle case if there's only one topic directly under health-topics
      const title = topics.title || '';
      const summary = topics['full-summary'] || topics.summary || '';
      if (title) extractedText += `Topic: ${title}\n`;
      if (summary) {
        const cleanSummary = summary
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        extractedText += `Summary: ${cleanSummary}\n\n`;
      }
    } else {
      console.warn(`Could not find expected 'health-topic' structure in ${path.basename(filePath)}.`);
      console.log('Available keys:', Object.keys(result));
      if (healthTopics) {
        console.log('Health topics keys:', Object.keys(healthTopics));
      }
    }
    // --- End of XML parsing logic ---

    // console.log(`Extracted text from XML ${path.basename(filePath)}`);
    return extractedText;
  } catch (error) {
    console.error(`Error reading or parsing XML file ${filePath}:`, error);
    return ''; // Return empty string on error
  }
}

// --- Main Ingestion Logic ---

async function ingestData() {
  let client: MongoClient | null = null; // Declare client outside try block

  try {
    console.log('Starting ingestion process...');

    // 1. Connect to Database
    if (!MONGODB_URI) {
      throw new Error('Please define MONGODB_URI in .env.local');
    }
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(collectionName);
    console.log(`Connected to DB and using collection: ${collectionName}`);

    // Check for resume
    const START_BATCH = process.env.START_BATCH ? parseInt(process.env.START_BATCH) : 1;
    if (START_BATCH > 1) {
      console.log(`Resuming ingestion from batch ${START_BATCH}. Skipping deletion of existing documents.`);
    } else {
      // Delete existing documents in the collection before ingesting (optional)
      // console.log('Deleting existing documents from collection...');
      // await collection.deleteMany({});
      // console.log('Existing documents deleted.');
    }

    // 2. Initialize Embeddings Model and Text Splitter
    const embeddings = new OllamaEmbeddings({
      model: process.env.OLLAMA_EMBED_MODEL, // e.g., 'nomic-embed-text' or 'all-minilm'
      baseUrl: process.env.OLLAMA_BASE_URL,   // default http://localhost:11434
    });

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
    console.log('Embeddings model and text splitter initialized.');

    // 3. Process Files
    const documents: Document[] = [];
    console.log(`Using embedding model: ${embeddings['model']}`);
    console.log(`Reading files from specified subdirectories in: ${dataDir}`);

    for (const subDir of subDirsToProcess) {
      const fullSubDirPath = path.join(dataDir, subDir);
      try {
        const files = await fs.readdir(fullSubDirPath);
        console.log(`Processing directory: ${subDir} (${files.length} files)`);

        for (const file of files) {
          const filePath = path.join(fullSubDirPath, file);
          const stats = await fs.stat(filePath);

          if (stats.isFile()) {
            let textContent = '';
            const fileExtension = path.extname(file).toLowerCase();

            if (fileExtension === '.pdf') {
              console.log(`Processing PDF file: ${file}`);
              textContent = await extractTextFromPdf(filePath);
              console.log(`Extracted ${textContent.length} characters from ${file}`);
            } else if (fileExtension === '.xml') {
              console.log(`Processing XML file: ${file}`);
              textContent = await extractTextFromXml(filePath);
              console.log(`Extracted ${textContent.length} characters from ${file}`);
            } else {
              console.log(`Skipping unsupported file type: ${file}`);
              continue; // Skip files that are not PDF or XML
            }

            if (textContent) {
              // Create a Document object for LangChain
              documents.push(new Document({
                pageContent: textContent,
                metadata: {
                  source: path.join(subDir, file), // Store relative path as source
                  lastModified: stats.mtime,
                },
              }));
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.warn(`Directory not found, skipping: ${fullSubDirPath}`);
        } else {
          console.error(`Error reading directory ${fullSubDirPath}:`, error);
        }
      }
    }

    if (documents.length === 0) {
      console.error("No documents found or extracted. Please check the 'data' directory and file contents.");
      return; // Exit if no documents were processed
    }
    console.log(`Total documents extracted: ${documents.length}`);

    // 4. Split Documents into Chunks
    console.log('Splitting documents into chunks...');
    const chunks = await textSplitter.splitDocuments(documents);
    console.log(`Total chunks created: ${chunks.length}`);

    if (chunks.length === 0) {
      console.error("No chunks were created. Text content might be too short or splitter config issue.");
      return;
    }

    // 5. Create Vector Store and Add Chunks in Batches
    console.log('Creating MongoDB Atlas Vector Search store and adding chunks in batches...');
    // Ensure index exists on the collection before running this.

    // Process chunks in batches to avoid overwhelming Ollama
    const CHUNK_BATCH_SIZE = 100;
    const totalChunkBatches = Math.ceil(chunks.length / CHUNK_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
      const chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
      const batchNum = Math.floor(i / CHUNK_BATCH_SIZE) + 1;

      if (batchNum < START_BATCH) {
        if (batchNum % 10 === 0) console.log(`Skipping batch ${batchNum} (processed)...`);
        continue;
      }

      console.log(`\nAdding chunk batch ${batchNum}/${totalChunkBatches} (${chunkBatch.length} chunks)...`);

      if (i === 0 && START_BATCH === 1) {
        // First batch: create the vector store
        await MongoDBAtlasVectorSearch.fromDocuments(
          chunkBatch,
          embeddings,
          {
            collection: collection,
            indexName: VECTOR_INDEX,
            textKey: TEXT_KEY,
            embeddingKey: EMBEDDING_KEY,
          }
        );
      } else {
        // Subsequent batches: add to existing vector store
        const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
          collection: collection,
          indexName: VECTOR_INDEX,
          textKey: TEXT_KEY,
          embeddingKey: EMBEDDING_KEY,
        });
        await vectorStore.addDocuments(chunkBatch);
      }

      console.log(`Batch ${batchNum}/${totalChunkBatches} completed.`);
    }

    console.log('Successfully added chunks to MongoDB Atlas Vector Search.');

    // Safety net: Backfill any docs that somehow have empty/missing embeddings
    console.log('Verifying and backfilling empty/missing embeddings (if any)...');
    let checked = 0;
    let fixed = 0;
    const cur = collection.find({}, { batchSize: 100 });
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
        if (fixed % 25 === 0) console.log(`[backfill] fixed=${fixed}`);
      } catch (e) {
        console.error(`[backfill-error] _id=${doc?._id} ${(e as Error)?.message || e}`);
      }
    }
    console.log(`Backfill complete. Checked=${checked}, fixed=${fixed}`);
    console.log('--- Ingestion Complete ---');

  } catch (error) {
    console.error('An error occurred during the ingestion process:', error);
    process.exit(1); // Exit with error code
  } finally {
    // 6. Close DB Connection (Important!)
    if (client) {
      await client.close();
      console.log('Database connection closed.');
    }
  }
}

// Run the ingestion function
ingestData();