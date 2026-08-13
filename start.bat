@echo off
echo Starting SOC Copilot...

set PYTHON=C:\Users\prath\AppData\Local\Programs\Python\Python313\python.exe

echo [1/5] Starting Ollama...
start "" ollama serve
echo Waiting for Ollama to start...
timeout /t 25 /nobreak

echo [2/5] Building ChromaDB...
cd ai
%PYTHON% rag_setup.py
cd ..

echo [3/5] Starting Flask...
cd web
start "Flask Backend" %PYTHON% app.py
cd ..

echo [4/5] Starting React...
cd web-react
start "React Frontend" cmd /k "npm start"
cd ..

echo [5/5] Starting Sentinel...
timeout /t 3 /nobreak
start "Sentinel" %PYTHON% agent\sentinel_launcher.py

echo.
echo All services running!
echo Open http://localhost:3000
pause