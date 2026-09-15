@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extensions\SeedAnalysis\tools\run-local.ps1" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo [ERROR] WikiCrop SeedAnalysis runner failed with code %EXITCODE%.
)
pause
exit /b %EXITCODE%
