# Names, references, and scripting

How the game ties the map to its Lua script — and why some things the map
declares are never placed in the editor. This is the model the editor's naming,
reference pickers, and (Phase 5) Lua completion are built on.

Sources: `Editor Documentation/HOMM5_A2_Script_Functions.pdf`,
`HOMM5_Users_Campaign_Editor.pdf`, and the shipped campaign scripts in
`UserMODs/All_campaigns.data.h5u` (`Maps/Scenario/C*/MapScript.lua`).

## The script editor

`Scripts` in the toolbar lists every `.lua` the map folder carries; opening one
gives a CodeMirror editor with Lua highlighting and completion from three
sources:

- **The engine API** — `src/script-api.json`, 204 functions with their parameter
  lists. It is MERGED (`npm run build-api`) from two sources: our own hand-written
  reference `src/script-api-curated.ts` (24 functions so far, with real
  descriptions — the popup shows them) and, as a fallback, the raw signatures
  pulled from the shipped manuals by `npm run script-api` (needs `pdftotext`).
  The readable form is `docs/SCRIPT_API.md`. These functions are implemented in
  the engine, so nothing in the game's own Lua declares them: scanning the scripts
  would find only the ones a mission happens to call.
- **The game's own scripts** — `<data>/scripts/*.lua`: the helpers a mission is
  expected to call (`startThreadOnce`) and the constants they define, read at
  run time from the installation.
- **This map** — every object `<Name>`, region and objective, plus the ID
  rosters (`CREATURE_*`, `SPELL_*`). Offered INSIDE a string literal, because
  that is how every one of them is passed:
  `SetObjectiveState( "prim1", OBJECTIVE_ACTIVE )`.

The last is the one that matters. A misspelt name is not a syntax error — it is
a call that does nothing, at run time, inside the game, with no message. The
editor cannot check a name after the fact, so it offers the right ones instead.

Highlighting uses the legacy **stream** mode rather than a strict Lua grammar,
because the game's Lua is 4.0-shaped: `%upvalue` inside a nested function, `f{}`
calls, no `#` operator. A modern parser paints half of the shipped missions red.

