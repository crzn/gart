# Gart installer launcher for Windows 10/11 (PowerShell).
# Checks Node.js, then starts the local web wizard (installer\install.mjs).
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js was not found."
    Write-Host "Install Node.js 22.12 or newer from https://nodejs.org and run this script again."
    exit 1
}

$version = [version]((node -v).TrimStart("v"))
if ($version -lt [version]"22.12.0") {
    Write-Host "Node.js $version is too old. Version 22.12 or newer is required (https://nodejs.org)."
    exit 1
}

node installer\install.mjs @args
exit $LASTEXITCODE
