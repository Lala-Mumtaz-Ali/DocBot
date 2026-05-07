"""
Quick test for condense_question() — verifies that follow-up references like
"explain them" get rewritten into self-contained queries that a vector
retriever can actually find chunks for.

Runs only the rewrite step (no MongoDB, no transformers, no BioBERT).
"""

import os
import sys
from dotenv import load_dotenv

# Mirror main.py's env loading order
load_dotenv("../.env.local")
load_dotenv()

# Stub the heavy imports main.py does at the top, so we can `from main import ...`
# without paying for transformers / pymongo / sentence-transformers.
import types

for mod_name in [
    "pymongo", "transformers", "torch",
    "fitz", "embeddings",
]:
    if mod_name not in sys.modules:
        stub = types.ModuleType(mod_name)
        sys.modules[mod_name] = stub

# Provide the specific names main.py imports from these stubs
sys.modules["pymongo"].MongoClient = lambda *a, **k: type("M", (), {"__getitem__": lambda s, k: None})()
sys.modules["transformers"].pipeline = lambda *a, **k: None
sys.modules["transformers"].AutoConfig = None
sys.modules["torch"].cuda = type("C", (), {"is_available": staticmethod(lambda: False)})()
sys.modules["embeddings"].LocalEmbeddings = lambda *a, **k: None

# Make sure the backend dir is on sys.path so `from main import ...` works
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# pymongo MongoClient stub returns None for db lookup — main.py's module-level
# code sets `collection = db[COLLECTION_NAME]`. We need a working chain.
class _Stub:
    def __getitem__(self, k): return self
    def __getattr__(self, k): return self
sys.modules["pymongo"].MongoClient = lambda *a, **k: _Stub()

# Force MONGODB_URI so the import doesn't ValueError out
os.environ.setdefault("MONGODB_URI", "stub")

from main import condense_question


SCENARIOS = [
    {
        "name": "User's failing case: 'explain them'",
        "history": [
            {"role": "user",      "content": "What is diabetes?"},
            {"role": "assistant", "content": "Diabetes is a chronic disease that affects how your body turns food into energy. It is characterized by high blood sugar levels."},
            {"role": "user",      "content": "How many types of diabetes are there?"},
            {"role": "assistant", "content": "There are at least three types: Type 1 diabetes, Type 2 diabetes, and Gestational diabetes."},
        ],
        "message": "explain them",
    },
    {
        "name": "Pronoun reference 'it'",
        "history": [
            {"role": "user",      "content": "What is hypertension?"},
            {"role": "assistant", "content": "Hypertension is high blood pressure, typically defined as a reading of 130/80 mmHg or higher."},
        ],
        "message": "what causes it?",
    },
    {
        "name": "First message — no history (should pass through unchanged)",
        "history": [],
        "message": "What is asthma?",
    },
    {
        "name": "Already standalone follow-up",
        "history": [
            {"role": "user",      "content": "What is diabetes?"},
            {"role": "assistant", "content": "Diabetes is a chronic disease..."},
        ],
        "message": "What are the symptoms of pneumonia?",
    },
    {
        "name": "Comparative follow-up",
        "history": [
            {"role": "user",      "content": "Tell me about Type 1 diabetes."},
            {"role": "assistant", "content": "Type 1 diabetes is an autoimmune condition where the pancreas produces little to no insulin."},
        ],
        "message": "how is it different from type 2?",
    },
]


def main():
    print("=" * 70)
    print("Testing condense_question() on real scenarios")
    print("=" * 70)
    for s in SCENARIOS:
        print(f"\n--- {s['name']} ---")
        print(f"Original     : {s['message']}")
        rewritten = condense_question(s["history"], s["message"])
        print(f"Rewritten    : {rewritten}")
        if rewritten == s["message"]:
            print("  (no change)")
        else:
            print("  (REWRITTEN)")
    print("\nDone.")


if __name__ == "__main__":
    main()
