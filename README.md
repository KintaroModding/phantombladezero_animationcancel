# Animation Cancel

Guard cuts your own attacks short, dodge where the game makes it wait, and dodge or guard breaks you out of a stagger, with the game's own moves. A PBZModLoader mod; settings in a text file in its folder, or on its Mods Menu page, live in game.

A [PBZModLoader](https://github.com/KintaroModding/phantombladezero_pbzmodloader) mod for Phantom Blade Zero (Unreal Engine
5.7), made with game version `CL-302256_JKS-17280` and PBZModLoader 2.1.0. This README is for developers.
What the mod does, how to install it and its compatibility are in [openmods.md](openmods.md), the mod page on
[openmods](https://openmods.nexus).

## How it works

The game runs much of its logic in JavaScript (Puerts). PBZModLoader loads every folder in
`ProjectPBZ/PBZModLoader/mods/` that has a `main.js`, through the game's own module system, after the game's
`MainStart`; `require("ue")`, `require("puerts")` and `require("Library/TsHelper")` are the game's modules, and
`puerts.argv.getByName("GameInstance")` gives the game instance. Before a reload (Alt+F5) the loader awaits the mod's
`stop()`, which must give back everything the mod changed.

`main.js` polls every 16 ms (the game's own scripts use 16 ms timers; `IsInputKeyDown` sees only a key held across
a poll) and watches the keys bound to four input actions: `IA_Dodge`, `IA_Deflect` (guard), `IA_UseBottomItem` and
`IA_UseTopItem` (the medicine slots), read through `EnhancedInputLocalPlayerSubsystem.QueryKeysMappedToAction`. A press
the game did not turn into the move itself within 30 ms (two frames) is handled:

- **Cancel** (an attack's Start, Act or Combo phase: `Ability.Action.Hun.Light`, `.Heavy`, `.Weapon.Switch`; dodge also
  out of `Ability.Action.Stance`): `AbilityInputComponent.ForceActivateExternalActionAbilityByTag(ability, inputAction,
  priority)`, then `RemoveBufferedInputs`. The guard first moves the attack into its Cancel phase with
  `ActorStateComponent.TryActivateNewState(CharacterState.Action.Phase.Cancel)`, only while its key is still held.
- **Stagger escape** (standing staggers, and `Break.Normal` with `EscapeBreak`): after `EscapeDelayMs`, at most once per
  `EscapeCooldownS`, `HitreactComponent.ChangeHitPhase(DashEscape)` (dodge) or the hit Cancel phase (guard), then the
  forced move; a failed one puts the hit phase back. In a hit phase where the move is allowed already, it is forced at
  once.
- **Heal cancel** (`CancelHeal`): the upper-body heal `Ability.UpperBody.Hun.UseItem` with the slot's input action.

Never: heals, combat arts, Sha-Chi skills, executions, cutscenes, death and the other states in `NEVER`. The mod
changes nothing that lasts, so `stop()` only ends its timer. 20 failed polls in a row (a game update) stop it for the
session with one warning. `DEBUG = true` logs every decision.

2.0 is the port of 1.0 (2026-11-01), a block appended to the game script
`UI/Widget/Foundation/WeaponAdvancdNumricEntry.js` in a pak (since the game update of 2026-11-04 the game refuses a
changed script without a bypass). The logic is 1.0's, unchanged except where a comment says "2.0": the settings file
next to `main.js` (written with the defaults when missing), the Mods Menu page in the 0.9 form (its id is the
folder name, not 1.0's `PBZAnimationCancel`: Mods Menu 0.9.8 hides a pushed page under one of its built-in ids unless
its own loader started that mod), a start that fails throws, `valid()` catches a freed
GameInstance, `stop()`, and the texts that said "dodge or guard" cancels (the game lets a dodge break most attacks
itself; the mod's dodge acts where the game refuses it).

`tests/test_mod.js` runs the script in Node.js against a stand-in player (tags, hit state, keys, components), drives
the poll by hand and checks the cancels, the escapes, the settings and the parts of 2.0 (49 checks).

- **Settings file:** `phantombladezero_animationcancel.txt` next to `main.js` (`__dirname`, the mod's folder as a full path), read every
  2 s with `EasyCsv.LoadStringFromLocalFile` and written with the defaults when missing. The shipped file is exactly the
  script's default text (`tests/test_mod.js` checks it).
- **Mods Menu, optional:** PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu (0.9.0 or later) has
  its registry object in `globalThis.PBZModsMenu` by then. Only when it has the features `settingsPath` and
  `store.saved`, the mod pushes its page (id `phantombladezero_animationcancel`, `store: "saved"`) and reads the file the page saves
  (`PBZModsMenu.settingsPath(id)`, in Mods Menu's Saved folder): a registered page cannot save anywhere else.
- **Log:** `console.log` lines that start with `[PBZMOD]` and the game's warnings reach `ProjectPBZ/PBZModLoader/loader.log`.

## Check and deploy

Requirements: Windows PowerShell 5.1 and [Node.js](https://nodejs.org/) (for `node --check` and the offline test).

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1             # node --check, tests\test_mod.js
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy     # the checks, then deploy.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1            # copy src\phantombladezero_animationcancel to the game
```

`deploy.ps1` mirrors `src\phantombladezero_animationcancel\` to `<game folder>\ProjectPBZ\PBZModLoader\mods\phantombladezero_animationcancel\`. The
settings file that is already there is the tester's and stays; `-ResetConfig` copies the shipped one. The game folder
comes from `gameDir` in `_tools\gamedata\phantombladezero\game.json`, else `$env:UE5_GAMES_DIR\PBZ`; `-GameDir` or
`-ModsDir` override it. It stops when PBZModLoader is not installed (its start file
`ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js` is missing).

The GitHub release zip holds the mod folder at `ProjectPBZ/PBZModLoader/mods/phantombladezero_animationcancel/`, so players unpack it
into the game folder.

Versioning: every change raises the second number in `mod.json` and `main.js` (1.0 -> 1.1): `python scripts\bump_version.py`.

## Project layout

```
src/phantombladezero_animationcancel/   The mod folder: main.js and the shipped settings file
tests/test_mod.js     Offline test of main.js (Node.js, stand-ins for the game)
docs/                 Cover and screenshots
scripts/              bump_version.py, check_openmods.py, publish.ps1
build.ps1, deploy.ps1 Checks; copy into the game
mod.json              Name, version, game, kind pbzmodloader, modsPath
```

## License

MIT, see [LICENSE](LICENSE).
