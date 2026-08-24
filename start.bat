@echo off
REM Force the working directory to wherever this script actually lives,
REM regardless of how it's launched. Needed specifically because "Run as
REM Administrator" on a .bat file can start the process from
REM C:\Windows\System32 instead of the script's own folder -- which would
REM silently break every relative `cd ai` / `cd web` / `cd web-react`
REM below without this.
cd /d %~dp0

echo Starting SOC Copilot...

set PYTHON=C:\Users\satya\AppData\Local\Python\pythoncore-3.14-64\python.exe
set RUSTINEL_DIR=C:\Users\satya\Documents\rustinel_soc\rustinel-1.3.0-x86_64-pc-windows-msvc

echo [1/7] Starting Ollama...
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
echo [2/7] Pulling latest data from honeypot...
cd ai
%PYTHON% honeypot_log_sync.py --once
cd ..

echo [3/7] Building ChromaDB from fresh honeypot data...
cd ai
%PYTHON% rag_setup.py
cd ..

REM Flask starts only now. Its own startup begins the continuous background
REM sync (polling every 15s) for the rest of the session -- it no longer
REM needs to run *before* the rebuild, since the one-shot pull above already
REM got the initial data in.
echo [4/7] Starting Flask (background sync continues from here)...
cd web
start "Flask Backend" %PYTHON% app.py
cd ..

echo [5/7] Starting React...
cd web-react
start "React Frontend" cmd /k "npm start"
cd ..

echo [6/7] Starting Sentinel...
timeout /t 3 /nobreak
start "Sentinel" %PYTHON% agent\sentinel_launcher.py

REM Rustinel needs Administrator privileges to enable ETW providers on
REM Windows -- if this whole start.bat wasn't launched "as Administrator",
REM this step will fail silently or throw an access-denied error. If that
REM happens, right-click start.bat -> "Run as administrator" instead of
REM double-clicking it normally.
echo [7/7] Starting Rustinel EDR...
timeout /t 2 /nobreak
start "Rustinel EDR" cmd /k "cd /d %RUSTINEL_DIR% && rustinel.exe run --console"

echo.
echo All services running!
echo Open http://localhost:3000
pause