// src/app/lib/embeddings.js

class OllamaEmbeddings {
    constructor(config = {}) {
        this.model = config.model || process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
        this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    }

    async embedQuery(text) {
        try {
            const response = await fetch(`${this.baseUrl}/api/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: text,
                }),
            });

            if (!response.ok) {
                throw new Error(`Ollama API Error: ${response.statusText}`);
            }

            const data = await response.json();
            return data.embedding;
        } catch (error) {
            console.error('Error fetching embeddings from Ollama:', error);
            throw error;
        }
    }
}

export default OllamaEmbeddings;
