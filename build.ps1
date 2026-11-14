<#
.SYNOPSIS
    Checks the PBZModLoader mod: node --check of every .js in src, then tests\test_mod.js; -Deploy then runs deploy.ps1.

.DESCRIPTION
    A PBZModLoader mod needs no build: src\<folder> is the mod folder as it goes into the game. This script checks it
    with Node.js (https://nodejs.org/), which must be on the PATH. The GitHub release zip is made by the playbook's
    publish tool from src\<folder> (kind pbzmodloader in mod.json).

    Exit codes: 0 = all checks passed (and deployed with -Deploy), 1 = a check failed or an error.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy
#>
param(
    # After the checks, copy the mod into the game (deploy.ps1).
    [switch]$Deploy,
    # Passed on to deploy.ps1: copy the shipped settings file over the one in the game.
    [switch]$ResetConfig
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js (node) is not on the PATH."
}
$mod = Get-Content (Join-Path $PSScriptRoot "mod.json") -Raw | ConvertFrom-Json
$source = Join-Path $PSScriptRoot "src\$($mod.folder)"
foreach ($file in Get-ChildItem $source -Recurse -Filter *.js) {
    node --check $file.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Syntax error in $($file.FullName)" -ForegroundColor Red
        exit 1
    }
}
node (Join-Path $PSScriptRoot "tests\test_mod.js")
if ($LASTEXITCODE -ne 0) {
    Write-Host "tests\test_mod.js failed." -ForegroundColor Red
    exit 1
}
Write-Host "$($mod.name) $($mod.version): all checks passed." -ForegroundColor Green
if ($Deploy) {
    $arguments = @{}
    if ($ResetConfig) {
        $arguments.ResetConfig = $true
    }
    & (Join-Path $PSScriptRoot "deploy.ps1") @arguments
    exit $LASTEXITCODE
}
exit 0
