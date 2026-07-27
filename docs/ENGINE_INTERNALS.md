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

## Read the NCF binary, not the Steam one

`bin/` ships four executables. `H5_Game.exe` has its `.text` encrypted by the
Steam wrapper — entropy 7.98 across the whole section, an extra `.bind`
section, and a disassembler produces nonsense. **`H5_Game_NCF.exe` is the same
program in the clear** (entropy 5.2, ordinary prologues) and it is what our
ceiling patchers already edit. `.rdata` and `.data` are identical in both, so
string and pointer addresses found in one apply to the other; only code can be
read from the NCF build.

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

Two things fall out of this.

**`MakeHeroNecromancer` is exactly what it looked like.** The scripted level is
consulted *only* when the hero's own Necromancy skill is zero — so it fits a
knight in a cloak and does nothing for a necromancer. That was the right
instinct.

**Term 7 is a worked example of what we want.** The Necromancer set's
+20% is not special-cased anywhere else: it is twenty bytes at the end of this
function that count worn set pieces, compare against a threshold, and add a
constant read from data. Anything we add for the Cloak has the same shape and
sits in the same place.

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

**Index 0 — `ARTFSET_EFFECT_CUSTOM` — appears at no call site at all.** That
settles what it is: a set the engine will parse, count, name, and draw, and
whose effect nothing in the executable implements. It is the slot the
designers left for exactly our case. The Lua side can read it directly —
`GetArtifactSetItemsCount(hero, 0, 1)` counts our worn pieces — and a native
hook can read it the same way through vtable `0x328`.

(Still to confirm in game: that the data parser accepts `CUSTOM` in a `<Sets>`
entry, and how the counter behaves if two sets declare the same enum.)

## Where a mod can cut in

Ranked by cost, cheapest first. Nothing here is implemented yet.

**1. Pure data, no code.** The Cloak joins the shipped Necromancer set: set
membership is data, the threshold and the constant are data. The hero gets
+20% necromancy through term 7 with no patch of any kind — the engine cannot
tell our artifact from Ubisoft's. The cost is that it *is* the Necromancer
set: the name, the other three pieces and the threshold come with it. Worth
trying first because it is an afternoon, not a project.

**2. One constant, patched by pattern.** `push 0x47` in the pendant term names
artifact id 71. Repointing it to our id moves the pendant's bonus to our item;
duplicating the four-instruction block would add a term. Both are small, and
both need free bytes — see the ceiling notes for how the patcher already finds
sites by pattern rather than address.

**3. A detour on `0xc77850`.** Call the original, add our own terms with the
hero object in hand. This is the general form of term 7 and it scales to any
number of artifacts without touching the shipped logic.

**4. A proxy DLL.** The game imports a local `zlib1.dll` (also `granny2.dll`,
`fmod.dll`) — a forwarding stub gets our code into the process with no patched
byte in the executable at all. From there: register new Lua functions in the
live state, install the detours above, and read a **config the map editor
generates** — which artifact ids contribute what, which sets exist, what each
threshold gives. That is the shape that lets the editor add and remove effects
without recompiling anything, and it is the honest answer to "make it work
like the original".

The pieces that make (4) tractable are all present: a documented registration
convention, a signature grammar the parser already enforces, an unclaimed set
enum, and a necromancy sum whose terms are twenty bytes each.

## Open threads

- **Dark energy.** `GetPlayerNecroEnergy` exists with no setter, as known. The
  strings `NecroEnergy`, `EnergyBase`, `EnergyPerNecromancyAmplifier` are
  there; the daily/weekly grant that writes the value has not been located yet
  — the wrapper's call chain was followed to the wrong branch and the debug
  strings near it (`"Energy = "`) have no code xref, so it needs a different
  approach (probably the town/day-tick code, or watching the field offset the
  getter reads). Since the plan is "just restore it every day", finding the
  write site is enough; no new mechanic is needed.
- `GiveHeroBattleBonus(string, number, number)` and
  `WarpHeroExp(string, number)` are undocumented and their names suggest
  campaign plumbing; their bodies follow the standard preamble but were not
  read past argument parsing.
- Which vtable slots `0x174` (skill mastery), `0x328` (set count) and
  `0x368` (scripted necromancy level) belong to — naming that class would make
  every hook here easier to write.
