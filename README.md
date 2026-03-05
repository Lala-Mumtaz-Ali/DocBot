# DocBot - Medical RAG Chatbot

DocBot is a hybrid Retrieval-Augmented Generation (RAG) chatbot designed to answer medical queries. It effectively combines:
- **MongoDB Atlas Vector Search** for retrieval.
- **BioBERT** for re-ranking and finding precise medical context.
- **DeepSeek-R1 (via Ollama)** for generating natural, evidence-based responses.

## Prerequisites

Before running the project, ensure you have the following installed:

1.  **Node.js** (v18+)
2.  **Python** (v3.10+)
3.  **Ollama** (Local LLM runner) -> [Download Ollama](https://ollama.com/)
4.  **MongoDB Atlas Account** (with a Vector Search Index configured)

---

## 1. Environment Setup

### Clone & Configure
1.  Navigate to the project directory:
    ```bash
    cd d:\FYP\docbot
    ```

2.  Create a `.env.local` file in the root directory with your secrets:
    ```env
    # MongoDB Atlas
    MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/?retryWrites=true&w=majority
    MONGODB_DB_NAME=DocBot
    MONGODB_COLLECTION=medical_embeddings
    MONGODB_VECTOR_INDEX=vector_index
    MONGODB_TEXT_KEY=text
    MONGODB_EMBEDDING_KEY=embedding
    
    # Ollama
    OLLAMA_BASE_URL=http://localhost:11434
    OLLAMA_EMBED_MODEL=nomic-embed-text
    ```

---

## 2. Install Dependencies

### Python Backend
Install the required Python packages:
```bash
pip install -r requirements.txt
```
*(If you don't have `pip`, ensure Python is added to your PATH).*

### Node.js Frontend (and Ingestion Scripts)
Install the Node.js packages:
```bash
npm install
```

---

## 3. Setup Models (Ollama)

You need to pull the specific models used by the system locally. Open a terminal and run:

1.  **Pull Embedding Model:**
    ```bash
    ollama pull nomic-embed-text
    ```
2.  **Pull Generation Model:**
    ```bash
    ollama pull deepseek-r1:1.5b
    ```

*(Note: The BioBERT model will automatically download the first time you run the Python backend).*

---

## 4. Validating & Ingesting Data

If you are starting fresh or adding new definitions (like `data/smallTalk/definitions.json`), run the ingestion script:

```bash
# Ingest smallTalk data (PDFs and JSON definitions)
npx ts-node scripts/ingest-smallTalk.ts
```
This process will:
1.  Read files from `data/smallTalk`.
2.  Generate embeddings using Ollama.
3.  Store them in your MongoDB Atlas collection.

---

## 5. Running the Application

You will need **two terminal windows** running simultaneously.

### Terminal 1: Python Backend (API)
This handles the heavy lifting (AI logic).
```bash
python python_backend/main.py
```
*Wait until you see "QA Model loaded" before using the chat.*

### Terminal 2: Next.js Frontend (UI)
This runs the web interface.
```bash
npm run dev
```
Open your browser and navigate to: **[http://localhost:3000/chat](http://localhost:3000/chat)**

---

## Architecture Flow
1.  **Input**: User asks "What is diabetes?".
2.  **Retrieval**: MongoDB finds relevant definition documents.
3.  **Reranking**: BioBERT scores the documents to pick the most relevant ones.
4.  **Generation**: DeepSeek-R1 (1.5b) writes a helpful answer using those documents.

pip install zain