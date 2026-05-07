# save as test.py and run it
import requests

response = requests.post("http://localhost:5000/ask", json={
    "question": "What alerts were detected?",
    "model": "ollama"
})
print(response.json())