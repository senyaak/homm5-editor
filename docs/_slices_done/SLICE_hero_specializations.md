# SLICE — A specialization of our own

> **Status: LANDED, 01.08.2026.** The editor makes a specialization of its own
> end to end — `HERO_SPEC_H3_FIRST_AID` = 84 appended to the enum, its words and
> icon written onto every hero holding it, and a row in the extension's config
> that adds **+5% of the first aid tent's own number per hero level**. Gem holds
> it instead of the borrowed `HERO_SPEC_EMPIRIC`.
>
> **Proven in game**, which was the one thing no test could answer. The
> extension's log, from a battle:
>
> ```
> tent:
>       mastery       1        <- basic war machines
>       engine said   20
>       hero level    1
>       our spec      84       <- the engine answered about OUR value
>       we add        1        <- 20 x 5% x 1
>       amount        21
> ```
>
> So the parser accepts an 85th value, the hero carries it, and the engine's own
> `HasSpecialization` recognises it. 24 calls in one battle, all identical: both
> of the tent's spells draw on the one number, as measured.
>
> The durable half of this is now
> [docs/ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md); what stays here is why the
> shape is what it is.

Reading first: [SLICE_artifact_effects.md](SLICE_artifact_effects.md) (the same
three layers, one rung down), [docs/ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md)
(what the binary does), [docs/CONTENT_FORMS.md](../CONTENT_FORMS.md) (what a
window that MAKES something has to do).

---

## 1. What a specialization is, measured

Established by reading the data, then the executable, then a battle — in that
order, and each step corrected the one before it.

**Data.** `HeroSpecialization` is a plain enum in `types.xml`, 84 values
(`HERO_SPEC_NONE` = 0 … `HERO_SPEC_INFERNAL_MACHINE` = 83). No reference table,
no `MinElements`/`MaxElements`, no file per value — unlike a creature or an
artifact, which is why a new one is cheap. A hero carries four fields and
nothing else: `<Specialization>` and three hrefs (name, description, icon).
Some specializations' NUMBERS are data — `DefaultStats.xdb` → `HeroSpecializations`,
grouped by class — and the ToE ones also carry `Base`/`PerPower` in their
`SPELL_SPEC_*` records. Empiric's numbers are in neither: they are compiled.

**Executable.** The value is field **`+0xEC`** of the hero, found by asking
which displacement is compared against many DIFFERENT values in 1…83 (the
winner had 17; every rival had one or two). Roughly 60 sites read it, some as
plain compares and some through jump tables — that is the whole of what a
specialization does, and a new value therefore does nothing at all until we add
it. The only bound check on the value is `cmp edx,53h; ja` in the enum → string
helper, whose default is harmless, so an 85th value reads off the end of
nothing. **A ceiling patch looks unnecessary** — unlike creatures and artifacts,
whose ceilings ARE compiled — but that is a reading, not yet a fact: one probe
map with a hero holding value 84 settles it.

**The tent, in full.** `0xb7fca0` computes what the first aid tent does:

```
amount = {10, 20, 50, 100}[war machines mastery]     ; a table in code
       + 5 × hero level                              ; if his specialization is 36 (EMPIRIC)
```

and a second number `{0, 0, 1, 3}` beside it. Both of the tent's spells draw on
it — `0xdc96d0` (`CCombatWarMachine::GetSpellPower`) answers for machine type 3
and for spells 189 (heal) and 352 (plague) alike, with the owner's War Machines
mastery. So healing and plague are ONE number, as the shipped Empiric text says
in words, and one term of ours moves both.

Confirmed from inside by the extension's own log: mastery 1 → base 20, level 1,
empiric yes, amount 25; and mastery 3 at level 8 → 140 = 100 + 5×8.

**Three things that cost a run each, and are worth keeping:**

- The mastery is an **index, not a multiplier**. Returning ten times it moved
  the tooltip and broke the tent — out of the table's range, the engine falls
  into a constant. The bug was only visible because Сеня said "it used to work
  and now doesn't"; from the numbers alone it read as "this value changes
  nothing".
- **The tooltip and the effect are computed by different code.** The prediction
  followed our doubled number while the applied amount did not. Check the
  battle log, never the hovering number.
