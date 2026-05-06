FROM python:3.11-slim

WORKDIR /app

# System dependencies needed by PyMuPDF and transformers
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first.
# The default torch on PyPI bundles CUDA (~2GB). CPU-only is ~200MB.
# We install it before requirements.txt so pip skips reinstalling it.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download ML models into the image at build time.
# This makes runtime startup instant — models are already on disk.
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
print('Downloading MiniLM...'); \
SentenceTransformer('all-MiniLM-L6-v2'); \
print('MiniLM done.')"

RUN python -c "\
from transformers import pipeline; \
print('Downloading BioBERT...'); \
pipeline('question-answering', model='dmis-lab/biobert-base-cased-v1.1-squad'); \
print('BioBERT done.')"

# Copy application source
COPY . .

# HuggingFace Spaces exposes port 7860 for Docker spaces
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
