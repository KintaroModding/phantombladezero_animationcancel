// Offline test of the mod, run by build.ps1: node tests/test_mod.js
// It loads src/phantombladezero_animationcancel/main.js as PBZModLoader does (a module whose __dirname is the mod's
// folder) with stand-ins for the modules the game gives it (ue, puerts), a small game world (the player's tags, hit
// state, keys and components), an optional running Mods Menu and the settings file, drives the mod's 16 ms poll by hand,
// and checks what the mod does: the cancels, the stagger escapes, the settings file, the cases it must leave to the game,
// and (2.0) the start, stop() and the Mods Menu page. The move checks are 1.0's.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const FOLDER = path.join(__dirname, "..", "src", "phantombladezero_animationcancel");
const SCRIPT = path.join(FOLDER, "main.js");
const SETTINGS = path.join(FOLDER, "phantombladezero_animationcancel.txt");
const SETTINGS_PATH = FOLDER.replace(/[\\/]+$/, "") + "/phantombladezero_animationcancel.txt";
const MENU_PATH = "C:/Game/ProjectPBZ/Saved/PBZModsMenu/Settings/phantombladezero_animationcancel.txt";
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mod.json"), "utf8")).version;
const KEYS = { "/PBZDeflectSystem/Input/IA_Dodge.IA_Dodge": "SpaceBar",
    "/PBZDeflectSystem/Input/IA_Deflect.IA_Deflect": "RightMouseButton",
    "/Game/PBZContent/Input/InputActions/IA_UseBottomItem.IA_UseBottomItem": "R",
    "/Game/PBZContent/Input/InputActions/IA_UseTopItem.IA_UseTopItem": "T" };
const DODGE = "SpaceBar", GUARD = "RightMouseButton", HEAL = "R";
const ATTACK = ["Ability.Action.Hun.Light", "CharacterState.Action.Phase.Act", "CharacterState.Space.Ground"];

let failed = 0;
function check(name, ok) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) {
        failed++;
    }
}

