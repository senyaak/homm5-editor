# Recipes — how to actually make things

Task-first notes for someone new to the editor: not what a format is, but what to
click to get a result. The reference for *why* each thing is shaped the way it is
lives in the format docs (`NAMES_AND_SCRIPTING.md`, `TERRAIN_FORMAT.md`, …); this
is the short path to doing it.

---

## Script a mission

A mission's logic — objectives, triggers, dialog, combat — is Lua. Here is the
whole loop, start to finish.

### 1. Bind the map script

Open the map tree (**Map tree** in the toolbar, tick **Advanced**), find the
**MapScript** row, and click **New**. Name it (`MapScript` is conventional). This
creates two files in the map folder and binds them:

- `MapScript.lua` — the code;
- `MapScript.xdb` — the wrapper the map actually references.

The editor opens on the new (empty) `.lua`. That is the map script: it runs from
the top the moment the map loads.

> Why two files: the engine references a `<Script>` document, and the document
> names the `.lua`. See [NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md#binding-a-script-the-lua-and-its-xdb-wrapper).

### 2. Write it, with the editor helping

The editor completes from three places, so you rarely type a name in full:

- **engine functions** — start typing `SetObj…` and take `SetObjectiveState`; the
  call comes in with its brackets and the cursor between them, its parameters
  shown in the popup.
- **the game's helpers** — `startThreadOnce` and friends from the installed
  scripts.
- **this map's own names** — inside a string, `"…"`, the completion turns into
  the map's objects, regions and objectives, each tagged with what it is. This is
  the one that matters: a wrong name is not an error, it is a call that silently
  does nothing in the game. Let the completion spell it.

The header shows what the editor knows (`204 engine fns · … regions · …
objectives`) so an empty list is never a silent one.

### 3. Watch the linter

Beside the file's name: **✓ no errors**, or **⚠ 2 errors** with a red mark in the
gutter. It catches what the engine would reject and never say so — a missing
`end`, an unclosed bracket, an unterminated string — as you type. A near-miss on
a function name (`SetObjectvieState`) is a yellow warning. Fix the reds before you
save; the engine will not tell you about them.

Save with the **Save** button or **Ctrl/Cmd-S**.

### 4. The other scripts

A mission usually has more than the map script:

- **A combat script** governs a scripted battle (`Prepare`/`Start`, hint threads).
  Make it the same way — click **New** on a `CombatScript` field, or create it
  and reference it from Lua by path. C1M1 does both: it hands one to a hero with
  `SetHeroCombatScript` and passes another to `StartCombat`.
- **A dialog scene** is started from Lua with `StartDialogScene("/DialogScenes/…
  /DialogScene.xdb#xpointer(/DialogScene)")`. Authoring the scene itself is the
  scene editor (ROADMAP Phase 5b); the script just names it.

### The handles a script addresses

Everything a script passes as a string is defined elsewhere in the map, and the
editor is where you give it that name:

| handle | where you name it | example call |
|---|---|---|
| object | the object's **Name** (auto-assigned, editable in its panel) | `RemoveObject("enemy1")` |
| region | drawn on the map with the **Regions** tool | `Trigger(REGION_ENTER_AND_STOP_TRIGGER, "d2", "Dialog2")` |
| objective | added in the tree under `Objectives` | `SetObjectiveState("prim1", OBJECTIVE_COMPLETED)` |
| player / resource / creature | engine enums (`PLAYER_1`, `GOLD`, `CREATURE_PEASANT`) | `SetPlayerResource(PLAYER_1, GOLD, 0)` |

Draw the regions and add the objectives **before** you write the script that names
them, and the completion will have them ready.

### Which call for what

The reference is [SCRIPT_API.md](SCRIPT_API.md) — **our own**, hand-written and
grown as missions turn up new calls, with a description, typed arguments and an
example for each. Add to it by editing `src/script/script-api-curated.ts` and running
`npm run build-api`. What we have not written up yet is listed at the end of that
doc as bare signatures (from the manual) — a to-do list. The calls you reach for
most, drawn from C1M1's own script:

| you want to… | calls | example (C1M1) |
|---|---|---|
| set / read an objective | `SetObjectiveState`, `GetObjectiveState` | `SetObjectiveState("prim1", OBJECTIVE_ACTIVE)` |
| react to the hero entering a region | `Trigger(REGION_ENTER_AND_STOP_TRIGGER, region, fn)` | `Trigger(REGION_ENTER_AND_STOP_TRIGGER, "d2", "Dialog2")` |
| react to an object being touched / taken | `Trigger(OBJECT_TOUCH_TRIGGER \| OBJECT_CAPTURE_TRIGGER, obj, fn)` | `Trigger(OBJECT_CAPTURE_TRIGGER, "zastava", "CompleteObjective3")` |
| show / hide a placed object | `SetObjectEnabled`, `RemoveObject` | `SetObjectEnabled("zastava", 1)` |
| where is an object / hero | `GetObjectPosition` | `x, y, fl = GetObjectPosition("zastava")` |
| count a hero's creatures | `GetHeroCreatures` | `GetHeroCreatures(HERO_NAME, CREATURE_FOOTMAN)` |
| grant experience / resources | `GiveExp`, `SetPlayerResource` | `SetPlayerResource(PLAYER_1, GOLD, 0)` |
| play a cutscene | `StartDialogScene` | `StartDialogScene("/DialogScenes/…/DialogScene.xdb#xpointer(/DialogScene)")` |
| start a scripted battle | `StartCombat` | `StartCombat("Isabell", nil, 1, CREATURE_PEASANT, 13, "…CombatScript.xdb#xpointer(/Script)", "AfterCombat")` |
| run something in parallel | `startThread`, `startThreadOnce` | `startThread(PObjective1)` |
| pause a thread | `sleep(seconds)` | `sleep(5)` |
| win / lose | `Win`, `Loose` | `Win()` |

Some calls the campaigns use are engine built-ins the manuals never documented —
the tutorial/combat-runtime `WaitForTutorialMessageBox`, `combatReadyPerson`,
`setATB`, … We can still write them up in `src/script/script-api-curated.ts` from what a
script does (that is what `source: 'observed'` marks — `GiveExp` is one). Until
one is written up the editor cannot complete it, so type it by hand; the linter
will not flag it, because a name it does not know is not the same as a name that is
wrong.

### Checking your work

There is no compiler to run, so the proof is: the linter is clean, the map packs,
and it loads and plays in the game. For a reconstruction, `npm run diff-map`
confirms the `MapScript` binding matches the original
([E2E_RECONSTRUCTION.md](E2E_RECONSTRUCTION.md)).

## Give a hero a class of his own

Four things, in this order, and the order is the constraint rather than a
preference: a skill cannot belong to a class that does not exist yet, and a
class cannot weight a skill that does not either.

1. **The class** — Heroes → Classes → New class. Fill it from a shipped one,
   then say what is yours: thirteen weights adding to a hundred, four attributes
   adding to a hundred. Both totals are shown as you type and the build refuses
   anything else, because the engine walks both as distributions.
2. **Its racial** — Heroes → Skills → New skill, kind *racial*, class yours. A
   racial is drawn and named four times; give it a picture per level if the
   levels look different, one if they do not, none to borrow the War Machines
   set.
3. **Back to the class**, to give the racial its weight — it did not exist a
   minute ago, so it could not be weighted then.
4. **The perks of its branch** — New skill, kind *perk*, branch the racial.
   They need nothing else: the branch is the gate, since no other class has it.

To let the class take a SHIPPED perk that its neighbours cannot — the plague
tent, say — open the class again and move the perk to the left in *Perk
availability*. That writes your class into the perk's own list of classes, with
the dependencies the others already need. A perk that is in neither list is open
to everybody already.

What none of this does is give a skill an EFFECT. See
[HERO_CLASSES.md](HERO_CLASSES.md) — the arithmetic is compiled against the
values the game was built with, and ours has to come from the extension.
