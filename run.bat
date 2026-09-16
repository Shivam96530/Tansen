@echo off
echo Starting Tansen Application in a single terminal window...
set PYTHONIOENCODING=utf-8

start http://localhost:5173

npx -y concurrently -k -n "PYTHON,EXPRESS,VITE" -c "yellow,blue,magenta" "python python/audio_service.py" "npm --prefix server run dev" "npm run dev"
