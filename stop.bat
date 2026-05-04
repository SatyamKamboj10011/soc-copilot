@echo off
echo Stopping SOC Copilot...
taskkill /f /im node.exe
taskkill /f /im python.exe
echo ✅ All stopped!
pause