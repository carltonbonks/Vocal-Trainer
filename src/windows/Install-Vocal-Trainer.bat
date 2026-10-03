@echo off
rem Double-click to install or update Vocal Trainer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. See the message above.
)
echo.
pause
