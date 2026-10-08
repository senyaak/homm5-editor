# Our functions

**Generated** by `npm run build-api` from `src/script/script-api-ours.ts` — do not
edit by hand; write the function up there and re-run.

Every function the editor's extension (`bin/homm5-editor.dll`) and its mod add to
the game's Lua. A map played without the extension finds each of them nil, so a
script that may run without it checks first: `if H5EHireScreen ~= nil then`.

**How they answer.** One value or nothing, and nothing reads as nil: "1 or
nothing" for a yes/no, and nothing — never a made-up zero — when the question
could not be asked (no such hero, no screen up). Test with `~= nil`. Every
refusal is named in `bin/homm5-editor-*.log`.

**Where.** The adventure map's Lua and a battle's share no functions: a battle
function is nil on the map and the other way round. Each entry says which.

34 functions:

- [Hiring](#hiring) — `H5EHireScreen`, `H5EHirePay`, `H5EHireLeft`, `H5EHireCost`, `H5EHireOpen`
- [Creatures](#creatures) — `H5ECreatureCount`, `H5ECreatureAt`, `H5ECreatureTier`, `H5ECreatureGrowth`, `H5ECreatureCost`, `H5ECreatureTown`
- [Heroes and spells](#heroes-and-spells) — `H5EArmySlots`, `H5EHeroHasSpecialization`, `H5ECanLearnSpell`, `H5ECanHoldSpell`, `H5EIsBarbarian`, `H5EIsCastingHero`, `H5ECasterKnown`, `H5EAnswer`, `RestoreDarkEnergy`
- [Windows](#windows) — `H5EMessageBox`, `H5EAskCount`, `H5EAskedCount`, `ShowSliderDialog`
- [Artifact sets](#artifact-sets) — `EditorWornCount`, `EditorHeroWearing`
- [Battle](#battle) — `H5ETentCharge`, `H5ECombatTest`
- [Plumbing](#plumbing) — `H5ELog`, `H5ENoSuchFunction`, `H5ETownButtons`, `H5EMapIsPlaying`, `H5EAnnounceGain`, `EditorTest`

## Hiring

### `H5EHireScreen(options…, creature, count, price = 100)`

Open the game's own hire screen over a list of the script's, at the script's prices. · *map script*

| param | type | meaning |
|---|---|---|
| `options…` | string | Any argument that is a string is an option, wherever it stands: "bought=<function>" (required), "tag=<text>", "hero=<name>", "object=<name>", "notabs" — see the notes. |
| `creature` | CREATURE_* | A line of the list: the creature on offer. 0 skips the line. |
| `count` | number | How many of it are on offer. |
| `price` | number | Its price in percent of the creature's own cost, every resource alike: 100 ordinary, 50 half, 0 free. _(optional, default 100)_ |

```lua
H5EHireScreen("bought=CampBought", "tag=" .. town, CREATURE_PEASANT, 20, 100, CREATURE_ARCHER, 10, 50);
```

> Lines are THREE numbers each and are read until they run out; the screen keeps the list's order. OPTIONS: "bought=<function>" names the map function told of a purchase, as <function>(creature, count, tag) — the screen has already checked the stock, the room in the army and the money; the function pays (H5EHirePay), gives the creatures and writes down what is left (H5EHireLeft). "tag=<text>" comes back as that third argument word for word (no quotes or backslashes), so four towns share one function. Without "hero=" the TOWN SCREEN must be up and its town buys. "hero=<name>" opens it on the ADVENTURE MAP for that hero (his army beside the offers) and then "object=<name>" is required: the object on the map that sells — the camp he walked into — as a dwelling sells on its own screen. "notabs" hides the three caravan tabs on the left. One screen of ours at a time; a call while one is up is refused. Every refusal is named in bin/homm5-editor-*.log.

### `H5EHirePay(creature, count)`

Take what that many cost on the open hire screen from the buying player. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | How many were bought. |

**Returns:** 1 when paid (or when the line is free), 0 when the purse is short.

```lua
if H5EHirePay(creature, count) == 1 then AddHeroCreatures(hero, creature, count); end;
```

> Only inside the purchase event — the "bought=" function — because that is when there is a buyer. It charges exactly what the screen showed (H5EHireCost). A line the script gives away is simply not paid for.

### `H5EHireLeft(creature, count)`

Tell the open hire screen how many of a creature are left. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | What is left of it now. |

```lua
H5EHireLeft(creature, left);
```

> Said from the purchase event, it lands before the window reads its list again, so the screen shows the script's number at once. A creature the list does not hold is ignored.

### `H5EHireCost(creature, count, resource = GOLD)`

What that many cost on the open hire screen, in one resource. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | How many. |
| `resource` | WOOD…GOLD | Which resource. _(optional, default GOLD)_ |

**Returns:** The amount — the number the screen showed and checked; nothing for a creature the list does not hold.

```lua
local gold = H5EHireCost(creature, count);
```

### `H5EHireOpen()`

Whether a hire screen of ours is the screen on screen. · *map script*

**Returns:** 1 while one is up, 0 otherwise.

```lua
while H5EHireOpen() == 1 do sleep(1); end;
```

## Creatures

### `H5ECreatureCount(minTier = 1, maxTier = 7)`

How many creatures the game's table holds — the mod's own included — within the tiers asked. · *map script*

| param | type | meaning |
|---|---|---|
| `minTier` | number | The lowest tier counted. _(optional, default 1)_ |
| `maxTier` | number | The highest tier counted. _(optional, default 7)_ |

**Returns:** The count; 0 when the filter leaves none.

```lua
local n = H5ECreatureCount(3, 6);
```

> With H5ECreatureAt this is a roll that needs no list kept up to date: H5ECreatureAt(random(n) + 1, 3, 6). A count and an index rather than one call with many results, because a table built from one call's results keeps only the first of them in this Lua.

### `H5ECreatureAt(n, minTier = 1, maxTier = 7)`

The id of the Nth creature within the tiers asked, in the table's own order. · *map script*

| param | type | meaning |
|---|---|---|
| `n` | number | Which one — the first is 1. |
| `minTier` | number | The lowest tier counted. _(optional, default 1)_ |
| `maxTier` | number | The highest tier counted. _(optional, default 7)_ |

**Returns:** A CREATURE_* number; nothing past the last.

```lua
local c = H5ECreatureAt(random(H5ECreatureCount(3, 6)) + 1, 3, 6);
```

### `H5ECreatureTier(creature)`

A creature's tier. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** 1 to 7; nothing for an id the table lacks.

```lua
if H5ECreatureTier(c) >= 5 then ... end;
```

### `H5ECreatureGrowth(creature)`

What a week of a creature is — the number its dwelling stocks. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** Its weekly growth.

```lua
local week = H5ECreatureGrowth(CREATURE_ARCHER);
```

### `H5ECreatureCost(creature, resource = 6)`

What one of a creature costs, in one resource. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |
| `resource` | number | The game's resource number; gold is 6. _(optional, default 6)_ |

**Returns:** The price of one.

```lua
local gold = H5ECreatureCost(CREATURE_ANGEL);
```

### `H5ECreatureTown(creature)`

The race a creature belongs to. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** A TOWN_* number.

```lua
if H5ECreatureTown(c) == TOWN_NECROMANCY then ... end;
```

## Heroes and spells

### `H5EArmySlots(hero)`

How many slots of a hero's army are taken. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** The number of taken slots, 0 to 7; nil when there is no such hero or army.

```lua
if H5EArmySlots(hero) < 7 then AddHeroCreatures(hero, c, n); end;
```

> The engine keeps slot counting to itself — GetHeroCreatures counts creatures, not slots — and this asks the routine it counts with. Nil rather than a guess: a rule that read "no answer" as "plenty of room" is what this exists to end.

### `H5EHeroHasSpecialization(hero, spec)`

Whether a hero holds this specialization. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spec` | number | The specialization value — the mod's own included. |

**Returns:** 1 when he holds it; nothing when he does not, or when there is no such living hero.

```lua
if H5EHeroHasSpecialization(hero, 84) ~= nil then ... end;
```

> What lets a specialization of the mod GRANT something on the map rather than have it written into documents at build time. A value read that is not a specialization at all is refused, not compared.

### `H5ECanLearnSpell(hero, spell)`

Whether a hero may learn a spell now — school, skill, mastery and level, as the game decides. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spell` | SPELL_* | The spell. |

**Returns:** 1 when he may; nothing when he may not, or when there is no such hero or spell.

```lua
if H5ECanLearnSpell(hero, SPELL_MAGIC_ARROW) ~= nil then TeachHeroSpell(hero, SPELL_MAGIC_ARROW); end;
```

### `H5ECanHoldSpell(hero, spell)`

The school half of H5ECanLearnSpell on its own: whether spells of that kind are for this hero at all. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spell` | SPELL_* | The spell. |

**Returns:** 1 when his kind may hold it; nothing otherwise.

```lua
if H5ECanHoldSpell(hero, spell) == nil then -- refused for what he IS
```

> Tells a refusal for what the hero IS (a barbarian handed magic) from one for what he lacks yet (level, skill) — the first is worth paying for, the second is lost the way it is at a shrine.

### `H5EIsBarbarian(hero)`

Whether a hero is of the Horde. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** 1 for a barbarian; nothing for anybody else.

```lua
if H5EIsBarbarian(hero) ~= nil then ... end;
```

### `H5EIsCastingHero(hero)`

Whether this hero is the one casting the adventure spell being decided now. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** 1 when he is; nil when he is not, and nil when it cannot be told — read that as "not him".

```lua
if H5EIsCastingHero(hero) ~= nil then ... end;
```

> For the scripts behind adventure spells of the mod (the page that is live or greyed). Ask H5ECasterKnown first: nil from here can also mean nobody is casting.

### `H5ECasterKnown()`

Whether the extension holds the hero whose adventure spell this is. · *map script*

**Returns:** 1 when it does; nothing when nobody is casting.

```lua
if H5ECasterKnown() ~= nil then ... end;
```

> Tells "I could not find him among the player's heroes" (refuse) from "nobody is casting" — falling back to any hero is how one hero's spell was once decided by another hero's army.

### `H5EAnswer(spell, verdict)`

Say whether an adventure spell of the mod may be cast now. · *map script*

| param | type | meaning |
|---|---|---|
| `spell` | SPELL_* | The spell's number. |
| `verdict` | number | 1 (or anything but 0) for yes, 0 for no. |

```lua
H5EAnswer(spell, now);
```

> The engine was never built with the mod's spell numbers, so its own gate says no to them; the extension answers in its place with the last verdict the map gave. The same answer greys the spellbook page and refuses the click.

### `RestoreDarkEnergy(player)`

Fill a player's dark energy back up to its ceiling. · *map script*

| param | type | meaning |
|---|---|---|
| `player` | PLAYER_* | Whose pool to fill — 1 through 8. |

```lua
RestoreDarkEnergy(PLAYER_1);
```

> The engine has no setter for the pool: it keeps a CEILING and fills to it weekly, so "restore" is asking the player to do that refill out of turn. Any ceiling our artifacts add is included, because the refill is one of the calculations the extension extends. A player number out of range is refused in the engine's own words.

## Windows

### `H5EMessageBox(text, header)`

A message box on whatever screen is up — a town screen included. · *map script*

| param | type | meaning |
|---|---|---|
| `text` | path \| table | The text, as MessageBox takes it: a path to a text file, or a table of the path and its values. |
| `header` | path \| table | A header above the text, the same way. _(optional)_ |

```lua
H5EMessageBox("/Text/MyMod/camp_closed.txt");
```

> The game's MessageBox queues its box for the ADVENTURE screen and shows it only when that screen runs again — after a town screen closes. This one goes straight onto the screen on top, the way the town screen's own boxes do. It does not wait for the player.

### `H5EAskCount(creature, becomes, most)`

Put up the game's own count slider. Answers nothing — see ShowSliderDialog. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | What the player is counting. |
| `becomes` | CREATURE_* | What they turn into. |
| `most` | number | The largest number the slider will reach. |

```lua
H5EAskCount(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);
```

> The window is the engine's own split slider (CSplitStack) driven by a controller of ours, so it has the game's frame, slider and buttons, and it goes on whichever screen the player is looking at. The picture is made from the creature NUMBER, the way the engine makes it from a stack. A second window while one is open is refused: there is one answer to collect. Prefer ShowSliderDialog, which waits.

### `H5EAskedCount()`

What the count slider was answered with, if it has been. · *map script*

**Returns:** Nothing while the window is open; the chosen number once OK is pressed; -1 when it was closed without an answer.

```lua
local n = H5EAskedCount(); if n ~= nil then ... end;
```

### `ShowSliderDialog(creature, becomes, most)`

Ask the player how many creatures to turn into another kind, and wait. · *map script*

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | What the player is counting. |
| `becomes` | CREATURE_* | What they turn into. |
| `most` | number | The largest number the slider will reach. |

**Returns:** The number the player chose, from 1 to `most`, or -1 if they closed it.

```lua
local n = ShowSliderDialog(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);
```

> Plain Lua, defined in the mod's copy of scripts/advmap-common.lua, over the extension's H5EAskCount and H5EAskedCount. THE WAITING IS THE WRAPPER'S: a registered function's results are counted the moment it returns, so the one that opens the window cannot answer with a number that does not exist yet. Without the extension it answers -1 rather than hanging. The slider starts at `most` and never reaches nought — that is what Cancel is for. The window draws the FIRST creature on both sides today: the engine asks its controller once and uses the one answer for both icons, so showing what they become means filling the second icon ourselves.

## Artifact sets

### `EditorWornCount(hero, members)`

How many of these artifacts the hero is WEARING. · *map script*

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `members` | table | Artifact ids — a set's `<Set>_MEMBERS` list. |

**Returns:** The count worn. A piece in the backpack does not count.

```lua
EditorWornCount(hero, H3UndeadKing_MEMBERS)
```

> Plain Lua, defined in the mod's copy of scripts/advmap-common.lua rather than in the extension. It leans on HasArtefact's third argument, which the manuals omit and which is what makes "worn" mean worn.

### `EditorHeroWearing(player, members, count)`

The first hero of a player wearing at least N of these artifacts. · *map script*

| param | type | meaning |
|---|---|---|
| `player` | PLAYER_* | Whose heroes to look through. |
| `members` | table | Artifact ids — a set's `<Set>_MEMBERS` list. |
| `count` | number | How many have to be worn. |

**Returns:** The hero's name, or nil when none of them qualifies.

```lua
local hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);
```

> The condition half of a set's script: what the set does is up to the script, whether that is one of ours or anything else the API offers.

## Battle

### `H5ETentCharge()`

Give the first aid tent one more use. · *battle script*

```lua
H5ETentCharge();
```

> The half of a perk the battle's Lua cannot do: no function of the game's touches the tent's charges. With no arguments it cannot be told WHOSE tent, so the use goes to the last one built — right when one side has a tent, the ordinary case. See docs/api/combat.md.

### `H5ECombatTest()`

Write one line to the extension's log — proof that a battle's script reaches the extension. · *battle script*

```lua
H5ECombatTest();
```

> The log line needs a build with `--log lua/registry`.

## Plumbing

### `H5ELog(value)`

A number from a script, into the extension's log. · *map script*

| param | type | meaning |
|---|---|---|
| `value` | number | What to write down. |

```lua
H5ELog(GetHeroLevel(hero));
```

> print goes to the game's console, which is where a player looks; this lands in bin/homm5-editor-*.log beside everything else the extension says, so a script can measure the game and the measurement survives the session.

### `H5ENoSuchFunction()`

The "else" of a line the extension says to the map — logs that the function it named is missing. · *map script*

```lua
if CampBought ~= nil then CampBought(c, n, t); else H5ENoSuchFunction(); end;
```

> For the extension's own use: every call it makes into the map's Lua (a town button, a purchase event) is guarded this way, so a function the map lacks is a line in the log rather than nothing at all.

### `H5ETownButtons()`

How many town buttons the extension's file lists — and the map introduces itself. · *map script*

**Returns:** The number of buttons in bin/homm5-editor-buildings.txt.

```lua
H5ETownButtons();
```

> A button's click has no Lua context of its own; calling this hands the extension the map. The extension now also takes the map from the script scheduler's tick, so a map does not have to call it.

### `H5EMapIsPlaying()`

Tell the extension the map is being played, not set up. · *map script*

```lua
H5EMapIsPlaying();
```

> For the extension's own use: a line put into every map starts a thread that calls this once it gets past its first sleep, which only happens once the game is running — so a spell a map's start-up script hands out is not announced.

### `H5EAnnounceGain()`

Ask for the next gain a hero receives to be announced on screen. · *map script*

```lua
H5EAnnounceGain(); TeachHeroSpell(hero, spell);
```

> One announcement per call, counted: a box with three spells asks three times, because the grants are deferred and run after the asks. Nothing else in the game is announced — a script that never asks never notices the extension.

### `EditorTest()`

Write one line to the extension's log — proof that the map's Lua reaches the extension. · *map script*

```lua
EditorTest();
```

> "The extension is loaded" and "the game's Lua can reach it" are different claims; only the second explains why a script does nothing.
