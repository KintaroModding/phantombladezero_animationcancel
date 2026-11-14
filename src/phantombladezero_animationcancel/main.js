"use strict";
// Animation Cancel for Phantom Blade Zero: a PBZModLoader mod (ProjectPBZ/PBZModLoader/mods/phantombladezero_animationcancel/).
//
// Guard cuts your own attacks short, dodge where the game makes it wait (for example out of a guard), and dodge or guard
// breaks you out of a standing stagger.
//
// Cancel: a dodge or guard press during a normal attack's Start, Act or Combo phase (dodge also during a guard)
// activates that move through the game's own AbilityInputComponent.ForceActivateExternalActionAbilityByTag, a plain GAS
// TryActivateAbility. The guard's own CanActivate refuses during an action that is not in its Cancel phase (unless an
// attack is about to land, BP_StanceAction_Base_Player), so the guard first moves the attack into its Cancel phase with
// ActorStateComponent.TryActivateNewState, the call the attack's GAAction_ActionPhase makes at the end of every swing;
// it does that only while the guard key is still held. The dodge's CanActivate passes mid-swing, so it is forced as is
// (the game lets a dodge break most attacks itself; the mod's dodge acts where the game refuses it).
// The attack's own Cancel phase already allows both moves: there the game does it itself.
//
// Stagger escape: in a standing stagger (and a stance break, with EscapeBreak), after EscapeDelayMs and at most once
// per EscapeCooldownS, a dodge press first puts the hit reaction into CharacterState.Hitreact.Phase.DashEscape
// (HitreactComponent.ChangeHitPhase, what the game's own AN_HitReactDashEscape notify does on knockdowns), so the dodge
// comes out as the game's escape roll; a guard press uses the hit Cancel phase. In a hit phase where the move's own
// rules already pass (dodge: DashEscape, Combo, Cancel; guard: Cancel) it is forced at once, without delay or cooldown.
//
// Heal cancel (CancelHeal, off by default): a medicine key during the same attacks forces the game's upper-body heal
// (GA_Medicine_Common_Additive, Ability.UpperBody.Hun.UseItem) with that slot's input action, which picks the slot. The
// heal plays out in full, no move of this mod ever cuts a heal short, and a heal never escapes a stagger.
//
// Costs, cooldown tags and invincibility frames are the game's own. Times are game time (they stop while paused). The
// mod changes nothing that lasts: stop() only ends its timer.
//
// 2.0: the port of 1.0, a block appended to the game script UI/Widget/Foundation/WeaponAdvancdNumricEntry.js in a pak
// (since the game update of 2026-11-04 the game refuses a changed script without a bypass). The logic is 1.0's,
// unchanged except where a comment says "2.0".
//
// PBZModLoader loads this file after the game's MainStart, through the game's module system ("ue" and "puerts" are the
// game's modules). Before a reload (Alt+F5) it awaits stop(). Settings: phantombladezero_animationcancel.txt next to
// this file (__dirname), "Key=Value" lines, read every 2 s and written with the defaults when missing. With Mods Menu
// (0.9.0 or later) running, the mod adds its page there and reads the file that page saves instead (a page cannot save
// anywhere else).
const UE = require("ue");
const puerts = require("puerts");

const MOD_NAME = "Animation Cancel";
const MOD_ID = "phantombladezero_animationcancel"; // the mod folder's name
const MOD_VERSION = "2.0";
// 2.0: Mods Menu's page has the folder name as its id. Not 1.0's "PBZAnimationCancel": that is one of Mods Menu's
// built-in ids, and Mods Menu 0.9.8 shows a pushed page under a built-in id only when its own loader started that mod
const MENU_ID = MOD_ID;
const SETTINGS_FILE = MOD_ID + ".txt";
// 2.0: every setting with its default; the shipped settings file holds exactly this text (tests/test_mod.js checks it)
const DEFAULT_TEXT = ["; " + MOD_NAME + " (" + MOD_ID + ") settings.",
    "; Change a value and save. The game picks it up within 2 seconds, no restart needed.",
    "; Without this file the mod writes it with these values.",
    ";",
    "; Cancel: 1 = guard cuts your normal attacks short, and dodge breaks out where the game makes it wait (for example",
    ";   out of a guard), 0 = stock.",
    "Cancel=1",
    "; CancelHeal: 1 = a medicine key also breaks out of those attacks (the heal uses its potion and plays out in full), 0 = stock.",
    "CancelHeal=0",
    "; StaggerEscape: 1 = dodge or guard breaks out of a standing stagger, 0 = stock.",
    "StaggerEscape=1",
    "; EscapeBreak: 1 = dodge also rolls out of a broken stance (Sha-Chi broken), 0 = a broken stance plays out.",
    "EscapeBreak=1",
    "; EscapeDelayMs: how long a stagger must last before you can break out, in milliseconds (0 to 3000).",
    "EscapeDelayMs=400",
    "; EscapeCooldownS: seconds after a stagger escape before the next one (0 to 60).",
    "EscapeCooldownS=4",
    ""].join("\r\n");
