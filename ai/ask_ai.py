from langchain_groq import ChatGroq
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
import os
from dotenv import load_dotenv
load_dotenv()

embeddings = OllamaEmbeddings(model="nomic-embed-text")
vectorstore = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings
)

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    groq_api_key=os.getenv("GROQ_API_KEY")
)

retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

def ask_ai(question):
    docs = retriever.invoke(question)
    context = "\n\n".join([d.page_content for d in docs])

    prompt = f"""You are a cybersecurity analyst assistant.
Use ONLY the log data below to answer the question.
Be specific — mention IP addresses, ports, timestamps, and alert names.
If the answer is not in the logs, say "I don't have enough log data to answer that."

Log Data:
{context}

Question: {question}

Answer:"""

    response = llm.invoke(prompt)
    return response.content

if __name__ == "__main__":
    while True:
        q = input("\nAsk a question (or quit): ")
        if q.lower() == "quit":
            break
        print("\nAnswer:", ask_ai(q))