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

`bin/H5_Game_NCF.exe` is **ours**: the shipped executable copied aside under
that name (the `_NCF` convention the modding scene already uses) and patched
there, never the original. Entropy 5.2, ordinary prologues, disassembles fine.

```bash
npm run unwrap-exe
```

makes that file: it copies the shipped executable when it is already clean —
the GOG and retail case, where nothing else is needed — and unwraps it with
Steamless (pinned to `v3.1.0.5`, downloaded once into `tools/vendor/`) when it
is not. An existing copy is never overwritten, because it is probably already
carrying a patched ceiling. `--check` says what each file is and writes
nothing. See `src/exe-unwrap.ts`.

So the rule for reverse engineering is "read an unwrapped build", and on this
machine that file happens to be the NCF copy. `.rdata` and `.data` are
identical wrapped or not, so string and pointer addresses transfer either way;
only code needs the clean build. And since a GOG build is a different
compilation, **every address in this document is a landmark for a pattern
search, never a constant to hardcode** — the same discipline the creature and
artifact ceiling patchers already follow.

Tooling, all TypeScript: `src/pe.ts` (sections, addresses, strings,
references), `src/disasm.ts` (iced-x86), `src/lua-registry.ts`, and the
commands in `tools/reverse/` — `lua-registry.ts` regenerates
[EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) from the binary and
`npm run test-lua-registry` fails if the two have drifted apart; `vtable.ts`
goes from an RTTI class name to its vtables; `trace.ts` disassembles, finds
callers, and intersects what several functions reach. See that folder's README
for why iced-x86 and not capstone.

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

## Hunting the equipment aggregator

Not found yet. This is what the search established, so the next attempt starts
here rather than at the beginning.

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
swap), and those two apply methods share three helpers directly, one of which
— `0xb4a560` — carries the string `spell_name`. That is almost certainly the
scroll mechanism: the artifact's spell going into or out of the hero's book,
which is the effect no script API can reproduce.

**A hook belongs at that shared level, not on the UI command.** Anything
attached to `CSwapMoveArtifactCmd` would miss a script removal, a quest taking
an item away, and a hero dying; anything below the commands sees all of them.

**Ruled out along the way**, so the next pass does not re-walk them:
`0xed427c` and `0xed4dfa` read the stats but compare `CostOfGold` against
10000 — that is the AI valuing an artifact. `0xb4a3d7` and `0xb4aa0f` read the
record after the getter but build tooltips (`ARTIFACT_NAME_MINOR`, per-id
special text).

**The working hypothesis** for why no code reads the six stat fields together:
the stats are applied to the hero **when the artifact is equipped**, not summed
each time a stat is read. If that holds, there is no aggregator to find — there
is an apply-and-undo pair inside the command layer, which is a better hook
anyway, and `0xb4a560` is one end of it.

Next: identify the equipped-collection class behind hero vtable `+0x74` (its
`contains` is `0xb4c270`, `0xb4cbe0` for the backpack), and read `0xb4a560`
through.

## Open threads

- **Dark energy.** `GetPlayerNecroEnergy` exists with no setter, as known. The
  strings `NecroEnergy`, `EnergyBase`, `EnergyPerNecromancyAmplifier` are
  there; the daily/weekly grant that writes the value has not been located yet
  — the wrapper's call chain was followed to the wrong branch and the debug
  strings near it (`"Energy = "`) have no code xref, so it needs a different
  approach (probably the town/day-tick code, or watching the field offset the
  getter reads). Since the plan is "just restore it every day", finding the
  write site is enough; no new mechanic is needed.
- **The equipment aggregator** — see the section above for where the hunt got to.
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
