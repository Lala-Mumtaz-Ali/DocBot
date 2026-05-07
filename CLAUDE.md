# CLAUDE.md

This file documents the DocBot codebase as it exists on the `master` branch.

## Project Overview

DocBot is a medical document chatbot with a **hybrid RAG pipeline** focused on diabetes management. Three services must run for full functionality:

| Service | Local port | Runtime | Hosting |
|---|---|---|---|
| Next.js frontend | 3000 | Node.js | **Vercel** |
| FastAPI RAG backend | 8000 | Python | **Hugging Face Spaces** (Docker SDK) |
| FastAPI ML microservice | 8001 | Python | **Hugging Face Spaces** (Docker SDK) |

In production, the Vercel-hosted frontend calls the two Hugging Face Spaces over HTTPS via `PYTHON_BACKEND_URL` and `ML_SERVICE_URL` (set as Vercel environment variables to the Spaces URLs, e.g. `https://<user>-docbot-backend.hf.space`). Both Python services are container-deployed via the Dockerfiles and the Hugging Face Spaces metadata at the top of `python_backend/README.md` and `diabetes_ml/README.md` (`sdk: docker`, `app_port: 7860`).

## Prerequisites & Environment Variables

All env vars live in `.env.local` at the project root. The Python backend loads this same file via `load_dotenv("../.env.local")`.

```
MONGODB_URI=                # Required — MongoDB Atlas connection string
JWT_SECRET=                 # Required — used by Next.js JWT auth
GROQ_API_KEY=               # Required — used by Python backend AND Next.js routes for all LLM/OCR calls
GOOGLE_CLIENT_ID=           # Required for Google OAuth (server-side verification)
NEXT_PUBLIC_GOOGLE_CLIENT_ID= # Required for Google OAuth (client-side button)
EMAIL_USER=                 # Gmail address used by nodemailer for welcome emails
EMAIL_PASS=                 # Gmail app password
MONGODB_DB_NAME=            # Default: DocBot
MONGODB_COLLECTION=         # Default: medical_embeddings
MONGODB_VECTOR_INDEX=       # Default: vector_index
GEN_MODEL=                  # Default: llama-3.3-70b-versatile (Groq model for chat + extraction)
CONDENSE_MODEL=             # Default: llama-3.1-8b-instant (Groq model for query rewriting)
EMBED_MODEL=                # Default: all-MiniLM-L6-v2 (sentence-transformers, 384 dims)
ML_SERVICE_URL=             # Default: http://localhost:8001
PYTHON_BACKEND_URL=         # Default: http://localhost:8000
```

**MongoDB Atlas** (not local) with a vector search index named `vector_index` on the `medical_embeddings` collection (384 dimensions, cosine similarity).

**No local Ollama is required.** Earlier versions of the project used Ollama / DeepSeek-R1 for some routes; the current code calls Groq exclusively for all LLM and OCR tasks. There is a stale `OllamaEmbeddings` class in `src/app/lib/embeddings.js` that is not imported anywhere.

## Commands

```bash
# Install dependencies
npm install
pip install -r python_backend/requirements.txt
pip install -r diabetes_ml/requirements.txt

# Run all services (separate terminals)
npm run dev                                                 # Next.js on :3000
python python_backend/main.py                              # FastAPI RAG backend on :8000
cd diabetes_ml && uvicorn main:app --port 8001 --reload    # ML microservice on :8001

# Knowledge-base ingestion (run once to populate the vector store)
npm run ingest             # PDFs + XML from data_DocBot_Chat/{books,medguides,medlineplus_xml}/
npm run ingest:smalltalk   # PDFs from data_DocBot_Chat/smallTalk/

# ML training pipeline
cd diabetes_ml
python ingest_fhir.py            # parses Model_Training_Material/fhir/*.json into data/raw/diabetes_raw_fhir.csv
python train_model.py            # produces models/xgboost_model.pkl (3-class risk classifier)
python train_forecast_model.py   # produces models/xgboost_forecast.pkl (HbA1c regressor)
python evaluate_model.py         # sanity-check classifier on the processed feature set

# Ad-hoc testing
node test-connect.js     # Validate MongoDB connection
python test_upload.py    # Test FastAPI file upload endpoint

# Production build
npm run build
```

