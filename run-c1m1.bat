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
REM  Fresh every run: the stages are idempotent -- stage 1 OPENS an existing map
REM  if one is on disk and only builds a blank when none is, so a leftover map
REM  would be re-applied over instead of rebuilt. So the previous reconstruction
REM  is deleted first, and the chain truly starts from an empty New Map.
REM  (Assumes the default data root, data-unpacked; not a custom HOMM5_DATA.)
REM
REM  Prerequisite (run once, from your own copy of the mod):
REM      npm run extract-fixture C1M1
REM  Without it the C1M1 stages fail on purpose (a silent skip reads as a pass).
REM ===========================================================================

setlocal
cd /d "%~dp0"

echo Cleaning the previous reconstruction (fresh from-scratch build)...
if exist "data-unpacked\Maps\SingleMissions\e2e Reconstruct C1M1" rmdir /s /q "data-unpacked\Maps\SingleMissions\e2e Reconstruct C1M1"
if exist "_tmp\recon\C1M1" rmdir /s /q "_tmp\recon\C1M1"

set HOMM5_NO_REMOVE_MAP=1
call npx playwright test c1m1

echo.
echo ===========================================================================
echo  Done. If the run was green, the playable map is here:
echo    %~dp0..\Maps\e2e Reconstruct C1M1.h5m
echo ===========================================================================
pause
