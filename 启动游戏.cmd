@echo off
chcp 65001 >nul
cd /d "%~dp0logic-detective"
title Logic Detective

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found. Install the LTS version from https://nodejs.org
  echo       and run this file again.
  echo.
  pause
  exit /b 1
)

node serve.mjs
pause
