# Names, references, and scripting

How the game ties the map to its Lua script — and why some things the map
declares are never placed in the editor. This is the model the editor's naming,
reference pickers, and (Phase 5) Lua completion are built on.

Sources: `Editor Documentation/HOMM5_A2_Script_Functions.pdf`,
`HOMM5_Users_Campaign_Editor.pdf`, and the shipped campaign scripts in
`UserMODs/All_campaigns.data.h5u` (`Maps/Scenario/C*/MapScript.lua`).

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
