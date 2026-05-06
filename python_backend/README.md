---
title: DocBot Backend
emoji: 🏥
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
app_port: 7860
---

# DocBot Python Backend

FastAPI backend for DocBot — a medical document chatbot with a hybrid RAG pipeline.

## Endpoints

- `POST /chat` — RAG-based medical Q&A (BioBERT reranking + Groq generation)
- `POST /extract_pdf_text` — PDF text extraction with Groq Vision OCR fallback
- `POST /analyze_report` — Full report analysis with Groq
