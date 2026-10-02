@echo off
chcp 65001 >nul
title Arabic Voice Pipeline Launcher
cd /d "%~dp0"

echo =======================================================
echo    ARABIC VOICE PIPELINE LAUNCHER
echo =======================================================
echo  [1/3] STT gRPC Service      (Port :50051)
echo  [2/3] TTS gRPC Service      (Port :50052)
echo  [3/3] NestJS Voice Gateway  (Port :3000)
echo =======================================================
echo.

echo Launching STT gRPC Service...
start "STT gRPC Service (50051)" cmd /k "start_stt_grpc.bat"
ping 127.0.0.1 -n 3 >nul

echo Launching TTS gRPC Service...
start "TTS gRPC Service (50052)" cmd /k "start_tts_grpc.bat"
ping 127.0.0.1 -n 3 >nul

echo Launching NestJS Gateway...
start "NestJS Gateway (3000)" cmd /k "start_backend.bat"
ping 127.0.0.1 -n 3 >nul

echo.
echo =======================================================
echo  All services have been launched successfully!
echo  Web UI URL: http://localhost:3000/
echo =======================================================
echo.

REM Automatically open default browser to testing frontend
start http://localhost:3000/

pause
