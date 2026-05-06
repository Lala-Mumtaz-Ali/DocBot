# CLAUDE.md

This file documents the DocBot codebase as it exists on the `mumtaz` branch.

## Project Overview

DocBot is a medical document chatbot with a **hybrid RAG pipeline** focused on diabetes management. Three services must run to use all features:

| Service | Port | Runtime |
|---|---|---|
| Next.js frontend | 3000 | Node.js |
| FastAPI RAG backend | 8000 | Python |
| ML microservice (optional) | 8001 | Python |

## Prerequisites & Environment Variables

All env vars live in `.env.local` at the project root. The Python backend loads this same file via `load_dotenv("../.env.local")`.

```
MONGODB_URI=            # Required — MongoDB Atlas connection string
JWT_SECRET=             # Required — used by Next.js JWT auth
GROQ_API_KEY=           # Required — used by Python backend for LLM generation
OLLAMA_BASE_URL=        # Default: http://localhost:11434 — used by Next.js routes
MONGODB_DB_NAME=        # Default: DocBot
MONGODB_COLLECTION=     # Default: medical_embeddings
MONGODB_VECTOR_INDEX=   # Default: vector_index
GEN_MODEL=              # Default: llama-3.3-70b-versatile (Groq model for chat)
EMBED_MODEL=            # Default: all-MiniLM-L6-v2 (sentence-transformers)
ML_SERVICE_URL=         # Default: http://localhost:8001
OLLAMA_MODEL=           # Default: deepseek-r1:1.5b (used by Next.js API routes)
```

**Ollama** must be running locally with `deepseek-r1:1.5b` pulled. It is used only by Next.js API routes (`/api/extract-report` and `/api/analyze-trend`), NOT by the Python backend.

**MongoDB Atlas** (not local) with a vector search index named `vector_index` on the `medical_embeddings` collection (384 dimensions, cosine similarity).

## Commands

```bash
# Install dependencies
npm install
pip install -r python_backend/requirements.txt

# Run all services (separate terminals)
npm run dev                              # Next.js on :3000
python python_backend/main.py           # FastAPI RAG backend on :8000
cd diabetes_ml && uvicorn main:app --port 8001 --reload  # ML microservice on :8001

# Data ingestion (run once to populate the vector store)
npm run ingest           # PDFs + XML from data_DocBot_Chat/{books,medguides,medlineplus_xml}/
npm run ingest:smalltalk # Greeting/definition JSON files

# Ad-hoc testing
node test-connect.js     # Validate MongoDB connection
python test_upload.py    # Test FastAPI file upload endpoint

# Production build
npm run build
```

No Jest or Pytest suite — testing is done via the ad-hoc scripts above.

## Architecture

### LLM Usage (two separate providers)

| Where | Model | Provider | Purpose |
|---|---|---|---|
| Python backend (`/chat`) | `llama-3.3-70b-versatile` | **Groq cloud** | Chat answers from RAG context |
| Next.js `/api/extract-report` | `deepseek-r1:1.5b` | **Ollama (local)** | Extract biomarkers from PDF text |
| Next.js `/api/analyze-trend` | `deepseek-r1:1.5b` | **Ollama (local)** | Synthesize trend explanation |

### RAG Pipeline (request flow for `/chat`)

1. User message → Next.js `/api/chat` → proxies to FastAPI `POST /chat`
2. FastAPI: embed query with **sentence-transformers** `all-MiniLM-L6-v2` (384 dims, runs locally via `LocalEmbeddings` class in `python_backend/embeddings.py`)
3. MongoDB Atlas vector search — retrieves top 30 candidates
4. **BioBERT** (`dmis-lab/biobert-base-cased-v1.1-squad`) reranks as a QA pipeline — uses confidence score as relevance metric — picks top 7 chunks
5. Prompt assembled → **Groq** (`llama-3.3-70b-versatile`) generates final answer
6. Response (with `sources` and `debug_info`) returned to frontend

### PDF Handling (Python backend)

- `POST /extract_pdf_text` — PyMuPDF primary extraction; falls back to **EasyOCR** for scanned/image pages; groups OCR results by y-coordinate into lines
- `POST /analyze_report` — same extraction + regex HbA1c/glucose extraction + Groq JSON output (used by the chat page file upload only)

### Report Extraction Pipeline (Next.js routes)

