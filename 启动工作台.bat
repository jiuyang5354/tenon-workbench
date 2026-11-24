@echo off
chcp 65001 >nul
title CONDUIT - Gemini x Codex Workbench
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
