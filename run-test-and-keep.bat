@echo off
REM ===========================================================================
REM  Build the mod through the editor UI, into the REAL install, and leave it.
REM
REM  Runs the mod stages in order, each driving the window the way a person
REM  would:
REM      mod-001  the Sharpshooter, authored in the Units dialog
REM      mod-002  its textures repainted by palette
REM      mod-003  three artifacts and the set made of them
REM      mod-004  a hero of our own
REM      mod-005  one building of every one of the sixteen classes
REM      mod-006  the Sharpshooter's palace -- a dwelling, its town art baked
REM      mod-007  a playable map with the creature and the artifacts on it
REM      mod-008  every building the mod carries, stood on a map of its own
REM      mod-009  reads back what actually landed on disk
REM
REM  An ORDINARY run gives these specs a throwaway install under _tmp and
REM  deletes it at the end -- which is what makes the suite say something about
REM  the code rather than about this machine, and also means it leaves you
REM  nothing to play. This script is the other mode (HOMM5_NO_REMOVE, set by
REM  tools\e2e-live.ts): the work happens in the install this checkout sits in,
REM  and nothing is swept up.
REM
REM  What you get in <game>\H5E\ when it is green:
REM      homm5-editor.h5u        the creature, the artifacts, the set, the hero,
REM                              the buildings and all of their art
REM      Sharpshooter Test.h5m   a map to load and look at them
REM      e2e Buildings Map.h5m   the buildings, one of every class, in a row
REM  ...and the two ceilings in bin\H5_Game_H5E.exe raised to match the archive,
REM  because a mod id above the compiled limit is read and silently ignored.
REM
REM  It is not a wrecking ball: a live run first takes OUR things back out of the
REM  installed mod so the specs author them from nothing, and leaves everything
REM  else in the archive alone -- there are dwellings in there no dialog can
REM  author again. See LIVE in e2e\mods.ts.
REM ===========================================================================

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node 24 or newer from https://nodejs.org and run this again.
  goto :fail
)

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
  if errorlevel 1 goto :fail
)

REM The mod is installed INTO the patched executable's install: the archive and
REM the ceilings in that copy have to agree exactly. Without it there is nothing
REM to install into, and the first run is what makes it.
if not exist "..\bin\H5_Game_H5E.exe" (
  echo.
  echo  This install has not been prepared yet -- no ..\bin\H5_Game_H5E.exe.
  echo  Start the editor once and let its setup screen do the four steps:
  echo.
  echo      start-editor.bat        ^(or: npm start^)
  echo.
  goto :fail
)

REM Forward slashes, even here: Playwright matches these as REGULAR EXPRESSIONS
REM against the file paths, and a backslash in one is an escape rather than a
REM separator -- which finds nothing at all and says only "No tests found".
call node tools\e2e-live.ts ^
  e2e/mod-001-units-create.spec.ts ^
  e2e/mod-002-units-recolor.spec.ts ^
  e2e/mod-003-artifacts-create.spec.ts ^
  e2e/mod-004-heroes-create.spec.ts ^
  e2e/mod-005-buildings-create.spec.ts ^
  e2e/mod-006-dwelling-create.spec.ts ^
  e2e/mod-007-sharpshooter-map.spec.ts ^
  e2e/mod-008-buildings-map.spec.ts ^
  e2e/mod-009-installed.spec.ts
if errorlevel 1 goto :fail

echo.
echo ===========================================================================
echo  Done. What the run left in the game:
echo    %~dp0..\H5E\homm5-editor.h5u
echo    %~dp0..\H5E\Sharpshooter Test.h5m
echo.
echo  Launch bin\H5_Game_H5E.exe to see them. The shipped bin\H5_Game.exe reads
echo  none of it, which is the way to turn all of it off.
echo ===========================================================================
pause
exit /b 0

:fail
echo.
echo  The run did not finish. Nothing was cleaned up, so what it did get to is
echo  still in ..\H5E\ -- read the failure above before running it again.
pause
exit /b 1
