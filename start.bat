@echo off
echo Starting SOC Copilot...

set PYTHON=C:\Users\satya\AppData\Local\Python\pythoncore-3.14-64\python.exe

echo.
echo [1/3] Building ChromaDB...
cd ai
%PYTHON% rag_setup.py
cd ..

echo.
echo [2/3] Starting Flask Backend...
cd web
start "Flask Backend" %PYTHON% app.py
cd ..

echo.
echo [3/3] Starting React Frontend...
cd web-react
start "React Frontend" cmd /k "npm start"
cd ..

echo.
echo ✅ Everything is running!
echo Flask: http://localhost:5000
echo React: http://localhost:3000
echo.
pause