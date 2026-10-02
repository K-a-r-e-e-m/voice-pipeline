@echo off
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
title TTS gRPC Server (Port 50052)
cd /d "%~dp0"
echo =======================================================
echo  Starting OmniVoice Egyptian TTS gRPC Server on port 50052...
echo =======================================================
".venv-test\Scripts\python.exe" tts\tts_grpc_server.py
pause
