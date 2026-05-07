from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pymongo import MongoClient
from transformers import pipeline, AutoConfig
from fastapi import FastAPI, HTTPException, UploadFile, File
import fitz # PyMuPDF
import io
import os
import base64
from dotenv import load_dotenv
from embeddings import LocalEmbeddings
from groq import Groq
import torch
import requests
import json
import re

# Load environment variables
# Try loading from the unified Next.js root config first, then fallback to local .env
load_dotenv("../.env.local")
load_dotenv()

app = FastAPI()

# MongoDB Setup
MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB_NAME", "DocBot")
COLLECTION_NAME = os.getenv("MONGODB_COLLECTION", "medical_embeddings")
VECTOR_INDEX = os.getenv("MONGODB_VECTOR_INDEX", "vector_index")

if not MONGO_URI:
    raise ValueError("MONGODB_URI is not set in environment variables.")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

# BioBERT QA Setup (Used for Reranking/Scoring now)
MODEL_NAME = "dmis-lab/biobert-base-cased-v1.1-squad"
print(f"Loading QA Model for Reranking: {MODEL_NAME}...")
device = 0 if torch.cuda.is_available() else -1
qa_pipeline = pipeline("question-answering", model=MODEL_NAME, tokenizer=MODEL_NAME, device=device)
print(f"QA Model loaded on device {device}.")

# Embedding Setup
ollama = LocalEmbeddings()

# Generative Model Setup
GEN_MODEL = os.getenv("GEN_MODEL", "llama-3.3-70b-versatile") # Groq cloud model
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY is not set in environment variables.")

groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# ============================
# GROQ VISION OCR
# ============================
OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

def ocr_with_groq(page_image_bytes: bytes) -> str:
    """Extract text from a scanned page image using Groq vision model."""
    if not groq_client:
        print("Groq client not available for OCR.")
        return ""
    try:
        image_b64 = base64.b64encode(page_image_bytes).decode("utf-8")
        response = groq_client.chat.completions.create(
            model=OCR_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extract ALL text from this medical document image exactly as it appears. "
                                "Preserve the layout with line breaks. "
                                "Return only the raw extracted text, no commentary."
                            ),
                        },
                    ],
                }
            ],
            max_tokens=4096,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"Groq OCR error: {e}")
        return ""

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


# A small, fast model for the rewrite step. Falls back to the main GEN_MODEL
# if the user has not overridden it.
CONDENSE_MODEL = os.getenv("CONDENSE_MODEL", "llama-3.1-8b-instant")


def _normalize_history(history: list[dict]) -> list[dict]:
    """Filter out hidden context messages and map roles to 'user'/'assistant'."""
    out = []
    for msg in history or []:
        if msg.get("hidden"):
            continue
        role = msg.get("role", "user")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if role in ("bot", "model", "assistant"):
            role = "assistant"
        elif role != "system":
            role = "user"
        out.append({"role": role, "content": content})
    return out


def condense_question(history: list[dict], message: str) -> str:
    """
    Rewrite a follow-up question into a standalone query using the conversation
    history. This is the standard "Conversational RAG" pattern: it lets the
    retriever see the resolved question (e.g. "explain them" -> "explain Type 1,
    Type 2, and Gestational diabetes") so vector search can actually find
    relevant chunks.

    Returns the original message unchanged if there is no history, no LLM
    available, or the rewrite fails.
    """
    history = _normalize_history(history)
    if not history or not groq_client:
        return message

    convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-6:])
    rewrite_prompt = (
        "You rewrite follow-up messages from a medical chat into a single, "
        "self-contained question that a search engine can use without seeing "
        "the prior conversation.\n\n"
        "Rules:\n"
        "- Resolve pronouns and references (\"them\", \"it\", \"that\") using the conversation.\n"
        "- Keep the user's original intent and medical terminology exactly.\n"
        "- Do NOT answer the question.\n"
        "- If the message is already standalone, return it unchanged.\n"
        "- Output ONLY the rewritten question, no quotes, no preamble.\n\n"
        f"Conversation so far:\n{convo}\n\n"
        f"Follow-up message: {message}\n\n"
        "Standalone question:"
    )

    try:
        response = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": rewrite_prompt}],
            model=CONDENSE_MODEL,
            temperature=0.0,
            max_tokens=200,
        )
        rewritten = (response.choices[0].message.content or "").strip()
        rewritten = rewritten.strip('"').strip("'").strip()
        # Sanity guard: if the model returned an empty string or echoed back
        # an obvious refusal, keep the original message.
        if not rewritten or len(rewritten) > 500:
            return message
        return rewritten
    except Exception as e:
        print(f"Query condensation failed: {e}")
        return message


