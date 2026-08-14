@echo off
echo Starting SOC Copilot...

set PYTHON=C:\Users\satya\AppData\Local\Python\pythoncore-3.14-64\python.exe

echo [1/6] Starting Ollama...
start "" ollama serve
echo Waiting for Ollama to start...
timeout /t 25 /nobreak

REM One-shot pull of fresh honeypot data BEFORE Flask starts. Flask holds
REM ai/chroma_db's sqlite file open the entire time it's running -- a hard
REM Windows file lock that directly conflicts with rag_setup.py's
REM shutil.rmtree() during a rebuild. The sync only touches logs/eve.json
REM and conn.log, never chroma_db, so it doesn't need Flask running at all
REM -- pulling once here avoids that lock conflict completely, while still
REM guaranteeing the rebuild below sees genuinely current data.
echo [2/6] Pulling latest data from honeypot...
cd ai
%PYTHON% honeypot_log_sync.py --once
cd ..

echo [3/6] Building ChromaDB from fresh honeypot data...
cd ai
%PYTHON% rag_setup.py
cd ..

REM Flask starts only now. Its own startup begins the continuous background
REM sync (polling every 15s) for the rest of the session -- it no longer
REM needs to run *before* the rebuild, since the one-shot pull above already
REM got the initial data in.
echo [4/6] Starting Flask (background sync continues from here)...
cd web
start "Flask Backend" %PYTHON% app.py
cd ..

echo [5/6] Starting React...
cd web-react
start "React Frontend" cmd /k "npm start"
cd ..

echo [6/6] Starting Sentinel...
timeout /t 3 /nobreak
start "Sentinel" %PYTHON% agent\sentinel_launcher.py

echo.
echo All services running!
echo Open http://localhost:3000
pause