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

def generate_deepseek_response(context, question, history):
    if not groq_client:
        return "Error: GROQ_API_KEY is not configured."

    messages = []
    
    # System Prompt
    system_prompt = """You are a helpful medical assistant. Answer the user's question using the provided medical context. 
If the answer is not in the context, say "I don't know based on the provided information." and suggest seeing a doctor.
Do not hallucinate. Keep the answer concise."""
    
    messages.append({"role": "system", "content": system_prompt})

    # Add Conversation History
    for msg in history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        # Skip hidden context messages injected by PDF uploads
        if msg.get("hidden"):
            continue
        # Map frontend roles to Groq-compatible roles
        if role in ("bot", "model", "assistant"):
            role = "assistant"
        elif role != "system":
            role = "user"
        messages.append({"role": role, "content": content})

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
        # 1. Generate Embedding
        print("\nStep 2: Embedding Generation (Ollama)")
        query_embedding = ollama.embed_query(user_message)
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
            # We use the confidence score as a relevance metric
            qa_result = qa_pipeline(question=user_message, context=text)
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
            "debug_info": debug_info
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

