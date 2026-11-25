# Crowd Control - laptop installer for Windows 10/11.
# Paste into PowerShell (no admin needed):
#
#   irm https://crowd.etzalgroup.com/install.ps1 | iex
#
# 1. Installs Python 3.12 if this laptop has no Python 3.9+ (with winget, for this user only)
# 2. Downloads the laptop app (v2/edge from GitHub) into %LOCALAPPDATA%\CrowdControl\edge
# 3. Installs its packages (YOLO, OpenCV, ...: about 1 GB, a few minutes the first time)
# 4. Puts "Crowd Laptop" on the desktop and starts it; https://crowd.etzalgroup.com/laptop then connects
# Safe to run again: it updates the app and keeps your settings (.env).
#
# Options (environment variables): CROWD_APP_DIR, CROWD_REPO_ZIP, CROWD_NO_SHORTCUT=1, CROWD_NO_START=1

& {   # a script block: nothing below changes the PowerShell window it runs in
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"       # much faster downloads in Windows PowerShell 5

    $App = if ($env:CROWD_APP_DIR) { $env:CROWD_APP_DIR } else { Join-Path $env:LOCALAPPDATA "CrowdControl" }
    $RepoZip = if ($env:CROWD_REPO_ZIP) { $env:CROWD_REPO_ZIP } else { "https://github.com/Qyuzet/Software-Engineering/archive/refs/heads/master.zip" }
    $Edge = Join-Path $App "edge"

    function Say($text) { Write-Host "[crowd] $text" -ForegroundColor Cyan }
    function Fail($text) { Write-Host "[crowd] $text" -ForegroundColor Red; throw $text }

    function Get-Python {
        # A Python 3.9+ that is really installed (not the Microsoft Store shortcut)
        $tries = @(
            @{ exe = "py"; pre = @("-3") },
            @{ exe = "python"; pre = @() },
            @{ exe = (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"); pre = @() }
        )
        foreach ($t in $tries) {
            try {
                $out = & $t.exe @($t.pre) -c "import sys; print(sys.executable if sys.version_info >= (3, 9) else '')" 2>$null
                if ($LASTEXITCODE -eq 0 -and $out -and (Test-Path ($out | Select-Object -Last 1))) {
                    return ($out | Select-Object -Last 1).Trim()
                }
            } catch { }
        }
        return $null
    }

    # ---- 1. Python ----
    $py = Get-Python
    if (-not $py) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            Fail "Python is missing and winget is not available. Install Python 3.12 from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run this again."
        }
        Say "Installing Python 3.12 (winget, this user only)..."
        winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
        $py = Get-Python
        if (-not $py) { Fail "The Python install did not finish. Install it from https://www.python.org/downloads/ and run this again." }
    }
    Say "Python: $py"

    # ---- 2. The app ----
    Say "Downloading the laptop app..."
    $tmp = Join-Path $env:TEMP ("crowd-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        Invoke-WebRequest -Uri $RepoZip -OutFile (Join-Path $tmp "app.zip") -UseBasicParsing
        Expand-Archive -Path (Join-Path $tmp "app.zip") -DestinationPath $tmp -Force
        $src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "v2\edge\main.py") } | Select-Object -First 1
        if (-not $src) { Fail "The download does not contain v2/edge." }
        New-Item -ItemType Directory -Force $Edge | Out-Null
        # Copy the code; keep this laptop's settings, log queue, model and Python packages
        robocopy (Join-Path $src.FullName "v2\edge") $Edge /E /XF .env yolov8n.pt /XD .venv data __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Fail "Copying the app failed (robocopy $LASTEXITCODE)." }
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path (Join-Path $Edge ".env"))) { Copy-Item (Join-Path $Edge ".env.example") (Join-Path $Edge ".env") }
    Say "App folder: $Edge"

    # ---- 3. Packages ----
    $venvPy = Join-Path $Edge ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPy)) {
        Say "Creating the Python environment..."
        & $py -m venv (Join-Path $Edge ".venv")
        if ($LASTEXITCODE -ne 0) { Fail "Could not create the Python environment." }
    }
    Say "Installing the packages (about 1 GB the first time - keep this window open)..."
    & $venvPy -m pip install --disable-pip-version-check --upgrade pip --quiet
    & $venvPy -m pip install --disable-pip-version-check -r (Join-Path $Edge "requirements.txt")
    if ($LASTEXITCODE -ne 0) { Fail "Installing the packages failed (see above). Check the internet connection and run this again." }
    Set-Content -Path (Join-Path $Edge ".venv\installed.ok") -Value "ok"

    # ---- 4. Shortcut + start ----
    if (-not $env:CROWD_NO_SHORTCUT) {
        $lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Crowd Laptop.lnk"
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
        $shortcut.TargetPath = Join-Path $Edge "run.bat"
        $shortcut.WorkingDirectory = $Edge
        $shortcut.Description = "Crowd Control laptop panel"
        $shortcut.Save()
        Say "Desktop shortcut: Crowd Laptop"
    }
    Say "Done. Next time just double-click 'Crowd Laptop' on the desktop."
    Say "Still needed once: paste the edge token in the panel (ask the admin)."
    if (-not $env:CROWD_NO_START) {
        Start-Process -FilePath (Join-Path $Edge "run.bat") -WorkingDirectory $Edge
    }
}