- **Healing is capped by what is missing.** A stack of 15-HP sharpshooters can
  never show more than 14, whatever the amount is — which is why three
  measurements in a row came back "5". The amount is a budget: it tops up the
  wounded creature, then raises dead ones at `maxHP` each, and the remainder is
  lost. `81 ÷ 17 = 4 raised` and `100 → 8` both fit.
- **`HERO_SKILL_LAST_AID` is «Чумная палатка»** — the identifier lies, and it is
  an ordinary War Machines perk any class may take. Read the game's text, not
  the name.

---

## 2. Scope — and what of it is built

Everything in 2.1 is written and tested except the probe, which needs a launch.

| what | where |
| --- | --- |
| the model, the enum patch, the shipped names read off types.xml | `src/mods/specializations.ts` |
| `addSpecialization` / `update` / `remove` — append-only, and a removal refused while a hero holds it | `src/mods/mod-model.ts` |
| the entry written into the archive's types.xml | `src/mods/creature-mod.ts` |
| its words and icon written onto every hero holding it, unless he overrides them | `src/mods/hero-files.ts` |
| the config row, its grammar and both readers | `src/mods/artifact-effects.ts` |
| the term itself — a detour on `0x77fca0` adding `engine × percent × level / 100` | `native/homm5-editor.c` |
| the window, beside the heroes, with its gate | `renderer/…/specializations.ts`, `parts/dialogs/heroes.html` |
| the channel, the payload, the list | `electron/channels/mods-heroes.ts`, `ipc.ts`, `mods-list.ts` |
| 34 checks, and the authoring + refusal pair in the chain | `tools/test-specializations.ts`, `e2e/mod-004`, `e2e/mod-008` |

Two things the tests caught and would catch again: the fixture in `e2e/mods.ts`
rewrites the extension's config from the mod, so it had to learn about the new
row or a rebuild would silently drop it — the boots' bug a third time; and
`#sp-…` was already the script picker's prefix, so the ids are `#hs-…`.

2.1. **In:**

- а) **A specialization is a thing the editor MAKES** — its own window or tab,
  in the shape [docs/CONTENT_FORMS.md](../CONTENT_FORMS.md) fixes: identifier,
  name, description, icon picture, effect and its numbers; stars on what the
  build refuses; a refusal test beside the authoring one.
- б) **Data:** `types.xml` gains `HERO_SPEC_<OURS> = 84` (the same edit
  `addArtifactSet` already makes for set effects, one enum along), the texts are
  written as the hero's two `.txt` files, and the icon is built from a picture
  the way a hero's portrait now is (§3 below — that part is DONE).
- в) **The effect, natively:** a detour on `0xb7fca0` that calls the original
  and adds our term when the hero holds OUR value — `+5% per level`, i.e.
  `base × 0.05 × level`, which unlike Empiric's flat +5 scales with the mastery
  the tent already has.
- г) **Config from the editor**, as `bin/homm5-editor-effects.txt` already does
  for artifacts: a row naming the specialization value, what it modifies and by
  how much. The DLL hardcodes nothing; adding a specialization is editing data.
- д) **A probe first:** a hero with value 84 in game, to prove the parser
  accepts it and nothing indexes an array with it.

2.2. **Out:**

- Specializations whose effect is not a number the engine already sums — a
  creature specialist, say. The seam we have is the tent's; each new effect is
  its own reverse job, and they should be added one at a time.
- The Lua path. Not on principle — that was my error and Сеня corrected it: what
  Lua can reach, Lua should do (a battle-wide stat bonus is
  `GiveHeroBattleBonus(hero, HERO_BATTLE_BONUS_*, n)`, documented in the fan FAQ
  and real in the binary as `CGiveHeroBattleBonusCmd`). The tent's amount is
  simply not reachable from any script: no combat function heals, sets hit
  points or touches a machine's power.
- Raising the enum ceiling. There appears to be none; if the probe says
  otherwise, the patch has the same shape as `src/exe/creature-limit.ts`.

---

## 3. Done already, on the way here

