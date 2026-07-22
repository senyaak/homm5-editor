# The game's own type system — `data/types.xml`

Every `.xdb` in the data tree is an instance of a type declared in one 2.4 MB
file: `<game>/data/types.xml`. 775 type declarations, 3293 fields, and it was
sitting in the data folder the whole time we were inferring field sets from maps
(`docs/OBJECT_FIELDS.md`).

Read by `src/typespec.ts`, from the installed game at run time — nothing from it
is copied into this repository.

## What a declaration looks like

```xml
<Item>
  <__ClassTypeID>270082826</__ClassTypeID>
  <__ServerPtr>21053922</__ServerPtr>       <!-- how OTHER types refer to this one -->
  <Type>TYPE_TYPE_CLASS</Type>
  <TypeName>AdvMapMonster</TypeName>
  <BaseType>0b064c32</BaseType>             <!-- AdvMapObjectBase, by ServerPtr -->
  <Fields>
    <Item>
      <Type>03000000</Type>                 <!-- field's own type id -->
      <Name>Custom</Name>
      <ChunkID>3</ChunkID>
      <Constraints/>                        <!-- Min/Max for numbers -->
      <DefaultValue><Type>00000000</Type></DefaultValue>   <!-- 0 = none declared -->
    </Item>
    …
  </Fields>
  <TypeID>370347203</TypeID>
</Item>
```

## Two things that will waste an afternoon

**`BaseType` names the base's `__ServerPtr`, not its `TypeID`.** They are
different numbers on the same type, and both are present in every declaration.
Indexing by `TypeID` and looking bases up in it finds nothing at all — quietly,
with no error, just types that appear to inherit from nowhere. `AdvMapMonster`
points at `0b064c32`, which is `AdvMapObjectBase`'s `__ServerPtr`.

**Structures are `TYPE_TYPE_STRUCT`, beside the `TYPE_TYPE_CLASS` entries.** A
field's `<Type>` may point at either, and skipping structs loses exactly the
nested types worth having — `CommonObjective` (a seer hut's `Quest`), `Vec3`,
`Rect`. There are also `TYPE_TYPE_ENUM` entries; see below.

The parser splits on `<TypeName>` rather than on the enclosing `<Item>`: items
nest several levels deep (fields, constraints, entries), so matching the wrapper
means counting brackets for no gain.

## What it is authoritative about

**Field sets, with inheritance.** `AdvMapMonster` declares 20 fields; a monster
in a file carries those plus 5 from `AdvMapObjectBase`. `allFields()` resolves
the chain, base first, which is also the order fields are written in.

**Field ORDER, at any depth.** `fieldOrder()` returns the ordered names for a
type and, recursively, for each of its structured fields. That is what lets a
missing field be inserted *where it belongs* rather than appended: a seer hut's
missing `CheckDelay` lives inside `Quest`, three levels down. Verified against
the original editor's own inspector — 28 fields of `AdvMapSeerHut/Quest` came
out in exactly the order it shows them.

Recursion is depth-limited: an objective's dependencies are objectives, so the
type graph contains cycles.

**Enum members — all of them.** 97 `TYPE_TYPE_ENUM` types carry their
`<Entries>` as name/value pairs, and an object's enum field points straight at
one. This answers the standing caveat in `docs/OBJECT_FIELDS.md`, which says the
enum lists inferred from maps are a lower bound "and those would have to come
from the game's own definitions" — they exist. `AdvMapMonster.AttackType` is
`ATTACK_ANY` on all 6377 monsters in every shipped map; the spec says the type
also has `ATTACK_RANGE` and `ATTACK_MELEE`.

Watch for sentinel members: `MONSTER_MOODS_COUNT` closes `MonsterMood`, and it
is a count, not a mood. Offering it in a dropdown would be a bug.

**Constraints.** Numeric fields carry `Min`/`Max`.

## What it is NOT

**It is not a complete source of defaults.** 1092 fields across the whole file
declare a `DefaultValue`, but only 17 of them are on the 21 map object types,
and none of those are the ones that make a new object usable — a town's town
hall, a shipyard's boat four tiles out, a monster's `Amount` 0. Those are the
EDITOR's behaviour, not the type system's, and only a map the editor saved can
testify to them. See `docs/OBJECT_DEFAULTS.md`.

Where the spec does declare a default, `tools/test-defaults.ts` asserts we match
it: 29 confirmed, no conflicts, against a measurement taken independently.

## How the editor uses it

- **Placing an object** (`src/defaults.ts`): a new object is still built by
  cloning a real one, because a donor carries the file's own formatting and is
  correct by construction. But a field the donor's game version predates is now
  ADDED, in the position the spec gives it — and only when the spec says the
  type has it. Never on our schema's word alone.
- **The property panel**: fields the spec declares and the object does not carry
  are offered as "not set on this object"; setting one creates the element.
  Two independent yeses are required — the spec that the type has the field, our
  own schema for what shape it is.
- **Tests**: `tools/test-defaults.ts` (defaults vs the spec) and
  `e2e/place-objects.spec.ts` (a shipped map whose statics predate
  `TerrainAligned`/`ScalePercent`, both offered, one set, saved, and checked in
  the file).

Both skip themselves when there is no game data to read.

## A third source: the shipped PDFs — a different vocabulary, not a wrong one

`<game>/Editor Documentation/HOMM5_A2_IDs_for_Scripts.pdf` lists the script IDs
by name and number (`pdftotext -layout` reads it). It is the reference for what
**Lua** can say, and it covers ground the data does not surface as neatly:
creatures, spells, artifacts, skills, perks and class feats, town buildings,
border-guard key colours, trigger types.

**It is not interchangeable with the type system, and `weekIDs` shows why.**
114 of the 126 moon weeks match; in the other 12 slots the PDF has the
Hammers-of-Fate/Tribes-of-the-East faction weeks — `WEEK_OF_WYVERN` (4),
`WEEK_OF_SHAMAN` (7), `WEEK_OF_THANE` (19), `WEEK_OF_ORC` (21) — while
`types.xml` and the shipped maps have the older animal weeks in the same
positions. This is not inference: `Maps/CombatArenas/Beach_Snow_01/map.xdb`,
which the addon's own `a2p1-data.pak` carries, writes
`<Item>WEEK_OF_FIREFLY</Item>` and `<Item>WEEK_OF_RAT</Item>`, and
`WEEK_OF_ORC` appears in no data file at all.

The numbers are beside the point for us: a map stores the **name**, so what a
select needs is the name list the map may contain. That comes from `types.xml`,
which is what the maps use. The PDF's list is what a script may name.

Rule of thumb: **map files → `types.xml`; Lua → the PDF.** Equating them is the
bug, not either source.
