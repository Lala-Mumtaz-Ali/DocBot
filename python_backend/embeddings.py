import requests
import os
import json

class OllamaEmbeddings:
    def __init__(self, model: str = "nomic-embed-text", base_url: str = "http://localhost:11434"):
        self.model = os.getenv("OLLAMA_EMBED_MODEL", model)
        self.base_url = os.getenv("OLLAMA_BASE_URL", base_url)

    def embed_query(self, text: str) -> list[float]:
        try:
            url = f"{self.base_url}/api/embeddings"
            payload = {
                "model": self.model,
                "prompt": text
            }
            response = requests.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("embedding", [])
        except Exception as e:
            print(f"Error generating embedding: {e}")
            raise e