// 2.0: the running timer, a read of the settings asked for by Mods Menu's page, and whether the default file was written
const run = { timer: undefined, stopped: false, readNow: false, made: false };

// ----------------------------------------------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------------------------------------------
const DEFAULTS = {
    Cancel: 1, CancelHeal: 0, StaggerEscape: 1, EscapeBreak: 1, EscapeDelayMs: 400, EscapeCooldownS: 4,
};
const LIMITS = {
    Cancel: [0, 1], CancelHeal: [0, 1], StaggerEscape: [0, 1], EscapeBreak: [0, 1],
    EscapeDelayMs: [0, 3000], EscapeCooldownS: [0, 60],
};
// words the settings file may use for 1 and 0
const WORDS = { on: 1, true: 1, yes: 1, off: 0, false: 0, no: 0 };

// ----------------------------------------------------------------------------------------------------------------
// Timing
// ----------------------------------------------------------------------------------------------------------------
const POLL_MS = 16; // IsInputKeyDown only sees a key held across a poll; the game's own scripts use 16 ms timers
const FILE_EVERY = 125; // polls between two reads of the settings file (about 2 s)
const KEYS_EVERY_IDLE = 16; // polls between two reads of a move's keys while none are bound (about 250 ms)
const GRACE_MS = 30; // the game gets two frames to act on a press itself before the mod steps in
const PRESS_MS = 200; // a press the mod could not use yet is dropped after this, like a short input buffer
const MAX_ERRORS = 20; // failed polls in a row before the mod stops for the session

// ----------------------------------------------------------------------------------------------------------------
// Log: the game's log (LogPuerts in ProjectPBZ\Saved\Logs). DEBUG = true writes every decision, for tests.
// ----------------------------------------------------------------------------------------------------------------
const DEBUG = false;
const log = (message) => { if (DEBUG) console.log("[Animation Cancel] " + message()); };
const warn = (message) => console.warn("[Animation Cancel] " + message);

// ----------------------------------------------------------------------------------------------------------------
// Game tags
// ----------------------------------------------------------------------------------------------------------------
// a heal running (upper body, the full-body heal in a stagger, the heal on a pole): no move cuts it short
const HEALS = ["Ability.UpperBody.Hun.UseItem", "Ability.Action.Hun.UseItem", "Ability.SpecialMove.Pole.UseItem"];
// the normal attacks a move may cancel; combat arts, Sha-Chi skills, executions, perfect-dodge counters and parries
// are in no list, so they play out
const ATTACKS = ["Ability.Action.Hun.Light", "Ability.Action.Hun.Heavy", "Ability.Action.Hun.Weapon.Switch"];
const ACTION_PHASES = ["CharacterState.Action.Phase.Start", "CharacterState.Action.Phase.Act",
    "CharacterState.Action.Phase.Combo"];
const CANCEL_PHASE = "CharacterState.Action.Phase.Cancel";
// standing staggers (exact hit states, lower case) and the stance break (EscapeBreak): knockdowns already get the
// game's own escape roll; launches, grabs, executions and deaths stay as in the game
const STAGGERS = ["characterstate.hitreact.state.normal", "characterstate.hitreact.state.normal.heavy",
    "characterstate.hitreact.state.normal.knockback", "characterstate.hitreact.state.normal.counter",
    "characterstate.hitreact.state.normalloop"];
