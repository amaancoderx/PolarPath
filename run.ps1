<#
    PolarPath launcher.

    .\run.ps1            build the interface, then serve everything on :8000
    .\run.ps1 -Dev       run the API on :8000 and the Vite dev server on :5173
#>
param([switch]$Dev)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "  PolarPath" -ForegroundColor Cyan
Write-Host "  Antarctic sea-ice, iceberg trajectory and navigation decision support"
Write-Host ""

if (-not (Test-Path "$root\backend\data\artefacts\sea_ice_forecaster.joblib")) {
    Write-Host "  Building model artefacts. First run only, a few minutes." -ForegroundColor Yellow
    python backend\scripts\train.py
    Write-Host ""
}

if ($Dev) {
    if (-not (Test-Path "$root\frontend\node_modules")) {
        Push-Location "$root\frontend"; npm install; Pop-Location
    }
    Write-Host "  API       http://127.0.0.1:8000"
    Write-Host "  Interface http://127.0.0.1:5173" -ForegroundColor Green
    Write-Host ""
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; python -m uvicorn polarpath.main:app --app-dir backend --port 8000 --reload"
    Set-Location "$root\frontend"
    npm run dev
} else {
    if (-not (Test-Path "$root\frontend\dist\index.html")) {
        if (-not (Test-Path "$root\frontend\node_modules")) {
            Push-Location "$root\frontend"; npm install; Pop-Location
        }
        Write-Host "  Building the interface."
        Push-Location "$root\frontend"; npm run build; Pop-Location
        Write-Host ""
    }
    Write-Host "  Open http://127.0.0.1:8000" -ForegroundColor Green
    Write-Host ""
    python -m uvicorn polarpath.main:app --app-dir backend --port 8000 --host 127.0.0.1
}
