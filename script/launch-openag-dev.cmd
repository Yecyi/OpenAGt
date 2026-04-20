@echo off
setlocal
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
"%BUN%" run dev
pause
