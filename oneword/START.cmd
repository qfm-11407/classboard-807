@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 請先安裝 Node.js 22 以上版本，再重新執行。
  echo https://nodejs.org/
  pause
  exit /b 1
)
node server.mjs --open
if errorlevel 1 pause
