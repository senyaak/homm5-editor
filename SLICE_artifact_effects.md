# SLICE — Artifact effects that the engine treats as its own

> **Status:** reconnaissance done, nothing built yet. Adding an artifact already
> works (`Maps/sod/docs/ARTIFACTS.md` in the maps repo) but a new id gets **no
> properties**: every special behaviour the shipped artifacts have is compiled
> against a specific id. This slice makes our own artifacts carry real
> properties — our own set, our own effect id, our own numbers — through the
> engine's own arithmetic rather than a script imitating it from outside.
> When it ships, fold the findings into [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md)
> and retire this file.

Reading first: [docs/ARTIFACT_EFFECTS.md](docs/ARTIFACT_EFFECTS.md) (what data
and script can express), [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md)
(what the binary does), [docs/EXE_LUA_REGISTRY.md](docs/EXE_LUA_REGISTRY.md)
(every function the engine hands to Lua).

---

## 1. Scope

1.1. **In:**
- а) **Finish the reverse.** Find where the engine applies and removes an
  equipped artifact's contribution. Three threads converge on it: read
  `0xb4a560` through (the helper carrying `spell_name`, shared by give and
  swap), identify the equipped-collection class behind hero vtable `+0x74`,
  and untangle the virtual base the stat getters hang off. Also locate the
  write site for dark energy, approaching from the day tick rather than the
  getter.
- б) **Prove the data premises in game, before any code.** Declare our own
  `ARTFSET_EFFECT_<ours> = 11` in `types.xml` plus a set in `DefaultStats`
  using it, and see whether the parser accepts it, whether the tooltip draws,
  and whether `GetArtifactSetItemsCount` counts our worn pieces. Separately:
  does an eleventh set hit a compiled ceiling.
- в) **Prove the native path.** A proxy DLL forwarding `zlib1.dll` — no patched
  byte in the executable — carrying two proofs on top: one new Lua function
  callable from a map script, and one detour adding a term to the necromancy
  sum so the percentage visibly moves in game.
- г) **Make it editable.** The DLL hardcodes nothing: it reads a table saying
  which set, which threshold, which kind of bonus, how much — and the editor
  generates and edits that table.
- д) **The Cloak of the Undead King set itself**, for the Heroes III port.

1.2. **Out (deferred — "потом"):**
- а) The green bonus line in the hero screen. The UI draws known effects per id
  out of the executable; our bonus will work without appearing there. Сеня:
  «юай не важно — статы должны найти».
- б) Percentage damage riders (`+50% fire`, the Trident family) and anything
  touching the damage formula. There is no damage hook in any script API and no
  cheap seam in the engine; revisit only if the equipment path turns out to
  generalise.
- в) A general modding SDK. This slice serves the port, not an audience.

## 2. Why — where the wall actually is

2.1. **Data stops at six numbers.** An artifact record carries name, slot,
price, visuals and `HeroStatsModif` — attack, defence, knowledge, spell power,
morale, luck. Nothing else. Every other shipped behaviour is compiled against
an id.

2.2. **A script cannot close the gap honestly.** It can poll and add stat
deltas, but there is no equip event to hang off, no way to unlearn a spell it
granted, and no access to combat numbers. NAF ran into exactly this and shipped
permanent spell artifacts as the compromise. Сеня: «мы делаем своё — не криво
переиспользуем существующее».

2.3. **But the engine's own bonuses are already data-parameterised**, which is
what makes this affordable. The necromancy percentage is one sum at `0xc77850`
whose last term is *"count worn pieces of set 5, if ≥ 4 add a constant read
from `DefaultStats`"*. That is twenty bytes. A term of our own is the same
twenty bytes with our set id and our number.

2.4. **And there is one place that sees every route.** `GiveArtefact` from Lua
does not touch the hero — it posts a `CGiveArtefactCmd`. So do the hero screen
(`CSwapMoveArtifactCmd`), the market, the altar. There is no separate script
path to miss, which answers the objection that a hook on the UI command would
skip a quest removal or a hero's death. Сеня: «я говорил не про клик — а про
триггер».

## 3. Model — four layers, each useful before the next exists

3.1. **Data declares that our set exists.** `ArtifactSetEffect` is an ordinary
enum in `types.xml`, so we append our own value rather than borrowing
`ARTFSET_EFFECT_CUSTOM` (the developers' own "no predefined effect" slot) or
overwriting a shipped one. From here the game counts worn pieces, names the set
and draws its tooltip, and Lua can already read the count.

3.2. **Native code makes the effect real.** A proxy DLL installs detours where
the engine sums its own bonuses. The result then flows through the engine's
arithmetic, its caps and its display — which is the whole meaning of
"indistinguishable from a shipped artifact".

3.3. **A config makes it editable.** Which id or set contributes what, at which
threshold, how much. Written by the editor, read by the DLL.

3.4. **Lua functions are a third face of the same table**, for a map or
campaign that wants to read or adjust bonuses at runtime — never the mechanism
an artifact depends on.

## 4. Touchpoints

| File | Change |
| ---- | ------ |
| `types.xml` (in the mod archive) | Append `ARTFSET_EFFECT_<ours> = 11` to the `ArtifactSetEffect` enum. Append-only: the value is what saves and maps store. |
| `GameMechanics/RPGStats/DefaultStats.xdb` | A `<Sets>` entry using that effect — members, per-count texts and icons. |
| new: the proxy DLL | Forwards `zlib1.dll`, registers Lua functions, installs detours, reads the config. Built outside this repo; the editor ships and configures it. |
| new: `src/artifact-effects.ts` | The config model + writer — what the DLL reads. |
| [src/artifacts.ts](src/artifacts.ts) | Emit the enum entry and the set alongside the existing artifact records. |
| [src/artifact-limit.ts](src/artifact-limit.ts) | Unchanged in shape; the ceiling still gates whether new ids resolve at all. |
| [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) | Fold in what §1.1(а) finds; drop the hunt notes once the answer is in. |
| the editor UI | Editing effects per artifact and per set — the point of §1.1(г). |

Verification is in game, with a control: a shipped artifact on the same hero by
the same route. Three of the four wrong answers last time would have been
skipped by having one (`Maps/sod/docs/ARTIFACTS.md`).

## 5. Open questions (need a call before code)

5.1. **Does an added enum value parse?** The whole "our own effect" premise. If
the parser rejects it, fall back to `ARTFSET_EFFECT_CUSTOM` — same mechanics,
someone else's name. Answered by §1.1(б), an afternoon.

5.2. **Is there a ceiling on the number of sets?** The container is dynamic and
no accessor returning 11 has a caller, so probably not — but that is an absence
of evidence, and the creature and artifact ceilings both looked absent until
they were found.

5.3. **Where does equipment get applied?** Still unfound. If it turns out to
have no single seam, the fallback is a detour per sum — we already know the
necromancy pair by address, and the same shape should hold for the others.

5.4. **Dark energy.** Decided: restore it daily rather than model it — Сеня.
Needs only the write site, not a new mechanic.

5.5. **How far does the config go?** Minimum is stat and necromancy
contributions per set threshold. Whether it should also carry spells granted
while worn depends on what §1.1(а) finds — the engine clearly has that
machinery, since a Scroll loses its spell the moment it comes off.
