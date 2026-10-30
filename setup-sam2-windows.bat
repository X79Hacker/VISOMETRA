@echo off
setlocal
cd /d "%~dp0"
echo Installing optional SAM 2.1 video tracking in .venv-sam2
echo Internet and Git are needed once. Default installation uses CPU wheels.
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  py tools\setup_sam2.py %*
) else (
  py -3.12 tools\setup_sam2.py %*
)
if errorlevel 1 echo Setup failed. Read the error above and docs\SEQUENCE_STUDIO.md.
pause
