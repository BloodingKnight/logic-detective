@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Logic Detective

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found.
  echo.
  echo   This game needs Node.js to start a small local web server.
  echo   Download the LTS version from https://nodejs.org and run this file again.
  echo.
  echo   Or just double-click index.html -- the game still works,
  echo   but your progress may not be saved.
  echo.
  pause
  exit /b 1
)

node serve.mjs
pause
