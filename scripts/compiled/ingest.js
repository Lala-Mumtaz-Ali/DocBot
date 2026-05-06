"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/ingest.ts
const mongodb_1 = require("mongodb");
const mongodb_2 = require("@langchain/mongodb");
const textsplitters_1 = require("@langchain/textsplitters");
const documents_1 = require("@langchain/core/documents");
const fs = __importStar(require("fs/promises")); // Use promise-based fs
const path = __importStar(require("path"));
// Use proper import with esModuleInterop
// @ts-ignore
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const xml2js_1 = require("xml2js"); // xml2js library
const dotenv = __importStar(require("dotenv"));
const transformers_1 = require("@xenova/transformers");
// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });
// --- Configuration ---
const dataDir = path.resolve(process.cwd(), 'data_DocBot_Chat'); // Root data directory
const subDirsToProcess = ['books', 'medguides', 'medlineplus_xml']; // Specify subdirectories
const chunkSize = 1000; // Size of text chunks
const chunkOverlap = 150; // Overlap between chunks
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
const collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings';
const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
const TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
const EMBEDDING_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';
// Minimal local embeddings client using Xenova/transformers (runs entirely in JS, no Ollama needed)
class LocalEmbeddings {
    modelName;
    extractor;
    constructor(opts) {
        this.modelName = opts?.model || 'Xenova/all-MiniLM-L6-v2';
    }
    async getExtractor() {
        if (!this.extractor) {
            console.log(`Loading local embedding model: ${this.modelName}...`);
            this.extractor = await (0, transformers_1.pipeline)('feature-extraction', this.modelName);
        }
        return this.extractor;
    }
    async embedDocuments(texts) {
        const extractor = await this.getExtractor();
        const results = [];
        console.log(`Generating embeddings for ${texts.length} chunks...`);
        const batchSize = 10;
        const totalBatches = Math.ceil(texts.length / batchSize);
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${totalBatches}`);
            try {
                const outputs = await extractor(batch, { pooling: 'mean', normalize: true });
                const arr = outputs.tolist();
                results.push(...arr);
            }
            catch (error) {
                console.error("Error generating embeddings for batch, inserting zero-vectors.");
                for (let j = 0; j < batch.length; j++) {
                    results.push(new Array(384).fill(0));
                }
            }
        }
        return results;
    }
    async embedQuery(text) {
        const extractor = await this.getExtractor();
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return output.tolist()[0];
    }
}
// --- Helper Functions ---
/**
 * Reads and extracts text from a PDF file.
 * @param filePath Full path to the PDF file.
 * @returns Extracted text content.
 */
async function extractTextFromPdf(filePath) {
    try {
        const dataBuffer = await fs.readFile(filePath);
        // Use the imported pdfParse module
        const data = await (0, pdf_parse_1.default)(dataBuffer);
        // console.log(`Extracted ${data.numpages} pages from ${path.basename(filePath)}`);
        return data.text;
    }
    catch (error) {
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
async function extractTextFromXml(filePath) {
    try {
        const xmlString = await fs.readFile(filePath, 'utf-8');
        const result = await (0, xml2js_1.parseStringPromise)(xmlString, {
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
            topics.forEach((topic, index) => {
                const title = topic.title || '';
                const summary = topic['full-summary'] || topic.summary || ''; // Use full-summary tag
                if (title)
                    extractedText += `Topic: ${title}\n`;
                if (summary) {
                    // Clean up HTML entities and tags
                    const cleanSummary = summary
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&')
                        .replace(/<[^>]*>/g, ' ') // Remove HTML tags
                        .replace(/\s+/g, ' ') // Normalize whitespace
                        .trim();
                    extractedText += `Summary: ${cleanSummary}\n\n`;
                }
                if (index < 5)
                    console.log(`Processed topic: ${title}`);
            });
        }
        else if (topics) {
            // Handle case if there's only one topic directly under health-topics
            const title = topics.title || '';
            const summary = topics['full-summary'] || topics.summary || '';
            if (title)
                extractedText += `Topic: ${title}\n`;
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
        }
        else {
            console.warn(`Could not find expected 'health-topic' structure in ${path.basename(filePath)}.`);
            console.log('Available keys:', Object.keys(result));
            if (healthTopics) {
                console.log('Health topics keys:', Object.keys(healthTopics));
            }
        }
        // --- End of XML parsing logic ---
        // console.log(`Extracted text from XML ${path.basename(filePath)}`);
        return extractedText;
    }
    catch (error) {
        console.error(`Error reading or parsing XML file ${filePath}:`, error);
        return ''; // Return empty string on error
    }
}
// --- Main Ingestion Logic ---
async function ingestData() {
    let client = null; // Declare client outside try block
    try {
        console.log('Starting ingestion process...');
        // 1. Connect to Database
        if (!MONGODB_URI) {
            throw new Error('Please define MONGODB_URI in .env.local');
        }
        client = new mongodb_1.MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(collectionName);
        console.log(`Connected to DB and using collection: ${collectionName}`);
        // Check for resume
        const START_BATCH = process.env.START_BATCH ? parseInt(process.env.START_BATCH) : 1;
        if (START_BATCH > 1) {
            console.log(`Resuming ingestion from batch ${START_BATCH}. Skipping deletion of existing documents.`);
        }
        else {
            // Delete existing documents in the collection before ingesting (optional)
            // console.log('Deleting existing documents from collection...');
            // await collection.deleteMany({});
            // console.log('Existing documents deleted.');
        }
        // 2. Initialize Embeddings Model and Text Splitter
        const embeddings = new LocalEmbeddings({
            model: 'Xenova/all-MiniLM-L6-v2', // Matches the Python backend dimensions (384)
        });
        const textSplitter = new textsplitters_1.RecursiveCharacterTextSplitter({
            chunkSize,
            chunkOverlap,
        });
        console.log('Embeddings model and text splitter initialized.');
        // 3. Process Files
        const documents = [];
        console.log(`Using embedding model: Xenova/all-MiniLM-L6-v2`);
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
                        }
                        else if (fileExtension === '.xml') {
                            console.log(`Processing XML file: ${file}`);
                            textContent = await extractTextFromXml(filePath);
                            console.log(`Extracted ${textContent.length} characters from ${file}`);
                        }
                        else {
                            console.log(`Skipping unsupported file type: ${file}`);
                            continue; // Skip files that are not PDF or XML
                        }
                        if (textContent) {
                            // Create a Document object for LangChain
                            documents.push(new documents_1.Document({
                                pageContent: textContent,
                                metadata: {
                                    source: path.join(subDir, file), // Store relative path as source
                                    lastModified: stats.mtime,
                                },
                            }));
                        }
                    }
                }
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    console.warn(`Directory not found, skipping: ${fullSubDirPath}`);
                }
                else {
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
                if (batchNum % 10 === 0)
                    console.log(`Skipping batch ${batchNum} (processed)...`);
                continue;
            }
            console.log(`\nAdding chunk batch ${batchNum}/${totalChunkBatches} (${chunkBatch.length} chunks)...`);
            if (i === 0 && START_BATCH === 1) {
                // First batch: create the vector store
                await mongodb_2.MongoDBAtlasVectorSearch.fromDocuments(chunkBatch, embeddings, {
                    collection: collection,
                    indexName: VECTOR_INDEX,
                    textKey: TEXT_KEY,
                    embeddingKey: EMBEDDING_KEY,
                });
            }
            else {
                // Subsequent batches: add to existing vector store
                const vectorStore = new mongodb_2.MongoDBAtlasVectorSearch(embeddings, {
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
            if (!doc) {
                continue;
            }
            checked++;
            const emb = doc?.[EMBEDDING_KEY];
            const needs = !Array.isArray(emb) || emb.length === 0 || typeof emb[0] !== 'number';
            if (!needs)
                continue;
            const txt = (doc?.[TEXT_KEY] ?? doc?.pageContent ?? '').toString();
            if (!txt || txt.trim().length === 0)
                continue;
            try {
                const vec = await embeddings.embedQuery(txt);
                await collection.updateOne({ _id: doc._id }, { $set: { [EMBEDDING_KEY]: vec } });
                fixed++;
                if (fixed % 25 === 0)
                    console.log(`[backfill] fixed=${fixed}`);
            }
            catch (e) {
                console.error(`[backfill-error] _id=${doc?._id} ${e?.message || e}`);
            }
        }
        console.log(`Backfill complete. Checked=${checked}, fixed=${fixed}`);
        console.log('--- Ingestion Complete ---');
    }
    catch (error) {
        console.error('An error occurred during the ingestion process:', error);
        process.exit(1); // Exit with error code
    }
    finally {
        // 6. Close DB Connection (Important!)
        if (client) {
            await client.close();
            console.log('Database connection closed.');
        }
    }
}
// Run the ingestion function
ingestData();