A `.lua` is written as plain UTF-8 — the engine's parser reads it byte by byte.
Only the display texts (`name.txt`, an objective's caption) get the UTF-16LE the
game writes for them.

## The linter — the errors the engine won't tell you about

A map script is never compiled anywhere we can watch. The engine loads the chunk
at run time and, if it is malformed, silently refuses it — no message, no line
number, the mission just does not script. So the editor lints as you type
(`src/lua-lint.ts`), and the verdict sits beside the file's name: **✓ no errors**,
or **⚠ 2 errors**, with a red mark in the gutter on each offending line.

What it flags as an **error** is exactly what the parser rejects, and nothing
else:

- an unbalanced block — a `function`, `if` or `do` with no matching `end` (or one
  `end` too many; `repeat` is closed by `until`);
- an unclosed or mismatched bracket — `(`, `{`, `[`;
- an unterminated string.

The block rule is tuned to the game's dialect and measured against the shipped
scripts: `for`/`while` take no `end` of their own — their `do` does — so the
opener count is `function + if + do`, and every one of the three C1M1 scripts
balances to zero. That is the load-bearing test (`tools/test-lua-lint.ts`): a
linter that reddens working code is worse than none, so the thing that must stay
true is that a real mission script lints clean.

What it deliberately does **not** treat as an error is an unknown function name.
The API list (`docs/SCRIPT_API.md`, from the manuals) does not cover every call a
mission makes: some the campaigns use are engine built-ins the manuals never
documented — `GiveExp`, the combat-runtime `combatReadyPerson`/`setATB`, the
tutorial `WaitForTutorialMessageBox`/`IsTutorialEnabled` — so "not in the list"
cannot mean "wrong". The one name check is a **warning**, and only on a *near*
miss: an unknown that sits one or two edits from a name we do know
(`SetObjectvieState` beside `SetObjectiveState`) is a typo far more often than
not. An unknown with no near match is left alone.

A misspelt *string* — a wrong object or region name — is not caught at all,
because it cannot be told from a file path or a tutorial id. That is what the
completion is for: offer the right names so they are never typed wrong (above).

## Binding a script: the `.lua` and its `.xdb` wrapper

A map does not reference a `.lua` directly. Every script is **two files**:

- `MapScript.lua` — the code the engine runs;
- `MapScript.xdb` — a tiny `<Script>` wrapper that names it
  (`<FileName href="MapScript.lua"/>`).

The map's `<MapScript>` (and a hero's `<CombatScript>`, and the `StartCombat`
call's script argument) all point at the **wrapper**, by xpointer:
`MapScript.xdb#xpointer(/Script)`. In the map tree, the `MapScript` row's **New**
button makes both files, binds the ref, and opens the code; **✎** follows the
wrapper to its `.lua`. Typing the name of a script that already exists re-binds to
it without touching its contents, which is also how you point the map at a script
you wrote earlier. (`script:new` / `script:resolve` in `electron/main.ts`.)

A mission usually has more than one:

- **the map script** — bound as `<MapScript>`, runs from the top when the map
  loads; C1M1's sets up objectives, tutorial triggers and the opening dialog.
- **a combat script** — referenced from Lua by path
  (`StartCombat("Isabell", …, "…/C1M1-CombatScript.xdb#xpointer(/Script)", …)`)
  or bound to a hero (`SetHeroCombatScript`); its `Prepare`/`Start` and any
  threads run during a battle.

These cross-references are stored as the original wrote them. C1M1's map script
names its combat scripts by **absolute** path into the shipped mission's folder
(`/Maps/Scenario/C1M1/…`); reproduced verbatim, that points at the original's
location, not a rebuilt map's. Rehoming those paths is a separate concern from
authoring the script and is left to the mission author.

## The `<Name>` is the script handle

Lua addresses everything on the map by a **string name**, not by file path or
index. A placed object, a town, a hero, an objective — each carries a `<Name>`,
and the script API takes that name:

```lua
TransformTown(townName, type)          -- change a town's faction
GetTownHero(townName)                   -- the hero garrisoned in it
SetObjectOwner(objectName, playerID)    -- give an object to a player
GetObjectPosition(objectName)           -- where it stands
DeployReserveHero(heroName, x, y, floor)
```

So a `<Name>` is not decoration — it is the identifier the whole script layer
depends on. Two objects sharing a name, or a referenced name that no object
defines, is a latent bug: the script silently acts on the wrong object or none.

**Editor consequence:** object/entity `<Name>` should be **unique within the
map** and **not empty** when anything can reference it. See "Default names"
below.

## Definitions vs placed objects — why "main"/"reserve" aren't on the map

Some things the map declares are **definitions the engine or the script
materialises at run time**, not objects the editor places. This is why setting a
player's Main Town / Main Hero / a Reserve Hero puts *nothing* on the canvas.

- **Reserve heroes** (`players[i].ReserveHeroes`) — "reserved after a player"
  when the map is built. Per the API doc, they *"will not appear in taverns and
  can't be hired"*. The script puts them on the map on demand:

  ```lua
  DeployReserveHero("Agrael", 120, 55, GROUND)   -- C1M5/MapScript.lua
  DeployReserveHero("Razzak", 24, 90, 0)         -- C3M5/MapScript.lua
  ```

  *"Their armies are restored to those specified in the editor."* — i.e. the
  editor **definition** (the standalone `Name.(AdvMapHero).xdb`) supplies the
  stats/army; the script chooses when and where it appears. `UnreserveHero(name)`
  drops it back to the taverns.

- **Main Town / Main Hero / Start Hero** (`players[i].*`) — reference a
  **standalone document** (`Name.(AdvMapTown).xdb` / `.(AdvMapHero).xdb`), a full
  `<AdvMapTown>`/`<AdvMapHero>` saved as its own file so the same town or hero
  can carry across campaign missions. The document carries its own `<Pos>`; the
  engine uses the definition (for the Award "given to the player's main hero",
  the "don't lose your main hero" objective, and campaign carry-over), rather
  than it being a pre-placed editor object.

- **Campaign migration** (`HOMM5_Users_Campaign_Editor.pdf`) — a hero migrates
  into the next mission via an **entry point** marker on the destination map,
  which is replaced by the arriving hero on load (its props set position and
  army). Spells and artifacts do **not** transfer this way; skills and
  experience are replaced at mission start. A hero already standing on the map
  (not a "default" migrant) must have an instance placed on the destination.

The through-line: **these are named definitions, wired up by script or engine at
run time.** The editor's job is to let you author the definition and its name —
not to place it.

## Where names are defined and where they are referenced

The schema marks both sides with `x-nameOf` (this field *defines* a handle) and
`x-nameRef` (this field *refers* to one, of a given kind). The editor offers a
`<datalist>` of names defined elsewhere in the map (IPC `map:names`) as a hint —
not a hard constraint, since a name not yet defined is still typeable.

### Handles — fields that define a name (`x-nameOf`)

| Field | Kind | Where |
|---|---|---|
| object `<Name>` | `object` | every `AdvMap*` object — `$defs/CommonObject` (objects.schema.json) |
| objective `<Name>` | `objective` | `Objectives.*` and `ScenarioInformation[]` items |
| region `<Name>` | `region` | `regions[]` items |

Standalone definition documents (a Main Town/Hero's `Name.(AdvMapTown).xdb`, a
reserve hero) carry their own `<Name>` too — that is the handle a script uses
(`DeployReserveHero(heroName, …)`), even though the file is referenced by href.

### References — fields that name a handle (`x-nameRef`) or a script identifier

| Field | → kind | Consumer |
|---|---|---|
| `Objective.Dependencies[]` | `objective` | engine — objective ordering |
| `TargetGlance.Target.Name` | `object` | engine — the objective's target/camera |
| trigger `…Trigger.Action.FunctionName` | *Lua function* | engine calls that Lua function (a **script-side** handle, not a map name — not in `map:names`) |
| Lua args: `townName` / `objectName` / `heroName` / `regionName` | object / region | the map script (free text today) |

The **Lua script** is the largest consumer of the `object`/`town`/`hero`/`region`
handles, but the script is free text — nothing yet connects the map's names to
the identifiers a script types. Closing that gap (name completion) is Phase 5.

Note the two distinct namespaces a trigger touches: `FunctionName` is a **Lua
function** to run; the arguments that function takes are the **map handles**
above. Only the latter come from `map:names`.

## Enum handles used by name, for reference

Towns transform between factions by these ids (`TransformTown` type argument):
`TOWN_HEAVEN, TOWN_PRESERVE, TOWN_ACADEMY, TOWN_DUNGEON, TOWN_NECROMANCY,
TOWN_INFERNO, TOWN_FORTRESS, TOWN_STRONGHOLD` (+ `TOWN_NO_TYPE`). Players are
`PLAYER_1…PLAYER_8` / `PLAYER_NONE` in script, stored as `PCOLOR_*` on the slot.

## Editor implications (todo — tracked in ROADMAP Phase 5)

1. **Default, unique names.** A new named object/entity should get a
   non-empty default handle — `<TYPE>_001`, `<TYPE>_002`, … — and the editor
   should refuse (or auto-suffix) duplicates within the map, since a duplicate
   or empty handle breaks the script that refers to it.
2. **Lua name completion.** The Monaco Lua editor should offer the map's own
   names (objects, towns, heroes, objectives, regions) as completions in the
   argument positions that take them — driven by `map:names`, the same source
   the `x-nameRef` datalists already use. This is what makes "reference an
   entity from Lua" correct instead of hand-typed and typo-prone.
