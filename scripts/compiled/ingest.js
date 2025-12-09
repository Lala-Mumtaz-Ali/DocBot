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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/ingest.ts
var mongodb_1 = require("mongodb");
var mongodb_2 = require("@langchain/mongodb");
var textsplitters_1 = require("@langchain/textsplitters");
var documents_1 = require("@langchain/core/documents");
var fs = __importStar(require("fs/promises")); // Use promise-based fs
var path = __importStar(require("path"));
// Use proper import with esModuleInterop
// @ts-ignore
var pdf_parse_1 = __importDefault(require("pdf-parse"));
var xml2js_1 = require("xml2js"); // xml2js library
var dotenv = __importStar(require("dotenv"));
// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });
// --- Configuration ---
var dataDir = path.resolve(process.cwd(), 'data'); // Root data directory
var subDirsToProcess = ['books', 'medguides', 'medlineplus_xml']; // Specify subdirectories
var chunkSize = 1000; // Size of text chunks
var chunkOverlap = 150; // Overlap between chunks
var MONGODB_URI = process.env.MONGODB_URI;
var DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
var collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings';
var VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
var TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
var EMBEDDING_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';
// Minimal Ollama embeddings client compatible with LangChain Embeddings interface
var OllamaEmbeddings = /** @class */ (function () {
    function OllamaEmbeddings(opts) {
        this.model = (opts === null || opts === void 0 ? void 0 : opts.model) || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
        this.baseUrl = (opts === null || opts === void 0 ? void 0 : opts.baseUrl) || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.batchSize = (opts === null || opts === void 0 ? void 0 : opts.batchSize) || 10; // Process 10 embeddings at a time (reduced from 50)
        this.delayMs = (opts === null || opts === void 0 ? void 0 : opts.delayMs) || 500; // 500ms delay between batches (increased from 100ms)
        this.requestDelayMs = (opts === null || opts === void 0 ? void 0 : opts.requestDelayMs) || 200; // 200ms delay between individual requests
    }
    OllamaEmbeddings.prototype.embedDocuments = function (texts) {
        return __awaiter(this, void 0, void 0, function () {
            var results, totalBatches, i, batch, batchNum, j, text, retries, embedding, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        results = [];
                        totalBatches = Math.ceil(texts.length / this.batchSize);
                        console.log("Processing ".concat(texts.length, " embeddings in ").concat(totalBatches, " batches of ").concat(this.batchSize, "..."));
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < texts.length)) return [3 /*break*/, 15];
                        batch = texts.slice(i, i + this.batchSize);
                        batchNum = Math.floor(i / this.batchSize) + 1;
                        console.log("Processing batch ".concat(batchNum, "/").concat(totalBatches, " (").concat(batch.length, " embeddings)..."));
                        j = 0;
                        _a.label = 2;
                    case 2:
                        if (!(j < batch.length)) return [3 /*break*/, 12];
                        text = batch[j];
                        retries = 3;
                        _a.label = 3;
                    case 3:
                        if (!(retries > 0)) return [3 /*break*/, 9];
                        _a.label = 4;
                    case 4:
                        _a.trys.push([4, 6, , 8]);
                        return [4 /*yield*/, this.embed(text)];
                    case 5:
                        embedding = _a.sent();
                        results.push(embedding);
                        return [3 /*break*/, 9]; // Success, exit retry loop
                    case 6:
                        error_1 = _a.sent();
                        retries--;
                        if (retries === 0) {
                            console.error("Failed to embed text after 3 retries: \"".concat(text.substring(0, 50), "...\""));
                            console.warn("Skipping problematic chunk by inserting zero-vector.");
                            // Return a zero-vector of dimension 768 (standard for nomic-embed-text)
                            // This allows the process to continue even if one chunk fails
                            results.push(new Array(768).fill(0));
                            return [3 /*break*/, 9];
                        }
                        console.warn("Retry ".concat(3 - retries, "/3 for embedding..."));
                        return [4 /*yield*/, this.sleep(2000)];
                    case 7:
                        _a.sent(); // Wait 2 seconds before retry (increased from 1s)
                        return [3 /*break*/, 8];
                    case 8: return [3 /*break*/, 3];
                    case 9:
                        if (!(j < batch.length - 1)) return [3 /*break*/, 11];
                        return [4 /*yield*/, this.sleep(this.requestDelayMs)];
                    case 10:
                        _a.sent();
                        _a.label = 11;
                    case 11:
                        j++;
                        return [3 /*break*/, 2];
                    case 12:
                        if (!(i + this.batchSize < texts.length)) return [3 /*break*/, 14];
                        return [4 /*yield*/, this.sleep(this.delayMs)];
                    case 13:
                        _a.sent();
                        _a.label = 14;
                    case 14:
                        i += this.batchSize;
                        return [3 /*break*/, 1];
                    case 15:
                        console.log("Completed processing ".concat(results.length, " embeddings."));
                        return [2 /*return*/, results];
                }
            });
        });
    };
    OllamaEmbeddings.prototype.embedQuery = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.embed(text)];
            });
        });
    };
    OllamaEmbeddings.prototype.embed = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            var res, msg, data, embedding;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, fetch("".concat(this.baseUrl, "/api/embeddings"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ model: this.model, prompt: text }),
                        })];
                    case 1:
                        res = _c.sent();
                        if (!!res.ok) return [3 /*break*/, 3];
                        return [4 /*yield*/, res.text().catch(function () { return ''; })];
                    case 2:
                        msg = _c.sent();
                        throw new Error("Ollama embeddings error (".concat(res.status, "): ").concat(msg));
                    case 3: return [4 /*yield*/, res.json()];
                    case 4:
                        data = _c.sent();
                        embedding = (data === null || data === void 0 ? void 0 : data.embedding) || ((_b = (_a = data === null || data === void 0 ? void 0 : data.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.embedding);
                        if (!embedding)
                            throw new Error('Invalid embeddings response from Ollama');
                        return [2 /*return*/, embedding];
                }
            });
        });
    };
    OllamaEmbeddings.prototype.sleep = function (ms) {
        return new Promise(function (resolve) { return setTimeout(resolve, ms); });
    };
    return OllamaEmbeddings;
}());
// --- Helper Functions ---
/**
 * Reads and extracts text from a PDF file.
 * @param filePath Full path to the PDF file.
 * @returns Extracted text content.
 */