def generate_deepseek_response(context, question, history):
    if not groq_client:
        return "Error: GROQ_API_KEY is not configured."

    messages = []

    # System Prompt — context is primary, but history is allowed for resolving
    # follow-up references and continuing previously-grounded discussions.
    system_prompt = (
        "You are DocBot, a friendly and concise medical assistant.\n\n"
        "You have two information sources:\n"
        "1. RETRIEVED CONTEXT: medical text chunks fetched for the current question. "
        "Treat these as your primary source of factual claims.\n"
        "2. CONVERSATION HISTORY: prior turns in this chat. Use them to understand "
        "follow-up questions, pronouns, and references (e.g. \"explain them\", \"what about that?\").\n\n"
        "Rules:\n"
        "- If the user is following up on something you already answered, continue that thread.\n"
        "- Prefer facts from the retrieved context. If the context contradicts something "
        "you said earlier, trust the context.\n"
        "- If neither the context nor the conversation gives you a confident answer, say "
        "\"I don't have enough information to answer that. Please consult a doctor.\"\n"
        "- Do not invent facts or cite sources you weren't given.\n"
        "- Keep answers clear and concise."
    )
    
    messages.append({"role": "system", "content": system_prompt})

    # Add Conversation History (normalized — hidden messages dropped, roles mapped)
    for msg in _normalize_history(history):
        messages.append(msg)

    # Add Current Context and Question as User Message
    user_input = f"Context:\n{context}\n\nQuestion: {question}"
    messages.append({"role": "user", "content": user_input})
    
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=messages,
            model=GEN_MODEL,
            temperature=0.2,
        )
        
        content = chat_completion.choices[0].message.content
        
        # Clean <think> tags if present (in case user switches to DeepSeek on Groq)
        content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        
        return content

    except Exception as e:
        print(f"Groq Generation Error: {e}")
        return f"Error generating response with {GEN_MODEL}. Please check logs."

@app.get("/")
def read_root():
    return {"status": "DocBot Hybrid RAG Backend Running"}