// One fresh game world and one fresh load of the script (its state lives in a closure).
function boot(options = {}) {
    const world = {
        time: 1000, paused: false, held: new Set(), tags: new Set(["CharacterState.Space.Ground"]), hit: "None",
        files: new Map(), forced: [], buffered: [], phases: [], states: [], warnings: [], logs: [], saved: [],
        pushed: [], loadError: undefined, timer: undefined,
        interval: undefined, cleared: false, forceResult: true, missingActions: new Set(options.missingActions || []),
        throwOnPawn: false,
    };
    if (options.settings !== undefined) {
        world.files.set(options.menu ? MENU_PATH : SETTINGS_PATH, options.settings);
    }
    const token = (name) => ({ StaticClass: () => name });
    const owns = (query) => [...world.tags].some((t) => t == query || t.startsWith(query + "."));
    const components = {
        AbilityInputComponent: {
            ForceActivateExternalActionAbilityByTag(tag, action, priority) {
                world.forced.push({ ability: tag.TagName, action: action.path, priority });
                return world.forceResult;
            },
            RemoveBufferedInputs(list) { world.buffered.push(list.items.map((a) => a.path)); },
        },
        HitreactComponent: {
            GetCurrentHitState: () => ({ TagName: world.hit }),
            ChangeHitPhase(tag) {
                world.phases.push(tag.TagName);
                [...world.tags].filter((t) => t.startsWith("CharacterState.Hitreact.Phase.")).forEach((t) => world.tags.delete(t));
                world.tags.add(tag.TagName);
                return true;
            },
        },
        ActorStateComponent: {
            TryActivateNewState(tag) { world.states.push(tag.TagName); world.tags.add(tag.TagName); return true; },
            StopState(tag) { world.states.push("stop " + tag.TagName); },
        },
    };
    const asc = { HasMatchingGameplayTag: (tag) => owns(tag.TagName) };
    const pawn = { GetComponentByClass: (cls) => components[cls] };
    const controller = { IsInputKeyDown: (key) => world.held.has(key.KeyName) };
    const gameInstance = { freed: false };
    class GameplayTag { constructor() { this.TagName = "None"; } }
    const ue = {
        LinearColor: class { },
        GameplayTag,
        Key: class { constructor(name) { this.KeyName = name; } },
        InputAction: "InputAction",
        NewArray: () => ({ items: [], Add(x) { this.items.push(x); } }),
        AbilityInputComponent: token("AbilityInputComponent"),
        HitreactComponent: token("HitreactComponent"),
        ActorStateComponent: token("ActorStateComponent"),
        EnhancedInputLocalPlayerSubsystem: options.missingClass ? undefined : token("Subsystem"),
        KismetSystemLibrary: {
            // Puerts throws for a wrapper of an object the game has freed, even here (2026-11-14)
            IsValid: (o) => { if (o && o.freed) throw new Error("passing a invalid object"); return !!o; },
            ConvertToAbsolutePath: (p) => p,
        },
        BlueprintPathsLibrary: { FileExists: (p) => world.files.has(p) },
        EasyCsv: {
            LoadStringFromLocalFile(p, out) { out[0] = world.files.get(p); return true; },
            SaveStringToFileWithFullPath(text, p) { world.saved.push([p, text]); world.files.set(p, text); return true; },
        },
        GameplayStatics: {
            GetPlayerCharacter() {
                if (world.throwOnPawn) {
                    throw new Error("passing a invalid object");
                }
                return pawn;
            },
            GetPlayerController: () => controller,
            IsGamePaused: () => world.paused,
            GetTimeSeconds: () => world.time / 1000,
        },
        PBZBlueprintFunctionLibrary: { GetLocalPlayer: () => "local player" },
        SubsystemBlueprintLibrary: {
            GetLocalPlayerSubsystem: () => ({
                QueryKeysMappedToAction(action) {
                    const names = KEYS[action.path] ? [KEYS[action.path]] : [];
                    return { Num: () => names.length, Get: (i) => ({ KeyName: names[i] }) };
                },
            }),
        },
        Object: { Load: (p) => (world.missingActions.has(p) ? null : { path: p }) },
        AbilitySystemBlueprintLibrary: { GetAbilitySystemComponent: () => asc },
    };
    const puerts = {
        $ref: (value) => [value],
        $unref: (box) => box[0],
        argv: { getByName: (name) => (name == "GameInstance" && !options.noGameInstance ? gameInstance : undefined) },
    };
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request == "ue") {
            return ue;
        }
        if (request == "puerts") {
            return puerts;
        }
        return load.call(this, request, parent, isMain);
    };
    globalThis.setInterval = (fn, ms) => { world.timer = fn; world.interval = ms; return 7; };
    globalThis.clearInterval = (id) => { world.cleared = id === 7; };
    const warn = console.warn, logLine = console.log;
    console.warn = (message) => world.warnings.push(String(message));
    console.log = (message) => world.logs.push(String(message));
    globalThis.PBZModsMenu = options.menu === "array" ? [] : options.menu ? {
        api: { has: (f) => !(options.menuMissing || []).includes(f) },
        push(...mods) { world.pushed.push(...mods); return world.pushed.length; },
        settingsPath: (id) => (world.pushed.some((m) => m.id == id) ? MENU_PATH : undefined),
    } : undefined;
    world.menuGlobal = globalThis.PBZModsMenu;
    delete require.cache[require.resolve(SCRIPT)];
    try {
        world.exports = require(SCRIPT);
    }
    catch (e) {
        world.loadError = e;
    }
    finally {
        Module._load = load;
        console.warn = warn;
        console.log = logLine;
    }
    // one poll after `ms` of game time
    world.poll = (ms = 16) => {
        world.time += ms;
        const warnBefore = console.warn;
        console.warn = (message) => world.warnings.push(String(message));
        try {
            world.timer();
        }
        finally {
            console.warn = warnBefore;
        }
    };
    world.polls = (count, ms = 16) => {
        for (let i = 0; i < count; i++) {
            world.poll(ms);
        }
    };
    world.press = (key) => { world.held.add(key); };
    world.release = (key) => { world.held.delete(key); };
    world.setTags = (list) => { world.tags = new Set(list); };
    world.menu = () => world.pushed[0];
    world.gameInstance = gameInstance;
    world.stop = () => {
        const warnBefore = console.warn, logBefore = console.log;
        console.warn = (message) => world.warnings.push(String(message));
        console.log = (message) => world.logs.push(String(message));
        try {
            world.exports.stop();
        }
        finally {
            console.warn = warnBefore;
            console.log = logBefore;
        }
    };
    if (world.timer) {
        world.poll(); // the first poll reads the settings and loads the input actions and keys
    }
    return world;
}
const abilities = (w) => w.forced.map((f) => f.ability);

