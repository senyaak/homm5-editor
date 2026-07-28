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
- а) ~~**Finish the reverse.**~~ **Done.** There is nothing to hook on equip:
  the engine asks *"how many of artifact N are worn"* at the moment it needs
  the answer, through one function, `0xb4c270`. It has 77 call sites in 36
  functions naming 50 artifacts, and no rival — that is the entire per-id
  behaviour the executable owns.
  [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) carries the catalogue.
  Still open, and only for §1.1(д): the write site for dark energy, and
  whatever grants a Scroll's spell (it is not `0xb4a560`, which turned out to
  be a property-bag writer).
- б) **Prove the data premises in game, before any code.** *Built:*
  `addArtifactSet` emits our own `ARTFSET_EFFECT_… = 11` into `types.xml` and
  the matching row into `DefaultStats.xdb`, refusing a shipped effect id;
  `npm run test-artifact-set` holds it, including that the shipped eleven come
  out unmoved. **Answered in game, 2026-07-28: it works.** The parser accepts a
  twelfth effect value, an eleventh set is reached — no compiled ceiling — the
  set is named on the hero screen, and the game counts the worn pieces itself.
  The probe is retired; the Cloak of the Undead King is ordinary data in the
  port now (`Maps/sod/src/new-artifacts.ts`).
- в) **Prove the native path.** A proxy DLL forwarding `zlib1.dll` — no patched
  byte in the executable — carrying two proofs on top: one new Lua function
  callable from a map script, and **one detour on the necromancy sum
  `0xc77850`** that calls the original and adds a term of ours — our set, our
  threshold, our number — so the percentage visibly moves in game while every
  shipped term still reads exactly as it did.
- г) **Make it editable.** The DLL hardcodes nothing: it reads a table saying
  which set, which threshold, which kind of bonus, how much — and the editor
  generates and edits that table.
- д) **The Cloak of the Undead King set itself**, for the Heroes III port —
  what it does, in Heroes V's own terms. See §6.

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

3.2. **Native code makes the effect real, by adding to the engine's answer
rather than replacing it.** A proxy DLL detours a calculation, calls the
original, and appends one term of ours: count our set's worn pieces, compare
against our threshold, add our number. It reads what is worn through the
engine's own `CountEquipped` — asking about our ids, never answering for
someone else's. Nothing shipped changes behaviour, and the result still flows
through the engine's arithmetic, caps and display, which is the whole meaning
of "indistinguishable from a shipped artifact". Сеня: «мы должны строить
поверх — не заменять существующее».

3.3. **A config makes it editable.** Which id or set contributes what, at which
threshold, how much. Written by the editor, read by the DLL.

3.4. **Lua functions are a third face of the same table**, for a map or
campaign that wants to read or adjust bonuses at runtime — never the mechanism
an artifact depends on.

## 4. Touchpoints

| File | Change |
| ---- | ------ |
| `types.xml` (in the mod archive) | ✅ Append `ARTFSET_EFFECT_<ours> = 11` to the `ArtifactSetEffect` enum. Append-only: the value is what saves and maps store. |
| `GameMechanics/RPGStats/DefaultStats.xdb` | ✅ A `<Sets>` entry using that effect — members, per-count texts and icons. |
| [src/creature-mod.ts](src/creature-mod.ts) | ✅ `addArtifactSet` and the two patches above, in the existing single pass over types.xml. |
| `Maps/sod/src/new-artifacts.ts` (port repo) | ✅ `NEW_ARTIFACT_SETS` — the Cloak of the Undead King, ordinary data now that §1.1(б) is answered. The probe that proved it is retired. |
| [renderer/index.html](renderer/index.html), [renderer/app.ts](renderer/app.ts) | ✅ A Sets pane inside the Artifacts dialog, not a dialog of its own: one mod, one install. Members are ticked from a list, never typed. |
| [electron/main.ts](electron/main.ts), [electron/ipc.ts](electron/ipc.ts) | ✅ `mods:install-set`, and `sets` in `ModListEntry` so an installed set is visible. |
| [e2e/artifacts-create.spec.ts](e2e/artifacts-create.spec.ts) | ✅ Builds two pieces and the set they belong to; checks that borrowing a shipped effect is refused. |
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

