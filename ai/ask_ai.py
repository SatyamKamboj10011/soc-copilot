from langchain_ollama import OllamaEmbeddings
from langchain_ollama import OllamaLLM
from langchain_community.vectorstores import Chroma

print("Loading ChromaDB...")
embeddings = OllamaEmbeddings(model="llama3")
vectorstore = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings
)

print("Setting up AI...")
llm = OllamaLLM(model="llama3")
retriever = vectorstore.as_retriever()

questions = [
    "What suspicious activity was detected?",
    "Which IP addresses appear most often?",
    "What type of events are in these logs?"
]

for q in questions:
    print(f"\nQuestion: {q}")
    docs = retriever.invoke(q)
    context = "\n".join([d.page_content for d in docs])
    prompt = f"Based on these security logs:\n{context}\n\nAnswer this question: {q}"
    answer = llm.invoke(prompt)
    print(f"Answer: {answer}")