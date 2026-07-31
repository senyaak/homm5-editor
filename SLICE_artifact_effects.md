# SLICE — Artifact effects that the engine treats as its own

> **Status:** built, and waiting to be seen in game. Adding an artifact already
> worked ([docs/ARTIFACTS.md](docs/ARTIFACTS.md)) but a new id got **no
> properties**: every special behaviour the shipped artifacts have is compiled
> against a specific id. This slice makes our own artifacts carry real
> properties — our own set, our own effect id, our own numbers — through the
> engine's own arithmetic rather than a script imitating it from outside. Two
> stats are live now: the necromancy percentage, and the dark energy ceiling
> a set of ours raises. When the second is confirmed in game, fold the findings
> into [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) and retire this
> file.

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
  port now, authored through the dialog and held by [e2e/mods.ts](e2e/mods.ts).
- в) ~~**Prove the native path.**~~ **Done, 2026-07-28.** Not a proxy DLL in the
  end: `H5_Game_H5E.exe` is our copy already, so it names our library in its
  import table and no file of the game's is touched. The detour on the
  necromancy sum `0xc77850` calls the original and adds our term, reading what
  is worn through the engine's own `CountEquipped`. Seen in game, from the
  extension's own log: three pieces worn → engine 20, ours +30; one taken off →
  engine 20, ours +20. The shipped terms read exactly as they did.
- г) ~~**Make it editable.**~~ **Done.** The DLL hardcodes nothing: it reads
  rows saying which artifacts, how many of them worn, which bonus and how much,
  and the editor writes them — per artifact from the artifact dialog, per set
  from the set dialog.
- д) **The Cloak of the Undead King set itself**, for the Heroes III port.
  **What it gives is decided** (Сеня): a percentage to necromancy per piece,
  and — with **two of the three** worn — **+150 to the player's dark energy
  ceiling**, "a grail of our own": put a piece on and the pool's maximum grows,
  take it off and it shrinks, while the pool itself does not jump. Both terms
  are built; what is left is authoring the numbers for the port and seeing it
  in game.

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
| [src/mods/creature-mod.ts](src/mods/creature-mod.ts) | ✅ `addArtifactSet` and the two patches above, in the existing single pass over types.xml. |
| [e2e/mods.ts](e2e/mods.ts) | ✅ The Cloak of the Undead King as a fixture — ordinary data now that §1.1(б) is answered, authored through the dialog like everything else. The probe that proved it is retired. |
| [renderer/index.html](renderer/index.html), [renderer/app.ts](renderer/app.ts) | ✅ A Sets pane inside the Artifacts dialog, not a dialog of its own: one mod, one install. Members are ticked from a list, never typed. |
| [electron/main.ts](electron/main.ts), [electron/ipc.ts](electron/ipc.ts) | ✅ `mods:install-set`, and `sets` in `ModListEntry` so an installed set is visible. |
| [e2e/mod-003-artifacts-create.spec.ts](e2e/mod-003-artifacts-create.spec.ts) | ✅ Builds two pieces and the set they belong to; checks that borrowing a shipped effect is refused. |
| new: the proxy DLL | Forwards `zlib1.dll`, registers Lua functions, installs detours, reads the config. Built outside this repo; the editor ships and configures it. |
| new: `src/mods/artifact-effects.ts` | The config model + writer — what the DLL reads. |
| [src/mods/artifacts.ts](src/mods/artifacts.ts) | Emit the enum entry and the set alongside the existing artifact records. |
| [src/exe/artifact-limit.ts](src/exe/artifact-limit.ts) | Unchanged in shape; the ceiling still gates whether new ids resolve at all. |
| [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) | Fold in what §1.1(а) finds; drop the hunt notes once the answer is in. |
| the editor UI | Editing effects per artifact and per set — the point of §1.1(г). |

Verification is in game, with a control: a shipped artifact on the same hero by
the same route. Three of the four wrong answers last time would have been
skipped by having one ([docs/ARTIFACTS.md](docs/ARTIFACTS.md)).

## 5. Open questions (need a call before code)

5.1. ~~**Does an added enum value parse?**~~ **Yes** — seen in game
2026-07-28. `ARTFSET_EFFECT_H3_UNDEAD_KING = 11` loads, the set is named on the
hero screen, and the game counts the worn pieces on its own. No fallback to
`ARTFSET_EFFECT_CUSTOM` is needed; the effect is ours and nothing shipped moved.

5.2. **Is a set of ours reachable from CODE?** No — and it stopped mattering.
The extension counts the members itself through `CountEquipped`, so a row is a
list of artifact ids and how many of them must be worn; the threshold became
ours rather than one compiled into an effect, which is what makes "two of
three" expressible at all. The finding below stands as the reason.

