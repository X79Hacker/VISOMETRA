@echo off
setlocal
cd /d "%~dp0"
echo SAM 3 optional setup. The included Fast offline model works without this setup.
echo First request model access: https://huggingface.co/facebook/sam3
if exist ".venv-sam3\Scripts\python.exe" goto install
py -3.12 --version >nul 2>nul
if not errorlevel 1 (
  py -3.12 -m venv .venv-sam3
) else (
  py -3 -m venv .venv-sam3
)
if errorlevel 1 goto failed
:install
.venv-sam3\Scripts\python.exe -c "import sys; assert sys.version_info >= (3,12), 'Install Python 3.12 or newer'"
if errorlevel 1 goto failed
.venv-sam3\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto failed
.venv-sam3\Scripts\python.exe -m pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto failed
.venv-sam3\Scripts\python.exe -m pip install -r requirements-sam3.txt
if errorlevel 1 goto failed
echo Log into your own Hugging Face account locally. Never paste tokens into the website.
.venv-sam3\Scripts\hf.exe auth login
if errorlevel 1 goto failed
.venv-sam3\Scripts\python.exe sam3_setup.py
if errorlevel 1 goto failed
echo Done. Close this window and run start-windows.bat.
pause
exit /b 0
:failed
echo Setup did not finish. Read docs\SAM3_SETUP.md and retry.
pause
exit /b 1
