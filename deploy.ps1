<#
.SYNOPSIS
    Copies the PBZModLoader mod (src\<folder>) into the game's ProjectPBZ\PBZModLoader\mods\<folder>.

.DESCRIPTION
    Reads mod.json. The target is <game folder>\<modsPath>\<folder>; the game folder is gameDir of
    _tools\gamedata\<game>\game.json, else $env:UE5_GAMES_DIR\<gameFolder>, unless -GameDir or -ModsDir is given.
    PBZModLoader must be installed in the game (its start file ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js).

    The script mirrors src\<folder> into the target: files that are no longer in src are removed there, and nothing
    else in the mods folder is touched. PBZModLoader loads its mods at game start (Alt+F5 reloads them while the game
    runs).

    An existing settings file (<folder>.txt) in the game stays: it holds the settings of the one who tests, and the
    mod takes the default for every setting it lacks. -ResetConfig copies the shipped one over it.

    Exit codes: 0 = deployed or already up to date, 1 = error.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#>
param(
    # The game's install folder. Default: gameDir of _tools\gamedata\<game>\game.json, else $env:UE5_GAMES_DIR\<gameFolder of mod.json>.
    [string]$GameDir,
    # PBZModLoader's mods folder. Default: <GameDir>\<modsPath of mod.json>.
    [string]$ModsDir,
    # Copy the shipped settings file over the one in the game.
    [switch]$ResetConfig
)

$ErrorActionPreference = "Stop"

# The game folder: "gameDir" of _tools\gamedata\<game>\game.json, for a game outside UE5_GAMES_DIR (for example in a
# Steam library), else $env:UE5_GAMES_DIR\<gameFolder of mod.json>; $null when neither is known. The tools folder is
# $env:UE5_TOOLS, else the first _tools folder above the project (a plain clone has none).
function Get-GameDir {
    $toolsDir = $env:UE5_TOOLS
    if (-not $toolsDir -and $PSScriptRoot) {
        $dir = Split-Path $PSScriptRoot -Parent
        while (-not $toolsDir -and $dir) {
            if (Test-Path (Join-Path $dir "_tools")) {
                $toolsDir = Join-Path $dir "_tools"
            }
            $dir = Split-Path $dir -Parent
        }
    }
    if ($toolsDir) {
        $gameJson = Join-Path $toolsDir "gamedata\$($mod.game)\game.json"
        if (Test-Path $gameJson) {
            $gameInfo = Get-Content $gameJson -Raw | ConvertFrom-Json
            if ($gameInfo.gameDir) {
                return $gameInfo.gameDir
            }
        }
    }
    if ($env:UE5_GAMES_DIR) {
        return Join-Path $env:UE5_GAMES_DIR $mod.gameFolder
    }
    return $null
}

$mod = Get-Content (Join-Path $PSScriptRoot "mod.json") -Raw | ConvertFrom-Json
$source = Join-Path $PSScriptRoot "src\$($mod.folder)"
if (-not (Test-Path (Join-Path $source "main.js"))) {
    throw "$source\main.js not found."
}
if (-not $ModsDir) {
    if (-not $GameDir) {
        $GameDir = Get-GameDir
    }
    if (-not $GameDir) {
        throw "The game folder is unknown: set UE5_GAMES_DIR (the folder that holds '$($mod.gameFolder)'), give the game a gameDir in _tools\gamedata\$($mod.game)\game.json, or use -GameDir or -ModsDir."
    }
    $startFile = Join-Path $GameDir "ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js"
    if (-not (Test-Path $startFile)) {
        throw "PBZModLoader is not installed in the game ($startFile is missing). Install PBZModLoader first."
    }
    $ModsDir = Join-Path $GameDir $mod.modsPath
}
$target = Join-Path $ModsDir $mod.folder

# robocopy neither copies nor removes an excluded file, so /XF keeps the game's settings file.
$settings = "$($mod.folder).txt"
$keepSettings = (-not $ResetConfig) -and (Test-Path (Join-Path $target $settings))
$options = @("/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
if ($keepSettings) {
    $options += @("/XF", $settings)
}
robocopy $source $target @options | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) {
    throw "robocopy failed with exit code $code"
}
if ($code -eq 0) {
    Write-Host "Already up to date: $target" -ForegroundColor Green
} else {
    Write-Host "Deployed $($mod.name) $($mod.version) to $target (active from the next game start, or Alt+F5)" -ForegroundColor Green
}
if ($keepSettings) {
    Write-Host "Kept the game's $settings; -ResetConfig copies the shipped one."
}
exit 0
