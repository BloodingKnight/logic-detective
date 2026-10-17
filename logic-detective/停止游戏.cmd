@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Stop Logic Detective
node stop.mjs
pause
