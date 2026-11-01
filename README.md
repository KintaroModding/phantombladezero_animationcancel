# Animation Cancel

Dodge or guard cancels your own attacks at once and breaks you out of a stagger, with the game's own moves. Settings in phantombladezero_animationcancel.txt next to the pak, live in game.

A mod for Phantom Blade Zero (Unreal Engine 5.7), made with game version `CL-301524_JKS-17219`. This README is
for developers. What the mod does, how to install it and its compatibility are in [openmods.md](openmods.md), the mod
page on [openmods](https://openmods.nexus).

## How it works

The game runs much of its logic in JavaScript (Puerts). The mod replaces one small game script,
`ProjectPBZ/Content/JavaScript/UI/Widget/Foundation/WeaponAdvancdNumricEntry.js` (the HUD mixin of
`W_WeaponAdvancdNumricValueText`; `MainStart.js` requires it once at game start). The game's code of that file stays
byte for byte; the mod's code sits between `// Animation Cancel: begin.` and `// Animation Cancel: end`, before the
file's last line. It runs once on the `require`, inside its own function, and checks the player's keys every 16 ms.

- **Cancel:** a dodge or guard press during the Start, Act or Combo phase of `Ability.Action.Hun.Light`, `.Heavy` or
  `.Weapon.Switch` (dodge also during `Ability.Action.Stance`) starts the move with the game's own
  `AbilityInputComponent.ForceActivateExternalActionAbilityByTag`. The guard first moves the attack into its Cancel
  phase (`ActorStateComponent.TryActivateNewState`), only while the key is held.
- **Stagger escape:** in a standing stagger (and a stance break with `EscapeBreak`), after `EscapeDelayMs` and at most
  once per `EscapeCooldownS`, the dodge first sets the hit phase `CharacterState.Hitreact.Phase.DashEscape`
  (`HitreactComponent.ChangeHitPhase`), so it comes out as the game's escape roll; the guard uses the hit Cancel phase.
  A failed escape puts the hit phase back.
- **Never:** the states in `NEVER` (death, executions, sequences, dialogue, heals, special moves).

Settings: `loose/phantombladezero_animationcancel.txt` goes next to the pak in `Paks\~mods`; the mod reads it every
2 s (`EasyCsv.LoadStringFromLocalFile`) and uses its defaults (`DEFAULTS`) without it. `DEBUG = true` in the script
writes each decision to the game's log (`LogPuerts`); two lines are always written: when the mod cannot start and
when it stops after 20 failed polls in a row (a game update).

The block is laid out for editing: settings, timing, log, game tags, the moves table (one entry per move, its fields
explained above it), the optional Mods Menu entry, then the runtime (settings file, keys, the two kinds of moves,
the poll). `tests/test_mod.js` runs it in Node.js against a small stand-in game.

The mod replaces whole files. A mod that changes the same files conflicts with this one, and a game update that
changes them needs a new build of the mod from the new files.

## Build

Requirements:

- Windows PowerShell 5.1 (part of Windows).
- [repak](https://github.com/trumank/repak/releases) v0.2.3 and [retoc](https://github.com/trumank/retoc/releases)
  v0.1.5. `build.ps1` looks for `_tools\repak\repak.exe` and `_tools\retoc\retoc.exe` in the parent folders of the
  project; set `UE5_TOOLS` to a folder that holds both to use another place.
- Optional, for mods with JavaScript: [Node.js](https://nodejs.org/) for the syntax check and the offline test
  (`tests\test_mod.js`).

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1             # dist\phantombladezero_animationcancel_P.pak/.utoc/.ucas
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy     # build, then copy the files to Paks\~mods
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Wait      # copy the files when the game is closed
```

The build checks every `.js` in `src` with `node --check` and runs `tests\test_mod.js` when there is one. Then it
packs `src` into a `.pak` (repak, pak version V11, mount point `../../../`), writes an empty IoStore container of the
same name (retoc `to-zen`; an IoStore game can ignore a `.pak` without one), and checks that the pak holds exactly
the files of `src`, byte for byte.

Loose files (the folder `loose`, flat; for example the mod's settings file) are not packed: the build copies them
into `dist` next to the pak, and they go into `~mods` beside it. A mod without settings has no `loose` folder.

`deploy.ps1` copies the three files and the loose files to `<game folder>\ProjectPBZ\Content\Paks\~mods`. A loose
file that is already there is the player's settings and stays; `-ResetConfig` copies the shipped one. The game folder
comes from `gameDir` in
`_tools\gamedata\phantombladezero\game.json`, else `$env:UE5_GAMES_DIR\PBZ`; `-GameDir` or `-ModsDir` override
it. The running game locks the files, so the script stops (exit code 2) or, with `-Wait`, waits until the game is
closed.

Versioning: every change raises the second number in `mod.json` (1.0 -> 1.1): `python scripts\bump_version.py`.

## Project layout

```
src/                               Mod source: the changed game files at their path in the game's .pak
loose/                             Files next to the pak in Paks\~mods, such as the settings file (only when needed)
tests/test_mod.js                  Offline test of the scripts (Node.js; only for mods with JavaScript)
dist/                              Build output: the .pak/.utoc/.ucas and the loose files for Paks\~mods (git-ignored)
docs/                              Cover and screenshots for openmods.md
scripts/bump_version.py            Raises the version in mod.json
build.ps1                          Checks and builds dist\ from src\
deploy.ps1                         Copies the build to the game's Paks\~mods folder
mod.json                           Name, version, game, engine and file names
```

The first commit with a game file holds the original file, so `git diff` against it shows exactly what the mod
changes.

## License

MIT, see [LICENSE](LICENSE). The files in `src` are the game's own files with the changes above; Phantom Blade Zero and
its files belong to their makers.