The original finding: The game names our eleventh set on the hero screen and counts its pieces
there, which is why this was briefly marked answered — but that is the UI
reading `<Sets>` directly. Asked through the hero's set accessor
(vtable `+0x328`, the call the necromancy sum makes for the shipped set), our
effect 11 answers **0** with all three pieces worn. So the tooltip proves the
data parses, not that code can reach it.

It does not block anything: per-ARTIFACT rows go through `CountEquipped`, need
no set at all, and are proven working (§1.1(в)). Heroes III gave each piece its
own bonus anyway. Worth solving for a bonus that only a complete set should
give.

5.3. ~~**Where does equipment get applied?**~~ **Answered:** nowhere — it is
read where it is used, and every read goes through `0xb4c270`. So there is no
single hook that covers everything, and the fallback named here — a detour per
sum, adding our term after the engine's — is the plan. The catalogue in
[docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) bounds it: 36 functions is
every place an artifact effect can live, so the work is finite and known.

5.4. ~~**Dark energy — how to write it.**~~ **Answered, and nothing needs
writing.** There is no setter because the engine does not set the pool — it
maintains a CEILING of four numbers and fills the pool to it on its own. So the
bonus is a fifth term of that ceiling, and the grant stays the engine's.
`docs/ENGINE_INTERNALS.md` carries the map; the short of it is that the four are
summed in exactly three places (clamp, refill, and the bar), which is the whole
cost of the feature.

5.5. **How far does the config go?** The entry that is now obvious: *"this set,
at this many worn pieces, adds this much to that calculation"* — one row per
term we append. Spells granted while worn are a second kind and are not costed
yet — the machinery exists, since a Scroll loses its spell the moment it
comes off, but §1.1(а) found the stat path rather than the spellbook one.

## 6. Where this stands, 2026-07-28

6.1. **Done and seen in game.** Our own set effect parses and the game counts
its pieces. The native extension loads through an import added to
`H5_Game_H5E.exe` — no file of the game's is touched — and its detour adds our
term to the necromancy sum: three pieces worn gave engine 20 + ours 30, one
taken off gave 20 + 20, and the count of undead raised moved with it,
`floor(0.75 x percent)` across four battles.

6.2. **Done in the editor.** Everything an artifact gives is ONE list of rows
added with "+ bonus": the six the record itself holds go into the artifact's own
document, and the rest — necromancy, dark energy — into
`bin/homm5-editor-effects.txt`, which the extension reads. A set's list adds a
`lua` row, and that one carries no numbers: it carries a pencil, and the pencil
opens the script in the editor the map's own scripts are written in. The Artifacts dialog lists artifacts and sets side by side,
each row with edit and remove; forms are dialogs on top. Removing warns with
the maps that name the thing, found by name. `npm run build-native` builds the
DLL with Zig (a devDependency); the dialog has a button that installs it.

6.3. **Done, 2026-07-29: the set as a condition, and dark energy.** Both of the
things this section listed as missing are built.

- **The set as a condition** needed no engine reach after all. A row now names
  several artifact NUMBERS and a threshold, and the extension counts them with
  the same `CountEquipped` a single artifact uses. The hero's set accessor still
  answers 0 for our effect 11 and no longer matters.
- **Dark energy** turned out not to need a write site: the engine keeps a
  ceiling of four numbers and refills the pool to it. Ours is a fifth term —
  two detours (`0xc066d0` refill, `0xc06670` recompute-and-clamp) and one
  replaced vtable pointer for the bar (`0xc06c60`), so the number on screen
  moves the moment a piece goes on. `docs/ENGINE_INTERNALS.md` has the map.

**Seen in game, 2026-07-29: it works.** Two of the three worn add 150 to the
ceiling, the bar moves as the pieces go on and off, and the pool is granted by
the engine itself.

6.4. **The Lua half, 2026-07-29.** The extension adds numbers to sums no script
can reach; it cannot decide WHEN, and the engine already hands events to Lua. So
the halves split there, and both ends are built:

- **Functions of ours are registered** — the adventure map's table is reached
  through an accessor, so the extension hands over a copy with its own rows and
  rewrites four bytes. `RestoreDarkEnergy(player)` is the first, and it finds
  its player by calling the engine's own `GetPlayerNecroEnergy` and watching
  which player the vtable slot we own is asked about. In game: `was 231 → now
  351`.
