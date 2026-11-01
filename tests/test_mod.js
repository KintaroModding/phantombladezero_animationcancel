// Offline test of the changed game script, run by build.ps1 when Node.js is installed: node tests/test_mod.js
// It loads src/.../WeaponAdvancdNumricEntry.js with stand-ins for the modules the game gives it (ue, puerts) and a small
// game world (the player's tags, hit state, keys and components), drives the mod's 16 ms poll by hand, and checks what
// the mod does: the cancels, the stagger escapes, the settings file and the cases it must leave to the game.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const SCRIPT = path.join(__dirname, "..", "src", "ProjectPBZ", "Content", "JavaScript", "UI", "Widget", "Foundation",
    "WeaponAdvancdNumricEntry.js");
const SETTINGS = path.join(__dirname, "..", "loose", "phantombladezero_animationcancel.txt");
const CONTENT = "C:/Game/ProjectPBZ/Content/";
const SETTINGS_PATH = CONTENT + "Paks/~mods/phantombladezero_animationcancel.txt";
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
        files: new Map(), forced: [], buffered: [], phases: [], states: [], warnings: [], timer: undefined,
        interval: undefined, cleared: false, forceResult: true, missingActions: new Set(options.missingActions || []),
        throwOnPawn: false,
    };
    if (options.settings !== undefined) {
        world.files.set(SETTINGS_PATH, options.settings);
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
    const gameInstance = {};
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
            IsValid: (o) => !!o,
            GetProjectContentDirectory: () => CONTENT,
            ConvertToAbsolutePath: (p) => p,
        },
        BlueprintPathsLibrary: { FileExists: (p) => world.files.has(p) },
        EasyCsv: { LoadStringFromLocalFile(p, out) { out[0] = world.files.get(p); return true; } },
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
        argv: { getByName: (name) => (name == "GameInstance" ? gameInstance : undefined) },
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
    const warn = console.warn;
    console.warn = (message) => world.warnings.push(String(message));
    globalThis.PBZModsMenu = undefined;
    delete require.cache[require.resolve(SCRIPT)];
    try {
        world.exports = require(SCRIPT);
    }
    finally {
        Module._load = load;
        console.warn = warn;
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
    world.menu = () => (globalThis.PBZModsMenu || [])[0];
    if (world.timer) {
        world.poll(); // the first poll reads the settings and loads the input actions and keys
    }
    return world;
}
const abilities = (w) => w.forced.map((f) => f.ability);

// The game's part of the file and the module.
{
    const text = fs.readFileSync(SCRIPT, "utf8");
    const lines = text.split("\n");
    check("the game's part: its 13 lines, then the mod's block, then the source map line",
        lines[12] == "exports.WeaponAdvancdNumricEntryInterface = WeaponAdvancdNumricEntryInterface;"
        && lines[13].startsWith("// Animation Cancel: begin.") && lines[lines.length - 2] == "// Animation Cancel: end"
        && lines[lines.length - 1] == "//# sourceMappingURL=WeaponAdvancdNumricEntry.js.map" && !text.endsWith("\n"));
    const w = boot();
    check("the game's class is still exported with PlayNiagara",
        typeof w.exports.WeaponAdvancdNumricEntryInterface.prototype.PlayNiagara == "function");
    check("one 16 ms poll timer", w.interval == 16 && typeof w.timer == "function");
    const menu = w.menu();
    check("Mods Menu entry: the mod's own settings file, version 1.0, six settings",
        !!menu && menu.file == "phantombladezero_animationcancel.txt" && menu.version == "1.0"
        && menu.settings.length == 6);
}

// The shipped settings file holds the defaults of the script.
{
    const text = fs.readFileSync(SETTINGS, "utf8");
    const values = Object.fromEntries([...text.matchAll(/^(\w+)=(\S+)/gm)].map((m) => [m[1], Number(m[2])]));
    const w = boot();
    const defaults = Object.fromEntries(w.menu().settings.map((s) => [s.key, Number(s.default)]));
    check("loose/phantombladezero_animationcancel.txt holds the six defaults (CRLF line ends)",
        JSON.stringify(values) == JSON.stringify(defaults) && text.includes("\r\n"));
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
    check("a missing game class: not started, one line in the game's log, no timer",
        c.timer === undefined && c.warnings.length == 1 && c.warnings[0].includes("not started"));

    const e = boot();
    e.throwOnPawn = true;
    e.polls(19);
    check("19 failed polls: still running", !e.cleared && e.warnings.length == 0);
    e.poll();
    check("20 failed polls in a row: the timer stops, one line in the game's log",
        e.cleared && e.warnings.length == 1 && e.warnings[0].includes("stopped after 20"));
}

process.exit(failed ? 1 : 0);