// 2.0: the module as PBZModLoader loads it.
{
    const w = boot();
    check("no error at load; stop() exported; one 16 ms poll timer", !w.loadError && typeof w.exports.stop == "function"
        && w.interval == 16 && typeof w.timer == "function");
    check("one start line for loader.log, naming the settings file in the mod's folder",
        w.logs.length == 1 && w.logs[0] == `[PBZMOD] [Animation Cancel] ${VERSION} started; settings: ${SETTINGS_PATH}`);
    check("no Mods Menu: no page pushed anywhere", globalThis.PBZModsMenu === undefined && w.pushed.length == 0);
    check("a missing settings file is written once with the defaults; the shipped file is exactly that text (CRLF)",
        w.saved.length == 1 && w.saved[0][0] == SETTINGS_PATH && w.saved[0][1] == fs.readFileSync(SETTINGS, "utf8")
        && fs.readFileSync(SETTINGS, "utf8").includes("\r\n"));
    w.stop();
    check("stop(): the timer cleared, a line for loader.log, no warning", w.cleared
        && w.logs[w.logs.length - 1] == "[PBZMOD] [Animation Cancel] stopped" && w.warnings.length == 0);
    const again = boot();
    again.setTags(ATTACK);
    again.press(DODGE);
    again.polls(3);
    check("a second start after stop() (the reload): it loads and cancels", !again.loadError
        && abilities(again).join() == "Ability.Action.Hun.Dash");
}

// 2.0: Mods Menu, optional; the shipped settings file holds the page's defaults.
{
    const m = boot({ menu: true, settings: "Cancel=0\r\n" });
    const page = m.menu();
    check("Mods Menu running: one page with the folder name as its id, the mod's settings file, version, store "
        + "\"saved\", six rows", m.pushed.length == 1 && page.id == "phantombladezero_animationcancel"
        && page.file == "phantombladezero_animationcancel.txt" && page.version == VERSION && page.store == "saved"
        && page.settings.length == 6);
    // Mods Menu 0.9.8 hides a pushed page under one of its built-in ids unless its own loader started that mod (the
    // game test of 2026-11-14: 2.0's page under 1.0's id PBZAnimationCancel did not show)
    const BUILT_IN = ["PBZAccessoryBoost", "PBZAnimationCancel", "PBZBuffDuration", "PBZDropMultiplier", "PBZHardMode",
        "PBZLootGlow", "PBZMoveSpeed", "PBZVisualTweaks", "PBZWagerTuner"];
    check("... and none of Mods Menu's built-in ids", !BUILT_IN.includes(page.id));
    const text = fs.readFileSync(SETTINGS, "utf8");
    const values = Object.fromEntries([...text.matchAll(/^(\w+)=(\S+)/gm)].map((x) => [x[1], Number(x[2])]));
    const defaults = Object.fromEntries(page.settings.map((s) => [s.key, Number(s.default)]));
    check("the shipped settings file holds the page's six defaults", JSON.stringify(values) == JSON.stringify(defaults));
    check("the mod reads the file the page saves (Cancel=0 there: the dodge is left to the game)",
        m.logs[0].endsWith(`settings: ${MENU_PATH} (Mods Menu's page)`) && (m.setTags(ATTACK), m.press(DODGE), m.polls(3),
            m.forced.length == 0));
    m.release(DODGE);
    m.files.set(MENU_PATH, "Cancel=1\r\n");
    page.onChange();
    m.poll();
    m.press(DODGE);
    m.polls(3);
    check("... a change on the page is read at the next poll", abilities(m).join() == "Ability.Action.Hun.Dash");
    check("the texts say what the mod does (guard cuts, dodge where the game makes it wait)",
        /dodge works where the game makes it wait/.test(page.settings[0].help) && /dodge breaks out where the game makes it wait/.test(text));
    const a = boot({ menu: "array" });
    check("Mods Menu not started yet (a plain array): nothing pushed, the mod's own file", a.menuGlobal.length == 0
        && a.logs[0].endsWith(`settings: ${SETTINGS_PATH}`));
    const o = boot({ menu: true, menuMissing: ["store.saved"] });
    check("an older Mods Menu without store \"saved\": no page", o.pushed.length == 0);
}

