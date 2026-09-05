"""
Direct local Ollama embeddings client -- replaces GoogleGenerativeAIEmbeddings
entirely. Genuinely eliminates the whole category of rate-limit/quota
problems this project kept hitting with Gemini's free tier: there is no
external API call here at all, everything runs on this server's own
Ollama instance, so there is nothing to rate-limit and no key to manage.

Implements LangChain's Embeddings interface (embed_documents, embed_query)
so it's a drop-in replacement everywhere GoogleGenerativeAIEmbeddings was
used -- both in rag_setup.py (offline indexing) and app.py (live
retriever), with no other code changes needed beyond swapping the import.
"""
import requests

OLLAMA_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"


class LocalOllamaEmbeddings:
    def _embed_one(self, text):
        resp = requests.post(
            OLLAMA_URL,
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]

    def embed_documents(self, texts):
        """Ollama's embeddings endpoint processes one text at a time (no
        native batch API like Gemini's) -- called in a plain loop here.
        This is genuinely fine: local inference on your own server has no
        per-minute/per-day request cap to worry about, so looping doesn't
        cost anything except real wall-clock time."""
        return [self._embed_one(t) for t in texts]

    def embed_query(self, text):
        return self._embed_one(text)