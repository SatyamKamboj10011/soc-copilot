# from langchain_community.llms import ollama
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_ollama import OllamaEmbeddings


print("Loading log file...")
loader = TextLoader('logs/eve.json')
documents = loader.load()

print("Splitting into Chunks...")
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)
chunks = splitter.split_documents(documents)

print("Storing in ChromaDB...")
embeddings = OllamaEmbeddings(model="llama3")
vectorstore = Chroma.from_documents(
    chunks,
    embeddings,
    persist_directory="./chroma_db"
)

print("RAG pipeline is ready!")
print(f"Loaded {len(chunks)} chunks into chromaDB")
