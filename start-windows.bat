@echo off
rem Starts the Sector Map app and opens it in your browser.
cd /d "%~dp0"
echo Sector Map SEQUENCE STUDIO V6 - diamond anchors and Bezier editing
echo Running from: %~dp0
echo Close the old Sector Map server first if port 8763 is already in use.
if exist ".venv-sam3\Scripts\python.exe" (
  .venv-sam3\Scripts\python.exe server.py %*
  goto :end
)
where py >nul 2>nul && ( py -3 server.py %* & goto :end )
where python >nul 2>nul && ( python server.py %* & goto :end )
echo Python 3 is not installed.
echo Get it from https://www.python.org/downloads/  (tick "Add python.exe to PATH" during setup)
:end
pause
