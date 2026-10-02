@echo off
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
title STT gRPC Server (Port 50051)
cd /d "%~dp0"
echo =======================================================
echo  Starting Cohere Arabic STT gRPC Server on port 50051...
echo =======================================================
".venv-test\Scripts\python.exe" app\stt_grpc_server.py
pause
