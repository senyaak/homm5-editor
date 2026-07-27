# Inside the executable: necromancy, artifact sets, and where a mod can cut in

What the engine actually does with artifact ids, read out of the binary on
2026-07-27. The companion documents are
[ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md) (what data and script can express)
and [EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) (every function the engine
hands to Lua, with the argument list the engine itself checks).

The reason to read the binary at all: the port wants a Cloak of the Undead
King that behaves **like a shipped artifact**, not like a script pretending to
be one. That means finding the code the shipped artifacts run through, and it
turned out to be short, readable, and already parameterised by data in most
of the places that matter.

## Read an unwrapped binary — on this machine, `H5_Game_NCF.exe`

`H5_Game.exe` in a Steam install has its `.text` encrypted by the wrapper:
entropy 7.98 across the section, an extra `.bind` section, and a disassembler
produces nonsense. This is not a Heroes fact, it is a Steam fact — a GOG or
retail install ships the code in the clear and needs none of this.

`bin/H5_Game_NCF.exe` here is **ours**: `setCreatureLimit` copies the shipped
executable aside under that name (the `_NCF` convention the modding scene
already uses) and patches the copy, never the original. The editor **does not
unwrap anything** — `readExe` detects a wrapped file and fails with a message
saying so, and unwrapping is a one-off done outside the editor. The copy in
this install is clean because it was made from an already-unwrapped
executable; entropy 5.2, ordinary prologues, disassembles fine.

So the rule for reverse engineering is "read an unwrapped build", and on this
machine that file happens to be the NCF copy. `.rdata` and `.data` are
identical wrapped or not, so string and pointer addresses transfer either way;
only code needs the clean build. And since a GOG build is a different
compilation, **every address in this document is a landmark for a pattern
search, never a constant to hardcode** — the same discipline the creature and
artifact ceiling patchers already follow.

Tooling: capstone via the system Python. `scratchpad/pe.py` (section map,
VA↔offset, string reader, xref and call scanners, annotated disassembly) and
`scratchpad/sigs.py` (signature extraction) are throwaway helpers — if this
work continues they belong in `tools/`.

## How Lua functions are registered

Seven null-terminated arrays of `{name pointer, function pointer}` pairs in
`.data`, 298 entries. Each function starts by copying a **format string** and
its own name to the heap and handing both to the argument parser at
`0xa454d0`, which validates the call and names the function in any error.
The format is a small grammar: `s` string, `n` number, `b` bool, `f` float,
`[default]` for an optional argument. That is how
[EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) can list a real signature for every
function, including the 129 the manuals never mention.

Two consequences for us:

- **The manuals are incomplete and occasionally wrong.** `HasArtefact` is
  documented as two arguments and compiles as `snn[0]`.
- **Adding a function is mechanically simple.** A new entry is a name string, a
  C function following the same convention, and a pointer pair. The tables are
  packed with no slack, so extension means relocating a table (and fixing the
  one pointer that names it) or repointing an existing entry — either is a
  handful of bytes. The heavy lifting, argument parsing, is already there.

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

## The necromancy percentage, in full

One function at `0xc77850`, called from `0xc77c35`, returns the raise
percentage. It is a plain sum, and every term prints itself to the debug log
(`"necromancy skill raise "`, `"lord of undead raise "`, …), which is what made
it findable. Each term is capped at 100 individually; `[ebp+N]` are fields of
the `Necromancy` block of `DefaultStats.xdb`, i.e. **the numbers are data**.

| # | term | how the engine finds it | number |
|---|---|---|---|
| 1 | base | — | `RaisePercentBase` (10) |
| 2 | skill | `GetSkillMastery(15)`; **if the hero has no Necromancy skill, falls back to the level set by `MakeHeroNecromancer`** | × `RaisePercentPerSkillLevel` (10) |
| 3 | Lord of Undead | `GetSkillMastery(0x65)` (perk 101) | `LordOfUndeadBonus` (5) |
| 4 | amplifiers | count of the town buildings | × `NecromancyAmplifierBonus` (10) |
| 5 | Obelisk of Confined Souls | the Necropolis grail building | × `GrailBonus` (50) |
| 6 | **Necromancer's Pendant** | `equipped.contains(0x47)` — artifact id **71**, a literal in the code | `NecroPendantBonus` (10) |
| 7 | **the Necromancer set** | `GetArtifactSetItemsCount(5) >= 4` | `Necromancers_4Necromancer_NecromancyBonusPercents` (20) |

The **raise cost** is a second, near-identical function at `0xc77270`, and the
two are easy to confuse. It sums a discount the same way — Pendant by the same
literal id 71 (`NecroPendant_CreatureCostDisountPercents`, 10) plus the same
set at ≥ 4 pieces (`…CreatureCostDisountPercents`, 25) — caps it at 100, and
folds it into `(100 − discount) × power / (CreaturePowerPointsForOneEnergy ×
100)`. The two set constants sit in adjacent fields (`+0x119c` raise,
`+0x11a0` cost), which is how they were told apart.

