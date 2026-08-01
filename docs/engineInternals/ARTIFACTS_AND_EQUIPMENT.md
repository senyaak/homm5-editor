# Artifacts: sets, equipment, and the one function that answers

*Answers: how the engine knows what a hero is wearing, where an artifact's
effect can live at all, and what a new id does NOT get.*

The longest part, and deliberately one file: `CountEquipped` is the single door
every one of these goes through — the sets, the stats, the fifty-four artifacts
whose behaviour is compiled by id — and split apart they stop being one
argument. What data and script can express instead is
[ARTIFACT_EFFECTS.md](../ARTIFACT_EFFECTS.md).

## `HasArtefact` has a third argument: worn versus carried

`HasArtefact(hero, artefactId, [onlyEquipped = 0])`, at `0x5d2300`:

```
call 0xb1ef60          ; the artifact-count ceiling (our patched 97)
cmp  ebx, eax          ; artefactId out of range -> "Invalid artefact ID %d"
call [eax + 0x74]      ; the hero's EQUIPPED collection
call 0xb4c270          ; ...contains artefactId?
test edi, edi          ; the third argument
jne  not_found         ; set -> stop here, equipped only
call [eax + 0x78]      ; otherwise the BACKPACK collection
call 0xb4cbe0          ; ...contains artefactId?
```

So worn-state detection needs no artifact set and no polling trick beyond
reading it: `HasArtefact(hero, id, 1)` is true only while the item is worn.
This corrects the earlier note that only `GetArtifactSetItemsCount` could tell
the difference. Vtable slot `0x74` (equipped) is the same one the necromancy
code uses to find the Pendant, below.

## Artifact sets are addressed by enum value

`<Effect>` in `DefaultStats.xdb` is a name; the engine works with its number.
The order in the exe's string table is the enum:

```
0 CUSTOM   1 DRAGONISH  2 DWARVEN  3 LIONS   4 MAGIS  5 NECROMANCERS
6 EDUCATIONAL  7 HUNTERS  8 OGRES   9 RUNIC  10 DEMONIC
```

`GetArtifactSetItemsCount` is a virtual call, vtable slot `0x328`. It is
called from **25 sites**, and their set indices are 1–10 — every shipped set,
several of them more than once (the necromancy sum uses index 5 twice: the
raise bonus and the raise-cost discount).

**Index 0 — `ARTFSET_EFFECT_CUSTOM` — appears at no call site at all**, and the
developers say why. `types.xml` documents the field in their own words:

> один из предопределённых эффектов сетов (ARTFSET_EFFECT_CUSTOM — нет
> предопределённого эффекта, но можно добавить скриптами)

So `CUSTOM` is not an unused leftover; it is the designers' own hook for a set
whose effect comes from outside the engine.

### The enum itself is data

`ArtifactSetEffect` is declared in **`types.xml`** as an ordinary enum — the
same `<Name>`/`<Value>` pairs as the artifact list we already extend:

```xml
<Type>TYPE_TYPE_ENUM</Type>
<TypeName>ArtifactSetEffect</TypeName>
<Entries>
    <Item><Name>ARTFSET_EFFECT_CUSTOM</Name><Value>0</Value></Item>
    <Item><Name>ARTFSET_EFFECT_DRAGONISH</Name><Value>1</Value></Item>
    …
    <Item><Name>ARTFSET_EFFECT_DEMONIC</Name><Value>10</Value></Item>
</Entries>
```

**A mod can therefore declare its own effect** — `ARTFSET_EFFECT_<OURS>` with
value 11 — instead of borrowing `CUSTOM` or overwriting a shipped one. Same
append-only discipline as artifact ids: values are what saves and maps store.

Unlike the artifact table, the sets are parsed into a **dynamic container**
(`ArtifactSets` → `[ebx+0x111c]`, alongside `MonstersArmy` and
`ArtifactsSetsEffectsConsts` → `[ebx+0x1148]`), and no accessor returning a
set count of 11 has any caller — so there may be no compiled ceiling here at
all. That is a hopeful reading of an absence, not a proof; the eleventh set is
a probe to run, not a fact to rely on.

The engine will still do **nothing** for a new enum value — no shipped code
branches on it. That is the point: the count and the UI come free from data,
the behaviour is ours to write, and nothing shipped is displaced.

(To confirm in game: that the parser accepts an added enum entry, that an
eleventh set draws its tooltip, and how the counter behaves if two sets
declare one enum.)

## Where equipment is read

There is no aggregator. Finding that out took a detour through the artifact
record, the stat getters and the command layer, and all of it is worth keeping,
because it is what a hook has to be written against.

**An artifact record's stats, in memory.** The loader names each field as it
parses it, which gives the layout directly: `CostOfGold` at +0x34, `AIValue`
+0x38, `CanBeGeneratedToSell` +0x3c, and `HeroStatsModif` at **+0x40** (the
parser does `add ecx, 0x40` before calling the sub-parser at `0xb1a1b0`).
Inside that struct: Attack +4, Defence +8, Knowledge +0xc, SpellPower +0x10,
Morale +0x14, Luck +0x18.