No Jest or Pytest suite — testing is done via the ad-hoc scripts above.

## Architecture

### LLM Usage — Groq is the only LLM provider

| Where | Model | Purpose |
|---|---|---|
| Python `/chat` (answer) | `llama-3.3-70b-versatile` | Chat answers from RAG context |
| Python `/chat` (rewrite) | `llama-3.1-8b-instant` | Conversational query condensation |
| Python `/extract_pdf_text` + `/analyze_report` (OCR) | `meta-llama/llama-4-scout-17b-16e-instruct` | Vision-based OCR fallback for scanned pages |
| Python `/analyze_report` (extraction) | `llama-3.3-70b-versatile` | JSON extraction from report text |
| Next.js `/api/extract-report` | `llama-3.3-70b-versatile` | JSON extraction (called via Groq REST API directly) |
| Next.js `/api/analyze-trend` | `llama-3.3-70b-versatile` | Patient-friendly trend explanation |

All Groq calls go through either the official `groq` Python client (Python backend) or direct `fetch()` to `https://api.groq.com/openai/v1/chat/completions` (Next.js routes).

### RAG Pipeline (request flow for `/chat`)

1. User message → Next.js `/api/chat` → proxies to FastAPI `POST /chat` with full conversation history.
2. FastAPI condenses the follow-up into a standalone query using Groq `llama-3.1-8b-instant` (skipped if there is no history).
3. Embed the condensed query with **sentence-transformers** `all-MiniLM-L6-v2` (384 dims). The wrapper class is `LocalEmbeddings` in `python_backend/embeddings.py`. (The variable is named `ollama` in `main.py` but it is **not** Ollama.)
4. MongoDB Atlas vector search — `numCandidates=200`, `limit=30`.
5. **BioBERT** (`dmis-lab/biobert-base-cased-v1.1-squad`) reranks each candidate as a question-answering pipeline; the QA confidence score is the relevance metric. Top **7** chunks are kept.
6. Prompt assembled (system prompt + last 5 history turns + context + question) → **Groq** `llama-3.3-70b-versatile` generates the final answer.
7. Response (with `reply`, `sources`, `debug_info`, `retrieval_query`) returned to the frontend.

### PDF Handling (Python backend)

- `POST /extract_pdf_text` — PyMuPDF primary text extraction. Falls back to **Groq Vision** (`meta-llama/llama-4-scout-17b-16e-instruct`) when a page yields fewer than 50 chars (typical of scanned PDFs).
- `POST /analyze_report` — same extraction pipeline + regex HbA1c/glucose hints + Groq JSON output. Used by the chat page's attach-PDF button.

### Report Extraction Pipeline (Next.js routes)