const BREAK = "characterstate.hitreact.state.break.normal";
// the hit phases a failed escape puts back
const HIT_PHASES = ["CharacterState.Hitreact.Phase.Act", "CharacterState.Hitreact.Phase.Combo"];
// states in which the mod never acts
const NEVER = ["CharacterState.Dead", "Ability.Executed", "CharacterState.HitReact.State.Executing",
    "Ability.Action.Execution", "CharacterState.Native.Sequence", "CharacterState.InLevelSequence",
    "CharacterState.NarrativeDialogue", "CharacterState.Narrative", "CharacterState.LowHealthLevelSequence",
    "CharacterState.SpecialMove", "CharacterState.InteractMove", "CharacterState.ShipNavigation",
    "CharacterState.AbilityState.InSpecialPerform"].concat(HEALS);

// ----------------------------------------------------------------------------------------------------------------
// Moves
// ----------------------------------------------------------------------------------------------------------------
// name, setting: the move and the setting that turns its cancel on
// action, ability, priority: the key's input action, the ability tag and the action priority of the game's own
//   bindings (AIM_Hun_Dash -3, BP_PlayerDeflectPassive Stance Action Priority -4, AIM_Medicine_Common 1)
// done: tags that mean the game already started the move itself
// cancels: the actions the move may cut short
// blocked: the move's ActivationBlockedTags (BP_PlayerDodge_Base; BP_StanceAction_Base and _Player)
// open: the hit phases in which the move's own CanActivate passes (the guard refuses Combo)
// escapePhase: the hit phase that lets the move out of a stagger (none: no stagger escape)
// phaseFirst: the attack must reach its Cancel phase before the move can start
// hold: the key must still be down (the stance starts with Stance Key Down = true and ends on a release it hears)
const MOVES = [
    {
        name: "dodge", setting: "Cancel",
        action: "/PBZDeflectSystem/Input/IA_Dodge.IA_Dodge", ability: "Ability.Action.Hun.Dash", priority: -3,
        done: ["Ability.Action.Hun.Dash", "Ability.Action.Hun.PerfectDodge", "Ability.Action.Hun.SpecialDash",
            "Ability.Action.Hun.ContinuousDash", "Ability.Action.Hun.AirDash", "Ability.Action.Hun.BreakEscape"],
        cancels: ATTACKS.concat(["Ability.Action.Stance"]),
        blocked: ["CharacterState.AbilityState.Dash.Cooldown", "CharacterState.AbilityState.Dash.Forbid"],
        open: ["CharacterState.Hitreact.Phase.DashEscape", "CharacterState.Hitreact.Phase.Combo",
            "CharacterState.Hitreact.Phase.Cancel"],
        escapePhase: "CharacterState.Hitreact.Phase.DashEscape", phaseFirst: false, hold: false,
    },
    {
        name: "guard", setting: "Cancel",
        action: "/PBZDeflectSystem/Input/IA_Deflect.IA_Deflect", ability: "Ability.Action.Stance", priority: -4,
        done: ["Ability.Action.Stance", "Ability.Action.HoldDeflect"],
        cancels: ATTACKS,
        blocked: ["CharacterState.Stand.Break", "CharacterState.AbilityState.Stance.Forbid",
            "CharacterState.Native.Sequence"],
        open: ["CharacterState.Hitreact.Phase.Cancel"],
        escapePhase: "CharacterState.Hitreact.Phase.Cancel", phaseFirst: true, hold: true,
    },
    // the two medicine slots (IMC_HUDInput_Meidicne: R / d-pad down, T / d-pad up). The heal's CanActivate has no
    // side effects (GA_UseItemActionBase, BP_ActionAbilityBase), so a refused heal changes nothing
    {
        name: "heal-bottom", setting: "CancelHeal",
        action: "/Game/PBZContent/Input/InputActions/IA_UseBottomItem.IA_UseBottomItem",
        ability: "Ability.UpperBody.Hun.UseItem", priority: 1,
        done: HEALS, cancels: ATTACKS, blocked: [], open: [], escapePhase: "", phaseFirst: false, hold: false,
    },
    {
        name: "heal-top", setting: "CancelHeal",
        action: "/Game/PBZContent/Input/InputActions/IA_UseTopItem.IA_UseTopItem",
        ability: "Ability.UpperBody.Hun.UseItem", priority: 1,
        done: HEALS, cancels: ATTACKS, blocked: [], open: [], escapePhase: "", phaseFirst: false, hold: false,
    },
];