**How a hero's effective stats are read.** `GetHeroStat` dispatches through a
table of three-dword entries at `0x108db8c` — {thunk, this-adjustment, virtual
base displacement} per `STAT_*` id — and each thunk jumps to a vtable slot:

| stat | slot | | stat | slot |
|---|---|---|---|---|
| Experience | `+0x1a4` | | Knowledge | `+0x1c` |
| Attack | `+0x10` | | Luck | `+0x13c` |
| Defence | `+0x14` | | Morale | `+0x140` |
| SpellPower | `+0x18` | | | |

The dispatch adjusts `this` through a **virtual base**, so those slots belong
to a base class of `CAdvMapHero` rather than to its primary vtable — which is
why reading `CAdvMapHero`'s own vtable at `+0x10` lands somewhere unrelated.
Resolving that base is the next step. `tools/reverse/vtable.py` turns any RTTI
class name into its vtables and the functions in any slot.

**A scan that proved nothing, and why it looked like it did.** Searching `.text`
for code reading several of the six stat offsets close together first came back
empty, which read as "the sum does not walk these fields". That conclusion was
an artefact of the tool: capstone stops decoding at the first byte it cannot
make sense of, and a whole `.text` is full of them, so the scan quietly covered
a fraction of the section. Re-run with a decoder that keeps going
(`node tools/reverse/trace.ts field 0x44 0x48 0x4c 0x50 0x54 0x58`) it finds
55 772 reads and 5 723 neighbourhoods touching three or more — far too many to
point anywhere, since `+0x44` is also every other structure and stack frame.

So the honest state is: this approach says nothing either way, and the result
that matters came from the command layer below.

**The artifact table, resolved.** `0xb1ef70` is the record getter, and it is
four instructions:

```
mov  eax, [0x1205ac8]   ; the loaded artifact table
imul ecx, ecx, 0x74     ; a record is 0x74 bytes
add  eax, 8             ; records start past the header
add  eax, ecx
ret
```

So a record is **0x74 bytes**, the table hangs off a single global, and 26
places call this getter. Every one of them bounds-checks the id against
`0xb1ef60` first — the ceiling accessor our patcher already edits, which is
why raising it is what makes new ids reachable at all.

### Every artifact change is a command

This is the part that matters for hooking, and it answers the question of
whether one hook can cover every route an artifact takes.

`GiveArtefact` from Lua does not modify the hero. It allocates a 0x1c-byte
object, writes a vtable into it, and posts it: `CGiveArtefactCmd`. Its
siblings, by RTTI: **`CRemoveArtefactCmd`**, **`CSwapMoveArtifactCmd`** (the
hero screen putting one on or taking one off), `CCreateArtifactCmd`,
`CBuyBlackMarketArtifactCmd`, `CSellArtifactInTownMarket`,
`CSacrificeArtifactOnAltar`, and the micro-artifact family.

The engine has no separate "script path" and "UI path" — the script *is* a
command, the same as the click. A command's vtable has a small wrapper at
`+0xc` and the real work at `+0x1c` (`0xb2d030` for give, `0xb2a790` for
swap), and those two apply methods share three helpers directly.

One of those helpers, `0xb4a560`, carries the string `spell_name`, and it was
read as the scroll mechanism — the artifact's spell entering or leaving the
hero's book. **It is not.** Read through, it switches on the artifact's id
(`[this+0x28]`, values 3, 0x34, 0x56 — the scroll and wand family) and writes
key/value pairs into an object passed in: `spell_name`, then `charges_cur` and
`charges_max` off a sub-object at `+0x1c`, through the setters `0xc95580`
(string) and `0xc954d0` (integer). It is a property-bag writer — description,
serialisation or network state — and it grants nothing.

**A hook belongs at that shared level, not on the UI command.** Anything
attached to `CSwapMoveArtifactCmd` would miss a script removal, a quest taking
an item away, and a hero dying; anything below the commands sees all of them.

**Ruled out along the way**, so the next pass does not re-walk them:
`0xed427c` and `0xed4dfa` read the stats but compare `CostOfGold` against
10000 — that is the AI valuing an artifact. `0xb4a3d7` and `0xb4aa0f` read the
record after the getter but build tooltips (`ARTIFACT_NAME_MINOR`, per-id
special text).

**The working hypothesis was wrong, and the answer is better than the
hypothesis.** The guess was that stats are applied to the hero when an artifact
is equipped, so there would be an apply-and-undo pair in the command layer.
There is no such pair. The engine asks what is worn **at the moment it needs
the answer**, inside each calculation, and it asks through one function.

## The one door: `CountEquipped`

`0xb4c270` — reached as hero vtable `+0x74` then a call — is thirty
instructions:

```
for (a in this->artifacts)          ; a plain vector, stride 4
    if (a == null) continue
    if (*(int*)((char*)a + a->vbase + 8) < 0) continue   ; slot < 0 = not worn
    if (a->id != wanted) continue                        ; id is at +0x28
    n++
return n
```

