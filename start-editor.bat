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

rem The game folder is NOT guessed here, on purpose.
rem
rem It used to be: this repo normally sits inside the install, so the directory
rem above it is the game -- which is how the editor finds Editor\MapFilters.xml
rem and Editor\IconCache for the object palette. But putting that in HOMM5_ROOT
rem made a GUESS look like an explicit answer, and electron/paths.ts ranks the
rem environment above `.env`, above what the setup window wrote into
rem settings.json, above everything. So the guess beat the answer established
rem when somebody pointed the editor at their install and prepared it -- and
rem those two are one act: the folder that holds the game is the folder the
rem patched executable is made in.
rem
rem paths.ts already makes exactly this guess -- `join(APP_ROOT, '..')` when
rem unpackaged -- as its LAST resort, after the settings. Leaving it only there
rem is the whole fix: the same answer when nothing else is known, and out of the
rem way when something is.
rem
rem What made it visible: a git worktree lives outside the install, so the
rem directory above it holds no game at all. The editor still opened -- it gates
rem on the DATA root, which was configured -- and only a panel that needs the
rem executable noticed.

rem npm is a .cmd shim, so without `call` this batch would end right here.
call npm start
if errorlevel 1 goto :fail

exit /b 0

:fail
echo.
echo --- the editor exited with an error, so this window stays open ---
pause
exit /b 1
