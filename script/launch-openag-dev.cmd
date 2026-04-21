@echo off
setlocal EnableExtensions EnableDelayedExpansion
title OpenAGt CLI
for %%I in ("%~dp0..") do set "REPO=%%~fI"
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN%" goto run
set "BUN=%USERPROFILE%\scoop\apps\bun\current\bun.exe"
if exist "%BUN%" goto run
set "BUN=%LOCALAPPDATA%\Programs\bun\bun.exe"
if exist "%BUN%" goto run
set "BUN=%LOCALAPPDATA%\bun\bin\bun.exe"
if exist "%BUN%" goto run
set "BUN=%LOCALAPPDATA%\Microsoft\WinGet\Links\bun.exe"
if exist "%BUN%" goto run
set "BUN=C:\Program Files\bun\bun.exe"
if exist "%BUN%" goto run
echo Bun not found. Install Bun first, then rerun this shortcut.
echo Expected locations checked:
echo   %USERPROFILE%\.bun\bin\bun.exe
echo   %USERPROFILE%\scoop\apps\bun\current\bun.exe
echo   %LOCALAPPDATA%\Programs\bun\bun.exe
echo   %LOCALAPPDATA%\bun\bin\bun.exe
echo   %LOCALAPPDATA%\Microsoft\WinGet\Links\bun.exe
echo   C:\Program Files\bun\bun.exe
pause
exit /b 1
:run
cd /d "%REPO%"
if not exist "node_modules\@opentui\solid\package.json" (
echo [OpenAGt CLI] Missing local dependencies. Running bun install...
"%BUN%" install
if errorlevel 1 (
echo [OpenAGt CLI] bun install failed.
pause
exit /b 1
)
)
"%BUN%" run --cwd packages/openagt dev
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" (
echo.
echo [OpenAGt CLI] Process exited with code %EXIT_CODE%.
echo Tip: run "bun install" in %REPO% and retry.
pause
)
exit /b %EXIT_CODE%
