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
from embeddings import OllamaEmbeddings
import torch
import requests
import json

# Load environment variables
load_dotenv(".env.local")

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
ollama = OllamaEmbeddings()

# Generative Model Setup
GEN_MODEL = "deepseek-r1:1.5b"
VISION_MODEL = "llava" # Or llava-phi3
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []

def generate_deepseek_response(context, question, history):
    url = f"{OLLAMA_BASE_URL}/api/generate"
    
    # Format history
    history_text = ""
    for msg in history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            history_text += f"User: {content}\n"
        else:
            history_text += f"Assistant: {content}\n"

    prompt = f"""You are a helpful medical assistant. Answer the user's question using the provided medical context and conversation history. If the context does not contain the answer, say "I don't know based on the provided information." and suggest seeing a doctor.

Context:
{context}

History:
{history_text}

Question: {question}
Answer:"""
    
    payload = {
        "model": GEN_MODEL,
        "prompt": prompt,
        "stream": False
    }
    
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except Exception as e:
        print(f"DeepSeek Generation Error: {e}")
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
                    "numCandidates": 100,
                    "limit": 10  # Retrieve more candidates for reranking
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "text": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        results = list(collection.aggregate(pipeline_agg))
        print(f"   Action: Retrieved {len(results)} initial candidates from MongoDB.")

        if not results:
             return {
                "reply": "I couldn't find any relevant medical information.",
                "sources": [],
                "debug_info": []
            }

        # 3. BioBERT Reranking
        print("\nStep 4: Reranking with BioBERT")
        ranked_chunks = []
        for i, doc in enumerate(results):
            text = doc.get("text", "")
            # Use BioBERT to check if this chunk answers the question
            # We use the confidence score as a relevance metric
            qa_result = qa_pipeline(question=user_message, context=text)
            bert_score = qa_result["score"]
            
            ranked_chunks.append({
                "text": text,
                "metadata": doc.get("metadata", {}),
                "mongo_score": doc.get("score"),
                "bert_score": bert_score
            })
            print(f"   Chunk {i+1}: MongoScore={doc.get('score'):.4f} | BioBERTScore={bert_score:.4f} | Source={doc.get('metadata', {}).get('source')}")

        # Sort by BioBERT score desc
        ranked_chunks.sort(key=lambda x: x["bert_score"], reverse=True)
        
        # Take Top 3
        top_k = ranked_chunks[:3]
        print(f"   Action: Selected Top {len(top_k)} chunks for generation.")

        # 4. Context Construction
        print("\nStep 5: Context Construction")
        context_text = "\n\n".join([c["text"] for c in top_k])
        print(f"   Context Preview: {context_text[:200]}...")

        # 5. DeepSeek Generation
        print("\nStep 6: Generation (DeepSeek-R1)")
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
                "source": c["metadata"].get("source", "Unknown"),
                "content": c["text"][:100]
            })

        return {
            "reply": final_answer,
            "sources": [c["metadata"].get("source") for c in top_k if c["metadata"].get("source")],
            "debug_info": debug_info
        }

    except Exception as e:
        print(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze_report")
async def analyze_report(file: UploadFile = File(...)):
    print(f"\n=== NEW REPORT ANALYSIS START (VISION) ===")
    print(f"File: {file.filename}")
    
    try:
        # 1. Read PDF
        contents = await file.read()
        
        # Open PDF with PyMuPDF
        doc = fitz.open(stream=contents, filetype="pdf")
        
        full_analysis = ""
        extracted_text_summary = ""

        # Process each page (limit to first 3 pages to avoid timeout)
        for page_num, page in enumerate(doc):
            if page_num >= 3: 
                break
                
            print(f"   Processing Page {page_num + 1}...")
            
            # --- VISION PART ---
            # Render page to image
            pix = page.get_pixmap()
            img_data = pix.tobytes("png")
            img_b64 = base64.b64encode(img_data).decode("utf-8")
            
            # --- CALL VISION MODEL ---
            prompt_vision = "Analyze this medical report page. Identify all key statistics, lab values, and abnormalities. Transcribe visible text and format it as a summary."
            
            url = f"{OLLAMA_BASE_URL}/api/generate"
            payload = {
                "model": VISION_MODEL,
                "prompt": prompt_vision,
                "images": [img_b64],
                "stream": False
            }
            
            print(f"   Action: Sending page image to {VISION_MODEL}...")
            try:
                response = requests.post(url, json=payload)
                if response.status_code != 200:
                    print(f"   ERROR: Ollama returned {response.status_code}")
                    print(f"   Response Body: {response.text}")
                    
                response.raise_for_status()
                page_analysis = response.json().get("response", "").strip()
                full_analysis += f"\n--- Page {page_num + 1} Analysis ---\n{page_analysis}\n"
            except Exception as e:
                print(f"   Warning: Vision model failed for page {page_num+1}: {e}")
                print("   Action: Falling back to text extraction for this page.")
                page_text = page.get_text()
                if page_text.strip():
                     # Send text to DeepSeek instead
                     prompt_fallback = f"Analyze the following text from a medical report page: \n{page_text}"
                     try:
                         fallback_response = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json={"model": GEN_MODEL, "prompt": prompt_fallback, "stream": False})
                         if fallback_response.status_code == 200:
                             full_analysis += f"\n--- Page {page_num + 1} (Text Fallback) ---\n{fallback_response.json().get('response', '')}\n"
                     except:
                         pass
                # Fallback to text extraction if vision fails? For now, just continue
            
            # Extract raw text for context history
            extracted_text_summary += page.get_text() + "\n"

        doc.close()

        if not full_analysis.strip():
             return {"reply": "I couldn't analyze the images in this file. Please ensure 'llava' is installed (`ollama pull llava`).", "extracted_text": ""}

        # 3. Final Synthesis (Optional: Use DeepSeek to summarize the Llava output if it's too long, but raw Llava output is usually good)
        # We will return the Llava analysis directly.
        
        print(f"   Output: Vision analysis complete.")
        print("=== REPORT ANALYSIS COMPLETE ===\n")
        
        return {
            "reply": full_analysis,
            "extracted_text": extracted_text_summary # Still return text for history context
        }

    except Exception as e:
        print(f"ERROR Analyzing Report: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

