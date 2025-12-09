from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pymongo import MongoClient
from transformers import pipeline, AutoConfig
import os
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
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

class ChatRequest(BaseModel):
    message: str

def generate_deepseek_response(context, question):
    url = f"{OLLAMA_BASE_URL}/api/generate"
    prompt = f"""You are a helpful medical assistant. Answer the user's question using ONLY the provided medical context below. If the context does not contain the answer, say "I don't know based on the provided information." and suggest seeing a doctor.

Context:
{context}

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
        final_answer = generate_deepseek_response(context_text, user_message)
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

