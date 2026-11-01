<#
.SYNOPSIS
    Builds the mod (the src folder) into dist\<pakName>.pak/.utoc/.ucas, the files for the game's Paks\~mods folder.

.DESCRIPTION
    The mod changes loose files of the game's classic .pak (for example the game's Puerts JavaScript or its .locres
    text files), not .uasset assets. Reads mod.json. Uses repak and retoc from the shared _tools folder of the modding
    base folder ($env:UE5_TOOLS overrides it), and Node.js when it is installed:
      1. checks the syntax of every src\**\*.js (node --check) and runs the offline test tests\test_mod.js when the
         project has one; without Node.js both are skipped with a warning;
      2. packs src into dist\<pakName>.pak with repak (pak version V11, mount point ../../../): the files keep their
         game path below src, for example src\<Project>\Content\JavaScript\UI\Widget\<script>.js;
      3. writes an empty IoStore container dist\<pakName>.utoc/.ucas with retoc to-zen (retoc packs no loose files).
         A UE5 IoStore game ignored a .pak without a .utoc/.ucas of the same name (a text mod in Mortal Shell II);
      4. checks the result: the pak holds exactly the files of src, each with the bytes of its source;
      5. copies the loose files (the folder loose, flat; for example the mod's settings file <folder>.txt) into dist,
         next to the pak: they go into the game's Paks\~mods folder beside it, not into the pak.
    With -Deploy, deploy.ps1 then copies them into the game's Paks\~mods folder. After a good build, dist\ holds only
    the three pak files and the loose files.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy
#>
param(
    # Copy the files to the game's Paks\~mods folder after the build (see deploy.ps1).
    [switch]$Deploy,
    # The game's install folder, passed on to deploy.ps1. Default: see deploy.ps1.
    [string]$GameDir
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$mod = Get-Content (Join-Path $root "mod.json") -Raw | ConvertFrom-Json
$src = Join-Path $root "src"
$loose = Join-Path $root "loose"
$dist = Join-Path $root "dist"
$zen = Join-Path $dist "zen"
$verify = Join-Path $dist "verify"

# The shared tools: $env:UE5_TOOLS, else the first _tools folder above the project.
function Find-Tools {
    if ($env:UE5_TOOLS) {
        return $env:UE5_TOOLS
    }
    $dir = Split-Path $root -Parent
    while ($dir) {
        $candidate = Join-Path $dir "_tools"
        if (Test-Path $candidate) {
            return $candidate
        }
        $dir = Split-Path $dir -Parent
    }
    throw "No _tools folder above $root. Put repak and retoc into _tools\repak and _tools\retoc above the project, or set UE5_TOOLS."
}

$tools = Find-Tools
$repak = Join-Path $tools "repak\repak.exe"
$retoc = Join-Path $tools "retoc\retoc.exe"
foreach ($tool in @($repak, $retoc)) {
    if (-not (Test-Path $tool)) {
        throw "$tool not found. repak: https://github.com/trumank/repak/releases, retoc: https://github.com/trumank/retoc/releases"
    }
}

$sources = @(Get-ChildItem $src -Recurse -File)
if ($sources.Count -eq 0) {
    throw "No files in $src."
}

# 1. JavaScript: syntax and the offline test.
$scripts = @($sources | Where-Object { $_.Extension -eq ".js" })
$test = Join-Path $root "tests\test_mod.js"
if ($scripts.Count -gt 0 -or (Test-Path $test)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        foreach ($js in $scripts) {
            & $node.Source --check $js.FullName
            if ($LASTEXITCODE -ne 0) {
                throw "JavaScript syntax error in $($js.FullName.Substring($src.Length + 1)). Nothing was built."
            }
        }
        if (Test-Path $test) {
            & $node.Source $test
            if ($LASTEXITCODE -ne 0) {
                throw "tests\test_mod.js failed (see above). Nothing was built."
            }
        }
    } else {
        Write-Host "JavaScript check and test skipped: Node.js not found." -ForegroundColor Yellow
    }
}

New-Item -ItemType Directory -Force $dist | Out-Null
foreach ($folder in @($zen, $verify)) {
    if (Test-Path -LiteralPath $folder) {
        Remove-Item -LiteralPath $folder -Recurse -Force
    }
}
foreach ($extension in @("pak", "utoc", "ucas")) {
    $old = Join-Path $dist "$($mod.pakName).$extension"
    if (Test-Path $old) {
        Remove-Item $old
    }
}

# 2. The pak with the changed files.
$pak = Join-Path $dist "$($mod.pakName).pak"
& $repak pack --version V11 --quiet $src $pak
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pak)) {
    throw "repak pack failed with exit code $LASTEXITCODE"
}

# 3. The empty IoStore container of the same name (retoc also writes a .pak without files; it is not used).
$zenStage = Join-Path $zen "stage"
New-Item -ItemType Directory -Force $zenStage | Out-Null
& $retoc to-zen --version $mod.engine $zenStage (Join-Path $zen "$($mod.pakName).utoc")
if ($LASTEXITCODE -ne 0) {
    throw "retoc to-zen failed with exit code $LASTEXITCODE"
}
foreach ($extension in @("utoc", "ucas")) {
    $file = Join-Path $zen "$($mod.pakName).$extension"
    if (-not (Test-Path $file)) {
        throw "retoc did not write $($mod.pakName).$extension"
    }
    Move-Item $file $dist
}

# 4. The check: unpack the pak and compare every file with its source, byte for byte.
& $repak unpack --quiet --output $verify $pak
if ($LASTEXITCODE -ne 0) {
    throw "repak unpack (check) failed with exit code $LASTEXITCODE"
}
$packed = @(Get-ChildItem $verify -Recurse -File | ForEach-Object { $_.FullName.Substring($verify.Length + 1) } | Sort-Object)
$expected = @($sources | ForEach-Object { $_.FullName.Substring($src.Length + 1) } | Sort-Object)
if (Compare-Object $packed $expected) {
    throw "The pak holds other files than src: packed $($packed -join ', '); expected $($expected -join ', ')"
}
foreach ($relative in $expected) {
    $a = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $src $relative)).Hash
    $b = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $verify $relative)).Hash
    if ($a -ne $b) {
        throw "Packed $relative differs from its source. Nothing was deployed."
    }
    Write-Host "Checked: $relative"
}

foreach ($folder in @($zen, $verify)) {
    Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. The loose files (flat: Paks\~mods has no subfolders for them), next to the pak in dist.
$looseFiles = @()
if (Test-Path $loose) {
    if (Get-ChildItem $loose -Directory) {
        throw "loose\ must be flat: its files go straight into Paks\~mods. Nothing more was built."
    }
    $looseFiles = @(Get-ChildItem $loose -File)
}
foreach ($file in $looseFiles) {
    if ($file.Name -like "$($mod.pakName).*") {
        throw "loose\$($file.Name) has the name of a pak file. Nothing more was built."
    }
    Copy-Item -LiteralPath $file.FullName (Join-Path $dist $file.Name) -Force
}

Write-Host "Built:"
$built = @(Get-ChildItem (Join-Path $dist "$($mod.pakName).*")) + @($looseFiles | ForEach-Object { Get-Item (Join-Path $dist $_.Name) })
$built | ForEach-Object { Write-Host "  $($_.Name) ($($_.Length) bytes)" }

if ($Deploy) {
    $deployArgs = @{}
    if ($GameDir) {
        $deployArgs.GameDir = $GameDir
    }
    & (Join-Path $root "deploy.ps1") @deployArgs
    exit $LASTEXITCODE
}
