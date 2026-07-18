@echo off
rem Launch the editor by double-clicking, no terminal needed.
rem
rem The window stays open on failure. That is the whole point of a batch file
rem here: a crash should be readable, not a window that blinks and vanishes.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node 24 or newer from https://nodejs.org and run this again.
  goto :fail
)

rem This project runs TypeScript straight off disk, which needs Node's native
rem type stripping. Checking up front beats a confusing syntax error later.
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 24 (
  echo Node %NODEMAJOR% is too old -- this project needs Node 24 or newer.
  goto :fail
)

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
  if errorlevel 1 goto :fail
)

rem Where the unpacked game data lives. Set HOMM5_DATA yourself to point
rem elsewhere; this only fills in a default when it is unset.
if "%HOMM5_DATA%"=="" (
  if exist "samples\paks\data\MapObjects" set "HOMM5_DATA=%~dp0samples\paks\data"
)

rem The game folder itself. This repo sits inside it, so the parent directory is
rem it -- which is how the editor finds Editor\MapFilters.xml and Editor\IconCache
rem for the object palette's groups and thumbnails. Those are loose beside the
rem install, not inside the paks, so they are NOT under HOMM5_DATA.
if "%HOMM5_ROOT%"=="" (
  for %%d in ("%~dp0..") do set "HOMM5_ROOT=%%~fd"
)

rem npm is a .cmd shim, so without `call` this batch would end right here.
call npm start
if errorlevel 1 goto :fail

exit /b 0

:fail
echo.
echo --- the editor exited with an error, so this window stays open ---
pause
exit /b 1
