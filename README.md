# DocBot — Medical RAG Chatbot

DocBot is a hybrid Retrieval-Augmented Generation (RAG) chatbot for diabetes-focused
medical queries, with report analysis and HbA1c risk/forecast prediction. It combines:

- **MongoDB Atlas Vector Search** for retrieval
- **BioBERT** for re-ranking retrieved chunks
- **Groq** (`llama-3.3-70b-versatile`) for generating evidence-based answers
- **XGBoost** models for diabetes risk classification and 90-day HbA1c forecasting

## Services

The project runs as three separate services:

| Service | Local port | Runtime | Production host |
|---|---|---|---|
| Next.js frontend | 3000 | Node.js | Vercel |
| FastAPI RAG backend | 8000 | Python | Hugging Face Spaces (Docker) |
| FastAPI ML microservice | 8001 | Python | Hugging Face Spaces (Docker) |

In production the Vercel frontend calls the two Spaces over HTTPS via
`PYTHON_BACKEND_URL` and `ML_SERVICE_URL`.

## Prerequisites

1. **Node.js** v18+ (developed on v24)
2. **Python** 3.10+ (developed on 3.14)
3. **MongoDB Atlas account** with a vector search index named `vector_index` on the
   `medical_embeddings` collection — 384 dimensions, cosine similarity
4. **Groq API key** — <https://console.groq.com>

There is **no Ollama requirement.** Earlier versions used Ollama/DeepSeek-R1; all LLM
and OCR calls now go to Groq. A few stale identifiers remain in the code (an `ollama`
variable, a `generate_deepseek_response` function name) — they are cosmetic.

---

## 1. Environment Setup

Create a `.env.local` file in the project root. The Python backend loads this same file.

```env
# --- Required ---
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/DocBot?retryWrites=true&w=majority
JWT_SECRET=<random-string>
GROQ_API_KEY=<your-groq-key>

# --- Google OAuth (required for Google sign-in) ---
GOOGLE_CLIENT_ID=<client-id>
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>

# --- Welcome emails (nodemailer via Gmail) ---
EMAIL_USER=<gmail-address>
EMAIL_PASS=<gmail-app-password>

# --- Service URLs (defaults shown; point at the HF Spaces in production) ---
PYTHON_BACKEND_URL=http://localhost:8000
ML_SERVICE_URL=http://localhost:8001

# --- Optional overrides (defaults are applied in code) ---
MONGODB_DB_NAME=DocBot
MONGODB_COLLECTION=medical_embeddings
MONGODB_VECTOR_INDEX=vector_index
GEN_MODEL=llama-3.3-70b-versatile
CONDENSE_MODEL=llama-3.1-8b-instant
OCR_MODEL=qwen/qwen3.6-27b
OCR_MAX_TOKENS=16384
EMBED_MODEL=all-MiniLM-L6-v2
```

> Use `KEY=value`. A `KEY: value` line is silently ignored by both dotenv and Next.js,
> which makes the variable read as undefined with no error.

**Never commit `.env.local`,** and never add a `.env` to the Hugging Face Space repos —
Space files are publicly readable. Use each Space's **Settings → Variables and secrets**.

---

## 2. Install Dependencies

### Node.js frontend and ingestion scripts

```bash
npm install
```

### Python services

Use a virtual environment so packages don't land in your global interpreter:

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r python_backend/requirements.txt
pip install -r diabetes_ml/requirements.txt
```

The BioBERT and sentence-transformers models download automatically on the backend's
first run (~450 MB).

---

## 3. Running the Application

Three terminals:

```bash
# Terminal 1 — Next.js frontend on :3000
npm run dev

# Terminal 2 — FastAPI RAG backend on :8000
python python_backend/main.py

# Terminal 3 — FastAPI ML microservice on :8001
cd diabetes_ml
uvicorn main:app --port 8001 --reload
```

Wait for `QA Model loaded` in Terminal 2 before using the chat, then open
<http://localhost:3000>.

The ML microservice degrades gracefully — if port 8001 is unreachable, trend analysis
falls back to a rule-based HbA1c threshold and skips the forecast.

---

## 4. Knowledge-Base Ingestion

Run once to populate the vector store. Source files live in `data_DocBot_Chat/`.

```bash
# books/, medguides/, medlineplus_xml/
npm run ingest

# smallTalk/
npm run ingest:smalltalk
```

Embeddings use `Xenova/all-MiniLM-L6-v2` (384 dims), matching the Python backend's
`all-MiniLM-L6-v2`. Chunks are 1000 chars with 150 overlap, written in batches of 100
to the `medical_embeddings` collection. Resume an interrupted run with the `START_BATCH`
environment variable.

---

## 5. ML Training Pipeline

Trained models are committed under `diabetes_ml/models/`, so this is only needed to
retrain. Requires the FHIR bundles in `Model_Training_Material/fhir/`.

```bash
cd diabetes_ml
python ingest_fhir.py            # FHIR JSON -> data/raw/diabetes_raw_fhir.csv
python train_model.py            # -> models/xgboost_model.pkl (3-class risk classifier)
python train_forecast_model.py   # -> models/xgboost_forecast.pkl (HbA1c regressor)
python evaluate_model.py         # sanity-check the classifier
```

The `.pkl` files are pickled estimators and are therefore tied to the XGBoost major
version that wrote them, which is why `diabetes_ml/requirements.txt` pins `<4.0.0`.

---

## Architecture Flow

**Chat**

1. User message → Next.js `/api/chat` → FastAPI `POST /chat`
2. Follow-ups are condensed into a standalone query (Groq `llama-3.1-8b-instant`)
3. Query embedded with `all-MiniLM-L6-v2` (384 dims)
4. MongoDB Atlas vector search — `numCandidates=200`, `limit=30`
5. BioBERT reranks the candidates; the top **7** are kept
6. Groq `llama-3.3-70b-versatile` writes the final answer from that context

**Report analysis**

1. PDF → `/api/extract-report` → FastAPI `/extract_pdf_text` (PyMuPDF)
2. Pages yielding under 50 characters fall back to Groq vision OCR
3. Regex + Groq extract `report_date`, `HbA1c`, and `fasting_glucose` into
   the `patient_reports` collection
4. `/api/analyze-trend` calls the ML service's `/predict-risk` and `/predict-forecast`
   in parallel, then has Groq write a patient-friendly explanation

---

## Testing

There is no Jest or Pytest suite. Validation is via ad-hoc scripts:

```bash
node test-connect.js     # verify the MongoDB connection
python test_upload.py    # exercise the FastAPI upload endpoint
```

The training scripts print their own metrics (held-out accuracy, macro-F1, confusion
matrix, MAE/RMSE/R²).

---

## Troubleshooting

**`querySrv ECONNREFUSED` from Node, while other tools reach Atlas fine.**
Node resolves `mongodb+srv://` through c-ares, which on some Windows setups falls back
to an unreachable `127.0.0.1` resolver even when the OS DNS is healthy. Either set a
working DNS server on the network adapter, or switch `MONGODB_URI` to the non-SRV form
(`mongodb://host1,host2,host3/...?ssl=true&replicaSet=...&authSource=admin`), which
skips the SRV lookup entirely.

**Google sign-in fails with no error.** Check that the `GOOGLE_CLIENT_ID` lines in
`.env.local` use `=` and not `:`.

**Scanned PDFs extract no text.** Groq periodically retires vision models. If the log
reports the OCR model as decommissioned, pick a current vision-capable model from
<https://console.groq.com/docs/models> and set `OCR_MODEL`.