5.1. ~~**Does an added enum value parse?**~~ **Yes** — seen in game
2026-07-28. `ARTFSET_EFFECT_H3_UNDEAD_KING = 11` loads, the set is named on the
hero screen, and the game counts the worn pieces on its own. No fallback to
`ARTFSET_EFFECT_CUSTOM` is needed; the effect is ours and nothing shipped moved.

5.2. ~~**Is there a ceiling on the number of sets?**~~ **No** — the eleventh set
is reached and works. The absence of evidence held this time, unlike the
creature and artifact ceilings.

5.3. ~~**Where does equipment get applied?**~~ **Answered:** nowhere — it is
read where it is used, and every read goes through `0xb4c270`. So there is no
single hook that covers everything, and the fallback named here — a detour per
sum, adding our term after the engine's — is the plan. The catalogue in
[docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) bounds it: 36 functions is
every place an artifact effect can live, so the work is finite and known.

5.4. ~~**Dark energy.** Decided: restore it daily rather than model it.~~
**Dropped** — see §6.3. Restoring it needs a day tick we have not found, and it
is the wrong shape besides. The engine already prices a raise in dark energy in
a function we have by address, and a discount there does the same job through
its own arithmetic.

5.5. **How far does the config go?** The entry that is now obvious: *"this set,
at this many worn pieces, adds this much to that calculation"* — one row per
term we append. Spells granted while worn are a second kind and are not costed
yet — the machinery exists, since a Scroll loses its spell the moment it
comes off, but §1.1(а) found the stat path rather than the spellbook one.

## 6. What the Cloak of the Undead King should do

The set exists in game and counts its pieces. What it *gives* is still a design
question, and it has to be answered before the DLL, because the DLL is only as
good as the number it adds.

6.1. **What it did in Heroes III.** Three pieces — the Amulet of the
Undertaker, the Vampire's Cowl and the Dead Man's Boots — each raising
necromancy on its own, and together raising it further *and* upgrading what a
necromancer raises: with the full cloak the dead come back as something better
than skeletons, by the hero's Necromancy level.

6.2. **Heroes V splits that into two numbers, and we have both by address.**
After a battle the engine works out how many creatures are *offered*, and
separately what each one *costs* in dark energy:

| what | where | shape |
|---|---|---|
| how many are offered | `0xc77850` | a sum of percentage terms, last one "count worn pieces of set N, if ≥ threshold add a constant" |
| what they cost | `0xc77270` | the same sum of discounts, folded into `(100 − discount) × power / (CreaturePowerPointsForOneEnergy × 100)` |

Both are the twenty bytes described in §2.3, and a term of ours is the same
twenty bytes in each.

6.3. **So the set's bonus is one term in each, and dark energy needs no new
mechanic.** "Restore dark energy every day" was decided when the write site was
unfound and looked like the only way to touch it. It should not be built:

- it needs a day tick we still have not located, where the discount needs
  nothing we do not already have;
- it is far stronger than the set. A daily refill does not modify the resource,
  it removes it — and dark energy is the whole reason necromancy in Heroes V is
  a decision rather than a multiplier;
- a discount is what Heroes III's tier upgrade actually means here. Heroes V
  already lets the player choose which undead to raise; what stops them
  choosing well is the price. Lower the price and the choice opens up, which is
  the same experience arrived at through the engine's own arithmetic.

6.4. **The proposal, then** — two terms, both in the config, both the shape the
Necromancer's Pendant already has:

| worn | term | why |
|---|---|---|
| 2 pieces | +N% to the raise (`0xc77850`) | the Heroes III per-piece bonus, collapsed into the threshold Heroes V thinks in |
| 3 pieces | +M% to the raise, and −K% off the dark-energy cost (`0xc77270`) | the full cloak: more of them, and better ones affordable |

6.5. **The numbers are Сеня's call**, and they are data either way — changing
one is editing the config, not rebuilding anything. For scale: the shipped
Necromancer's Pendant is +10% raise and −10% cost, and the shipped Necromancer
set at four pieces is +20% and −25%. Heroes III's cloak was +30% necromancy in
total, which in Heroes V's numbers is a lot.

6.6. **Not in scope, and worth saying so.** The tier upgrade as such — "raise
wights instead of skeletons" — is not portable: Heroes V has no equivalent
knob, the choice is the player's already. Anyone wanting it literally would
need a hook on the raise dialog's creature list, which is not in the catalogue
of §1.1(а) and would be its own reverse.