`/api/extract-report` (used by the Record Summary page):
1. Sends the PDF buffer to Python `/extract_pdf_text` for text extraction.
2. Strips "Interpretation" sections to avoid regex pollution.
3. Enhanced regex extracts `report_date`, `HbA1c`, `fasting_glucose` directly from the cleaned text.
4. Calls **Groq** `llama-3.3-70b-versatile` with the regex-extracted values as hints, requesting JSON output.
5. Applies the eAG formula as a fallback to derive missing values (`eAG = 28.7 * HbA1c − 46.7`).
6. Saves to MongoDB `patient_reports` collection, keyed by `userId` (the user's email string).

`/api/analyze-trend`:
1. Fetches all `PatientReport` docs for the user from MongoDB.
2. **Calls the ML microservice's `/predict-risk` AND `/predict-forecast` endpoints in parallel** via `Promise.allSettled`.
3. Builds a trend table and feeds it (along with risk + forecast facts) to **Groq** `llama-3.3-70b-versatile` for a patient-friendly explanation following a structured template (Greeting / Your Results / What This Means / Our Prediction / Action).
4. Degrades gracefully if the ML service is unreachable: falls back to a rule-based HbA1c-threshold risk score and skips the forecast.

### ML Microservice (`diabetes_ml/main.py`, port 8001)

Two XGBoost models share a feature-engineering pipeline:

1. **Classifier** (`models/xgboost_model.pkl`) — `XGBClassifier` (`multi:softprob`, `num_class=3`) producing a 3-class **risk_score**:
   - `0 = Stable`, `1 = Moderate Risk`, `2 = Rapid Deterioration`
   - Endpoint: `POST /predict-risk`
2. **Forecast regressor** (`models/xgboost_forecast.pkl`) — `XGBRegressor` predicting the patient's next HbA1c value at a configurable horizon (default 90 days).
   - Endpoint: `POST /predict-forecast`
   - Returns: `{ predicted_hba1c, current_hba1c, delta_predicted, horizon_days, projected_zone }` where `projected_zone ∈ {Normal, Pre-diabetic, Diabetic}` based on the 5.7 / 6.5 HbA1c thresholds.

Both models share these 10 engineered features (the regressor adds an 11th — `days_to_next`):

```
hba1c, fasting_glucose,
hba1c_delta_1, days_since_prev1, velocity_1,
hba1c_delta_2, days_since_prev2, velocity_2,
acceleration, projected_hba1c
```

Trained on real **FHIR longitudinal data** (1180 Synthea-style JSON bundles in `Model_Training_Material/fhir/`, parsed by `ingest_fhir.py`). Training uses a **patient-level train/test split** (no patient appears in both sets) plus 5-fold stratified CV with macro-F1, balanced sample weights, and early stopping. Run `python train_model.py` and `python train_forecast_model.py` before starting the microservice.

Risk labels are derived from clinical rules in `assign_risk_label()` capturing trajectory (delta + projected HbA1c at 90 days), not just the current zone — so a managed diabetic with stable readings labels as "Moderate", while a normal-zone patient with rapid worsening labels as "Rapid Deterioration".

### Knowledge-Base Ingestion (`scripts/`)

- TypeScript sources (`ingest.ts`, `ingest-smallTalk.ts`) are pre-compiled to `scripts/compiled/` and run via `npm run ingest` / `npm run ingest:smalltalk`.
- Source root: `data_DocBot_Chat/`.
  - `ingest.ts` processes the `books/`, `medguides/`, and `medlineplus_xml/` subdirectories.
  - `ingest-smallTalk.ts` processes the `smallTalk/` subdirectory only.
  - `who_factsheets/` exists in the data folder but is **not** wired into either ingest script.
- PDF parsing via `pdf-parse`. XML parsing via `xml2js` (specifically MedlinePlus `<health-topic>` elements).
- Embedding model: **`Xenova/all-MiniLM-L6-v2`** (JS port via `@xenova/transformers`, runs in-process) — 384 dims, same model family as the Python backend.
- Chunks: **1000 chars, 150 overlap** (`RecursiveCharacterTextSplitter`).
- Batch size: 100 chunks/batch with resume support via `START_BATCH` env var.
- Stored to MongoDB Atlas collection `medical_embeddings` (text key `text`, embedding key `embedding`).
- Includes a backfill safety net that re-embeds any document missing or with an empty embedding.

## Frontend (`src/app/`)

Path alias `@/*` → `src/*`. Next.js App Router (Next.js 15.5.16, React 19.1.0).

| Page | Route | Description |
|---|---|---|
| `page.js` | `/` | Auth landing — toggles between Signin/Signup components |
| `chat/page.js` | `/chat` | Main chat UI — text questions + PDF upload via `/api/analyze` |
| `profile/page.js` | `/profile` | User profile |
| `edit-profile/page.js` | `/edit-profile` | Update name/address/city/contact |
| `complete-profile/page.js` | `/complete-profile` | Finishes signup for Google OAuth users |
| `record/page.js` | `/record` | File records manager (upload/list/delete) |
| `record-summary/page.js` | `/record-summary` | Diabetes trend analysis — upload PDFs, view HbA1c trend chart, risk badge, 90-day forecast, DocBot analysis |
| `inbox/page.js` | `/inbox` | Share records between users |
| `logout/page.js` | `/logout` | Clears session |

### UI Libraries

- **Framer Motion** — message animations in chat, page transitions
- **react-icons** + **lucide-react** — icons (`FaPaperPlane`, `FaRobot`, `FaUser`, `FaPaperclip`, `AlertCircle`, `CheckCircle2`, etc.)
- **react-markdown** + **remark-gfm** — bot responses rendered as Markdown
- **react-photo-view** — image previews in records
- **SASS + CSS Modules** — all component styles in `src/app/style/*.module.css`. **Tailwind is not used.**

### Auth Flow

Two paths converge on the same `signup` collection and JWT format:

1. **Email + password** (`POST /api/sign`)
   - Single endpoint: `payload.login: true` discriminates login vs. signup.
   - Passwords hashed with **bcryptjs** (12 salt rounds in the model's pre-save hook; the `complete-google-signup` route uses 10 rounds via `bcrypt.hash` directly).
   - Returns JWT (7-day expiry) signed with `JWT_SECRET`.
2. **Google OAuth** (`@react-oauth/google` on the client + `google-auth-library` on the server)
   - `POST /api/google-login` verifies the Google ID token and either logs in (existing user) or returns `{ isNewUser: true, googleData }`.
   - `POST /api/complete-google-signup` collects the missing profile fields, creates the user, sends a welcome email via **nodemailer** (Gmail), and returns a JWT.
   - The `<GoogleOAuthProvider>` lives in `src/app/layout.js` using `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

`next-auth` is listed in `package.json` but is **not actually used** anywhere in the codebase.

JWT is stored in `localStorage` as `user` (object) and `token` (string). Protected API routes verify `Authorization: Bearer <token>` (used by `/api/records` and `/api/records/[id]`).

## MongoDB Collections

| Collection | Model file | Purpose |
|---|---|---|
| `signup` | `signupmodel.js` | Users — name, email, contact (`03XXXXXXXXX`), address, city, role, bcrypt password, optional `isVerified` / `verifyToken` / `verifyTokenExpiry` |
| `records` | `recordModel.js` | File records — binary `fileData` stored directly in MongoDB (≤10MB), `fileType ∈ {image, pdf, video, other}` |
| `inbox` | `inboxModel.js` | Shared record notifications — senderEmail, receiverEmail, ref to Record, `isRead` |
| `patient_reports` | `patientReport.js` | Diabetes report history — report_date, hba1c, fasting_glucose, raw_text, source_filename, userId (email string) |
| `medical_embeddings` | n/a (Atlas) | Vector store for RAG — text chunks + 384-dim embeddings + metadata.source |

## API Routes Summary

| Route | Methods | Description |
|---|---|---|
| `/api/chat` | POST | Proxies to FastAPI `/chat` |
| `/api/sign` | POST, GET | Auth — login/signup with email & password |
| `/api/google-login` | POST | Verifies Google ID token, logs in existing user or returns `isNewUser:true` |
| `/api/complete-google-signup` | POST | Creates Google-OAuth user + sends welcome email + returns JWT |
| `/api/update-profile` | PUT | Update profile fields by email |
| `/api/records` | GET, POST, DELETE | File records CRUD (JWT-protected) |
| `/api/records/[id]` | GET | Streams the binary `fileData` for a record (JWT-protected) |
| `/api/inbox` | GET, POST, DELETE | Inbox share/receive records |
| `/api/analyze` | POST | Proxies PDF to FastAPI `/analyze_report` (chat page upload) |
| `/api/extract-report` | POST | Full extraction pipeline → saves PatientReport to MongoDB (uses Groq) |
| `/api/analyze-trend` | POST | Trend analysis — fetches reports, calls ML service `/predict-risk` & `/predict-forecast` in parallel, calls Groq for synthesis |
| `/api/cdn/[filename]` | GET | Serves static files from `public/uploads/` (legacy filesystem CDN) |

## Python Backend (`python_backend/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — `/chat`, `/extract_pdf_text`, `/analyze_report`, plus `ocr_with_groq()` and `condense_question()` helpers |
| `embeddings.py` | `LocalEmbeddings` class — wraps `sentence-transformers` `all-MiniLM-L6-v2` (384 dims) |
| `requirements.txt` | fastapi, uvicorn, transformers, torch, pymongo, python-dotenv, requests, python-multipart, pypdf, pymupdf, groq, sentence-transformers |
| `Dockerfile` | Hugging Face Spaces deployment metadata (per `python_backend/README.md`) |

## Diabetes ML Microservice (`diabetes_ml/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — `/predict-risk`, `/predict-forecast`, `/` (health) |
| `train_model.py` | Trains the 3-class XGBoost risk classifier on FHIR data |
| `train_forecast_model.py` | Trains the XGBoost regressor for future-HbA1c forecasting |
| `ingest_fhir.py` | Parses Synthea-style FHIR JSON bundles into `data/raw/diabetes_raw_fhir.csv` (LOINC `4548-4` for HbA1c, `2339-0` for glucose) |
| `evaluate_model.py` | Sanity-check the saved classifier against `data/processed/features.csv` |
| `models/xgboost_model.pkl` | Trained classifier bundle (`{model, feature_order, class_names}`) |
| `models/xgboost_forecast.pkl` | Trained regressor bundle (`{model, feature_order}`) |
| `requirements.txt` | fastapi, uvicorn, xgboost, scikit-learn, numpy, joblib, pydantic |

## Key Architectural Notes

- **Embedding model must match between ingest and query**: both use `all-MiniLM-L6-v2` (384 dims). The ingest script uses the Xenova JS port; the Python backend uses sentence-transformers. They are the same underlying model and produce compatible vectors.
- **Groq is the only external LLM provider in the current code.** Older docs and a few stale identifiers (`ollama` variable in `main.py`, `generate_deepseek_response` function name, the unused `OllamaEmbeddings` class in `src/app/lib/embeddings.js`, a `// DeepSeek R1` comment in `extract-report/route.js`) refer to providers that are no longer wired up. Treat them as cosmetic only.
- **OCR is Groq Vision** (`meta-llama/llama-4-scout-17b-16e-instruct`), not EasyOCR or Tesseract. EasyOCR is **not** a dependency.
- **`userId` in PatientReport is the user's email string**, not a MongoDB ObjectId. This is used as the lookup key in trend analysis.
- **Record binary storage**: files are stored as raw `Buffer` in MongoDB (`fileData` field). `/api/cdn/` is a separate legacy mechanism that reads from `public/uploads/` filesystem — not connected to the MongoDB records collection.
- **ML microservice graceful degradation**: if port 8001 is unreachable, `/api/analyze-trend` falls back to a rule-based HbA1c threshold for the risk score and omits the forecast block from the LLM prompt.
- **No automated tests.** Validation is via `test-connect.js`, `test_upload.py`, and inspecting the train scripts' printed metrics (held-out accuracy, macro-F1, confusion matrix, MAE/RMSE/R²).
- **Deployment topology**: the Next.js app ships to **Vercel**; both Python services (RAG backend and ML microservice) ship to **Hugging Face Spaces** as Docker SDK Spaces. Hugging Face exposes each Space on port 7860 over HTTPS — the Vercel deployment must have `PYTHON_BACKEND_URL` and `ML_SERVICE_URL` set to those Space URLs (and `GROQ_API_KEY` / `MONGODB_URI` available to all three).
