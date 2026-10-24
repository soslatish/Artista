@echo off
chcp 65001 >nul
rem Обновить проект и запустить сайт + веб-версию Artista (Docker Desktop должен быть запущен).
cd /d "%~dp0"
echo Обновляю проект...
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0start.ps1' -Web 2>&1 | Tee-Object -FilePath '%~dp0infra\start.log'"
echo.
pause