// Cancel: a dodge during an attack.
{
    const w = boot();
    w.setTags(ATTACK);
    w.press(DODGE);
    w.polls(2);
    check("no move in the first 30 ms (the game gets two frames itself)", w.forced.length == 0);
    w.poll();
    check("dodge during a light attack: the game's dash, priority -3, with the dodge input action",
        w.forced.length == 1 && w.forced[0].ability == "Ability.Action.Hun.Dash" && w.forced[0].priority == -3
        && w.forced[0].action.endsWith("IA_Dodge"));
    check("the buffered dodge press is removed", w.buffered.length == 1 && w.buffered[0][0].endsWith("IA_Dodge"));
    w.polls(10);
    check("one press, one move", w.forced.length == 1);
}

// Cancel: a guard during an attack (the Cancel phase first, only while the key is held).
{
    const w = boot();
    w.setTags(ATTACK);
    w.press(GUARD);
    w.polls(3);
    check("guard during an attack: the attack's Cancel phase first, then the stance (priority -4)",
        w.states[0] == "CharacterState.Action.Phase.Cancel" && abilities(w).join() == "Ability.Action.Stance"
        && w.forced[0].priority == -4);
    const v = boot();
    v.setTags(ATTACK);
    v.press(GUARD);
    v.poll();
    v.release(GUARD);
    v.poll();
    check("a guard key released before the mod acts: no stance, no Cancel phase", v.forced.length == 0
        && v.states.length == 0);
}

// What the mod leaves to the game.
{
    const cases = [
        ["an idle press (no attack)", ["CharacterState.Space.Ground"], null],
        ["an attack the game already dodged out of", ATTACK.concat(["Ability.Action.Hun.Dash"]), null],
        ["dead", ATTACK.concat(["CharacterState.Dead"]), null],
        ["in the air", ["Ability.Action.Hun.Light", "CharacterState.Action.Phase.Act"], null],
        ["the dash on cooldown", ATTACK.concat(["CharacterState.AbilityState.Dash.Cooldown"]), null],
        ["a combat art (not in the cancel list)", ["Ability.Action.Hun.Skill", "CharacterState.Action.Phase.Act",
            "CharacterState.Space.Ground"], null],
        ["an attack in its Cancel phase (the game allows the dodge itself)", ["Ability.Action.Hun.Light",
            "CharacterState.Action.Phase.Cancel", "CharacterState.Space.Ground"], null],
    ];
    for (const [name, tags] of cases) {
        const w = boot();
        w.setTags(tags);
        w.press(DODGE);
        w.polls(4);
        check("left to the game: " + name, w.forced.length == 0);
    }
    const w = boot();
    w.press(DODGE);
    w.poll();
    w.setTags(ATTACK);
    w.polls(3);
    check("left to the game: a press before the attack began", w.forced.length == 0);
    const p = boot();
    p.setTags(ATTACK);
    p.press(DODGE);
    p.poll();
    p.paused = true;
    p.poll();
    p.paused = false;
    p.polls(3);
    check("a pause drops a waiting press", p.forced.length == 0);
}

// The heal cancel (off by default) and the settings file, read live.
{
    const w = boot();
    w.setTags(ATTACK);
    w.press(HEAL);
    w.polls(3);
    check("a medicine key during an attack does nothing by default (CancelHeal=0)", w.forced.length == 0);
    w.release(HEAL);
    w.files.set(SETTINGS_PATH, "; my settings\r\nCancelHeal = on\r\nCancel=0\r\n");
    w.polls(125);
    w.press(HEAL);
    w.polls(3);
    check("CancelHeal = on (read within 2 s): the upper-body heal, priority 1, with the slot's input action",
        abilities(w).join() == "Ability.UpperBody.Hun.UseItem" && w.forced[0].priority == 1
        && w.forced[0].action.endsWith("IA_UseBottomItem"));
    w.release(HEAL);
    w.press(DODGE);
    w.polls(3);
    check("Cancel=0: a dodge during an attack is left to the game", w.forced.length == 1);
    w.files.delete(SETTINGS_PATH);
    w.release(DODGE);
    w.polls(125);
    w.press(DODGE);
    w.polls(3);
    check("the file deleted: the defaults again (the dodge cancels)", abilities(w).pop() == "Ability.Action.Hun.Dash");
}

