@echo off
rem Double-click to open the laptop control panel in the browser (http://127.0.0.1:8765):
rem   choose the camera and the ESP32 mode, set the ESP32's Wi-Fi, check everything, start/stop detection.
rem First run: creates v2\edge\.venv and installs the requirements (a few minutes, needs internet).
rem Settings are saved in v2\edge\.env. Without the panel: python main.py
setlocal
cd /d "%~dp0"

set "PY=%EDGE_PYTHON%"
if not defined PY set "PY=.venv\Scripts\python.exe"

if not defined EDGE_PYTHON if not exist ".venv\installed.ok" (
  echo [setup] First run: installing Python packages into v2\edge\.venv - this takes a few minutes...
  if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv 2>nul || python -m venv .venv
  if not exist ".venv\Scripts\python.exe" (
    echo [setup] Python 3 was not found. Install it from https://www.python.org and run this again.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [setup] Installing the packages failed - see above. Run this again to retry.
    pause
    exit /b 1
  )
  echo ok> ".venv\installed.ok"
)

if not exist ".env" copy ".env.example" ".env" >nul

"%PY%" panel.py %*
if errorlevel 1 pause
