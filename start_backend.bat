@echo off
chcp 65001 >nul
title NestJS Voice Gateway (Port 3000)
cd /d "%~dp0nest-backend"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
echo =======================================================
echo  Starting NestJS Voice Pipeline Gateway on port 3000...
echo =======================================================
node dist/main.js
pause