// Stagger escape.
{
    const stagger = ["CharacterState.Space.Ground", "CharacterState.Hitreact.Phase.Act"];
    const w = boot();
    w.setTags(stagger);
    w.hit = "CharacterState.Hitreact.State.Normal";
    w.poll();
    w.press(DODGE);
    w.polls(15);
    check("a dodge early in a stagger: no escape before EscapeDelayMs (400 ms); the press is dropped after 200 ms",
        w.forced.length == 0);
    w.release(DODGE);
    w.polls(15);
    w.press(DODGE);
    w.polls(3);
    check("a dodge after 400 ms of stagger: the hit phase DashEscape, then the dash",
        w.phases.join() == "CharacterState.Hitreact.Phase.DashEscape" && abilities(w).join() == "Ability.Action.Hun.Dash");
    w.release(DODGE);
    w.setTags(stagger);
    w.polls(10);
    w.press(DODGE);
    w.polls(3);
    check("a second escape within EscapeCooldownS (4 s): none", w.forced.length == 1);

    const o = boot();
    o.setTags(["CharacterState.Space.Ground", "CharacterState.Hitreact.Phase.Combo"]);
    o.hit = "CharacterState.Hitreact.State.Normal";
    o.poll();
    o.press(DODGE);
    o.polls(3);
    check("a hit phase where the dodge is allowed: forced at once, no delay, no phase change",
        abilities(o).join() == "Ability.Action.Hun.Dash" && o.phases.length == 0);

    const f = boot();
    f.forceResult = false;
    f.setTags(stagger);
    f.hit = "CharacterState.Hitreact.State.Normal";
    f.polls(30);
    f.press(DODGE);
    f.polls(3);
    check("a failed escape puts the stagger's hit phase back", f.phases.join()
        == "CharacterState.Hitreact.Phase.DashEscape,CharacterState.Hitreact.Phase.Act");

    for (const [setting, escapes] of [["", true], ["EscapeBreak=0", false]]) {
        const b = boot({ settings: setting });
        b.setTags(stagger);
        b.hit = "CharacterState.Hitreact.State.Break.Normal";
        b.polls(30);
        b.press(DODGE);
        b.polls(3);
        check(`a broken stance with ${setting || "the defaults"}: ${escapes ? "the dodge rolls out" : "no escape"}`,
            (b.forced.length == 1) == escapes);
    }

    const k = boot();
    k.setTags(stagger);
    k.hit = "CharacterState.Hitreact.State.KnockDown";
    k.polls(30);
    k.press(DODGE);
    k.polls(3);
    check("a knockdown (not a standing stagger): left to the game", k.forced.length == 0);
}

// Settings values: words, decimal commas, clamping, a broken value.
{
    const w = boot({ settings: "EscapeDelayMs=99999\r\nEscapeCooldownS=0,5\r\nStaggerEscape=no\r\nCancel=maybe\r\n" });
    const stagger = ["CharacterState.Space.Ground", "CharacterState.Hitreact.Phase.Act"];
    w.setTags(stagger);
    w.hit = "CharacterState.Hitreact.State.Normal";
    w.polls(40);
    w.press(DODGE);
    w.polls(3);
    check("StaggerEscape=no: no escape", w.forced.length == 0);
    w.release(DODGE);
    w.setTags(ATTACK);
    w.hit = "None";
    w.poll();
    w.press(DODGE);
    w.polls(3);
    check("Cancel=maybe (unreadable) keeps its default 1", abilities(w).join() == "Ability.Action.Hun.Dash");
}

// Missing pieces after a game update.
{
    const w = boot({ missingActions: ["/PBZDeflectSystem/Input/IA_Deflect.IA_Deflect"] });
    w.setTags(ATTACK);
    w.press(GUARD);
    w.polls(3);
    w.release(GUARD);
    w.press(DODGE);
    w.polls(3);
    check("a missing input action leaves only that move to the game", abilities(w).join() == "Ability.Action.Hun.Dash");

    const c = boot({ missingClass: true });
    check("a missing game class: the load throws (PBZModLoader logs the mod as failed), one line, no timer",
        !!c.loadError && c.timer === undefined && c.warnings.length == 1 && c.warnings[0].includes("not started"));
    const n = boot({ noGameInstance: true });
    check("no GameInstance: the load throws, no timer", !!n.loadError && n.timer === undefined);
    const f = boot();
    f.gameInstance.freed = true;
    f.polls(25);
    check("2.0: a freed GameInstance (the game's exit): the polls wait, no error counted, no warning",
        !f.cleared && f.warnings.length == 0);

    const e = boot();
    e.throwOnPawn = true;
    e.polls(19);
    check("19 failed polls: still running", !e.cleared && e.warnings.length == 0);
    e.poll();
    check("20 failed polls in a row: the timer stops, one line in the game's log",
        e.cleared && e.warnings.length == 1 && e.warnings[0].includes("stopped after 20"));
}

process.exit(failed ? 1 : 0);