// ----------------------------------------------------------------------------------------------------------------
// Mods Menu (optional). 2.0: the page goes to a running Mods Menu (0.9.0 or later, with settingsPath and store "saved")
// and the mod reads the file the page saves. PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu has
// its registry object here by now; without it nothing is pushed. On/off rows are the choices "1" and "0", the values the
// settings file uses.
// ----------------------------------------------------------------------------------------------------------------
const onOff = [{ value: "1", label: "On" }, { value: "0", label: "Off" }];
const page = () => ({
    id: MENU_ID, title: MOD_NAME, file: SETTINGS_FILE, version: MOD_VERSION, store: "saved",
    description: "Guard cuts your own attacks short, dodge where the game makes it wait, and dodge or guard breaks you"
        + " out of a stagger. Healing can cut attacks short too.",
    settings: [
        { key: "Cancel", type: "choice", options: onOff, default: "1", label: "Cancel Attacks",
            help: "On: press guard during a light, heavy or weapon-switch attack and you guard at once, without waiting"
                + " for the swing to end; dodge works where the game makes it wait (for example out of a guard). Off:"
                + " attacks play out as normal." },
        { key: "CancelHeal", type: "choice", options: onOff, default: "0", label: "Heal Cancels Attacks",
            help: "On: press a medicine key during a light, heavy or weapon-switch attack and you start"
                + " drinking at once. The heal uses its potion and plays out in full as usual. Off: the game"
                + " waits for the swing to end." },
        { key: "StaggerEscape", type: "choice", options: onOff, default: "1", label: "Stagger Escape",
            help: "On: while enemy hits keep you staggered, dodge rolls you out and guard raises your guard."
                + " Off: you wait for the stagger to end." },
        { key: "EscapeBreak", type: "choice", options: onOff, default: "1", label: "Escape Stance Break",
            help: "On: dodge also rolls you out of a broken stance, not only a stagger. Off: a broken stance"
                + " plays out as normal." },
        { key: "EscapeDelayMs", type: "number", min: 0, max: 3000, step: 100, default: 400,
            label: "Escape Delay (ms)",
            help: "How long you must be staggered, in milliseconds, before dodge or guard can get you out."
                + " 0: at once." },
        { key: "EscapeCooldownS", type: "number", min: 0, max: 60, step: 1, default: 4,
            label: "Escape Cooldown (s)",
            help: "Seconds to wait after a stagger escape before you can escape again. 0: no wait." },
    ],
    onChange: () => { run.readNow = true; }, // read at the next poll
});
const menu = { on: false };
{
    const mm = globalThis.PBZModsMenu;
    if (mm && typeof mm === "object" && !Array.isArray(mm) && typeof mm.push === "function"
        && typeof mm.settingsPath === "function" && mm.api && typeof mm.api.has === "function"
        && mm.api.has("settingsPath") && mm.api.has("store.saved")) {
        try {
            mm.push(page());
            menu.on = typeof mm.settingsPath(MENU_ID) === "string";
        }
        catch (e) {
            console.warn(`[${MOD_NAME}] no Mods Menu page: ${e}`);
        }
    }
}
// 2.0: the settings file: the one Mods Menu's page saves, else the one next to this main.js
function settingsFile() {
    if (menu.on) {
        const path = globalThis.PBZModsMenu.settingsPath(MENU_ID);
        if (typeof path === "string" && path)
            return path;
    }
    return UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + SETTINGS_FILE);
}
// 2.0: Puerts throws "passing a invalid object" for a wrapper of an object the game has freed, even inside IsValid
// (seen at the game's exit, 2026-11-14): that is "not valid"
const valid = (o) => {
    if (!o)
        return false;
    try {
        return UE.KismetSystemLibrary.IsValid(o);
    }
    catch (e) {
        return false;
    }
};

