# Inside the executable

What the engine actually does — read out of the binary, one subsystem at a
time, starting 2026-07-27. The reason to read it at all: the port wants content
that behaves **like shipped content**, not like a script pretending to be it.
That means finding the code the shipped artifacts, sets and specializations run
through, and it keeps turning out to be short, readable, and already
parameterised by data in most of the places that matter.

This page is the **method and the index**. Every subsystem is its own file
beside it, because they are read one at a time and the pile was 700 lines.

| what | the question it answers |
| --- | --- |
| [engineInternals/ARTIFACTS_AND_EQUIPMENT.md](engineInternals/ARTIFACTS_AND_EQUIPMENT.md) | How the engine knows what a hero is wearing; sets addressed by enum value; the one function everything goes through; the 54 artifacts whose behaviour is compiled by id. |
| [engineInternals/NECROMANCY.md](engineInternals/NECROMANCY.md) | What the raise percentage and the dark energy ceiling are made of, and which of their terms are data. |
| [engineInternals/SPECIALIZATIONS.md](engineInternals/SPECIALIZATIONS.md) | What a hero specialization is in the data and in the code, and the shape of the term one of ours adds. |
| [engineInternals/FIRST_AID_TENT.md](engineInternals/FIRST_AID_TENT.md) | The tent: what it heals, how many uses it has, where each number is decided, and reaching a hero from a war machine. |
| [engineInternals/LUA.md](engineInternals/LUA.md) | How the script API is registered, why the manuals disagree with it, and what adding a function costs. |
| [engineInternals/MODS_AND_MAPS.md](engineInternals/MODS_AND_MAPS.md) | Where the game looks for mods, why a map archive can override anything, and where the generator writes. |
| [engineInternals/EXTENSION.md](engineInternals/EXTENSION.md) | The three layers of our own extension, and what we deliberately do not do. |
| [engineInternals/BATTLE_SCRIPTING.md](engineInternals/BATTLE_SCRIPTING.md) | How the extension reaches a fight's Lua, the moment it fires on, and what a mod must not do to `combat-startup.lua`. Its reference side is [api/combat.md](api/combat.md). |

The companion documents, which are about what data and script can express
rather than about the binary: [ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md),
[EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) (generated from the executable),
[SCRIPT_API.md](SCRIPT_API.md).

## Read an unwrapped binary — on this machine, `H5_Game_H5E.exe`

`H5_Game.exe` in a Steam install has its `.text` encrypted by the wrapper:
entropy 7.98 across the section, an extra `.bind` section, and a disassembler
produces nonsense. This is not a Heroes fact, it is a Steam fact — a GOG or
retail install ships the code in the clear and needs none of this.

`bin/H5_Game_H5E.exe` is **ours**: the shipped executable copied aside under
that name (`_H5E` for Heroes 5 Editor — the copy is ours) and patched
there, never the original. Entropy 5.2, ordinary prologues, disassembles fine.

```bash
npm run unwrap-exe
```

makes that file: it copies the shipped executable when it is already clean —
the GOG and retail case, where nothing else is needed — and unwraps it with
Steamless (pinned to `v3.1.0.5`, downloaded once into `tools/vendor/`) when it
is not. An existing copy is never overwritten, because it is probably already
carrying a patched ceiling. `--check` says what each file is and writes
nothing. See `src/exe/exe-unwrap.ts`.

So the rule for reverse engineering is "read an unwrapped build", and on this
machine that file happens to be the NCF copy. `.rdata` and `.data` are
identical wrapped or not, so string and pointer addresses transfer either way;
only code needs the clean build. And since a GOG build is a different
compilation, **every address in these documents is a landmark for a pattern
search, never a constant to hardcode** — the same discipline the creature and
artifact ceiling patchers already follow.

