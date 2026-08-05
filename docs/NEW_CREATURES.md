# Adding a creature to Tribes of the East

> **Where this document is, and what its paths mean.** It was written in the
> Heroes III port and moved here in 2026-07, because what it describes is the
> EDITOR: the ceiling in the executable, the four silent edits, the file date
> that cost three evenings. Paths below are this repo's unless they say
> otherwise; the port's own files (`src/new-creatures.ts`,
> `tools/build-creature-slots.ts`) were retired when the dialog became the mod's
> only writer, and the Sharpshooter is a fixture of [e2e/mods.ts](../e2e/mods.ts)
> now. The port itself lives at `<game>/h3-mod/`.

Written because the port needs Heroes III's **Sharpshooter** as a unit of its own,
and the same recipe will be wanted again — the Heroes III campaigns are full of
creatures Heroes V has no counterpart for.

**The headline: 180 creatures is a hard limit compiled into the executable.** A new
creature id cannot be added by editing data alone; the ceiling has to be raised in
`H5_Game.exe`. Anything that claims a new creature is just a ref-table entry is
wrong, and this file said so in its first version.

Everything else about it turned out smaller than the community's New Creature
Framework suggests: two byte-level edits and eight small files, with **no stub files
at all** — see [The edits](#the-edits) and [the files it carries](#the-files-the-mod-carries).

Two things stood in the way and neither was where it looked. Steam ships the game
encrypted, so the published patch offsets fit nothing —
[The Steam wrapper](#the-steam-wrapper). And every mod we built was read and silently
ignored because its files were dated 1980 —
[the file date](#why-nothing-we-shipped-took-effect-the-file-date), which cost three
wrong theories before it was found.

**This works: the creature exists in game, stands on a map and fights.** Sections marked
*(verified)* were read out of the game's own files or seen in game; anything still open is
in [Still open](#still-open).

## Why a new unit and not the one that ships

Tribes of the East already has `CREATURE_SHARP_SHOOTER` — the Wood Elf's second
(alternative) upgrade, model `T3_Elf_Sniper`, and it even carries the original's
signature `ABILITY_NO_RANGE_PENALTY`. It is not the same unit, though *(verified)*:

| | Heroes III | Tribes of the East |
|---|---|---|
| slot | level 4, **neutral** | tier 3, Sylvan |
| vs its own Grand Elf | attack 9→12, defence 5→10, speed 7→9, shots 24→32, gold 225→**400** | attack 5→6, defence 4→5, speed 5→5, shots 16→16, gold 190→**190** |

In Heroes III the Sharpshooter is a clear step up that costs nearly double. In
Heroes V it is a same-price side-grade. Reusing it would erase exactly the
difference that makes the Heroes III dwelling worth visiting.

## Anatomy of a creature *(verified)*

Paths from `CREATURE_SHARP_SHOOTER`, the closest thing to a template we have:

```
GameMechanics/Creature/Creatures/<Faction>/<Name>.xdb          the stats
    <Visual href="/GameMechanics/CreatureVisual/Creatures/…/<Name>.(CreatureVisual).xdb#xpointer(/CreatureVisual)"/>
    <MonsterShared href="/MapObjects/<Faction>/…/<Name>.(AdvMapMonsterShared).xdb#xpointer(/AdvMapMonsterShared)"/>

GameMechanics/CreatureVisual/Creatures/…/<Name>.(CreatureVisual).xdb   combat side
    NameFileRef        → /Text/Game/Creatures/…/<Name>_Name.txt
    DescriptionFileRef → /Text/Game/Creatures/…/<Name>_Desc.txt
    Icon128            → /UI/…/Icons/Creatures/…/<Name>.(Texture).xdb

MapObjects/<Faction>/…/<Name>.(AdvMapMonsterShared).xdb          adventure-map stack
    Model    → /Characters/Creatures/<Faction>/…/<Model>.xdb
    AnimSet  → /Characters/Creatures/<Faction>/…/<Model>-arena.xdb
    Type     → MONSTER_SPECIFIC
```

`Creature` is the stat block, `CreatureVisual` the combat body plus
name/description/icon, `AdvMapMonsterShared` what a wandering stack looks like on
the map.

### Stat fields

Verified in `SharpShooter.xdb`, plus the ones only the NCF dummy template shows:

```
AttackSkill  DefenceSkill  MinDamage  MaxDamage  Health  Speed  Initiative  Shots
WeeklyGrowth  Exp  Power  CreatureTier  Upgrade  SubjectOfRandomGeneration
SpellPoints (+1, +2)  KnownSpells  Abilities  Upgrades  Range
Cost { Wood Ore Mercury Crystal Sulfur Gem Gold }
Flying  TimeToCommand  CombatSize  PatternAttack  flybySequence
PairCreature  BaseCreature        — CREATURE_UNKNOWN when there is none
CreatureTown                      — TOWN_NO_TYPE for a neutral
MagicElement { First Second }     — ELEMENT_NONE / ELEMENT_NONE
```

`KnownSpells` holds `<Item><Spell>SPELL_…</Spell><Mastery>MASTERY_…</Mastery></Item>`
and needs `SpellPoints` above zero to be usable. `Abilities` holds `ABILITY_…` ids;
the Sharp Shooter's are `ABILITY_NO_RANGE_PENALTY` and `ABILITY_PIERCING_ARROW`.

`CreatureTown: TOWN_NO_TYPE` is how a neutral is expressed — which is what Heroes
III's level-4 neutral Sharpshooter needs.

## The Steam wrapper

`bin\H5_Game.exe` on Steam cannot be patched as it ships *(verified)*: it carries an
extra `.bind` section, its entry point sits inside that section at RVA `0xF05310`,
and its `.text` is encrypted on disk. Measured across the whole 11 MB code section:

| section | entropy | `CC` padding |
|---|---|---|
| `.text` | 7.997 | 0.4% |
| `.rdata` | 5.845 | — |
| `.bind` (the loader) | 7.868 | — |

Compiled x86 sits near 6.3 with 2–5% `CC` padding, so a flat 7.997 end to end is
encryption rather than code, and the loader in `.bind` is itself packed — it holds no
readable strings. `binDM\H5_Game.exe` (version 3.0) is wrapped the same way.

**`bin\H5_MapEditor.exe` is not wrapped** — five sections, entry point in `.text`,
and it matches the patch at all four offsets byte for byte. That is what proves the
patch data is right for our 3.1 build even though the game exe cannot be read yet.

Unwrapping is Steamless's job; it covers SteamStub variant 3.1 (x86). There is no
`steam_api.dll` or `steam_appid.txt` anywhere in the install, so the DRM is purely
the wrapper and an unwrapped executable stands alone.

**Done, and it worked** *(verified)*. Steamless reported variant 3.1, confirmed the
`.text` section was encrypted, removed `.bind` and restored the original entry point
at RVA `0x549FE3`. Sections were not realigned — `.text` still starts at raw `0x400`
— and the file shrank by exactly `0x2D7D0`, the size `.bind` had. Afterwards `.text`
measures entropy 5.87 with 4.1% `CC` padding: ordinary compiled code.

And then the surprise: **the published offsets do not fit this build at all.** Its
`.text` opens with padding rather than the expected `8D 41 34 C3`, and `0xE076` —
where the patch expects `mov esi,ecx` — holds a table of addresses stepping by ten.
Same version string, same section sizes, different compilation: Steam's game
executable is not retail 3.1. The map editor *is* retail, which is why it matched.
So the offsets had to be found. See [The edits](#the-edits).

## The edits

The editor applies them — `src/exe/creature-limit.ts`, with
`tools/creature-limit.ts` as its command line — and writes nothing unless every site
reads what it should. It identifies the build first, and says so plainly when handed
a wrapped executable rather than reporting an unknown one. The patch data lives there
rather than here because it is about the game's executables and not about this port;
the evidence for each offset stays in this document.

**Two edits open the slots.** They are the creature count, and on the Steam build
they sit here *(verified)*:

| offset | what it is | before | after |
|---|---|---|---|
| `0x69E3A1` | `mov eax,180; ret` — the count accessor | int `180` | int `181` |
| `0xABECD` | `push 180` in the ref-table registration | int `180` | int `181` |

Neither is a borrowed number, because none of the published offsets fit this build.
Each was found and then argued for:

- `0x69E3A1` sits in a run of **twelve** one-line accessors, all shaped
  `mov eax,<n>; ret`. Every one of the twelve returns a number that `types.xml`
  declares as some ref table's `ref_table_num_objs`, and 180 is the size of exactly
  one table — the creature table. Twelve for twelve, on a cluster whose whole job is
  reporting table sizes.
- `0xABECD` is a `push 180` thirty-three bytes after
  `mov edx, "/GameMechanics/RefTables/Creatures.xdb"`, inside the routine that
  registers each ref table by name, path and size. The name pushed just before it is
  `STable_Creature_CreatureType`; the next table the routine goes on to register is
  `HeroAttributeDesc`.

Both strings were found by resolving the pointers the *editor* pushes at its own
known-good site, which is what put the search in the right place to begin with.

Because this build's `.text` opens with padding, which identifies nothing, the tool
identifies it by sixteen bytes inside that registration routine instead.

**Two further edits exist, and we do not need them.** The published patch also writes
`EB 3B` over `8B F1` plus a nine-byte stub — `cmp edi,0Ch` / `je` / `mov esi,ecx`, the
instruction the jump overwrote, / `jmp` back — into the padding that follows. The
added test makes the random map generator step over creatures that have no
adventure-map visuals. Every new id copies `None.xdb`, and `None.xdb` already
carries `<SubjectOfRandomGeneration>false</SubjectOfRandomGeneration>` *(verified)*,
so the generator cannot pick them: the data already answers what the patch was for.
The tool keeps the pair for the retail build and applies none of it to Steam's.

Where the pair does apply, both displacements are baked into the bytes, so they only
hold if the padding sits exactly `0x3B` past the jump. The tool asserts that
arithmetic on startup for every build in its table rather than trusting it; all check
out.

Builds in the table: Steam 3.1 unwrapped, retail 3.1 (`0x6CA781`, `0x6E1A20`,
`0xE076`, `0xE0B3`), the retail map editor (`0x4B6DB1`, `0x4CF860`, `0x31F76`,
`0x31FB3`) and Quantomas' AI build. Patching the map editor is optional for us since
we have our own, but it is what makes new creatures appear in the original editor's
palette.

Verified twice: on the map editor exe, patching a copy changed exactly 15 bytes in
four runs; on the unwrapped Steam exe, exactly 4 bytes across the two sites.

**The wrapper comes off once, and only once.** A ceiling has to equal the mod's
creature count exactly, so the number changes every time a creature is added or
removed — and the first version of this tool would only start from the shipped 180,
which meant every change needed a freshly unwrapped executable. It does not: a
patched-to-N executable is a recognised starting state and goes to any other
ceiling in place, up or down. `bin/H5_Game_NCF.exe` is therefore written once and
then kept current by `build-creature-slots.ts --install`, which sets the ceiling in
the same step that installs the archive. Nothing has to be remembered, and the two
cannot drift apart. *(Verified: a round trip on the real 181 executable returns the
original bytes.)*
Re-running reports every site already done. The patched game executable is written
alongside the original as `bin/H5_Game_NCF.exe`, never over it.

**The ceiling is exactly the list.** Every id below it has to resolve at launch, so a
ceiling with room to spare means inventing empty creatures to fill the room. Both
tools take it from `CREATURE_LIMIT` in `src/new-creatures.ts` — one creature so far,
hence 181 — and adding one means re-running both. That is two commands, against
carrying dead ids in the data forever; the framework's own answer was a ceiling of
1000 and 820 stubs.

## The files the mod carries

`tools/build-creature-slots.ts` writes them and packs the result. The first three are taken
from the game's own data and edited by anchor, so an anchor that moved is an error
rather than a silent miss.

**1. `types.xml`** — three sites, each unique in the file *(verified)*:

- the `<EnumEntries>` list under the `dbid`
  `/GameMechanics/RefTables/Creatures.xdb#xpointer(/Table_Creature_CreatureType)`,
  after `<Item>CREATURE_CYCLOP_BLOODEYED</Item>`: one `<Item>` per new id;
- the `CreatureType` entry under `<SharedClasses>`, after
  `<Name>CREATURE_CYCLOP_BLOODEYED</Name>` / `<Value>179</Value>`: one
  `<Item><Name>…</Name><Value>…</Value></Item>` per new id. **This is the id→number
  map, and the number is what maps, saves and Lua store** — so the list is
  append-only, and reordering it silently repoints every creature after the change;
- `Table_Creature_CreatureType`: `ref_table_num_objs` and the `objects` field's
  `<MaxElements>`, both `180` → the new ceiling. `<MinElements>` sits directly above
  `MaxElements` and also reads 180; it stays, being a floor the new count clears.

One trap when editing by hand: `ref_table_num_objs` holds its number in a `<Data>`
inside a `<Data>`, so "the next `<Data>`" finds the wrong element.

**2. `GameMechanics/RefTables/Creatures.xdb`** — one `<Item>` per new id before
`</objects>`, each carrying **its own object, written inline**:

```xml
<Item>
	<ID>CREATURE_H3_SHARPSHOOTER</ID>
	<Obj href="#n:inline(Creature)" id="item_f9f640f2-7ae6-7663-8e29-15c7a15fff58">
		<Creature ObjectRecordID="1001000">
			<!-- the body of the game's own None.xdb, verbatim -->
		</Creature>
	</Obj>
</Item>
```

The `id` has to differ between entries; nothing appears to read it, so ours is
derived from the slot name and a rebuild stays byte-identical. `ObjectRecordID` has to
differ too: the tables that inline their objects number from 1000000 and addon content
reaches 1000059, so ours run from 1001000.

**3. `UI/UIGameRoot.(UIGameRoot).xdb`** — a single `<Item>` in `<creaturesCameras>`
whose `<creatures>` lists every new id, on the existing
`/Cameras/Interface/HireCreatures.(Camera).xdb`.

### The creature's own five files

Generated per creature, not edited: `src/new-creatures.ts` holds the definition and the
builder writes them out.

**4. `GameMechanics/CreatureVisual/Creatures/Sod/<Name>.(CreatureVisual).xdb)`** — a copy
of a shipped creature's visual with its three text references repointed at ours. Model,
animation and icon stay borrowed; the name, description and ability list become ours.

It cannot be left pointing at `None.xdb`'s visual: the startup check tests every
creature's visual for an icon, that one leaves `Icon`, `Icon32`, `Icon64` and `Icon128`
all empty, and the game stops with

```
CreatureVisual /GameMechanics/CreatureVisual/Creatures/None.xdb#xpointer(/CreatureVisual)
has invalid or missing icon.
```

`CREATURE_UNKNOWN` points at that same visual and gets away with it only because the
check starts at id 1.

**5. `MapObjects/Sod/<Name>.(AdvMapMonsterShared).xdb`** — a copy of a shipped stack
definition, and **the file that decides which creature a stack on the map is**. Its last
field is what matters:

```xml
<Type>MONSTER_SPECIFIC</Type>
<Creature>CREATURE_H3_SHARPSHOOTER</Creature>
```

An `AdvMapMonster` object on a map carries no creature field at all — only a reference to
one of these. Copy a shipped one and forget that line, and the map places the creature you
copied from, with its stats and its name, however new everything else is. That is exactly
what happened on the first test map: a tier-3 Sharp Shooter standing where our tier-4
neutral should have been, which reads as "an ordinary elf with the wrong stats" and is one
mistake rather than two.

**6, 7, 8. `Text/Sod/<Name>_Name.txt`, `_Desc.txt`, `_Abils.txt`** — UTF-16 LE with a
byte-order mark and no trailing newline, the way the game writes its own.

### Why there are no stub files

The framework ships a creature file and a recruit-screen camera per slot — 1640 of
them at its ceiling — because every id has to resolve at launch. Neither has to be a
file:

- **An object can live in the table** *(verified)*. `WarMachines.xdb`,
  `MicroArtifactEffects.xdb` and `MicroArtifactShells.xdb` all write their objects
  into the ref table under `href="#n:inline(<Type>)"` instead of pointing at a path.
  So each new id gets its own inline copy of the game's null creature, which a real
  creature later replaces.
- **One camera serves many ids** *(verified)*. `<creatures>` inside a
  `creaturesCameras` item is a list, and the game hangs Familiar, Imp and Quasit on
  camera `170.xdb`. So however many ids we add, one entry covers them all.

Which is why the mod is three files and 180 KiB rather than a distribution.

#### What does not work: sharing one object

An earlier version of this file had the first point wrong. It read `WarMachines.xdb`
as pointing five ids at one *file*, and `MicroArtifactEffects.xdb` eleven at one, and
concluded that any number of ids could share `None.xdb` between them. They share only the
literal string `#n:inline(WarMachine)`, which is a marker rather than a path — every
one of those entries has its own object and its own `ObjectRecordID`.

The game says so plainly. With extra ids pointed at a file that id 0 already holds, it
refuses to start:

```
DB Error
Empty pointer to creature # 180
```

followed by an offer to skip the remaining creature checks. Only the first id to claim
an object gets it; the rest come back empty. The lesson for reading this data: a
matching `href` is not evidence of a shared object until you have checked that the
`href` is a path.

### Why nothing we shipped took effect: the file date

A mod whose members are dated 1980-01-01 is read and then ignored, on every path
*(verified)*. **Given one path in more than one mounted archive, the game takes the
newest member.** Our zip writer stamped the ZIP epoch on everything for reproducible
builds, so every file we shipped lost to `data.pak`'s own 2007 copies. The archive was
never the problem and neither was where it sat.

The mods installed here show the same rule from the other side: `EWA_CoolTip`'s members
are dated 2017 and `Skill_wheel`'s 2007-10-29, both at or after the game's own files.

Fixed in `src/format/pak.ts` — `writeArchive` stamps the current time, and
`WriteOptions.mtime` pins it for callers that want byte-identical output. **This reached
beyond mods: every `.h5m` the editor packed was dated 1980 too**, so a map's own files
could lose the same way.

#### How it was found, and what it cost

Three explanations were chased and none of them was it. Worth keeping, because each was
plausible and each cost a launch:

- **The order `data/*.pak` is applied in.** Shipping the same bytes under two names,
  `a0-` and `zz-`, to be order-agnostic. No effect.
- **`data/index.bin`.** It is real and it is a genuine index of every database object —
  63,053 `path#xpointer(/Type)` entries, with the addon carrying its own 32 MB copy
  *inside* `a2p1-data.pak`, and the map editor writing a small one into each mod project
  it builds. All true, and none of it relevant: **a mod does not need one.**
- **ZIP directory members.** Every working mod here has them and ours never did. Added
  them; no effect. (They are still written — matching what works costs nothing.)

What settled it was a probe with **three distinguishable outcomes in one launch**: a mod
carrying the shipped creature table with an existing creature's object removed *and* a
renamed text. "Empty pointer to creature # 5" would mean the database was reachable;
the renamed stack would mean the archive was read but not for `GameMechanics/`; neither
would mean the archive was not read at all. It came back "neither", which pointed at the
archive itself and away from three theories at once.

The lesson worth carrying: the reason "mods work here, so archives are read" felt safe is
that it was never checked. Asking whether the *other* mods actually worked is what
narrowed it.

### The startup check, and why one bug looks like two

The creature loop that reports `Empty pointer to creature # N` is not a warning — it
is the function whose result decides whether the game runs at all *(verified by
disassembly)*. It starts with `mov bl, 1`, walks the creatures, and on any failure
does `xor bl, bl` before the "Press ok to skip the following creatures checks" box.
Its caller tests the result:

```
call  <the creature check>
test  al, al
jnz   <past the error>
push  "ORIGINAL_GAME_NOT_FOUND_ERROR"
```

So the second dialog — «Оригинальная версия игры Heroes of Might and Magic V не
найдена», whose text lives in `UI/ORIGINAL_GAME_NOT_FOUND.txt` inside `texts.pak` — is
not a separate problem, a licence check, or anything to do with running unwrapped. It
is what a failed creature check looks like from the outside. The same function checks
war machines, with its own two messages.

Worth knowing for later: a startup failure here reports itself as the game not being
installed properly, which sends you looking in entirely the wrong place.

### Getting it into the game

Mods go in `<game>/UserMODs/` as `.h5u`, which is the same ZIP container a pak is, folder
tree preserved, and **their members need a real modification time** — see
[the file date](#why-nothing-we-shipped-took-effect-the-file-date), which is the one thing
that actually stood in the way. `build-creature-slots.ts --install` puts it there.

`UserMODs/` is not the only place that works, which matters for how the port ships. The
engine scans `Maps/*.h5m`, `DuelPresets/*.h5p`, `UserCampaigns/*.h5c` and
`UserMODs/*.h5u|*.zip` with one and the same mechanism, and a map's archive is mounted for
the whole session rather than for its own mission: a foreign path added to one map
overrode the game while a *different* map was playing *(verified)*. So the mod's files can
travel **inside** the campaign's `.h5c` instead of beside it, and a player installs one
file. The executable patch is the part that cannot travel that way. Written up in the
editor repo: `docs/ARCHIVES.md`.

Applied after everything in `data/`, including the addon's own `a2p1-*` paks *(verified)*:
`All_campaigns.data.h5u` overrides `DialogScenes/AllDialogScenes.(DialogScenesList).xdb`
(38529 bytes against the addon's 7350) and `UI/MainMenu2/SelectCampaign/MenuPanel.xdb`,
and that mod works. `types.xml` included, which no other mod here touches: a ref-table
entry named `CREATURE_H3_SHARPSHOOTER` resolved to id 180 in game, and only our own enum
entry could have said that number.

Nothing goes into `data/`. An earlier version of this file worked out an ordering for
`data/*.pak` from the addon's paks sorting before the base ones, and shipped the same bytes
under two names to be safe. All of it was beside the point.

One thing to revisit: the editor's `pakOrder()` in `src/game/unpack.ts` builds its
unpacked view from `data/` only. That is right for the shipped game, but it knows nothing
about `UserMODs/`, so the editor cannot see a mod's overrides at all.

**Optional: `Scripts/`.** The Lua engine keeps its own copy of the id→number map —
`common.lua` has `CREATURE_CYCLOP_BLOODEYED = 179`. Add a `doFile` and a one-line file per
creature once a script needs to name one.

**Optional: `MapObjects/_(AdvMapObjectLink)/` and a regenerated `index.bin`.** What puts a
creature in the *original* editor's object palette. Ours reads the data directly, so this
is for compatibility only — and note that a mod does **not** need an `index.bin` to work.

### One creature registry, not one per map

Creature ids are global. The ref table is a single file and a mod replaces files rather
than merging them, so two mods that each add "one creature at id 180" do not compose: one
of the two `Creatures.xdb` copies wins outright and the other creature does not exist. A
map is no way around that. It *can* carry the database files — its archive is mounted like
any mod's — but that only moves the same collision between maps: an `AdvMapMonster` names
a creature through an id and a shared definition, both of which live in the one database
every mounted archive is writing over.

So the unit of a creature set is the **project**, not the map: one manifest, one mod, one
executable ceiling, and maps that pick from it. Two campaigns that each ship their own
creature pack will collide if both are installed, and the only way out is for something to
merge the packs and reallocate ids before installing — which is the editor's job if we ever
want it.

**The ceiling and the installed mod have to agree.** The executable's number says how many
creatures exist and the startup check walks every id below it, so a patched executable
without the mod refuses to start (`Empty pointer to creature # 180`) and so does a mod
whose creature the ceiling does not reach. Both tools read `CREATURE_LIMIT` from
`src/new-creatures.ts` for exactly that reason. This is also why we do not raise the
ceiling for headroom: spare ids would have to be filled with creatures that exist only to
stop the game complaining, which is what the framework's 820 stubs are.

## What this means for the port

Any new creature makes the campaign depend on a patched executable. That is a real
cost and an unavoidable one — the 180 cap is not in the data. It is also paid once,
and the port will want more creatures than this one.

What it does not cost is a dependency on someone else's distribution. The four byte
offsets come from MMH55's `NewCreatureFramework.yml` and are checked against our own
files; everything else we generate.

## The Sharpshooter as built

Working in game as of this writing: it exists, it stands on a map, it fights.
`src/new-creatures.ts` holds the definition; the numbers are Heroes III's own.

| | value |
|---|---|
| attack / defence | 12 / 10 |
| damage | 8–10, one shot |
| health | 15 |
| speed | 9 |
| initiative | 12 |
| shots | 32 |
| range | −1 — no obstacle penalty |
| weekly growth | 4 |
| cost | 400 gold |
| tier | 4, `TOWN_NO_TYPE` (neutral) |
| abilities | `ABILITY_NO_RANGE_PENALTY`, `ABILITY_PIERCING_ARROW` |
| Exp / Power | 82 / 940 |

Two of those are judgement rather than transcription:

- **Speed 9** is extreme on Heroes V's scale, where a Grand Elf has 5 and 9 is dragon
  territory. It is right anyway: in Heroes III sharpshooters crossed half a battlefield in
  a turn. Kept deliberately, not by oversight.
- **Initiative** has no Heroes III counterpart, so it is ours to pick. 12 against the Grand
  Elf's 10 — early, but not acting twice as often.
- **Exp and Power** are what the AI values a stack at. Scaled off the shipped Sharp
  Shooter's 39/447 by price, since ours costs 2.1 times as much.

An earlier version of this file proposed different numbers, derived by scaling Heroes V's
Grand Elf by the ratios Heroes III's Sharpshooter has over its own Grand Elf. It produced a
plausible Heroes V unit and the wrong one. The point is to port the creature.

Model, animation and icon are the shipped Sharp Shooter's — `T3_Elf_Sniper`, the elf line's
second upgrade. Worth knowing that the model's texture is named `T3_Elf_Sniper-highelf`: it
reuses the Grand Elf's skin, so up close it looks like an elf, and that is the game's own
Sharp Shooter looking like that, not our copy going wrong. A recolour is still open.

## Abilities of our own, and the first of them: `ABILITY_DRAGON`

**Almost no ability in this game is code.** A creature's `<Abilities>` is a list of ids in
its record, and the engine asks *"does this creature have that one"* wherever it matters —
`ABILITY_UNDEAD` is not a behaviour, it is a flag that resurrection, morale and the mind
spells each look at separately. So an ability nothing asks about does nothing at all, which
is exactly what a **tag** needs to be.

Adding one costs the same three global things an artifact costs, and no executable at all:

| what | where |
|---|---|
| the enum item and the name→number entry | `types.xml` |
| the size the table declares | `types.xml`, `ref_table_num_objs` on `Table_CreatureAbility_CombatAbility` |
| the object, with its caption and description | `GameMechanics/RefTables/CombatAbilities.xdb` |

Creatures and artifacts also need a ceiling raised inside `H5_Game.exe`, because the engine
counts those two for itself. Abilities it does not: the table is loaded by the generic
loader from a descriptor of type name and path, and its size comes from types.xml.

**Names ARE resolved from data.** The executable holds a compiled chain of ability names —
and one of creature names beside it — but our creatures work, which is what proves that
chain is not the loader's path: the xdb loader resolves an enum item through the name→number
map in types.xml. A name only in the data is a name the game reads as nothing; a name in the
map is an ability, with a number, and the second tag is simply the next number.

`src/mods/ability-files.ts` owns this, and `EDITOR_ABILITIES` is the list — append-only,
because the number is what a creature's record stores. The picker offers them before the mod
that carries them is installed and reads them out of the data afterwards.

**What `ABILITY_DRAGON` is.** A TAG and nothing more: an ability with a number, a caption
and a description, carried in a creature's own record and asked about by nothing in the
engine. It is the worked example of the paragraph above — what adding an ability of ours
costs, and what it does, which is nothing until something asks.

It is deliberately not wired to the Rune of the Dragon Form. That fix repairs the engine's
own question (see [engineInternals/RULES_FIXES.md](engineInternals/RULES_FIXES.md)), and a
rune can only be cast on a creature of the Dwarves anyway, so a tag on a creature of yours
would answer a question the game never asks of it.

## Trying it: `tools/make-test-map.ts`

Two heroes on opposing teams with a stack each, and a neutral stack between them. Built by
editing one of the stock editor's own map projects rather than from a blank project,
because a playable map needs an active player, a start hero and a town.

Two things about `.h5m` that cost a launch each, both now handled:

- **Files live under `Maps/SingleMissions/<name>/` inside the archive, beside a
  `map-tag.xdb`.** The lobby indexes tags, not maps, so an archive packed at the root with
  no tag is present and invisible. The tag is generated from the map's own `<AdvMapDesc>`
  by the editor's `buildMapTag`, so it cannot drift.
- **A player has to be coloured, not merely active.** The tag's `<teams>` counts players
  that are active *and* not `PCOLOR_NEUTRAL`; a neutral-coloured player is a scripted side,
  not a lobby slot, and a map with no slots never lists. The base map's only player was
  neutral-coloured, so its team list came out empty.

## Still open

- **Whether a campaign should carry the patched executable.** The mod half is easy; handing
  someone a patched executable is not, and it is the one part a player cannot produce from
  our files alone.
- **A recolour** for the Sharpshooter, so it reads as its own unit rather than a Grand Elf
  at a glance. Cosmetic, and the model is otherwise right.
- **The remaining creatures Gem's campaign wants.** The Mummy already ships complete; see
  `<game>/h3-mod/docs/DWELLINGS.md` for the by-tier mapping and what still has to be built.
- **Merging two creature packs**, if two campaigns are ever installed together — see
  [One creature registry](#one-creature-registry-not-one-per-map).

## Sources

- [Heroes 5 Wiki: New Creature Framework (NCF)](https://heroes5.fandom.com/wiki/New_Creature_Framework_(NCF)) — the technical detail above comes from here.
- [NCF on ModDB](https://www.moddb.com/mods/heroes-v-new-creature-framework) and its [Tribes of the East tutorial](https://www.moddb.com/mods/heroes-v-new-creature-framework/tutorials/ncf-for-tribes-of-the-east)
- [MMH55 framework files](https://github.com/Might-Magic-Heroes-5-5/MMH55/tree/master/Frameworks/NewCreatureFramework) — the exe patch and the prebuilt core.
- [Original NCF thread](http://heroescommunity.com/viewthread.php3?TID=24698) by SImonak.
- Andrey Vereshchagin, "Новые юниты Heroes of Might and Magic 5" (2006) — correct on field names and text locations, wrong that new creatures are impossible; its method is substitution, which deletes an existing unit. Its warning is worth keeping: after editing creature stats the game crashed **when a hero entered a town**, so a crash on the town screen points at creature data, not at the town.
- Heroes III numbers: [Sharpshooter](https://heroes.thelazy.net/index.php/Sharpshooter), [Grand Elf](https://heroes.thelazy.net/index.php/Grand_Elf), [Marksman](https://heroes.thelazy.net/index.php/Marksman)
