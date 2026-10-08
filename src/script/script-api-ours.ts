// OUR functions — what the editor's extension and its mod add to the game's Lua.
//
// Not the game's. Most exist because `bin/homm5-editor.dll` is loaded and adds
// them to the table the engine hands Lua (native/lua/registry.c,
// `add_map_function` and the battle's own table); a few are plain Lua the mod
// puts into its copy of `scripts/advmap-common.lua` (src/mods/artifact-scripts.ts).
// A map played without the extension finds every one of them nil, which is why
// a script that may run without it checks first: `if H5EHireScreen ~= nil then`.
//
// THIS LIST IS CHECKED, not trusted. tools/test-our-api.ts reads every name the
// DLL registers out of native/ and every function the mod's scripts define out
// of src/mods/, and fails on a name here that nothing defines (a write-up that
// outlived its function) and on a name defined there that is not here (a
// function nobody can find). `context` is checked the same way: a battle
// function written up as a map one would complete in the wrong editor.
//
// The same entries drive the editor's completion and its "did you mean" lint
// (src/script/script-api.json), docs/SCRIPT_API.md and the generated page
// docs/api/functions.md — `npm run build-api`.
//
// HOW THEY ANSWER. A registered function answers with one value or with
// NOTHING, and nothing reads as nil. Our functions use that on purpose: "1 or
// nothing" for a yes/no, and nothing — never a made-up zero — when the question
// could not be asked (no such hero, no screen up). A script tests `~= nil`.

import type { ApiDoc } from './script-api-curated.ts';

const HIRING = 'Ours · Hiring';
const CREATURES = 'Ours · Creatures';
const HEROES = 'Ours · Heroes and spells';
const WINDOWS = 'Ours · Windows';
const SETS = 'Ours · Artifact sets';
const BATTLE = 'Ours · Battle';
const PLUMBING = 'Ours · Plumbing';