Three facts fall out of those thirty instructions:

- an artifact object keeps its **id at `+0x28`** (the same field `0xb4a560`
  switches on) and its **equipped slot at `+8` off its virtual base**, negative
  meaning "in the backpack";
- hero vtable **`+0x74` returns the artifact collection**, which is what the
  necromancy sum was already using without it being named;
- the function answers *how many of artifact N are worn* — so it is the
  equipment query, not a helper beside one.

**It has 75 call sites and nothing competes with it.** Its neighbours in the
same class are an index accessor (`0xb4c9e0`, 23 calls), a reference-release
loop (`0xb4d3a0`) and two bounds-checked record getters (`0xb4cf90`,
`0xb4cfb0`); none of them takes an artifact id. The Lua `HasArtefact` goes
through it too.

### What the engine hardcodes, by id

The 75 sites sit in **36 functions** and name **54 distinct artifacts**. This is
the complete list of behaviour the executable owns per id — the thing a new
artifact does not get, spelled out:

| function | artifacts it asks about |
|---|---|
| `0xab9db0` | Werewolf Claw Necklace |
| `0xab9e40` | Boots of Swiftness, Whispering Ring |
| `0xab9f10` | Ring of Haste, Ring of Celerity, the five Dragon pieces, Ogre Club, Ogre Shield |
| `0xaba230` | Ring of Life |
| `0xabb2c0` | Werewolf Claw Necklace ×2, Boots of Swiftness, Whispering Ring |
| `0xabbe50`, `0xabc1f0` | Dragon Talon Crown |
| `0xad4bb0` | Ring of the Magi |
| `0xad8bc0`, `0xc24ac0`, `0xc3cc00` | Angel Wings, Boots of Levitation |
| `0xb6d890` | Staff of Vexings |
| `0xb6e300` | Unicorn Horn Bow, Shawl of the Great Lich |
| `0xb76ea2` | Twisting Nether |
| `0xb85e40` | Titan's Trident, Evercold Icicle, Phoenix Feather Cape, Earthsliders |
| `0xb869b0` | Iceberg Shield, Dwarven Smithy Hammer, Ring of Lightning Protection, Dragon Flame Tongue, Bearhide Wraps, Rigid Mantle |
| `0xb86fd0` | Ring of Death, the four Dwarven Mithral pieces, Staff of the Magi, Plate Mail of Stability, Boots of Interference |
| `0xc1c940` | Golden Sextant |
| `0xc24b00` | Wayfarer Boots, Angel Wings |
| `0xc25010` | Endless Sack of Gold, Endless Bag of Gold, Horn of Plenty |
| `0xc25830`, `0xc28d10` | Pendant of Mastery |
| `0xc25d40` | Helm of Enlightenment, Chain Mail of Enlightenment |
| `0xc27cf0` | Crown of Many Eyes |
| `0xc52920` | Shackles of War ×2 |
| `0xc77270`, `0xc77850` | Necromancer's Pendant — cost and raise |
| `0xcbad70` | Unicorn Horn Bow |
| `0xd52d20` | Nightmarish Ring, Cloak of Mourning |
| `0xd534a0` | Cloak of Mourning, Jinxing Band |
| `0xd55cc0` | Mask of the Doppelganger |
| `0xdca200` | Ring of Celerity |

`node tools/reverse/equipment.ts` rebuilds that table from the binary, so it can
be checked rather than trusted.

`0xab9f10` reads as the movement calculation, which the names confirm and the
arithmetic seconds: `+20` for a Ring of Haste, `×10` per Ring of Celerity,
`×5`/`×10` per Dragon piece, `−5` per Ogre item, clamped at `−100`, then
`(100 + sum)` scaled. Every entry in the table has that same shape — count,
multiply by a constant, add.

### What this means for the extension

**We add terms; we never answer for a shipped artifact.** It is tempting to
detour `CountEquipped` itself and have our Cloak report as a Necromancer's
Pendant — one hook, fifty behaviours for free. Do not: that is the engine's
answer about *its* artifact, and taking it over means our effect can only ever
be a copy of one the developers already wrote, sized by their number. Sums
would also stop being trustworthy, since the pendant term and ours would be
indistinguishable to anything reading them.

So the extension is one shape, applied per calculation:

```
result = original(...)                       ; the engine's own answer, untouched
       + ourTerm(hero, config)               ; our set, our threshold, our number
```

and `ourTerm` **calls** `CountEquipped` rather than replacing it — it is already
the right function for "how many of artifact N is this hero wearing", it stays
the engine's, and we ask it about our own ids.

That is exactly term 7 of the necromancy sum: count worn pieces of a set,
compare against a threshold, add a number that came from data. Twenty bytes.
Ours is the same twenty bytes reading our own set and our own number, appended
where the engine finished its own.

**So the catalogue above is a map of extension points, not of things to
impersonate.** Thirty-six functions is where an artifact effect can live at all
in this engine; each one is a place our config may add a term, and every one we
do not touch keeps behaving exactly as it shipped.
