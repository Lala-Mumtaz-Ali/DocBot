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
// scripts/ingest-smallTalk.ts
var mongodb_1 = require("mongodb");
// Use local Ollama for embeddings
var mongodb_2 = require("@langchain/mongodb");
var textsplitters_1 = require("@langchain/textsplitters");
var documents_1 = require("@langchain/core/documents");
var fs = __importStar(require("fs/promises"));
var path = __importStar(require("path"));
var dotenv = __importStar(require("dotenv"));
// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });
// --- Configuration ---
var MONGODB_URI = process.env.MONGODB_URI;
var DB_NAME = process.env.MONGODB_DB_NAME || 'DocBot';
var collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings'; // reuse existing collection
var VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
var TEXT_KEY = process.env.MONGODB_TEXT_KEY || 'text';
var EMBEDDING_KEY = process.env.MONGODB_EMBEDDING_KEY || 'embedding';
// @ts-ignore
var pdf_parse_1 = __importDefault(require("pdf-parse"));
// --- File/Chunk Configuration ---
var dataDir = path.resolve(process.cwd(), 'data', 'smallTalk');
var chunkSize = 1000;
var chunkOverlap = 150;
// Match ingest.ts PDF parsing logic
function extractTextFromPdf(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var dataBuffer, data, error_1;
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
                    return [2 /*return*/, data.text || ''];
                case 3:
                    error_1 = _a.sent();
                    console.error("Error reading PDF file ".concat(filePath, ":"), error_1);
                    return [2 /*return*/, ''];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Robust Ollama embeddings client compatible with LangChain Embeddings interface
var OllamaEmbeddings = /** @class */ (function () {
    function OllamaEmbeddings(opts) {
        this.model = (opts === null || opts === void 0 ? void 0 : opts.model) || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
        this.baseUrl = (opts === null || opts === void 0 ? void 0 : opts.baseUrl) || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.batchSize = (opts === null || opts === void 0 ? void 0 : opts.batchSize) || 10;
        this.delayMs = (opts === null || opts === void 0 ? void 0 : opts.delayMs) || 500;
        this.requestDelayMs = (opts === null || opts === void 0 ? void 0 : opts.requestDelayMs) || 200;
    }
    OllamaEmbeddings.prototype.embedDocuments = function (texts) {
        return __awaiter(this, void 0, void 0, function () {
            var results, totalBatches, i, batch, batchNum, j, text, retries, embedding, error_2;
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
                        return [3 /*break*/, 9];
                    case 6:
                        error_2 = _a.sent();
                        retries--;
                        if (retries === 0) {
                            console.error("Failed to embed text after 3 retries: \"".concat(text.substring(0, 50), "...\""));
                            console.warn("Skipping problematic chunk by inserting zero-vector.");
                            results.push(new Array(768).fill(0));
                            return [3 /*break*/, 9];
                        }
                        console.warn("Retry ".concat(3 - retries, "/3 for embedding..."));
                        return [4 /*yield*/, this.sleep(2000)];
                    case 7:
                        _a.sent();
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
function ingestSmallTalk() {
    return __awaiter(this, void 0, void 0, function () {
        var client, db, collection, embeddings, textSplitter, documents, files, _a, _i, files_1, file, filePath, stats, ext, textContent, chunks, CHUNK_BATCH_SIZE, totalChunkBatches, i, chunkBatch, batchNum, vectorStore, checked, fixed, cur, doc, emb, needs, txt, vec, e_1, error_3;
        var _b;
        var _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    client = null;
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 27, 28, 31]);
                    console.log('Starting smallTalk ingestion...');
                    // 1) Connect to DB
                    if (!MONGODB_URI) {
                        throw new Error('Please define MONGODB_URI in .env.local');
                    }
                    client = new mongodb_1.MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
                    return [4 /*yield*/, client.connect()];
                case 2:
                    _e.sent();
                    db = client.db(DB_NAME);
                    collection = db.collection(collectionName);
                    console.log("Connected. Using collection: ".concat(collectionName));
                    embeddings = new OllamaEmbeddings({
                        model: process.env.OLLAMA_EMBED_MODEL,
                        baseUrl: process.env.OLLAMA_BASE_URL,
                    });
                    textSplitter = new textsplitters_1.RecursiveCharacterTextSplitter({
                        chunkSize: chunkSize,
                        chunkOverlap: chunkOverlap,
                    });
                    documents = [];
                    console.log("Using embedding model: ".concat(embeddings['model']));
                    files = [];
                    _e.label = 3;
                case 3:
                    _e.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, fs.readdir(dataDir)];
                case 4:
                    files = _e.sent();
                    return [3 /*break*/, 6];
                case 5:
                    _a = _e.sent();
                    console.error("Directory not found: ".concat(dataDir));
                    process.exit(1);
                    return [3 /*break*/, 6];
                case 6:
                    console.log("Found ".concat(files.length, " files in smallTalk"));
                    _i = 0, files_1 = files;
                    _e.label = 7;
                case 7:
                    if (!(_i < files_1.length)) return [3 /*break*/, 11];
                    file = files_1[_i];
                    filePath = path.join(dataDir, file);
                    return [4 /*yield*/, fs.stat(filePath)];
                case 8:
                    stats = _e.sent();
                    if (!stats.isFile())
                        return [3 /*break*/, 10];
                    ext = path.extname(file).toLowerCase();
                    if (ext !== '.pdf') {
                        console.log("Skipping non-PDF: ".concat(file));
                        return [3 /*break*/, 10];
                    }
                    console.log("Processing PDF: ".concat(file));
                    return [4 /*yield*/, extractTextFromPdf(filePath)];
                case 9:
                    textContent = _e.sent();
                    if (!textContent)
                        return [3 /*break*/, 10];
                    documents.push(new documents_1.Document({
                        pageContent: textContent,
                        metadata: {
                            source: path.join('smallTalk', file),
                            lastModified: stats.mtime,
                        },
                    }));
                    _e.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 7];
                case 11:
                    if (documents.length === 0) {
                        console.error('No PDF content extracted from data/smallTalk');
                        return [2 /*return*/];
                    }
                    console.log("Total smallTalk documents: ".concat(documents.length));
                    return [4 /*yield*/, textSplitter.splitDocuments(documents)];
                case 12:
                    chunks = _e.sent();
                    console.log("Total chunks: ".concat(chunks.length));
                    if (chunks.length === 0)
                        return [2 /*return*/];
                    // 5) Clean up prior smallTalk docs only (do not wipe the whole collection)
                    console.log('Removing previous smallTalk docs from collection...');
                    return [4 /*yield*/, collection.deleteMany({ 'metadata.source': { $regex: '^smallTalk/' } })];
                case 13:
                    _e.sent();
                    // 6) Insert into vector store in BATCHES
                    console.log('Adding chunks to MongoDB Atlas Vector Search...');
                    CHUNK_BATCH_SIZE = 100;
                    totalChunkBatches = Math.ceil(chunks.length / CHUNK_BATCH_SIZE);
                    i = 0;
                    _e.label = 14;
                case 14:
                    if (!(i < chunks.length)) return [3 /*break*/, 17];
                    chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
                    batchNum = Math.floor(i / CHUNK_BATCH_SIZE) + 1;
                    console.log("\nAdding chunk batch ".concat(batchNum, "/").concat(totalChunkBatches, " (").concat(chunkBatch.length, " chunks)..."));
                    vectorStore = new mongodb_2.MongoDBAtlasVectorSearch(embeddings, {
                        collection: collection,
                        indexName: VECTOR_INDEX,
                        textKey: TEXT_KEY,
                        embeddingKey: EMBEDDING_KEY,
                    });
                    return [4 /*yield*/, vectorStore.addDocuments(chunkBatch)];
                case 15:
                    _e.sent();
                    console.log("Batch ".concat(batchNum, "/").concat(totalChunkBatches, " completed."));
                    _e.label = 16;
                case 16:
                    i += CHUNK_BATCH_SIZE;
                    return [3 /*break*/, 14];
                case 17:
                    // Safety net: Backfill
                    console.log('Verifying and backfilling empty/missing embeddings for smallTalk...');
                    checked = 0;
                    fixed = 0;
                    cur = collection.find({ 'metadata.source': { $regex: '^smallTalk/' } }, { batchSize: 100 });
                    _e.label = 18;
                case 18: return [4 /*yield*/, cur.hasNext()];
                case 19:
                    if (!_e.sent()) return [3 /*break*/, 26];
                    return [4 /*yield*/, cur.next()];
                case 20:
                    doc = _e.sent();
                    if (!doc) {
                        return [3 /*break*/, 18];
                    }
                    checked++;
                    emb = doc === null || doc === void 0 ? void 0 : doc[EMBEDDING_KEY];
                    needs = !Array.isArray(emb) || emb.length === 0 || typeof emb[0] !== 'number';
                    if (!needs)
                        return [3 /*break*/, 18];
                    txt = ((_d = (_c = doc === null || doc === void 0 ? void 0 : doc[TEXT_KEY]) !== null && _c !== void 0 ? _c : doc === null || doc === void 0 ? void 0 : doc.pageContent) !== null && _d !== void 0 ? _d : '').toString();
                    if (!txt || txt.trim().length === 0)
                        return [3 /*break*/, 18];
                    _e.label = 21;
                case 21:
                    _e.trys.push([21, 24, , 25]);
                    return [4 /*yield*/, embeddings.embedQuery(txt)];
                case 22:
                    vec = _e.sent();
                    return [4 /*yield*/, collection.updateOne({ _id: doc._id }, { $set: (_b = {}, _b[EMBEDDING_KEY] = vec, _b) })];
                case 23:
                    _e.sent();
                    fixed++;
                    if (fixed % 25 === 0)
                        console.log("[backfill-smallTalk] fixed=".concat(fixed));
                    return [3 /*break*/, 25];
                case 24:
                    e_1 = _e.sent();
                    console.error("[backfill-smallTalk-error] _id=".concat(doc === null || doc === void 0 ? void 0 : doc._id, " ").concat((e_1 === null || e_1 === void 0 ? void 0 : e_1.message) || e_1));
                    return [3 /*break*/, 25];
                case 25: return [3 /*break*/, 18];
                case 26:
                    console.log("Backfill smallTalk complete. Checked=".concat(checked, ", fixed=").concat(fixed));
                    console.log('Ingestion complete for smallTalk');
                    return [3 /*break*/, 31];
                case 27:
                    error_3 = _e.sent();
                    console.error('Error during smallTalk ingestion:', error_3);
                    process.exit(1);
                    return [3 /*break*/, 31];
                case 28:
                    if (!client) return [3 /*break*/, 30];
                    return [4 /*yield*/, client.close()];
                case 29:
                    _e.sent();
                    console.log('Database connection closed.');
                    _e.label = 30;
                case 30: return [7 /*endfinally*/];
                case 31: return [2 /*return*/];
            }
        });
    });
}
ingestSmallTalk();