So four worn pieces give **both**: +20% to the raise *and* −25% off the cost.
An in-game description that mentions only the discount is describing one of
the two.

Two things fall out of this.

**`MakeHeroNecromancer` is exactly what it looked like.** The scripted level is
consulted *only* when the hero's own Necromancy skill is zero — so it fits a
knight in a cloak and does nothing for a necromancer.

**Term 7 is the shape our own bonus should take.** It is twenty bytes: count
worn pieces of a set, compare against a threshold, add a number that came from
data. Nothing about it is special-cased elsewhere in the engine. A term for
our own set is the same twenty bytes reading our own number — which is the
whole design, and the reason the next section is short.

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

## The shape of our own extension

The goal is a Cloak of the Undead King that the engine treats as its own, with
**our** set, **our** effect id and **our** numbers — not our artifact wearing
Ubisoft's set, and not a shipped enum quietly repurposed. Everything above says
that is affordable, because the engine's own bonuses are already
data-parameterised and the seams are named.

Three layers, and each is useful before the next exists.

**Data — declares that our set exists.** `types.xml` gains
`ARTFSET_EFFECT_<OURS> = 11`; `DefaultStats.xdb` gains a `<Sets>` entry using
it, with members, per-count texts and icons. From here the game already counts
worn pieces, names the set and draws its tooltip, and
`GetArtifactSetItemsCount(hero, 11, 1)` answers from Lua. No shipped byte
changed, nothing borrowed.

**Native code — makes the effect real.** A proxy DLL is the way in: the game
imports a local `zlib1.dll` (also `granny2.dll`, `fmod.dll`), so a forwarding
stub loads our code with no patched executable at all. It then installs
detours where the engine sums its own bonuses — `0xc77850` for the necromancy
percentage, `0xc77270` for the raise cost, and the equipment aggregator for
plain stats once it is found. Each detour calls the original and adds our
terms: exactly term 7's twenty bytes, in our own code, reading our own
numbers. The result goes through the engine's own arithmetic, its own caps and
its own display — which is what "indistinguishable from a shipped artifact"
actually means.

**A config the editor writes — makes it editable.** The DLL should hardcode
nothing: it reads a table saying *which set id, which threshold, which kind of
bonus, how much*, and the map editor generates that table. Add an artifact,
change a percentage, drop an effect — all of it is editing data in the editor,
not rebuilding a DLL. This is the requirement that decides the DLL's design,
so it belongs in the first version, not a later one.

New Lua functions (registered by the same DLL, following the convention above)
are the third face of the same table: useful for a map or campaign to
read and adjust bonuses at runtime. But they should not be how the *artifact*
works — an artifact whose bonus depends on a script running is exactly the
seam we are trying not to have.

**Two cheap experiments worth running first**, because each answers a question
the design rests on:

- *Does an added enum work?* Declare set 11 with one artifact, load a map, see
  whether the parser accepts it and the tooltip draws. This is the whole "own
  enum" premise, and it is an afternoon.
- *Does a set bonus reach the engine's arithmetic?* Temporarily put the Cloak
  in the shipped Necromancer set and confirm the raise percentage moves. Not a
  design — a control, the kind that would have saved four wrong answers last
  time (`Maps/sod/docs/ARTIFACTS.md`). Then take it back out.

**And the piece still missing:** the equipment aggregator — the code that
rebuilds a hero's stats and spellbook from what is worn. Its existence is not
in doubt (a Scroll grants a spell and loses it the moment it comes off, which
no script API can do), and it is the natural home for stat contributions from
new artifacts. Finding it is the next reverse-engineering job, and it matters
more than anything else on this list.

## Open threads

- **Dark energy.** `GetPlayerNecroEnergy` exists with no setter, as known. The
  strings `NecroEnergy`, `EnergyBase`, `EnergyPerNecromancyAmplifier` are
  there; the daily/weekly grant that writes the value has not been located yet
  — the wrapper's call chain was followed to the wrong branch and the debug
  strings near it (`"Energy = "`) have no code xref, so it needs a different
  approach (probably the town/day-tick code, or watching the field offset the
  getter reads). Since the plan is "just restore it every day", finding the
  write site is enough; no new mechanic is needed.
- **The equipment aggregator** (see above) — the most valuable unfound thing.
- Whether an eleventh artifact set has a compiled ceiling. No accessor
  returning 11 has a caller and the container is dynamic, but that is an
  absence of evidence.
- `GiveHeroBattleBonus(string, number, number)` and
  `WarpHeroExp(string, number)` are undocumented and their names suggest
  campaign plumbing; their bodies follow the standard preamble but were not
  read past argument parsing.
- Which vtable slots `0x174` (skill mastery), `0x328` (set count) and
  `0x368` (scripted necromancy level) belong to — naming that class would make
  every hook here easier to write.