function extractTextFromPdf(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dataBuffer, data, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fs.readFile(filePath)];
                case 1:
                    dataBuffer = _a.sent();
                    return [4 /*yield*/, (0, pdf_parse_1.default)(dataBuffer)];
                case 2:
                    data = _a.sent();
                    // console.log(`Extracted ${data.numpages} pages from ${path.basename(filePath)}`);
                    return [2 /*return*/, data.text];
                case 3:
                    error_2 = _a.sent();
                    console.error("Error reading PDF file ".concat(filePath, ":"), error_2);
                    return [2 /*return*/, '']; // Return empty string on error
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Reads and extracts relevant text content from a MedlinePlus XML file.
 * This is a basic example and might need adjustment based on the exact XML structure.
 * It assumes health topics are within <health-topic> tags and extracts title/summary.
 * @param filePath Full path to the XML file.
 * @returns Extracted text content.
 */
function extractTextFromXml(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var xmlString, result, extractedText_1, healthTopics, topics, title, summary, cleanSummary, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fs.readFile(filePath, 'utf-8')];
                case 1:
                    xmlString = _a.sent();
                    return [4 /*yield*/, (0, xml2js_1.parseStringPromise)(xmlString, {
                            explicitArray: false, // Don't put single elements into arrays
                            tagNameProcessors: [function (name) { return name.toLowerCase(); }], // Normalize tag names
                        })];
                case 2:
                    result = _a.sent();
                    extractedText_1 = '';
                    healthTopics = result['health-topics'];
                    topics = healthTopics === null || healthTopics === void 0 ? void 0 : healthTopics['health-topic'];
                    if (Array.isArray(topics)) {
                        console.log("Found ".concat(topics.length, " health topics"));
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        topics.forEach(function (topic, index) {
                            var title = topic.title || '';
                            var summary = topic['full-summary'] || topic.summary || ''; // Use full-summary tag
                            if (title)
                                extractedText_1 += "Topic: ".concat(title, "\n");
                            if (summary) {
                                // Clean up HTML entities and tags
                                var cleanSummary = summary
                                    .replace(/&lt;/g, '<')
                                    .replace(/&gt;/g, '>')
                                    .replace(/&amp;/g, '&')
                                    .replace(/<[^>]*>/g, ' ') // Remove HTML tags
                                    .replace(/\s+/g, ' ') // Normalize whitespace
                                    .trim();
                                extractedText_1 += "Summary: ".concat(cleanSummary, "\n\n");
                            }
                            if (index < 5)
                                console.log("Processed topic: ".concat(title));
                        });
                    }
                    else if (topics) {
                        title = topics.title || '';
                        summary = topics['full-summary'] || topics.summary || '';
                        if (title)
                            extractedText_1 += "Topic: ".concat(title, "\n");
                        if (summary) {
                            cleanSummary = summary
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&amp;/g, '&')
                                .replace(/<[^>]*>/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                            extractedText_1 += "Summary: ".concat(cleanSummary, "\n\n");
                        }
                    }
                    else {
                        console.warn("Could not find expected 'health-topic' structure in ".concat(path.basename(filePath), "."));
                        console.log('Available keys:', Object.keys(result));
                        if (healthTopics) {
                            console.log('Health topics keys:', Object.keys(healthTopics));
                        }
                    }
                    // --- End of XML parsing logic ---
                    // console.log(`Extracted text from XML ${path.basename(filePath)}`);
                    return [2 /*return*/, extractedText_1];
                case 3:
                    error_3 = _a.sent();
                    console.error("Error reading or parsing XML file ".concat(filePath, ":"), error_3);
                    return [2 /*return*/, '']; // Return empty string on error
                case 4: return [2 /*return*/];
            }
        });
    });
}
// --- Main Ingestion Logic ---
function ingestData() {
    return __awaiter(this, void 0, void 0, function () {
        var client, db, collection, START_BATCH, embeddings, textSplitter, documents, _i, subDirsToProcess_1, subDir, fullSubDirPath, files, _a, files_1, file, filePath, stats, textContent, fileExtension, error_4, chunks, CHUNK_BATCH_SIZE, totalChunkBatches, i, chunkBatch, batchNum, vectorStore, checked, fixed, cur, doc, emb, needs, txt, vec, e_1, error_5;
        var _b;
        var _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    client = null;
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 38, 39, 42]);
                    console.log('Starting ingestion process...');
                    // 1. Connect to Database
                    if (!MONGODB_URI) {
                        throw new Error('Please define MONGODB_URI in .env.local');
                    }
                    client = new mongodb_1.MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
                    return [4 /*yield*/, client.connect()];
                case 2:
                    _e.sent();
                    db = client.db(DB_NAME);
                    collection = db.collection(collectionName);
                    console.log("Connected to DB and using collection: ".concat(collectionName));
                    START_BATCH = process.env.START_BATCH ? parseInt(process.env.START_BATCH) : 1;
                    if (!(START_BATCH > 1)) return [3 /*break*/, 3];
                    console.log("Resuming ingestion from batch ".concat(START_BATCH, ". Skipping deletion of existing documents."));
                    return [3 /*break*/, 5];
                case 3:
                    // Delete existing documents in the collection before ingesting (optional)
                    console.log('Deleting existing documents from collection...');
                    return [4 /*yield*/, collection.deleteMany({})];
                case 4:
                    _e.sent();
                    console.log('Existing documents deleted.');
                    _e.label = 5;
                case 5:
                    embeddings = new OllamaEmbeddings({
                        model: process.env.OLLAMA_EMBED_MODEL, // e.g., 'nomic-embed-text' or 'all-minilm'
                        baseUrl: process.env.OLLAMA_BASE_URL, // default http://localhost:11434
                    });
                    textSplitter = new textsplitters_1.RecursiveCharacterTextSplitter({
                        chunkSize: chunkSize,
                        chunkOverlap: chunkOverlap,
                    });
                    console.log('Embeddings model and text splitter initialized.');
                    documents = [];
                    console.log("Using embedding model: ".concat(embeddings['model']));
                    console.log("Reading files from specified subdirectories in: ".concat(dataDir));
                    _i = 0, subDirsToProcess_1 = subDirsToProcess;
                    _e.label = 6;
                case 6:
                    if (!(_i < subDirsToProcess_1.length)) return [3 /*break*/, 20];
                    subDir = subDirsToProcess_1[_i];
                    fullSubDirPath = path.join(dataDir, subDir);
                    _e.label = 7;
                case 7:
                    _e.trys.push([7, 18, , 19]);
                    return [4 /*yield*/, fs.readdir(fullSubDirPath)];
                case 8:
                    files = _e.sent();
                    console.log("Processing directory: ".concat(subDir, " (").concat(files.length, " files)"));
                    _a = 0, files_1 = files;
                    _e.label = 9;
                case 9:
                    if (!(_a < files_1.length)) return [3 /*break*/, 17];
                    file = files_1[_a];
                    filePath = path.join(fullSubDirPath, file);
                    return [4 /*yield*/, fs.stat(filePath)];
                case 10:
                    stats = _e.sent();
                    if (!stats.isFile()) return [3 /*break*/, 16];
                    textContent = '';
                    fileExtension = path.extname(file).toLowerCase();
                    if (!(fileExtension === '.pdf')) return [3 /*break*/, 12];
                    console.log("Processing PDF file: ".concat(file));
                    return [4 /*yield*/, extractTextFromPdf(filePath)];
                case 11:
                    textContent = _e.sent();
                    console.log("Extracted ".concat(textContent.length, " characters from ").concat(file));
                    return [3 /*break*/, 15];
                case 12:
                    if (!(fileExtension === '.xml')) return [3 /*break*/, 14];
                    console.log("Processing XML file: ".concat(file));
                    return [4 /*yield*/, extractTextFromXml(filePath)];
                case 13:
                    textContent = _e.sent();
                    console.log("Extracted ".concat(textContent.length, " characters from ").concat(file));
                    return [3 /*break*/, 15];
                case 14:
                    console.log("Skipping unsupported file type: ".concat(file));
                    return [3 /*break*/, 16]; // Skip files that are not PDF or XML
                case 15:
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
                    _e.label = 16;
                case 16:
                    _a++;
                    return [3 /*break*/, 9];
                case 17: return [3 /*break*/, 19];
                case 18:
                    error_4 = _e.sent();
                    if (error_4.code === 'ENOENT') {
                        console.warn("Directory not found, skipping: ".concat(fullSubDirPath));
                    }
                    else {
                        console.error("Error reading directory ".concat(fullSubDirPath, ":"), error_4);
                    }
                    return [3 /*break*/, 19];
                case 19:
                    _i++;
                    return [3 /*break*/, 6];
                case 20:
                    if (documents.length === 0) {
                        console.error("No documents found or extracted. Please check the 'data' directory and file contents.");
                        return [2 /*return*/]; // Exit if no documents were processed
                    }
                    console.log("Total documents extracted: ".concat(documents.length));
                    // 4. Split Documents into Chunks
                    console.log('Splitting documents into chunks...');
                    return [4 /*yield*/, textSplitter.splitDocuments(documents)];
                case 21:
                    chunks = _e.sent();
                    console.log("Total chunks created: ".concat(chunks.length));
                    if (chunks.length === 0) {
                        console.error("No chunks were created. Text content might be too short or splitter config issue.");
                        return [2 /*return*/];
                    }
                    // 5. Create Vector Store and Add Chunks in Batches
                    console.log('Creating MongoDB Atlas Vector Search store and adding chunks in batches...');
                    CHUNK_BATCH_SIZE = 100;
                    totalChunkBatches = Math.ceil(chunks.length / CHUNK_BATCH_SIZE);
                    i = 0;
                    _e.label = 22;
                case 22:
                    if (!(i < chunks.length)) return [3 /*break*/, 28];
                    chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
                    batchNum = Math.floor(i / CHUNK_BATCH_SIZE) + 1;
                    if (batchNum < START_BATCH) {
                        if (batchNum % 10 === 0)
                            console.log("Skipping batch ".concat(batchNum, " (processed)..."));
                        return [3 /*break*/, 27];
                    }
                    console.log("\nAdding chunk batch ".concat(batchNum, "/").concat(totalChunkBatches, " (").concat(chunkBatch.length, " chunks)..."));
                    if (!(i === 0 && START_BATCH === 1)) return [3 /*break*/, 24];
                    // First batch: create the vector store
                    return [4 /*yield*/, mongodb_2.MongoDBAtlasVectorSearch.fromDocuments(chunkBatch, embeddings, {
                            collection: collection,
                            indexName: VECTOR_INDEX,
                            textKey: TEXT_KEY,
                            embeddingKey: EMBEDDING_KEY,
                        })];
                case 23:
                    // First batch: create the vector store
                    _e.sent();
                    return [3 /*break*/, 26];
                case 24:
                    vectorStore = new mongodb_2.MongoDBAtlasVectorSearch(embeddings, {
                        collection: collection,
                        indexName: VECTOR_INDEX,
                        textKey: TEXT_KEY,
                        embeddingKey: EMBEDDING_KEY,
                    });
                    return [4 /*yield*/, vectorStore.addDocuments(chunkBatch)];
                case 25:
                    _e.sent();
                    _e.label = 26;
                case 26:
                    console.log("Batch ".concat(batchNum, "/").concat(totalChunkBatches, " completed."));
                    _e.label = 27;
                case 27:
                    i += CHUNK_BATCH_SIZE;
                    return [3 /*break*/, 22];
                case 28:
                    console.log('Successfully added chunks to MongoDB Atlas Vector Search.');
                    // Safety net: Backfill any docs that somehow have empty/missing embeddings
                    console.log('Verifying and backfilling empty/missing embeddings (if any)...');
                    checked = 0;
                    fixed = 0;
                    cur = collection.find({}, { batchSize: 100 });
                    _e.label = 29;
                case 29: return [4 /*yield*/, cur.hasNext()];
                case 30:
                    if (!_e.sent()) return [3 /*break*/, 37];
                    return [4 /*yield*/, cur.next()];
                case 31:
                    doc = _e.sent();
                    if (!doc) {
                        return [3 /*break*/, 29];
                    }
                    checked++;
                    emb = doc === null || doc === void 0 ? void 0 : doc[EMBEDDING_KEY];
                    needs = !Array.isArray(emb) || emb.length === 0 || typeof emb[0] !== 'number';
                    if (!needs)
                        return [3 /*break*/, 29];
                    txt = ((_d = (_c = doc === null || doc === void 0 ? void 0 : doc[TEXT_KEY]) !== null && _c !== void 0 ? _c : doc === null || doc === void 0 ? void 0 : doc.pageContent) !== null && _d !== void 0 ? _d : '').toString();
                    if (!txt || txt.trim().length === 0)
                        return [3 /*break*/, 29];
                    _e.label = 32;
                case 32:
                    _e.trys.push([32, 35, , 36]);
                    return [4 /*yield*/, embeddings.embedQuery(txt)];
                case 33:
                    vec = _e.sent();
                    return [4 /*yield*/, collection.updateOne({ _id: doc._id }, { $set: (_b = {}, _b[EMBEDDING_KEY] = vec, _b) })];
                case 34:
                    _e.sent();
                    fixed++;
                    if (fixed % 25 === 0)
                        console.log("[backfill] fixed=".concat(fixed));
                    return [3 /*break*/, 36];
                case 35:
                    e_1 = _e.sent();
                    console.error("[backfill-error] _id=".concat(doc === null || doc === void 0 ? void 0 : doc._id, " ").concat((e_1 === null || e_1 === void 0 ? void 0 : e_1.message) || e_1));
                    return [3 /*break*/, 36];
                case 36: return [3 /*break*/, 29];
                case 37:
                    console.log("Backfill complete. Checked=".concat(checked, ", fixed=").concat(fixed));
                    console.log('--- Ingestion Complete ---');
                    return [3 /*break*/, 42];
                case 38:
                    error_5 = _e.sent();
                    console.error('An error occurred during the ingestion process:', error_5);
                    process.exit(1); // Exit with error code
                    return [3 /*break*/, 42];
                case 39:
                    if (!client) return [3 /*break*/, 41];
                    return [4 /*yield*/, client.close()];
                case 40:
                    _e.sent();
                    console.log('Database connection closed.');
                    _e.label = 41;
                case 41: return [7 /*endfinally*/];
                case 42: return [2 /*return*/];
            }
        });
    });
}
// Run the ingestion function
ingestData();