**A hero can have a face of his own** (this was blocking the icon, and turned
out to be the same mechanism). Art is copied from the preset into the hero's
folder, so anything painted over the copy came back as the preset's on the next
build. Now `HeroSpec` takes PICTURES — paths, not hrefs — and the mod builds the
game's own textures from them on every build:

| where | what |
| --- | --- |
| `src/format/texture.ts` | `magnify()` — whole-pixel enlargement, because a 58×64 drawing has to fill a 128×128 frame and `fitSquare` only ever scales down |
| `src/mods/heroes.ts` | `portrait`, `specializationPicture`; `heroPaths` gained the six texture paths; `textureHref()` |
| `src/mods/hero-files.ts` | builds both portraits and the icon, points the document at them, and keeps them out of the art walk |
| `electron/ipc.ts`, `electron/channels/mods-heroes.ts` | the two fields, and `mods:pick-picture` |
| `renderer/…/heroes.{ts,html}` | the picture fields — the specialization's beside its name and text, the portrait's under Appearance — filled, cleared on New, carried back on Edit |
| `assets/` | `heroes/gem.gif`, `specializations/first_aid.gif`, `skills/first_aid.gif`, and the README they are listed in |
| `tools/test-heroes.ts`, `e2e/mod-004`, `e2e/mod-008`, `e2e/mods.ts` | the tests below |

**What the tests caught, and would catch again:** `mod-004` authors Gem and then
removes her, so a live run of that spec ALONE leaves the mod empty; and Gem is
put back by the map fixture rather than by the form, which did not know about
pictures — the first live chain produced a Gem with Ossir's face and every spec
green. `mod-008` now asserts the textures survive to the end of the chain, which
is the only place that question can be asked.

The whole chain `mod-001…mod-008` passes live (45 tests), and the installed
`H5E/homm5-editor.h5u` carries her portrait at 128 and 64 and her icon at 64.

---

## 4. Touchpoints, for the effect itself

| where | what |
| --- | --- |
| `types.xml` | `HERO_SPEC_<OURS> = 84` — one enum entry, no table |
| the hero's document | `<Specialization>` plus the three hrefs, all already reachable |
| `native/homm5-editor.c` | a detour on `0xb7fca0`; the hero is reached from the combat unit through `vt+0x18` → `vt+0xC`, and his level and specialization answer on a VIRTUAL BASE (`hero + 4 + *(int *)(*(void **)(hero + 4) + 8)`) — calling them on the plain pointer crashes the battle |
| `src/mods/artifact-effects.ts` | a row kind for specializations, alongside `necromancy` and `energy` |
| the new window | the form, its gate, and its refusal test |

**Clean-up done:** the three probes are out of `native/homm5-editor.c` — the
skill watcher, the tent-power vtable replacement and the stack walker — and what
is left at that address is the term itself plus a bounded log of every number it
was made from. The tent hook is installed only when a config row asks for it, so
a game with no specialization of ours is a game with nothing hooked.

**Still owed:** the rig in `H5E/Sharpshooter Test.h5m` — War Machines at expert
and both tent perks written by hand into Gem and into Straker. The live chain
repacks that map from the fixture, so what is there now is whatever mod-007
wrote; anything left of the hand-editing goes when the effect has been seen
working.

---

## 5. Open questions

- **Does the parser accept an 85th specialization value?** The one thing still
  unanswered, and one launch settles it. What to look for in
  `bin/homm5-editor.log`: `specialization rows: 1` and `first aid tent hook
  installed` at load, then a `tent:` block per tent action naming the mastery,
  what the engine said, the hero's level, which of our values matched, and what
  we added. A hero with a BASIC tent at low level adds nothing at all — 5% of
  10 truncates — so the check wants levels and mastery, not a fresh hero.
- What does the second number `{0, 0, 1, 3}` beside the tent's amount decide?
  It moves with mastery and is not the healing.
- Where do the numbers of the ToE specializations live — the `Base`/`PerPower`
  in their `SPELL_SPEC_*` records look like the data-driven half of the same
  mechanism, and if a new specialization can be given numbers THERE, part of
  §2.1(в) becomes data rather than code.
- `GiveHeroBattleBonus`'s seven bonus types are per-battle and army-wide. Which
  specializations of the port could be built from them alone, with no native
  code at all?