export const OURS: ApiDoc[] = [
  // --- hiring ----------------------------------------------------------------
  {
    name: 'H5EHireScreen', category: HIRING, source: 'extension', context: 'map',
    summary: "Open the game's own hire screen over a list of the script's, at the script's prices.",
    params: [
      { name: 'options…', type: 'string', desc: 'Any argument that is a string is an option, wherever it stands: "bought=<function>" (required), "tag=<text>", "hero=<name>", "object=<name>", "notabs" — see the notes.' },
      { name: 'creature', type: 'CREATURE_*', desc: 'A line of the list: the creature on offer. 0 skips the line.' },
      { name: 'count', type: 'number', desc: 'How many of it are on offer.' },
      { name: 'price', type: 'number', desc: "Its price in percent of the creature's own cost, every resource alike: 100 ordinary, 50 half, 0 free.", optional: true, default: '100' },
    ],
    example: 'H5EHireScreen("bought=CampBought", "tag=" .. town, CREATURE_PEASANT, 20, 100, CREATURE_ARCHER, 10, 50);',
    notes: 'Lines are THREE numbers each and are read until they run out; the screen keeps '
      + "the list's order. OPTIONS: \"bought=<function>\" names the map function told of a "
      + 'purchase, as <function>(creature, count, tag) — the screen has already checked the '
      + 'stock, the room in the army and the money; the function pays (H5EHirePay), gives '
      + 'the creatures and writes down what is left (H5EHireLeft). "tag=<text>" comes back '
      + 'as that third argument word for word (no quotes or backslashes), so four towns '
      + 'share one function. Without "hero=" the TOWN SCREEN must be up and its town buys. '
      + '"hero=<name>" opens it on the ADVENTURE MAP for that hero (his army beside the '
      + 'offers) and then "object=<name>" is required: the object on the map that sells — '
      + 'the camp he walked into — as a dwelling sells on its own screen. "notabs" hides the '
      + 'three caravan tabs on the left. One screen of ours at a time; a call while one is '
      + 'up is refused. Every refusal is named in bin/homm5-editor-*.log.',
  },
  {
    name: 'H5EHirePay', category: HIRING, source: 'extension', context: 'map',
    summary: 'Take what that many cost on the open hire screen from the buying player.',
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'A creature of the open list.' },
      { name: 'count', type: 'number', desc: 'How many were bought.' },
    ],
    returns: '1 when paid (or when the line is free), 0 when the purse is short.',
    example: 'if H5EHirePay(creature, count) == 1 then AddHeroCreatures(hero, creature, count); end;',
    notes: 'Only inside the purchase event — the "bought=" function — because that is when '
      + 'there is a buyer. It charges exactly what the screen showed (H5EHireCost). A line '
      + 'the script gives away is simply not paid for.',
  },
  {
    name: 'H5EHireLeft', category: HIRING, source: 'extension', context: 'map',
    summary: 'Tell the open hire screen how many of a creature are left.',
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'A creature of the open list.' },
      { name: 'count', type: 'number', desc: 'What is left of it now.' },
    ],
    example: 'H5EHireLeft(creature, left);',
    notes: 'Said from the purchase event, it lands before the window reads its list again, '
      + "so the screen shows the script's number at once. A creature the list does not hold "
      + 'is ignored.',
  },
  {
    name: 'H5EHireCost', category: HIRING, source: 'extension', context: 'map',
    summary: 'What that many cost on the open hire screen, in one resource.',
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'A creature of the open list.' },
      { name: 'count', type: 'number', desc: 'How many.' },
      { name: 'resource', type: 'WOOD…GOLD', desc: 'Which resource.', optional: true, default: 'GOLD' },
    ],
    returns: 'The amount — the number the screen showed and checked; nothing for a creature the list does not hold.',
    example: 'local gold = H5EHireCost(creature, count);',
  },
  {
    name: 'H5EHireOpen', category: HIRING, source: 'extension', context: 'map',
    summary: 'Whether a hire screen of ours is the screen on screen.',
    params: [],
    returns: '1 while one is up, 0 otherwise.',
    example: 'while H5EHireOpen() == 1 do sleep(1); end;',
  },

  // --- creatures --------------------------------------------------------------
  {
    name: 'H5ECreatureCount', category: CREATURES, source: 'extension', context: 'map',
    summary: "How many creatures the game's table holds — the mod's own included — within the tiers asked.",
    params: [
      { name: 'minTier', type: 'number', desc: 'The lowest tier counted.', optional: true, default: '1' },
      { name: 'maxTier', type: 'number', desc: 'The highest tier counted.', optional: true, default: '7' },
    ],
    returns: 'The count; 0 when the filter leaves none.',
    example: 'local n = H5ECreatureCount(3, 6);',
    notes: 'With H5ECreatureAt this is a roll that needs no list kept up to date: '
      + 'H5ECreatureAt(random(n) + 1, 3, 6). A count and an index rather than one call '
      + "with many results, because a table built from one call's results keeps only the "
      + 'first of them in this Lua.',
  },
  {
    name: 'H5ECreatureAt', category: CREATURES, source: 'extension', context: 'map',
    summary: 'The id of the Nth creature within the tiers asked, in the table\'s own order.',
    params: [
      { name: 'n', type: 'number', desc: 'Which one — the first is 1.' },
      { name: 'minTier', type: 'number', desc: 'The lowest tier counted.', optional: true, default: '1' },
      { name: 'maxTier', type: 'number', desc: 'The highest tier counted.', optional: true, default: '7' },
    ],
    returns: 'A CREATURE_* number; nothing past the last.',
    example: 'local c = H5ECreatureAt(random(H5ECreatureCount(3, 6)) + 1, 3, 6);',
  },
  {
    name: 'H5ECreatureTier', category: CREATURES, source: 'extension', context: 'map',
    summary: "A creature's tier.",
    params: [{ name: 'creature', type: 'CREATURE_*', desc: 'The creature.' }],
    returns: '1 to 7; nothing for an id the table lacks.',
    example: 'if H5ECreatureTier(c) >= 5 then ... end;',
  },
  {
    name: 'H5ECreatureGrowth', category: CREATURES, source: 'extension', context: 'map',
    summary: 'What a week of a creature is — the number its dwelling stocks.',
    params: [{ name: 'creature', type: 'CREATURE_*', desc: 'The creature.' }],
    returns: 'Its weekly growth.',
    example: 'local week = H5ECreatureGrowth(CREATURE_ARCHER);',
  },
  {
    name: 'H5ECreatureCost', category: CREATURES, source: 'extension', context: 'map',
    summary: 'What one of a creature costs, in one resource.',
    params: [
      { name: 'creature', type: 'CREATURE_*', desc: 'The creature.' },
      { name: 'resource', type: 'number', desc: "The game's resource number; gold is 6.", optional: true, default: '6' },
    ],
    returns: 'The price of one.',
    example: 'local gold = H5ECreatureCost(CREATURE_ANGEL);',
  },
  {
    name: 'H5ECreatureTown', category: CREATURES, source: 'extension', context: 'map',
    summary: 'The race a creature belongs to.',
    params: [{ name: 'creature', type: 'CREATURE_*', desc: 'The creature.' }],
    returns: 'A TOWN_* number.',
    example: 'if H5ECreatureTown(c) == TOWN_NECROMANCY then ... end;',
  },

  // --- heroes and spells --------------------------------------------------------
  {
    name: 'H5EArmySlots', category: HEROES, source: 'extension', context: 'map',
    summary: "How many slots of a hero's army are taken.",
    params: [{ name: 'hero', type: 'name', desc: "The hero's script name." }],
    returns: 'The number of taken slots, 0 to 7; nil when there is no such hero or army.',
    example: 'if H5EArmySlots(hero) < 7 then AddHeroCreatures(hero, c, n); end;',
    notes: 'The engine keeps slot counting to itself — GetHeroCreatures counts creatures, '
      + 'not slots — and this asks the routine it counts with. Nil rather than a guess: a '
      + 'rule that read "no answer" as "plenty of room" is what this exists to end.',
  },
  {
    name: 'H5EHeroHasSpecialization', category: HEROES, source: 'extension', context: 'map',
    summary: 'Whether a hero holds this specialization.',
    params: [
      { name: 'hero', type: 'name', desc: "The hero's script name." },
      { name: 'spec', type: 'number', desc: 'The specialization value — the mod\'s own included.' },
    ],
    returns: '1 when he holds it; nothing when he does not, or when there is no such living hero.',
    example: 'if H5EHeroHasSpecialization(hero, 84) ~= nil then ... end;',
    notes: 'What lets a specialization of the mod GRANT something on the map rather than '
      + 'have it written into documents at build time. A value read that is not a '
      + 'specialization at all is refused, not compared.',
  },
  {
    name: 'H5ECanLearnSpell', category: HEROES, source: 'extension', context: 'map',
    summary: 'Whether a hero may learn a spell now — school, skill, mastery and level, as the game decides.',
    params: [
      { name: 'hero', type: 'name', desc: "The hero's script name." },
      { name: 'spell', type: 'SPELL_*', desc: 'The spell.' },
    ],
    returns: '1 when he may; nothing when he may not, or when there is no such hero or spell.',
    example: 'if H5ECanLearnSpell(hero, SPELL_MAGIC_ARROW) ~= nil then TeachHeroSpell(hero, SPELL_MAGIC_ARROW); end;',
  },
  {
    name: 'H5ECanHoldSpell', category: HEROES, source: 'extension', context: 'map',
    summary: 'The school half of H5ECanLearnSpell on its own: whether spells of that kind are for this hero at all.',
    params: [
      { name: 'hero', type: 'name', desc: "The hero's script name." },
      { name: 'spell', type: 'SPELL_*', desc: 'The spell.' },
    ],
    returns: '1 when his kind may hold it; nothing otherwise.',
    example: 'if H5ECanHoldSpell(hero, spell) == nil then -- refused for what he IS',
    notes: 'Tells a refusal for what the hero IS (a barbarian handed magic) from one for '
      + 'what he lacks yet (level, skill) — the first is worth paying for, the second is '
      + 'lost the way it is at a shrine.',
  },
  {
    name: 'H5EIsBarbarian', category: HEROES, source: 'extension', context: 'map',
    summary: 'Whether a hero is of the Horde.',
    params: [{ name: 'hero', type: 'name', desc: "The hero's script name." }],
    returns: '1 for a barbarian; nothing for anybody else.',
    example: 'if H5EIsBarbarian(hero) ~= nil then ... end;',
  },
  {
    name: 'H5EIsCastingHero', category: HEROES, source: 'extension', context: 'map',
    summary: 'Whether this hero is the one casting the adventure spell being decided now.',
    params: [{ name: 'hero', type: 'name', desc: "The hero's script name." }],
    returns: '1 when he is; nil when he is not, and nil when it cannot be told — read that as "not him".',
    example: 'if H5EIsCastingHero(hero) ~= nil then ... end;',
    notes: 'For the scripts behind adventure spells of the mod (the page that is live or '
      + 'greyed). Ask H5ECasterKnown first: nil from here can also mean nobody is casting.',
  },
  {
    name: 'H5ECasterKnown', category: HEROES, source: 'extension', context: 'map',
    summary: 'Whether the extension holds the hero whose adventure spell this is.',
    params: [],
    returns: '1 when it does; nothing when nobody is casting.',
    example: 'if H5ECasterKnown() ~= nil then ... end;',
    notes: 'Tells "I could not find him among the player\'s heroes" (refuse) from "nobody '
      + 'is casting" — falling back to any hero is how one hero\'s spell was once decided '
      + "by another hero's army.",
  },
  {
    name: 'H5EAnswer', category: HEROES, source: 'extension', context: 'map',
    summary: 'Say whether an adventure spell of the mod may be cast now.',
    params: [
      { name: 'spell', type: 'SPELL_*', desc: "The spell's number." },
      { name: 'verdict', type: 'number', desc: '1 (or anything but 0) for yes, 0 for no.' },
    ],
    example: 'H5EAnswer(spell, now);',
    notes: 'The engine was never built with the mod\'s spell numbers, so its own gate says '
      + 'no to them; the extension answers in its place with the last verdict the map gave. '
      + 'The same answer greys the spellbook page and refuses the click.',
  },
  {
    name: 'RestoreDarkEnergy', category: HEROES, source: 'extension', context: 'map',
    summary: "Fill a player's dark energy back up to its ceiling.",
    params: [{ name: 'player', type: 'PLAYER_*', desc: 'Whose pool to fill — 1 through 8.' }],
    example: 'RestoreDarkEnergy(PLAYER_1);',
    notes: 'The engine has no setter for the pool: it keeps a CEILING and fills to it '
      + 'weekly, so "restore" is asking the player to do that refill out of turn. Any '
      + 'ceiling our artifacts add is included, because the refill is one of the '
      + 'calculations the extension extends. A player number out of range is refused '
      + "in the engine's own words.",
  },

  // --- windows ------------------------------------------------------------------
  {
    name: 'H5EMessageBox', category: WINDOWS, source: 'extension', context: 'map',
    summary: 'A message box on whatever screen is up — a town screen included.',
    params: [
      { name: 'text', type: 'path | table', desc: 'The text, as MessageBox takes it: a path to a text file, or a table of the path and its values.' },
      { name: 'header', type: 'path | table', desc: 'A header above the text, the same way.', optional: true },
    ],
    example: 'H5EMessageBox("/Text/MyMod/camp_closed.txt");',
    notes: "The game's MessageBox queues its box for the ADVENTURE screen and shows it "
      + 'only when that screen runs again — after a town screen closes. This one goes '
      + 'straight onto the screen on top, the way the town screen\'s own boxes do. It does '
      + 'not wait for the player.',
  },
  {
    name: 'H5EAskCount', category: WINDOWS, source: 'extension', context: 'map',
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
    name: 'H5EAskedCount', category: WINDOWS, source: 'extension', context: 'map',
    summary: 'What the count slider was answered with, if it has been.',
    params: [],
    returns: 'Nothing while the window is open; the chosen number once OK is pressed; '
      + '-1 when it was closed without an answer.',
    example: 'local n = H5EAskedCount(); if n ~= nil then ... end;',
  },
  {
    name: 'ShowSliderDialog', category: WINDOWS, source: 'extension', context: 'map',
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

  // --- artifact sets --------------------------------------------------------------
  {
    name: 'EditorWornCount', category: SETS, source: 'extension', context: 'map',
    summary: 'How many of these artifacts the hero is WEARING.',
    params: [
      { name: 'hero', type: 'name', desc: "The hero's script name." },
      { name: 'members', type: 'table', desc: "Artifact ids — a set's `<Set>_MEMBERS` list." },
    ],
    returns: 'The count worn. A piece in the backpack does not count.',
    example: 'EditorWornCount(hero, H3UndeadKing_MEMBERS)',
    notes: "Plain Lua, defined in the mod's copy of scripts/advmap-common.lua rather "
      + "than in the extension. It leans on HasArtefact's third argument, which the "
      + 'manuals omit and which is what makes "worn" mean worn.',
  },
  {
    name: 'EditorHeroWearing', category: SETS, source: 'extension', context: 'map',
    summary: 'The first hero of a player wearing at least N of these artifacts.',
    params: [
      { name: 'player', type: 'PLAYER_*', desc: 'Whose heroes to look through.' },
      { name: 'members', type: 'table', desc: "Artifact ids — a set's `<Set>_MEMBERS` list." },
      { name: 'count', type: 'number', desc: 'How many have to be worn.' },
    ],
    returns: "The hero's name, or nil when none of them qualifies.",
    example: 'local hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);',
    notes: "The condition half of a set's script: what the set does is up to the "
      + 'script, whether that is one of ours or anything else the API offers.',
  },

  // --- battle ---------------------------------------------------------------------
  {
    name: 'H5ETentCharge', category: BATTLE, source: 'extension', context: 'combat',
    summary: 'Give the first aid tent one more use.',
    params: [],
    example: 'H5ETentCharge();',
    notes: 'The half of a perk the battle\'s Lua cannot do: no function of the game\'s '
      + 'touches the tent\'s charges. With no arguments it cannot be told WHOSE tent, so '
      + 'the use goes to the last one built — right when one side has a tent, the '
      + 'ordinary case. See docs/api/combat.md.',
  },
  {
    name: 'H5ECombatTest', category: BATTLE, source: 'extension', context: 'combat',
    summary: "Write one line to the extension's log — proof that a battle's script reaches the extension.",
    params: [],
    example: 'H5ECombatTest();',
    notes: 'The log line needs a build with `--log lua/registry`.',
  },

  // --- plumbing ---------------------------------------------------------------------
  {
    name: 'H5ELog', category: PLUMBING, source: 'extension', context: 'map',
    summary: "A number from a script, into the extension's log.",
    params: [{ name: 'value', type: 'number', desc: 'What to write down.' }],
    example: 'H5ELog(GetHeroLevel(hero));',
    notes: "print goes to the game's console, which is where a player looks; this lands in "
      + 'bin/homm5-editor-*.log beside everything else the extension says, so a script can '
      + 'measure the game and the measurement survives the session.',
  },
  {
    name: 'H5ENoSuchFunction', category: PLUMBING, source: 'extension', context: 'map',
    summary: 'The "else" of a line the extension says to the map — logs that the function it named is missing.',
    params: [],
    example: 'if CampBought ~= nil then CampBought(c, n, t); else H5ENoSuchFunction(); end;',
    notes: "For the extension's own use: every call it makes into the map's Lua (a town "
      + 'button, a purchase event) is guarded this way, so a function the map lacks is a '
      + 'line in the log rather than nothing at all.',
  },
  {
    name: 'H5ETownButtons', category: PLUMBING, source: 'extension', context: 'map',
    summary: "How many town buttons the extension's file lists — and the map introduces itself.",
    params: [],
    returns: 'The number of buttons in bin/homm5-editor-buildings.txt.',
    example: 'H5ETownButtons();',
    notes: 'A button\'s click has no Lua context of its own; calling this hands the '
      + 'extension the map. The extension now also takes the map from the script '
      + "scheduler's tick, so a map does not have to call it.",
  },
  {
    name: 'H5EMapIsPlaying', category: PLUMBING, source: 'extension', context: 'map',
    summary: 'Tell the extension the map is being played, not set up.',
    params: [],
    example: 'H5EMapIsPlaying();',
    notes: "For the extension's own use: a line put into every map starts a thread that "
      + 'calls this once it gets past its first sleep, which only happens once the game is '
      + "running — so a spell a map's start-up script hands out is not announced.",
  },
  {
    name: 'H5EAnnounceGain', category: PLUMBING, source: 'extension', context: 'map',
    summary: 'Ask for the next gain a hero receives to be announced on screen.',
    params: [],
    example: 'H5EAnnounceGain(); TeachHeroSpell(hero, spell);',
    notes: 'One announcement per call, counted: a box with three spells asks three times, '
      + 'because the grants are deferred and run after the asks. Nothing else in the game '
      + 'is announced — a script that never asks never notices the extension.',
  },
  {
    name: 'EditorTest', category: PLUMBING, source: 'extension', context: 'map',
    summary: "Write one line to the extension's log — proof that the map's Lua reaches the extension.",
    params: [],
    example: 'EditorTest();',
    notes: '"The extension is loaded" and "the game\'s Lua can reach it" are different '
      + 'claims; only the second explains why a script does nothing.',
  },
];
