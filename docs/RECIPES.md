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

The header shows what the editor knows (`203 engine fns · … regions · …
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

The full catalogue — every engine function by section, with its parameters — is
[SCRIPT_API.md](SCRIPT_API.md), generated from the manuals; the game's own
`HOMM5_A2_Script_Functions.pdf` is where each one's behaviour is written out. The
calls you reach for most, drawn from C1M1's own script:

| you want to… | calls | example (C1M1) |
|---|---|---|
| set / read an objective | `SetObjectiveState`, `GetObjectiveState` | `SetObjectiveState("prim1", OBJECTIVE_ACTIVE)` |
| react to the hero entering a region | `Trigger(REGION_ENTER_AND_STOP_TRIGGER, region, fn)` | `Trigger(REGION_ENTER_AND_STOP_TRIGGER, "d2", "Dialog2")` |
| react to an object being touched / taken | `Trigger(OBJECT_TOUCH_TRIGGER \| OBJECT_CAPTURE_TRIGGER, obj, fn)` | `Trigger(OBJECT_CAPTURE_TRIGGER, "zastava", "CompleteObjective3")` |
| show / hide a placed object | `SetObjectEnabled`, `RemoveObject` | `SetObjectEnabled("zastava", 1)` |
| where is an object / hero | `GetObjectPosition` | `x, y, fl = GetObjectPosition("zastava")` |
| count a hero's creatures | `GetHeroCreatures` | `GetHeroCreatures(HERO_NAME, CREATURE_FOOTMAN)` |
| grant experience / resources | `GiveExp`*, `SetPlayerResource` | `SetPlayerResource(PLAYER_1, GOLD, 0)` |
| play a cutscene | `StartDialogScene` | `StartDialogScene("/DialogScenes/…/DialogScene.xdb#xpointer(/DialogScene)")` |
| start a scripted battle | `StartCombat` | `StartCombat("Isabell", nil, 1, CREATURE_PEASANT, 13, "…CombatScript.xdb#xpointer(/Script)", "AfterCombat")` |
| run something in parallel | `startThread`, `startThreadOnce` | `startThread(PObjective1)` |
| pause a thread | `sleep(seconds)` | `sleep(5)` |
| win / lose | `Win`, `Loose` | `Win()` |

\* `GiveExp` and the tutorial/combat-runtime calls (`WaitForTutorialMessageBox`,
`combatReadyPerson`, `setATB`, …) are engine built-ins the manuals never
documented, so they are **not** in `SCRIPT_API.md` and the editor cannot complete
them — the campaigns use them all the same. Type them by hand; the linter will not
flag them, because a name it does not know is not the same as a name that is wrong.

### Checking your work

There is no compiler to run, so the proof is: the linter is clean, the map packs,
and it loads and plays in the game. For a reconstruction, `npm run diff-map`
confirms the `MapScript` binding matches the original
([E2E_RECONSTRUCTION.md](E2E_RECONSTRUCTION.md)).
