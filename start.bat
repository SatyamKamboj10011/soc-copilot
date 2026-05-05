@echo off
echo Starting SOC Copilot...

set PYTHON=C:\Users\satya\AppData\Local\Python\pythoncore-3.14-64\python.exe

echo [1/4] Starting Ollama...
start "" ollama serve
echo Waiting for Ollama to start...
timeout /t 8 /nobreak

echo [2/4] Building ChromaDB...
cd ai
%PYTHON% rag_setup.py
cd ..

echo [3/4] Starting Flask...
cd web
start "Flask Backend" %PYTHON% app.py
cd ..

echo [4/4] Starting React...
cd web-react
start "React Frontend" cmd /k "npm start"
cd ..

echo.
echo All services running!
echo Open http://localhost:3000
pause