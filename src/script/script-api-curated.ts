// Our own API reference — written by hand, and the source of truth for it.
//
// The manuals the game ships are the only published list, but they are crooked:
// pdftotext mangles them, the section names are inconsistent, and we are not free
// to redistribute their prose. So this is the reference we WRITE, in our own
// words, and grow as we work through missions — whatever a real script calls gets
// documented here, with a description, typed arguments and an example, so nobody
// has to open the PDF again.
//
// This drives the editor's completion (its `summary` shows in the popup) AND the
// readable `docs/SCRIPT_API.md`. It is merged with the PDF extraction
// (`src/script-api-extracted.json`): a function documented here wins; one only in
// the extraction still completes, as a bare signature, until someone writes it up.
//
// To add one: find it in a mission, read what it does, and add an entry below.
// `source: 'observed'` marks a call the manuals never documented (learned from a
// script); `since` is the mission we first wrote it up from.

/** One parameter of a call, as we document it. */
export interface ApiParam {
  name: string;
  /** Our type note: `string`, `number`, an enum family (`OBJECTIVE_*`), `name`. */
  type: string;
  desc: string;
  /** Has a default in the signature, so it may be omitted. */
  optional?: boolean;
  /** The default the engine uses when omitted. */
  default?: string;
}

/** One function, documented by us. */
export interface ApiDoc {
  name: string;
  /** Our own clean grouping (not the manual's inconsistent sections). */
  category: string;
  /** One line: what it does. Our words. */
  summary: string;
  params: ApiParam[];
  /** What it returns, when it returns something. */
  returns?: string;
  /** A real call, ideally from a shipped mission. */
  example?: string;
  /** `manual` — documented in the shipped PDF; `observed` — undocumented, learned
   *  from a script the campaigns ship; `extension` — OURS, and only there when
   *  the native extension is installed (src/artifact-scripts.ts). */
  source: 'manual' | 'observed' | 'extension';
  /** The mission we first wrote this up from, for provenance. */
  since?: string;
  notes?: string;
}

/** The reference. Alphabetical within nothing in particular — grouped by category
 *  when rendered. Grows per mission. */