**A reference table's size is found by the table's own name — but it is not one
site.** The registration routine has the same shape for every table — the path
string, then a `push <count>`, then the call — so the hero class and skill
ceilings were found without a single new address
([HERO_CLASSES.md](HERO_CLASSES.md)). A table may ALSO be counted by an
out-of-line `mov eax,N; ret` that the code calls, and that number is as binding
as the pushed one: the skill table's sits at `0xb1ef80` with fifteen callers, and
until it moved, three perks of ours loaded, showed and were never once offered.

The twelve such one-liners beside the creature ceiling really are referenced by
nothing — searched for calls, jumps and pointers. **That fact was twice turned
into the wrong rule**: first "artifacts have no compiled ceiling"
([ARTIFACTS.md](ARTIFACTS.md)), then "the skill accessor is dead too". The
accessor that matters is somewhere else each time, so the patcher searches for
one with callers instead of assuming.

Tooling, all TypeScript: `src/exe/pe.ts` (sections, addresses, strings,
references), `src/exe/disasm.ts` (iced-x86), `src/exe/lua-registry.ts`, and the
commands in `tools/reverse/` — `lua-registry.ts` regenerates
[EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) from the binary and
`npm run test-lua-registry` fails if the two have drifted apart; `vtable.ts`
goes from an RTTI class name to its vtables; `trace.ts` disassembles, finds
callers, and intersects what several functions reach. See that folder's README
for why iced-x86 and not capstone.

## The rules that hold everywhere here

Each of these was learned by breaking something, and each applies to every
subsystem in the files above.

- **Verify the bytes before writing any.** Every address is a landmark, so a
  detour checks the prologue it expects and refuses when it does not match.
  A wrong address that is only ever READ is just as dangerous — it gets CALLED
  with a live object — so those are checked too.
- **Make the call the way the engine makes it.** When the engine reaches
  something through a vtable slot two instructions above the code you are
  cutting into, use that slot: no address has to be guessed, and it keeps
  working in a build with different offsets. This is how `CountEquipped` is
  reached, how a player hands over its heroes, and how the tent asks about a
  specialization.
- **Watch for virtual bases.** Several classes answer on a base rather than on
  the primary vtable, and the adjustment is spelled out in the code that calls
  them: `this = obj + 4 + *(int *)(*(void **)(obj + 4) + 8)`. Calling such a
  slot on the plain pointer crashes. `GetHeroStat`'s dispatch table carries the
  adjustment per stat; the first aid tent does it inline.
- **We add terms; we never answer for shipped content.** Detouring an accessor
  so our artifact reports as one of theirs would buy fifty behaviours for free
  and cost the ability to have any behaviour of our own. The shape is always
  `result = original(...) + ourTerm(config)`.
- **Measure in game; a reading is not a fact.** Three separate conclusions here
  were wrong until a battle contradicted them — an index mistaken for a
  multiplier, a tooltip computed by different code than the effect, and a heal
  capped by what was missing rather than by the amount. When a probe is cheap,
  run it before designing on top of the answer.
- **Log from inside rather than reading numbers off the screen.** The extension
  writes what it saw — the terms, the level, what it added — and that closed in
  one battle a question three evenings of relayed numbers had not.

## Open threads

- **The spellbook side.** `CountEquipped` explains stats and percentages, not a
  Scroll's spell appearing and disappearing with the item. That is a different
  mechanism and it is still unlocated — `0xb4a560` turned out to be a property
  writer, not it. It only matters if the config is to carry spells granted
  while worn; nothing else in the plan waits on it.
- Whether an eleventh artifact set has a compiled ceiling. No accessor
  returning 11 has a caller and the container is dynamic, but that is an
  absence of evidence. (The same question about an 85th SPECIALIZATION is now
  answered: it loads.)
- `GiveHeroBattleBonus(string, number, number)` and
  `WarpHeroExp(string, number)` are undocumented and their names suggest
  campaign plumbing; their bodies follow the standard preamble but were not
  read past argument parsing.
- Which vtable slots `0x174` (skill mastery), `0x328` (set count) and
  `0x368` (scripted necromancy level) belong to — naming that class would make
  every hook here easier to write.
