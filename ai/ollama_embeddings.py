"""
Direct Ollama embeddings, bypassing langchain_ollama.OllamaEmbeddings.

On this machine, langchain_ollama.OllamaEmbeddings was not honoring an
explicit base_url argument -- it kept targeting a stray, non-standard local
port instead of 127.0.0.1:11434, regardless of what was passed in or what
OLLAMA_HOST was set to. Confirmed by testing the underlying `ollama` package
directly with an explicit host, which worked correctly every time.

This wraps that same direct, working call in LangChain's Embeddings
interface, so it's a drop-in replacement for OllamaEmbeddings anywhere it
was used (rag_setup.py's indexing step, app.py's live retriever).
"""

import ollama
from langchain_core.embeddings import Embeddings


class DirectOllamaEmbeddings(Embeddings):
    def __init__(self, model: str = "nomic-embed-text", host: str = "http://127.0.0.1:11434"):
        self.model = model
        self.client = ollama.Client(host=host)

    def embed_documents(self, texts, batch_size: int = 100):
        # A single huge batch (thousands of texts in one call) was crashing
        # something inside the ollama package -- but a single string worked
        # fine in isolation. Splitting into modest-sized batches is a middle
        # ground: far fewer round trips than one-at-a-time, while staying
        # small enough to (hopefully) avoid whatever the large-batch path
        # was triggering. If this still fails, drop batch_size further
        # (e.g. 5) before falling back to one-at-a-time.
        results = []
        total = len(texts)
        for start in range(0, total, batch_size):
            chunk = texts[start:start + batch_size]
            result = self.client.embed(model=self.model, input=chunk)
            results.extend(result["embeddings"])
            done = min(start + batch_size, total)
            print(f"[ollama_embeddings] embedded {done}/{total}")
        return results

    def embed_query(self, text):
        result = self.client.embed(model=self.model, input=text)
        return result["embeddings"][0]