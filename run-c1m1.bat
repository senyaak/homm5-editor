@echo off
REM ===========================================================================
REM  Rebuild C1M1 FROM NOTHING, through the editor UI, and pack a playable .h5m.
REM
REM  Runs all 14 reconstruction stages in order (e2e\c1m1\001-heights ...
REM  014-pack). The whole chain is long (~30 min on a cold run) -- heights,
REM  textures and objects are the slow ones. The last stage verifies the whole
REM  map against the original and packs it; because HOMM5_NO_REMOVE_MAP is set
REM  below, it LEAVES the .h5m in the game's Maps\ folder so you can open it in
REM  the game straight after.
REM
REM  Fresh only: the stages are idempotent -- stage 1 OPENS an existing map if
REM  one is on disk and only builds a blank when none is, so a leftover map is
REM  re-applied over instead of rebuilt. If a reconstruction already exists this
REM  script WARNS and asks to delete it; decline and it exits without running,
REM  so the chain never runs over an old map by accident.
REM  (Assumes the default data root, data-unpacked; not a custom HOMM5_DATA.)
REM
REM  Prerequisite (run once, from your own copy of the mod):
REM      npm run extract-fixture C1M1
REM  Without it the C1M1 stages fail on purpose (a silent skip reads as a pass).
REM ===========================================================================

setlocal
cd /d "%~dp0"

set "MAPDIR=data-unpacked\Maps\SingleMissions\e2e Reconstruct C1M1"
set "RECONDIR=_tmp\recon\C1M1"

if exist "%MAPDIR%" (
  echo.
  echo  WARNING: a reconstruction map already exists:
  echo    %MAPDIR%
  echo.
  echo  It must be removed to rebuild from scratch. Kept, the stages re-apply
  echo  over the OLD map instead of building it anew -- not a from-scratch run.
  echo.
  choice /c YN /m "Delete it and rebuild from nothing?  N cancels"
  if errorlevel 2 (
    echo.
    echo  Cancelled -- nothing was deleted or run.
    pause
    exit /b 1
  )
  rmdir /s /q "%MAPDIR%"
)

if exist "%RECONDIR%" rmdir /s /q "%RECONDIR%"

set HOMM5_NO_REMOVE_MAP=1
call npx playwright test c1m1

echo.
echo ===========================================================================
echo  Done. If the run was green, the playable map is here:
echo    %~dp0..\Maps\e2e Reconstruct C1M1.h5m
echo ===========================================================================
pause
