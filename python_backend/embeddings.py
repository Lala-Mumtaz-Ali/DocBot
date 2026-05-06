import os
from sentence_transformers import SentenceTransformer

class LocalEmbeddings:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        # We use a small, efficient model suitable for CPU inference and free tiers.
        self.model_name = os.getenv("EMBED_MODEL", model_name)
        print(f"Loading Local Embedding Model: {self.model_name}...")
        self.model = SentenceTransformer(self.model_name)

    def embed_query(self, text: str) -> list[float]:
        try:
            # Generate embedding and convert to list of floats
            embedding = self.model.encode(text)
            return embedding.tolist()
        except Exception as e:
            print(f"Error generating local embedding: {e}")
            raise e