// ----------------------------------------------------------------------------------------------------------------
// Runtime
// ----------------------------------------------------------------------------------------------------------------
try {
    const gameInstance = puerts.argv.getByName("GameInstance");
    // a game update that renames one of these leaves the game as it is
    const findClass = (name) => { try { return UE[name]; } catch (e) { return undefined; } };
    const InputComponent = findClass("AbilityInputComponent");
    const HitComponent = findClass("HitreactComponent");
    const StateComponent = findClass("ActorStateComponent");
    const InputSubsystem = findClass("EnhancedInputLocalPlayerSubsystem");
    // 2.0: a start that fails throws, so PBZModLoader logs the mod as failed
    if (!gameInstance || !InputComponent || !HitComponent || !StateComponent || !InputSubsystem)
        throw new Error("the GameInstance or a game class is missing (a game update?); the game plays as normal");

    let settings = Object.assign({}, DEFAULTS);
    let settingsPath = undefined;
    let polls = 0;
    let errors = 0;
    let hitSince = 0; // game time (ms) when the current run of escapable hits began, 0 outside one
    let lastHit = "";
    let lastEscape = -Infinity;
    let movedThisPoll = false; // one forced move per poll
    // per move: its input action (undefined: not loaded yet, null: missing), its bound keys, whether a key was down
    // at the last poll, and a press the game did not use yet ({ at, duringHit, duringAction, wait })
    const runtime = new Map(MOVES.map((move) => [move.name,
        { action: undefined, keys: undefined, keyNames: [], down: false, press: undefined }]));

    const tags = new Map();
    function tag(name) {
        let found = tags.get(name);
        if (!found) {
            found = new UE.GameplayTag();
            found.TagName = name;
            tags.set(name, found);
        }
        return found;
    }

    const escapable = (hit) => STAGGERS.includes(hit) || (!!settings.EscapeBreak && hit == BREAK);
    const moveOff = (move) => !settings[move.setting] && !(move.escapePhase && settings.StaggerEscape);
    const clearPresses = () => runtime.forEach((state) => { state.press = undefined; });

    // "Cancel=1", also "on"/"off", "true"/"false", "1,5"; clamped to LIMITS; a key that cannot be read keeps
    // its default
    function parseSettings(text) {
        const out = Object.assign({}, DEFAULTS);
        for (const key of Object.keys(LIMITS)) {
            const line = new RegExp("^[ \\t]*" + key + "[ \\t]*=([^;#\\r\\n]*)", "im").exec(text);
            const raw = line ? line[1].trim().toLowerCase() : "";
            const word = Object.prototype.hasOwnProperty.call(WORDS, raw);
            const value = word ? WORDS[raw] : parseFloat(raw.replace(",", "."));
            if (Number.isFinite(value)) {
                const [low, high] = LIMITS[key];
                out[key] = Math.min(high, Math.max(low, value));
            }
        }
        return out;
    }

    function readSettings() {
        try {
            run.readNow = false;
            if (settingsPath === undefined)
                settingsPath = settingsFile(); // 2.0: next to main.js, or Mods Menu's file
            // check first: EasyCsv logs an error for a missing file
            if (!UE.BlueprintPathsLibrary.FileExists(settingsPath)) {
                settings = Object.assign({}, DEFAULTS);
                if (!run.made) {
                    run.made = true; // 2.0: once a session, and never over an existing file
                    UE.EasyCsv.SaveStringToFileWithFullPath(DEFAULT_TEXT, settingsPath);
                }
                return;
            }
            const out = puerts.$ref("");
            if (!UE.EasyCsv.LoadStringFromLocalFile(settingsPath, out))
                return; // locked mid-save: keep the settings and try again next time
            const next = parseSettings(puerts.$unref(out));
            if (JSON.stringify(next) != JSON.stringify(settings))
                log(() => "settings " + JSON.stringify(next) + " from " + settingsPath);
            settings = next;
        }
        catch (e) {
            log(() => "settings read threw: " + e);
        }
    }

    // the names of the keys bound to an input action right now; none in menus, cutscenes, QTEs and loading, whose
    // input modes drop IMC_Deflect. Names, not the FKeys: those live in a temporary array
    function keysOf(pawn, action) {
        const player = UE.PBZBlueprintFunctionLibrary.GetLocalPlayer(pawn);
        const input = UE.SubsystemBlueprintLibrary.GetLocalPlayerSubsystem(player, InputSubsystem.StaticClass());
        const keys = input ? input.QueryKeysMappedToAction(action) : undefined;
        const names = [];
        for (let i = 0; keys && i < keys.Num(); i++)
            names.push(String(keys.Get(i).KeyName));
        return names;
    }

    function forceMove(input, move, action) {
        const ok = !!input.ForceActivateExternalActionAbilityByTag(tag(move.ability), action, move.priority);
        if (ok) {
            movedThisPoll = true;
            try {
                // a press the game buffered would fire the move a second time once ours ends
                const buffered = UE.NewArray(UE.InputAction);
                buffered.Add(action);
                input.RemoveBufferedInputs(buffered);
            }
            catch (e) {
                log(() => "buffer cleanup threw: " + e); // the move is out either way; its cooldown still counts
            }
        }
        return ok;
    }

    // log helpers for DEBUG lines (they only run when DEBUG is true): the player's action, hit and space tags, and
    // why the ability system refused the last activation
    const SUMMARY_TAGS = new RegExp("^(CharacterState\\.(Action|Hit[Rr]eact|Stand\\.Break|Space|AbilityState)"
        + "|Ability\\.(Action|UpperBody))");
    const tagText = (container) => UE.BlueprintGameplayTagLibrary.GetDebugStringFromGameplayTagContainer(container);
    const tagSummary = (asc) => tagText(asc.BP_GetOwnedGameplayTags()).split(/,\s*/)
        .filter((t) => SUMMARY_TAGS.test(t)).join(" ");
    const failTags = (asc) => {
        try {
            return "GAS fail tags: " + (tagText(UE.AbilityUtils.GetActivateAbilityFailureTags(asc)) || "none");
        }
        catch (e) {
            return "GAS fail tags unreadable: " + e;
        }
    };
    const inputPhase = (input) => {
        try { return "input component " + input.InActionPhase + "/" + input.ActionPhase.TagName; }
        catch (e) { return "input component unreadable"; }
    };

    // A press during an escapable stagger. Returns true when the press is used up, false to keep it waiting for
    // EscapeDelayMs.
    function escapeStagger(pawn, asc, input, has, hit, move, state, now, leave) {
        if (!move.escapePhase)
            return leave("no stagger escape for this move");
        if (!settings.StaggerEscape)
            return leave("escape off");
        if (!escapable(hit))
            return leave("not an escapable hit state: " + hit + (hit == BREAK ? " (EscapeBreak=0)" : ""));
        const blocked = move.blocked.find(has);
        if (blocked)
            return leave("the game blocks this move now: " + blocked);
        const open = move.open.find(has);
        if (open) {
            // the move's own CanActivate passes in this hit phase: no delay, cooldown or phase change. The dodge's
            // CanActivate stops the hit phase before its last check, so a refusal puts the phase back
            let ok = false;
            try {
                ok = forceMove(input, move, state.action);
                if (!ok && !has(open))
                    pawn.GetComponentByClass(HitComponent.StaticClass()).ChangeHitPhase(tag(open));
            }
            catch (e) {
                log(() => move.name + " open-window force threw: " + e);
            }
            log(() => move.name + " ESCAPE in open window " + open + ": "
                + (ok ? "ok" : "failed, " + failTags(asc)));
            return true;
        }
        if (now - hitSince < settings.EscapeDelayMs) {
            state.press.wait = "hit for " + Math.round(now - hitSince) + " ms, under EscapeDelayMs "
                + settings.EscapeDelayMs;
            return false; // keep the press while it is fresh: it may still land after the delay
        }
        if (now - lastEscape < settings.EscapeCooldownS * 1000)
            return leave("escape on cooldown, " + Math.round(settings.EscapeCooldownS * 1000 - (now - lastEscape))
                + " ms left");
        const hitReact = pawn.GetComponentByClass(HitComponent.StaticClass());
        if (!hitReact)
            return leave("no HitreactComponent");
        const before = HIT_PHASES.find(has);
        let opened = false;
        let ok = false;
        try {
            opened = hitReact.ChangeHitPhase(tag(move.escapePhase));
            ok = forceMove(input, move, state.action);
        }
        catch (e) {
            log(() => move.name + " escape threw: " + e); // counts as a failed escape: the phase goes back below
        }
        finally {
            if (ok)
                lastEscape = now;
            else
                rollBackHitPhase(pawn, hitReact, before, move);
        }
        log(() => move.name + " ESCAPE " + (ok ? "ok" : "failed, " + failTags(asc)) + " from " + hit + " after "
            + Math.round(now - hitSince) + " ms (phase " + (before || "none") + " -> " + move.escapePhase + " "
            + opened + ")");
        return true;
    }

    // a failed escape puts the stagger back, so it opens no free window; the press is used up either way
    function rollBackHitPhase(pawn, hitReact, before, move) {
        try {
            if (before) {
                hitReact.ChangeHitPhase(tag(before));
            }
            else {
                const actorState = pawn.GetComponentByClass(StateComponent.StaticClass());
                if (actorState)
                    actorState.StopState(tag("CharacterState.Hitreact.Phase"), true);
            }
        }
        catch (e) {
            log(() => move.name + " escape rollback threw: " + e);
        }
    }

    // A press during the player's own action. Always uses up the press.
    function cancelAction(pawn, asc, input, has, move, state, leave) {
        if (!settings[move.setting])
            return leave(move.setting + " off");
        const from = move.cancels.find(has);
        const phase = ACTION_PHASES.find(has);
        if (!from || !phase)
            return leave("not a cancellable action (" + (from || "none") + ") in its Start, Act or Combo phase ("
                + (phase || "none") + ")");
        if (!state.press.duringAction)
            return leave("pressed before the action began: an idle press is the game's to handle");
        const blocked = move.blocked.find(has);
        if (blocked)
            return leave("the game blocks this move now: " + blocked);
        log(() => move.name + " CANCEL try from " + from + " in " + phase + ", " + inputPhase(input));
        let ok = false;
        try {
            let moved = true;
            if (move.phaseFirst) {
                // no way back from Cancel (the actor-state rules only move forward): if the force still fails, the
                // swing ends in its Cancel phase. The blocked check above makes that rare
                const actorState = pawn.GetComponentByClass(StateComponent.StaticClass());
                moved = !!actorState && !!actorState.TryActivateNewState(tag(CANCEL_PHASE));
                log(() => move.name + " CANCEL phase first: TryActivateNewState(Cancel) " + moved);
            }
            if (moved)
                ok = forceMove(input, move, state.action);
        }
        catch (e) {
            log(() => move.name + " CANCEL threw: " + e); // the press is used up either way: never a second try
        }
        log(() => move.name + " CANCEL " + (ok ? "ok" : "failed, " + failTags(asc)));
        return true;
    }

    // One press the game did not turn into the move itself. Returns true when the press is used up.
    function handlePress(pawn, asc, hit, move, state, now) {
        const has = (name) => asc.HasMatchingGameplayTag(tag(name));
        const leave = (why) => {
            log(() => move.name + " left to the game: " + why + (DEBUG ? "; " + tagSummary(asc) : ""));
            return true;
        };
        if (move.done.some(has))
            return leave("the game did it");
        if (move.hold && !state.down)
            return leave("key released before the mod could act: a stance started now would never hear the"
                + " release");
        const never = NEVER.find(has);
        if (never)
            return leave("excluded state " + never);
        if (!has("CharacterState.Space.Ground"))
            return leave("not on the ground");
        if (keysOf(pawn, state.action).length == 0)
            return leave("key not live in this input mode");
        const input = pawn.GetComponentByClass(InputComponent.StaticClass());
        if (!input)
            return leave("no AbilityInputComponent");
        return hit ? escapeStagger(pawn, asc, input, has, hit, move, state, now, leave)
            : cancelAction(pawn, asc, input, has, move, state, leave);
    }

    // why a waiting press is dropped, or "" to keep it: a press made during a stagger never cancels the attack
    // after it, and a press made outside one never escapes the stagger after it
    function dropReason(move, press, hit, now) {
        if (now - press.at > PRESS_MS)
            return "older than " + PRESS_MS + " ms (" + (press.wait || "no chance to act") + ")";
        if (press.duringHit != !!hit)
            return press.duringHit ? "the hit ended first" : "a hit began first";
        if (movedThisPoll)
            return "another move was forced this poll";
        if (moveOff(move))
            return move.setting + (move.escapePhase ? " and StaggerEscape both off" : " off");
        return "";
    }

    function pollMove(move, state, pawn, controller, hit, now) {
        const asc = () => UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn);
        // the input action loads on first use and every 2 s until it does; a game update that removes it leaves
        // that move as in the game. A load that throws counts as missing, so it never stops the other moves
        if (!state.action && (state.action === undefined || polls % FILE_EVERY == 1)) {
            let why = "";
            try {
                state.action = UE.Object.Load(move.action) || null;
            }
            catch (e) {
                state.action = null;
                why = ": " + e;
            }
            log(() => move.name + " input action " + move.action + (state.action ? " loaded" : " MISSING" + why));
        }
        if (!state.action)
            return;
        // keys read again every 2 s, or every 250 ms while none are bound (menu, cutscene)
        if (!state.keys || polls % (state.keys.length ? FILE_EVERY : KEYS_EVERY_IDLE) == 1) {
            const names = keysOf(pawn, state.action);
            if (!state.keys || names.join() != state.keyNames.join())
                log(() => move.name + " keys " + (names.join(", ") || "none"));
            state.keyNames = names;
            state.keys = names.map((name) => new UE.Key(name));
        }
        const held = state.keys.some((key) => controller.IsInputKeyDown(key));
        if (held && !state.down) {
            // duringAction: a cancellable action ran at the press, so an attack begun after it is not cancelled
            const a = asc();
            state.press = {
                at: now, duringHit: !!hit, wait: "",
                duringAction: !!a && move.cancels.some((name) => a.HasMatchingGameplayTag(tag(name))),
            };
            log(() => move.name + " pressed; hit " + (hit || "none"));
        }
        state.down = held;
        const press = state.press;
        if (!press || now - press.at < GRACE_MS)
            return;
        const drop = dropReason(move, press, hit, now);
        const a = drop ? undefined : asc(); // only while a press waits, so an idle poll stays light
        if (drop || !a)
            log(() => move.name + " press dropped: " + (drop || "no ability system"));
        if (drop || !a || handlePress(pawn, a, hit, move, state, now))
            state.press = undefined;
    }

    function tick() {
        try {
            if (!valid(gameInstance)) // 2.0: valid() catches a freed object
                return;
            if (polls++ % FILE_EVERY == 0 || run.readNow)
                readSettings();
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const controller = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
            if (!pawn || !controller || UE.GameplayStatics.IsGamePaused(gameInstance)) {
                clearPresses(); // a press from before a pause or a load is not a press for what comes after
                return;
            }
            const now = UE.GameplayStatics.GetTimeSeconds(gameInstance) * 1000;
            if (now < lastEscape || now < hitSince) {
                // a new world restarted the clock
                lastEscape = -Infinity;
                hitSince = 0;
                clearPresses();
            }
            movedThisPoll = false;
            const hitReact = pawn.GetComponentByClass(HitComponent.StaticClass());
            const hitState = hitReact ? hitReact.GetCurrentHitState() : undefined;
            const hit = hitState && hitState.TagName && String(hitState.TagName) != "None"
                ? String(hitState.TagName).toLowerCase() : "";
            // only time spent in an escapable hit counts toward the escape delay, not a knockdown before it
            hitSince = escapable(hit) ? hitSince || now : 0;
            if (hit != lastHit) {
                log(() => "hit state " + (lastHit || "none") + " -> " + (hit || "none"));
                lastHit = hit;
            }
            for (const move of MOVES)
                pollMove(move, runtime.get(move.name), pawn, controller, hit, now);
            errors = 0;
        }
        catch (e) {
            log(() => "poll threw: " + e);
            if (++errors >= MAX_ERRORS) {
                // a class or function is gone after a game update: stop for good and leave the game as it is
                clearInterval(run.timer);
                run.timer = undefined;
                warn("stopped after " + MAX_ERRORS + " failed polls in a row (a game update?); the game plays as"
                    + " normal. Last error: " + e);
            }
        }
    }

    log(() => "started: moves " + MOVES.map((move) => move.name).join(", "));
    run.timer = setInterval(tick, POLL_MS);
    console.log(`[PBZMOD] [${MOD_NAME}] ${MOD_VERSION} started; settings: ${settingsFile()}` + (menu.on ? " (Mods Menu's page)" : ""));
}
catch (e) {
    console.warn(`[${MOD_NAME}] not started: ${e}`);
    throw e;
}

// 2.0: PBZModLoader calls stop() before a reload (Alt+F5). The mod changes nothing that lasts, so it only ends its timer.
exports.stop = function () {
    run.stopped = true;
    if (run.timer !== undefined)
        clearInterval(run.timer);
    run.timer = undefined;
    console.log(`[PBZMOD] [${MOD_NAME}] stopped`);
};