@app.post("/chat")
def chat(request: ChatRequest):
    user_message = request.message
    history = request.history
    print(f"\n=== NEW QUERY PROCESSING START (HYBRID RAG) ===")
    print(f"Step 1: User Input -> '{user_message}'")

    try:
        # 1a. Condense follow-up into a standalone retrieval query.
        # The retriever is stateless, so "explain them" embeds to nothing useful.
        # We rewrite using the conversation history before searching.
        print("\nStep 1b: Conversational Query Rewrite")
        retrieval_query = condense_question(history, user_message)
        if retrieval_query != user_message:
            print(f"   Rewritten for retrieval: '{retrieval_query}'")
        else:
            print("   No rewrite needed (no history or already standalone).")

        # 1. Generate Embedding (uses the condensed query)
        print("\nStep 2: Embedding Generation (Ollama)")
        query_embedding = ollama.embed_query(retrieval_query)
        print(f"   Action: Generated query vector ({len(query_embedding)} dims).")

        # 2. Vector Search (MongoDB Atlas)
        print("\nStep 3: Vector Search (MongoDB Atlas)")
        pipeline_agg = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX,
                    "path": "embedding",
                    "queryVector": query_embedding,
                    "numCandidates": 200,
                    "limit": 30  # Retrieve more candidates for better reranking coverage
                }
            },
            {
                "$addFields": {
                    "score": {"$meta": "vectorSearchScore"}
                }
            },
            {
                "$project": {
                    "embedding": 0  # Exclude the large vector, keep everything else
                }
            }
        ]
        results = list(collection.aggregate(pipeline_agg))
        print(f"   Action: Retrieved {len(results)} initial candidates from MongoDB.")
        # Debug: print raw document structure to diagnose field mapping
        if results:
            print(f"   [DEBUG] Raw doc keys: {list(results[0].keys())}")
            print(f"   [DEBUG] Raw doc[0] metadata: {results[0].get('metadata')}")
            print(f"   [DEBUG] Raw doc[0] score: {results[0].get('score')}")

        if not results:
             return {
                "reply": "I couldn't find any relevant medical information.",
                "sources": [],
                "debug_info": []
            }

        # Helper to extract source from various possible locations
        def get_source(doc):
            meta = doc.get("metadata")
            if isinstance(meta, dict) and meta.get("source"):
                return meta["source"]
            if doc.get("source"):
                return doc["source"]
            return "Medical Knowledge Base"

        # 3. BioBERT Reranking
        print("\nStep 4: Reranking with BioBERT")
        ranked_chunks = []
        for i, doc in enumerate(results):
            text = doc.get("text", doc.get("pageContent", ""))
            if not text:
                continue
            # Use BioBERT to check if this chunk answers the question
            # We use the confidence score as a relevance metric.
            # Use the condensed retrieval query so reranking sees resolved references.
            qa_result = qa_pipeline(question=retrieval_query, context=text)
            bert_score = qa_result["score"]
            
            source = get_source(doc)
            ranked_chunks.append({
                "text": text,
                "source": source,
                "mongo_score": doc.get("score"),
                "bert_score": bert_score
            })
            print(f"   Chunk {i+1}: MongoScore={doc.get('score', 0):.4f} | BioBERTScore={bert_score:.4f} | Source={source}")

        # Sort by BioBERT score desc
        ranked_chunks.sort(key=lambda x: x["bert_score"], reverse=True)
        
        # Take Top 7 best chunks after reranking
        top_k = ranked_chunks[:7]
        print(f"   Action: Selected Top {len(top_k)} chunks for generation.")

        # 4. Context Construction
        print("\nStep 5: Context Construction")
        context_text = "\n\n".join([c["text"] for c in top_k])
        print(f"   Context Preview: {context_text[:200]}...")

        # 5. LLM Generation
        print(f"\nStep 6: Generation ({GEN_MODEL})")
        print(f"   Action: Sending prompt to {GEN_MODEL}...")
        final_answer = generate_deepseek_response(context_text, user_message, history[-5:]) # Pass last 5 turns
        print(f"   Output: {final_answer}")

        print("=== QUERY PROCESSING COMPLETE ===\n")

        # Prepare Debug Info
        debug_info = []
        for i, c in enumerate(top_k):
            debug_info.append({
                "rank": i+1,
                "bert_score": c["bert_score"],
                "mongo_score": c["mongo_score"],
                "source": c["source"],
                "content": c["text"][:100]
            })

        return {
            "reply": final_answer,
            "sources": [c["source"] for c in top_k],
            "debug_info": debug_info,
            "retrieval_query": retrieval_query,
        }

    except Exception as e:
        print(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/extract_pdf_text")
async def extract_pdf_text(file: UploadFile = File(...)):
    """Extract raw text from PDF using PyMuPDF. Scanned PDFs fallback to Vision Model OCR."""
    try:
        contents = await file.read()
        doc = fitz.open(stream=contents, filetype="pdf")
        
        extracted_text = ""
        for page_num, page in enumerate(doc):
            # Try native text extraction first
            page_text = page.get_text().strip()
            
            # If empty (less than 50 chars usually implies a scanned image page)
            if len(page_text) < 50:
                print(f"Page {page_num + 1} appears to be an image. Falling back to Groq Vision OCR...")
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
                    page_text = ocr_with_groq(pix.tobytes("png"))
                    if page_text.strip():
                        print(f"Groq OCR successful for page {page_num + 1}.")
                    else:
                        print(f"Groq OCR returned no text for page {page_num + 1}.")
                except Exception as eval_err:
                    print(f"OCR error on page {page_num+1}: {eval_err}")
            
            print(f"\n📝 Extracted Text from Page {page_num + 1} (/extract_pdf_text):")
            print(page_text)
            print("-" * 40)
            
            extracted_text += page_text + "\n"
            
        doc.close()
        return {"text": extracted_text.strip()}
    except Exception as e:
        print(f"ERROR Extracting PDF Text: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_report")
async def analyze_report(file: UploadFile = File(...)):
    print("\n==============================")
    print("🚀 NEW REPORT ANALYSIS START")
    print("==============================")

    try:
        contents = await file.read()
        doc = fitz.open(stream=contents, filetype="pdf")

        full_text = ""

        for page_num, page in enumerate(doc):
            print(f"\n📄 Processing Page {page_num + 1}")

            # 1️⃣ Normal extraction
            text = page.get_text("text").strip()

            # 2️⃣ OCR fallback
            if len(text) < 50:
                print("⚠️ Using Groq Vision OCR")
                pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
                text = ocr_with_groq(pix.tobytes("png"))
                if text.strip():
                    print("✅ Groq OCR Success")
                else:
                    print("❌ Groq OCR returned no text")

            # Clean text
            text = re.sub(r'\s+', ' ', text)

            full_text += f"\n--- Page {page_num + 1} ---\n{text}\n"

            print(f"\n📝 Extracted Text from Page {page_num + 1} (/analyze_report):")
            print(text)
            print("-" * 40)

        doc.close()

        print("\n📊 FINAL TEXT LENGTH:", len(full_text))

        # ============================
        # 🔥 REGEX EXTRACTION (FINAL FIX)
        # ============================

        # 🔥 Normalize text (fix OCR broken words like "H b A 1 c")
        normalized_text = re.sub(r'\s+', ' ', full_text)
        normalized_text = normalized_text.replace("H b A 1 c", "HbA1c")
        normalized_text = normalized_text.replace("H b A1 c", "HbA1c")
        normalized_text = normalized_text.replace("H b A 1c", "HbA1c")

        # 🔥 Strong HbA1c regex (handles all formats)
        hb = re.search(
            r'(HbA1c|A1c|Glycated Hemoglobin)[^\d]{0,25}([\d]+\.?\d*)',
            normalized_text,
            re.IGNORECASE
        )
        print("hello how are you" ,hb)

        # 🔥 Glucose regex (slightly improved)
        glucose = re.search(
            r'(Glucose|Blood Sugar|Fasting Blood Sugar)[^\d]{0,25}([\d]+\.?\d*)',
            normalized_text,
            re.IGNORECASE
        )

        hb_value = hb.group(2) if hb else None
        glucose_value = glucose.group(2) if glucose else None

        print("\n🧪 HbA1c:", hb_value)
        print("🧪 Glucose:", glucose_value)

        # ============================
        # 🤖 AI EXTRACTION
        # ============================
        prompt = f"""
You are a medical data extractor.

Already extracted:
- HbA1c: {hb_value}
- Glucose: {glucose_value}

Extract ONLY JSON:
- report_date
- patient_name
- abnormal_values

Rules:
- DO NOT guess
- If missing → null
- Return ONLY JSON

Text:
{full_text[:4000]}
"""

        if not groq_client:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured.")

        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=GEN_MODEL,
            temperature=0.1,
            response_format={"type": "json_object"}
        )

        ai_output = chat_completion.choices[0].message.content

        print("\n🤖 AI OUTPUT:")
        print(ai_output)

        return {
            "reply": ai_output,
            "hbA1c": hb_value,
            "glucose": glucose_value,
            "extracted_text": full_text
        }

    except Exception as e:
        print("\n❌ ERROR:", e)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