- **A set carries a script**, generated into the mod beside a copy of the game's
  `advmap-common.lua` that loads it. That file runs on every adventure map, and
  a `NEW_DAY_TRIGGER` set from it fires even on a map that sets its own — both
  measured, `docs/NAMES_AND_SCRIPTING.md`.
- **The three calls are in the reference** (`docs/SCRIPT_API.md`, marked `ours`),
  so the script editor completes them.

6.4a. **The set dialog, finished 2026-07-31.** The stage that made a set was
tagged `@wip` for a fortnight — the bonus worked, the form around it did not
explain itself. Three things were missing and all three are in:

- **What the columns are.** Three controls in a row with nothing over them read
  as three numbers. The line under them now says *what it adds · from how many
  pieces worn · how much*, and says outright that a hero's own stats are not on
  the list because there is no hook for them (§6.6) — a set that wants those
  carries a script row.
- **What the number is counted IN.** Necromancy is percentage points and dark
  energy is ceiling points, and "150" in the box meant either depending on a
  dropdown three controls to the left. The unit is shown beside the amount.
- **The tooltip the player reads.** It was typed twice — once as numbers in the
  effect row, once as a sentence in the per-count box — with nothing connecting
  them. **Draft from the effects** writes a first version of each line from the
  rows, cumulatively (every effect whose threshold that count has reached),
  which is how the shipped sets word theirs: `Necromancers_Desc4` repeats the
  two-piece sentence and adds its own. Only blank boxes are filled — a sentence
  somebody wrote is worth more than a draft — and the empty ones now say which
  blank is deliberate ("one piece is not a set") and which is a hole.

The tag is gone from `e2e/mod-003-artifacts-create.spec.ts`; the stage exercises
the draft, then overwrites it with the set's own words, and presses the button a
second time to see that it overwrites nothing.

6.5. **Known, accepted, not bugs.** Both follow from the grant being the
engine's, which is the point of the design:

- A hero who **starts** the map wearing the pieces starts with the pool full to
  the raised ceiling — the first refill sees them already on.
- **Taking a piece off drops the ceiling at once but the pool only the next
  day**, because the pool is cut by the engine's clamp and the clamp runs when
  the engine recalculates. Its own four terms behave the same way. Сеня, on
  seeing it: «пока не мешает».

6.6. **Open: the six an artifact record holds, granted by a SET.** A set has no
`HeroStatsModif` — that field belongs to an artifact record — so "+2 Attack while
two pieces are worn" needs a native term like the other two, and the place to add
it is not found yet. What the search establishes, so the next attempt starts
further along:

- The six are NOT in the `CountEquipped` catalogue. Its 36 functions are special
  behaviours (movement points, spell immunities, luck riders); none of them adds
  up `HeroStatsModif`.
- They are not read off the record at the point of use either: the only callers
  of the record getter (`0xb1ef70`) that touch `+0x44 … +0x58` are the AI's
  valuation, which was already ruled out once.
- **They are cached, packed into bitfields.** The hero's Luck reads
  `[this-0x78] >> 0x14 & 0xF` — four bits of a dword that also holds other stats
  (masks `0x3ff`, `0xffc00`, `0xf00000` appear in the writer at `0xc7bd40`), and
  the getters in `CAdvMapHero`'s vtable are that narrow. So there IS a recompute
  that fills them, and `0xd06fb0` — 246 instructions ending in that writer — is
  the candidate.
- The dispatch behind `GetHeroStat` is at **`0x108db90`**, not `0x108db8c`:
  twelve-byte entries of `{thunk, 0, 0}`, each thunk two instructions
  (`mov eax,[ecx]; jmp [eax+SLOT]`) — Attack `+0x10`, Defence `+0x14`, SpellPower
  `+0x18`, Knowledge `+0x1c`, Experience `+0x1a4`, and two more at `+0xf4`/`+0xfc`.

The next step is to read that recompute and find where the artifact contribution
enters it, the way the necromancy sum was read. Until then the set dialog offers
only what works — a bonus that appears in a list and does nothing is exactly what
the extension banner exists to prevent.

6.7. **What the set SAYS it gives** is a text per number of pieces worn, and it
follows the game's own convention rather than ours: the sentence names the
effect (`Добавляет игроку 150 очков темной энергии.`, the Amplifier's wording),
not the count — the count is drawn beside it — and it is REPEATED at three
pieces, because the game shows only the entry for the count worn and nothing
accumulates across them. The Dragonish set does the same.

6.8. **How to check anything here.** The extension logs beside itself
(`bin/homm5-editor.log`): what it loaded, what the config said, and for the
first two dozen calls what it saw and what it added. That log settled every
question so far faster than reasoning did.