`/api/extract-report` (used by Record Summary page):
1. Sends PDF to Python `/extract_pdf_text` for text extraction
2. Strips "Interpretation" sections to avoid regex pollution
3. Enhanced regex extracts `report_date`, `HbA1c`, `fasting_glucose` directly
4. Calls DeepSeek R1 via Ollama with pre-extracted values as hints
5. Applies eAG formula fallback to derive missing values (`eAG = 28.7 * HbA1c − 46.7`)
6. Saves to MongoDB `patient_reports` collection, keyed by `userId` (user's email)

`/api/analyze-trend`:
1. Fetches all `PatientReport` docs for user from MongoDB
2. POSTs to ML microservice (`/predict-risk`) → gets `risk_score` (0/1/2) and feature deltas
3. Builds trend table and calls DeepSeek R1 for a patient-friendly explanation
4. Degrades gracefully if ML service is unreachable (rule-based fallback on HbA1c)

### ML Microservice (`diabetes_ml/main.py`, port 8001)

- **XGBoost model** (`models/xgboost_model.pkl`) — trained with `train_model.py` on FHIR data
- Input: chronological list of `{report_date, hba1c, fasting_glucose}`
- Engineered features: delta, velocity, acceleration, projected HbA1c (90-day)
- Output: `risk_score` (0=Stable, 1=Moderate Risk, 2=Rapid Deterioration)
- Must run `python train_model.py` before starting the microservice

### Data Ingestion (`scripts/`)

- Source directory: `data_DocBot_Chat/` with subdirs `books/`, `medguides/`, `medlineplus_xml/`
- Reads PDFs (via `pdf-parse`) and MedlinePlus XML files
- Embedding model: **`Xenova/all-MiniLM-L6-v2`** (JS, runs in-process via `@xenova/transformers`) — 384 dims, same model family as Python backend
- Chunks: 1000 chars, 150 overlap
- Batch size: 100 chunks/batch; supports resume via `START_BATCH` env var
- Stores to MongoDB Atlas collection `medical_embeddings`

## Frontend (`src/app/`)

Path alias `@/*` → `src/*`

| Page | Route | Description |
|---|---|---|
| `page.js` | `/` | Auth landing — toggles between Signin/Signup components |
| `chat/page.js` | `/chat` | Main chat UI — text questions + PDF upload via `/api/analyze` |
| `profile/page.js` | `/profile` | User profile |
| `record/page.js` | `/record` | File records manager |
| `record-summary/page.js` | `/record-summary` | Diabetes trend analysis — upload PDFs, view HbA1c trend chart, risk badge, DOCBOT analysis |
| `inbox/page.js` | `/inbox` | Share records between users |
| `logout/page.js` | `/logout` | Clears session |

### UI Libraries

- **Framer Motion** — message animations in chat
- **React Icons** — FaPaperPlane, FaRobot, FaUser, FaPaperclip
- **React Markdown** + **remark-gfm** — bot responses rendered as Markdown
- **SASS** + CSS Modules — all styles in `src/app/style/`
- **react-photo-view** — image previews in records

### Auth Flow

- `POST /api/sign` — signup/login (single endpoint, `payload.login` flag discriminates)
- JWT (7-day expiry) signed with `JWT_SECRET`, returned to client
- Stored in `localStorage` as `user` (object) and `token` (string)
- Protected API routes verify `Authorization: Bearer <token>` header
- Passwords hashed with **bcryptjs** (12 rounds) in Mongoose pre-save hook

## MongoDB Collections

| Collection | Model file | Purpose |
|---|---|---|
| `signup` | `signupmodel.js` | Users — name, email, contact, address, city, role, bcrypt password |
| `records` | `recordModel.js` | File records — binary `fileData` stored directly in MongoDB (≤10MB), fileType: image/pdf/video/other |
| `inbox` | `inboxModel.js` | Shared record notifications — senderEmail, receiverEmail, ref to Record |
| `patient_reports` | `patientReport.js` | Diabetes report history — report_date, hba1c, fasting_glucose, raw_text, source_filename, userId (email) |
| `medical_embeddings` | n/a (Atlas) | Vector store for RAG — text chunks + 384-dim embeddings |

## API Routes Summary

| Route | Methods | Description |
|---|---|---|
| `/api/chat` | POST | Proxies to FastAPI `/chat` |
| `/api/sign` | POST, GET | Auth — login/signup |
| `/api/records` | GET, POST, DELETE | File records CRUD (JWT-protected) |
| `/api/records/[id]` | GET/DELETE | Single record by ID |
| `/api/inbox` | GET, POST, DELETE | Inbox share/receive records |
| `/api/analyze` | POST | Proxies PDF to FastAPI `/analyze_report` (chat page upload) |
| `/api/extract-report` | POST | Full extraction pipeline → saves PatientReport to MongoDB |
| `/api/analyze-trend` | POST | Trend analysis — fetches reports, calls ML service, calls DeepSeek |
| `/api/cdn/[filename]` | GET | Serves static files from `public/uploads/` |

## Python Backend (`python_backend/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — `/chat`, `/extract_pdf_text`, `/analyze_report` |
| `embeddings.py` | `LocalEmbeddings` class — wraps `sentence-transformers` `all-MiniLM-L6-v2` |

## Key Architectural Notes

- **Embedding model must match between ingest and query**: both use `all-MiniLM-L6-v2` (384 dims). The ingest script uses the Xenova JS port; the Python backend uses sentence-transformers. They are the same model.
- **Two separate LLM stacks coexist**: Groq (cloud, fast, for chat) and Ollama/DeepSeek (local, for report extraction). Both must be available for full functionality.
- **`userId` in PatientReport is the user's email string**, not a MongoDB ObjectId. This is used as the lookup key in trend analysis.
- **Record binary storage**: files are stored as raw `Buffer` in MongoDB (`fileData` field). The CDN route (`/api/cdn/`) is a separate legacy mechanism that reads from `public/uploads/` filesystem — not connected to the MongoDB records.
- **DeepSeek `<think>` tag stripping**: both Ollama-calling routes strip `<think>...</think>` blocks from DeepSeek R1 responses.
- **ML microservice graceful degradation**: if port 8001 is unreachable, `/api/analyze-trend` falls back to a rule-based HbA1c threshold score.