export const CURATED: ApiDoc[] = [
  // --- Ours, from the extension --------------------------------------------
  //
  // Not the game's. These exist because `bin/homm5-editor.dll` is loaded and
  // adds them to the table the engine hands Lua — a map that runs without the
  // extension will find them nil, which is why a script that calls one should
  // check it is there first. See
  // docs/engineInternals/LUA.md for how they are registered.
  {
    name: 'RestoreDarkEnergy', category: 'Ours', source: 'extension',
    summary: "Fill a player's dark energy back up to its ceiling.",
    params: [{ name: 'player', type: 'PLAYER_*', desc: 'Whose pool to fill — 1 through 8.' }],
    example: 'RestoreDarkEnergy(PLAYER_1);',
    notes: 'The engine has no setter for the pool: it keeps a CEILING and fills to it '
      + 'weekly, so "restore" is asking the player to do that refill out of turn. Any '
      + 'ceiling our artifacts add is included, because the refill is one of the '
      + 'calculations the extension extends. A player number out of range is refused '
      + "in the engine's own words.",
  },
  {
    name: 'ShowSliderDialog', category: 'Ours', source: 'extension',
    summary: 'Ask the player how many creatures to turn into another kind, and wait.',
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'What the player is counting.' },
      { name: 'becomes', type: 'CREATURE_*', desc: 'What they turn into.' },
      { name: 'most', type: 'number', desc: 'The largest number the slider will reach.' },
    ],
    returns: 'The number the player chose, from 1 to `most`, or -1 if they closed it.',
    example: 'local n = ShowSliderDialog(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);',
    notes: 'Plain Lua, defined in the mod\'s copy of scripts/advmap-common.lua, over the '
      + 'extension\'s H5EAskCount and H5EAskedCount. THE WAITING IS THE WRAPPER\'S: a '
      + 'registered function\'s results are counted the moment it returns, so the one '
      + 'that opens the window cannot answer with a number that does not exist yet. '
      + 'Without the extension it answers -1 rather than hanging. The slider starts at '
      + '`most` and never reaches nought — that is what Cancel is for. The window draws '
      + 'the FIRST creature on both sides today: the engine asks its controller once '
      + 'and uses the one answer for both icons, so showing what they become means '
      + 'filling the second icon ourselves.',
  },
  {
    name: 'H5EHeroSpecialization', category: 'Ours', source: 'extension',
    summary: 'Which specialization this hero holds, as its number.',
    params: [{ name: 'hero', type: 'name', desc: "The hero's script name." }],
    returns: 'The value of his specialization; nothing when there is no such living hero.',
    example: 'if H5EHeroSpecialization(hero) == 84 then ... end;',
    notes: 'NOTHING, not zero, on every path it cannot serve — zero is HERO_SPEC_NONE, a '
      + 'real answer, and a script that could not tell it from "he was not found" would '
      + 'act on the wrong heroes exactly on the run where the lookup broke. The hero is '
      + "reached the way GetHeroLevel reaches one, and the value is the hero's own field. "
      + 'This is what lets a specialization of the mod GRANT something on the map rather '
      + 'than have it written into documents at build time.',
  },
  {
    name: 'H5EAskCount', category: 'Ours', source: 'extension',
    summary: "Put up the game's own count slider. Answers nothing — see ShowSliderDialog.",
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'What the player is counting.' },
      { name: 'becomes', type: 'CREATURE_*', desc: 'What they turn into.' },
      { name: 'most', type: 'number', desc: 'The largest number the slider will reach.' },
    ],
    example: 'H5EAskCount(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);',
    notes: 'The window is the engine\'s own split slider (CSplitStack) driven by a '
      + 'controller of ours, so it has the game\'s frame, slider and buttons, and it '
      + 'goes on whichever screen the player is looking at. The picture is made from '
      + 'the creature NUMBER, the way the engine makes it from a stack. A second window '
      + 'while one is open is refused: there is one answer to collect. Prefer '
      + 'ShowSliderDialog, which waits.',
  },
  {
    name: 'H5EAskedCount', category: 'Ours', source: 'extension',
    summary: 'What the count slider was answered with, if it has been.',
    params: [],
    returns: 'Nothing while the window is open; the chosen number once OK is pressed; '
      + '-1 when it was closed without an answer.',
    example: 'local n = H5EAskedCount(); if n ~= nil then ... end;',
  },
  {
    name: 'EditorWornCount', category: 'Ours', source: 'extension',
    summary: 'How many of these artifacts the hero is WEARING.',
    params: [
      { name: "hero", type: "name", desc: "The hero's script name." },
      { name: "members", type: "table", desc: "Artifact ids — a set's `<Set>_MEMBERS` list." },
    ],
    returns: 'The count worn. A piece in the backpack does not count.',
    example: 'EditorWornCount(hero, H3UndeadKing_MEMBERS)',
    notes: "Plain Lua, defined in the mod's copy of scripts/advmap-common.lua rather "
      + "than in the extension. It leans on HasArtefact's third argument, which the "
      + 'manuals omit and which is what makes "worn" mean worn.',
  },
  {
    name: 'EditorHeroWearing', category: 'Ours', source: 'extension',
    summary: 'The first hero of a player wearing at least N of these artifacts.',
    params: [
      { name: 'player', type: 'PLAYER_*', desc: 'Whose heroes to look through.' },
      { name: "members", type: "table", desc: "Artifact ids — a set's `<Set>_MEMBERS` list." },
      { name: 'count', type: 'number', desc: 'How many have to be worn.' },
    ],
    returns: "The hero's name, or nil when none of them qualifies.",
    example: 'local hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);',
    notes: "The condition half of a set's script: what the set does is up to the "
      + 'script, whether that is one of ours or anything else the API offers.',
  },

  // --- Objectives ----------------------------------------------------------
  {
    name: 'SetObjectiveState', category: 'Objectives', source: 'manual', since: 'C1M1',
    summary: "Change a quest objective's state (active, completed, failed).",
    params: [
      { name: 'objectiveName', type: 'name', desc: "The objective's handle, as named in the map tree under Objectives (e.g. \"prim1\")." },
      { name: 'state', type: 'OBJECTIVE_*', desc: 'OBJECTIVE_ACTIVE, OBJECTIVE_COMPLETED, OBJECTIVE_FAILED, or OBJECTIVE_UNKNOWN (hidden).' },
      { name: 'playerID', type: 'PLAYER_*', desc: 'Whose quest log to change.', optional: true, default: 'PLAYER_1' },
    ],
    example: 'SetObjectiveState("prim1", OBJECTIVE_ACTIVE);',
  },
  {
    name: 'GetObjectiveState', category: 'Objectives', source: 'manual', since: 'C1M1',
    summary: "Read a quest objective's current state.",
    params: [
      { name: 'objectiveName', type: 'name', desc: "The objective's handle." },
      { name: 'playerID', type: 'PLAYER_*', desc: 'Whose quest log to read.', optional: true, default: 'PLAYER_1' },
    ],
    returns: 'The OBJECTIVE_* state, or OBJECTIVE_UNKNOWN if never set.',
    example: 'if GetObjectiveState("prim2") == OBJECTIVE_UNKNOWN then SetObjectiveState("prim2", OBJECTIVE_ACTIVE); end;',
  },

  // --- Triggers ------------------------------------------------------------
  {
    name: 'Trigger', category: 'Triggers', source: 'manual', since: 'C1M1',
    summary: 'Bind (or clear) a handler for a world event. Pass nil as the function to unbind.',
    params: [
      { name: 'triggerType', type: '*_TRIGGER', desc: 'Which event: REGION_ENTER_AND_STOP_TRIGGER, OBJECT_TOUCH_TRIGGER, OBJECT_CAPTURE_TRIGGER, HERO_LEVELUP_TRIGGER, PLAYER_REMOVE_HERO_TRIGGER, …' },
      { name: 'target', type: 'name | enum', desc: 'What to watch — a region or object name, or a player id, depending on the trigger type.' },
      { name: 'functionName', type: 'string | nil', desc: 'Name of the Lua function to call, as a string; nil removes the handler.' },
    ],
    example: 'Trigger(REGION_ENTER_AND_STOP_TRIGGER, "d2", "Dialog2");',
    notes: 'The handler is named by STRING, not passed as a value, and the engine calls it when the event fires. '
      + 'There are SEVENTEEN types and no more — the engine decides on one `cmp ebx,10h` at 0x5f27cb — and the game\'s '
      + 'own scripts declare sixteen of them: type 10 is real, undeclared, and a TOWN trigger (it refuses an object '
      + 'that is not a town). None of the seventeen is "a battle is starting"; COMBAT_RESULTS_TRIGGER fires afterwards. '
      + 'Handlers STACK rather than replace, so one set from a mod\'s advmap-common.lua survives a map setting its own.',
  },

  // --- Objects on the map --------------------------------------------------
  {
    name: 'SetObjectEnabled', category: 'Objects', source: 'manual', since: 'C1M1',
    summary: 'Show or hide a placed object (a disabled object is not on the map for the player).',
    params: [
      { name: 'objectName', type: 'name', desc: "The object's Name handle." },
      { name: 'enable', type: 'number | nil', desc: '1 to show, nil (or 0) to hide.' },
    ],
    example: "SetObjectEnabled('zastava', 1);",
  },
  {
    name: 'RemoveObject', category: 'Objects', source: 'manual', since: 'C1M1',
    summary: 'Remove a placed object from the map for good.',
    params: [{ name: 'objectName', type: 'name', desc: "The object's Name handle." }],
    example: 'RemoveObject("enemy1");',
  },
  {
    name: 'IsObjectExists', category: 'Objects', source: 'manual', since: 'C1M1',
    summary: 'Whether a named object is still on the map.',
    params: [{ name: 'objectName', type: 'name', desc: "The object's Name handle." }],
    returns: 'Non-nil if the object exists, nil otherwise.',
    example: "if IsObjectExists('swordsman') then Trigger(OBJECT_TOUCH_TRIGGER, \"swordsman\", nil); end;",
  },
  {
    name: 'GetObjectPosition', category: 'Objects', source: 'manual', since: 'C1M1',
    summary: "Find an object's position on the map.",
    params: [{ name: 'objectName', type: 'name', desc: "The object's (or hero's) Name handle." }],
    returns: 'Three values: x, y, floor.',
    example: "x, y, fl = GetObjectPosition('zastava');",
  },

  // --- Heroes --------------------------------------------------------------
  {
    name: 'GetHeroCreatures', category: 'Heroes', source: 'manual', since: 'C1M1',
    summary: "Count how many of a creature are in a hero's army.",
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'creatureID', type: 'CREATURE_*', desc: 'Which creature, e.g. CREATURE_FOOTMAN.' },
    ],
    returns: 'The number of that creature the hero has (0 if none).',
    example: 'nFootman = GetHeroCreatures(HERO_NAME, CREATURE_FOOTMAN);',
  },
  {
    name: 'GetHeroCreaturesTypes', category: 'Heroes', source: 'manual',
    summary: "Which creatures a hero's army holds, slot by slot.",
    params: [{ name: 'heroName', type: 'name', desc: "The hero's Name handle." }],
    returns:
      'SEVEN separate numbers, not a table: the distinct creature ids in slot order, '
      + 'padded with zeroes. A hero with two stacks of archers and one of marksmen '
      + 'answers CREATURE_ARCHER, CREATURE_MARKSMAN, 0, 0, 0, 0, 0.',
    example: 'local a, b, c, d, e, f, g = GetHeroCreaturesTypes(HERO_NAME);',
    notes:
      'The name says "types", and every instinct says table — but `for kind in '
      + 'GetHeroCreaturesTypes(h)` dies with "`for\' table must be a table", and this '
      + 'game has no `type` to ask with. Read from the executable instead: it pushes '
      + 'seven numbers and returns 7. Collect them into a table yourself if you want '
      + 'to walk them.',
  },
  {
    name: 'AddHeroCreatures', category: 'Heroes', source: 'manual',
    summary: "Put creatures into a hero's army.",
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'creatureID', type: 'CREATURE_*', desc: 'Which creature to add.' },
      { name: 'quantity', type: 'number', desc: 'How many. Must be positive.' },
    ],
    example: 'AddHeroCreatures(HERO_NAME, CREATURE_ARCHER, 20);',
    notes:
      'IT DOES NOT HAPPEN YET. Like its Remove twin it builds a command and hands '
      + 'it to the world to run later, while GetHeroCreatures reads the army itself '
      + '— so counting straight after an add counts the army as it was. `sleep` '
      + 'until the count changes before doing anything that depends on it.',
  },
  {
    name: 'RemoveHeroCreatures', category: 'Heroes', source: 'manual',
    summary: "Take creatures out of a hero's army.",
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'creatureID', type: 'CREATURE_*', desc: 'Which creature to take.' },
      { name: 'quantity', type: 'number', desc: 'How many. Asking for more than he has takes all he has.' },
    ],
    example: 'RemoveHeroCreatures(HERO_NAME, CREATURE_ARCHER, 20);',
    notes:
      'IT LEAVES ONE BEHIND rather than empty a hero. When the creature asked for '
      + 'occupies every slot he has, the engine quietly removes one less — a hero '
      + 'whose only stack is twenty archers keeps one archer, and says nothing. '
      + 'To replace a whole army: add the new creature, `sleep` until it is really '
      + 'there, and only then remove. Both halves matter — this call decides how '
      + 'many to take WHEN IT IS MADE, not when the world gets round to running it, '
      + 'so an add queued a line earlier has not happened yet and counts for nothing.',
  },
  {
    name: 'GetHeroStat', category: 'Heroes', source: 'manual', since: 'C1M1',
    summary: 'Read one of a hero\'s stats.',
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'statID', type: 'STAT_*', desc: 'Which stat, e.g. STAT_MOVE_POINTS.' },
    ],
    returns: 'The stat value.',
    example: 'local ap = GetHeroStat("Isabell", STAT_MOVE_POINTS);',
  },
  {
    name: 'GiveExp', category: 'Heroes', source: 'observed', since: 'C1M1',
    summary: 'Grant experience points to a hero.',
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'amount', type: 'number', desc: 'Experience to add.' },
    ],
    example: "GiveExp('Isabell', 500);",
    notes: 'Not in the shipped manuals — an engine built-in the campaigns use. The editor cannot complete it; type it by hand.',
  },
  {
    name: 'IsHeroAlive', category: 'Heroes', source: 'manual',
    summary: 'Whether a hero is still alive.',
    params: [{ name: 'heroName', type: 'name', desc: "The hero's Name handle." }],
    returns: 'Non-nil if alive, nil otherwise.',
    example: 'if IsHeroAlive("Isabell") == nil then Loose(); end;',
  },
  {
    name: 'SetHeroCombatScript', category: 'Heroes', source: 'manual', since: 'C1M1',
    summary: 'Attach a combat script to a hero, run when that hero fights.',
    params: [
      { name: 'heroName', type: 'name', desc: "The hero's Name handle." },
      { name: 'scriptName', type: 'ref', desc: "The combat script wrapper's xpointer, e.g. \"/Maps/…/IsabellScript.xdb#xpointer(/Script)\"." },
    ],
    example: "SetHeroCombatScript('Isabell', '/Maps/Scenario/C1M1/IsabellScript.xdb#xpointer(/Script)');",
  },

  // --- Players -------------------------------------------------------------
  {
    name: 'SetPlayerResource', category: 'Players', source: 'manual', since: 'C1M1',
    summary: "Set the amount of one of a player's resources.",
    params: [
      { name: 'player', type: 'PLAYER_*', desc: 'Which player.' },
      { name: 'resourceKind', type: 'resource', desc: 'WOOD, ORE, MERCURY, CRYSTAL, SULFUR, GEM, or GOLD.' },
      { name: 'quantity', type: 'number', desc: 'The new amount (absolute, not a delta).' },
    ],
    example: 'SetPlayerResource(PLAYER_1, GOLD, 0);',
  },

  // --- Fog of war ----------------------------------------------------------
  {
    name: 'OpenCircleFog', category: 'Fog of war', source: 'manual', since: 'C1M1',
    summary: 'Reveal the fog of war within a circle for a player.',
    params: [
      { name: 'x', type: 'number', desc: 'Centre tile x.' },
      { name: 'y', type: 'number', desc: 'Centre tile y.' },
      { name: 'floorID', type: 'number', desc: 'Floor (0 surface, 1 underground).' },
      { name: 'range', type: 'number', desc: 'Radius in tiles.' },
      { name: 'playerID', type: 'PLAYER_*', desc: 'Whose fog to lift.' },
    ],
    example: 'OpenCircleFog(x, y, fl, 4, PLAYER_1);',
  },

  // --- Dialog & combat -----------------------------------------------------
  {
    name: 'StartDialogScene', category: 'Dialog', source: 'manual', since: 'C1M1',
    summary: 'Play a dialogue cutscene, optionally calling back when it ends.',
    params: [
      { name: 'dialogSceneName', type: 'ref', desc: "The scene's xpointer, \"/DialogScenes/…/DialogScene.xdb#xpointer(/DialogScene)\"." },
      { name: 'callback', type: 'string', desc: 'Name of a function to call when the scene finishes.', optional: true, default: '""' },
      { name: 'saveName', type: 'string', desc: 'Autosave name to make before the scene.', optional: true, default: '""' },
    ],
    example: 'StartDialogScene("/DialogScenes/C1/M1/D1/DialogScene.xdb#xpointer(/DialogScene)");',
  },
  {
    name: 'StartCombat', category: 'Combat', source: 'manual', since: 'C1M1',
    summary: 'Start a scripted battle against a hero or a stack of creatures.',
    params: [
      { name: 'heroName', type: 'name', desc: 'The attacking hero.' },
      { name: 'enemyHeroName', type: 'name | nil', desc: 'The defending hero, or nil to fight creatures only.' },
      { name: 'creaturesCount', type: 'number', desc: 'How many creature stacks follow.' },
      { name: 'creatureType/Amount…', type: 'CREATURE_*, number', desc: 'A creatureType, creatureAmount pair per stack, repeated creaturesCount times.' },
      { name: 'combatScriptName', type: 'ref', desc: "The combat script's xpointer, or nil." },
      { name: 'combatFinishTrigger', type: 'string', desc: 'Name of a function to call when the battle ends.' },
      { name: 'arenaName', type: 'ref', desc: 'The arena to fight on ("" for the default).', optional: true, default: '""' },
      { name: 'allowQuickCombat', type: 'boolean', desc: 'Whether quick combat is allowed.', optional: true },
    ],
    example: 'StartCombat("Isabell", nil, 1, CREATURE_PEASANT, 13, \'/Maps/…/C1M1-CombatScript.xdb#xpointer(/Script)\', \'AfterCombat\');',
    notes: 'A variadic call: creatureType[i], creatureAmount[i] repeat creaturesCount times between the count and the script.',
  },
  {
    name: 'SetControlMode', category: 'Combat', source: 'manual', since: 'C1M1',
    summary: "Set a combat side's control to manual or automatic.",
    params: [
      { name: 'side', type: 'ATTACKER | DEFENDER', desc: 'Which side.' },
      { name: 'mode', type: 'MODE_*', desc: 'MODE_MANUAL or MODE_AUTO.' },
    ],
    example: 'SetControlMode(ATTACKER, MODE_MANUAL);',
    notes: 'Used from a combat script; the side must be human-controlled.',
  },

  // --- Flow control & vars -------------------------------------------------
  {
    name: 'startThread', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'Run a function concurrently, as its own thread.',
    params: [{ name: 'func', type: 'function', desc: 'The function to run (passed by value, not by name).' }],
    example: 'startThread(PObjective1);',
    notes: 'Long-running loops (objective checks, tutorial watchers) run in threads so the main script does not block. See startThreadOnce for a guarded version.',
  },
  {
    name: 'sleep', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'Pause the current thread for a number of turn segments.',
    params: [{ name: 'segments', type: 'number', desc: 'How long to wait.' }],
    example: 'sleep(5);',
  },
  {
    name: 'SetGameVar', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'Store a persistent script variable (survives save/load).',
    params: [
      { name: 'name', type: 'string', desc: 'The variable name, e.g. "temp.tutorial".' },
      { name: 'value', type: 'any', desc: 'The value to store.' },
    ],
    example: 'SetGameVar("temp.tutorial", 1);',
  },
  {
    name: 'GetGameVar', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'Read a persistent script variable, with a default if unset.',
    params: [
      { name: 'name', type: 'string', desc: 'The variable name.' },
      { name: 'default', type: 'any', desc: 'Returned when the variable is unset.', optional: true },
    ],
    returns: 'The stored value, or the default.',
    example: "if GetGameVar( \"temp.C1M1.num_combat\", 0 ) == '0' then … end;",
  },
  {
    name: 'MessageBox', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'Show a text popup to the player.',
    params: [{ name: 'textRef', type: 'ref', desc: 'A text file reference, e.g. "/Maps/…/notready.txt".' }],
    example: "MessageBox('/Maps/Scenario/C1M1/notready.txt');",
  },
  {
    name: 'Win', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'End the mission as a victory for the human player.',
    params: [],
    example: 'Win();',
  },
  {
    name: 'Loose', category: 'Flow', source: 'manual', since: 'C1M1',
    summary: 'End the mission as a defeat for the human player.',
    params: [],
    example: 'Loose();',
    notes: 'Spelled "Loose" in the engine, not "Lose".',
  },
];
