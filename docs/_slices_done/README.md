# Slices that are done

A slice lives at the repo root while it is being worked on, and moves here when
its work has landed. It is kept rather than deleted because the finished code
says WHAT the shape is and this says why it is that shape — the measurement that
chose it, the thing that was tried first and did not survive, the check that
caught something nothing else would have.

What a slice does NOT do from here is describe the code. That is
[CONTRIBUTING.md](../../CONTRIBUTING.md) and `docs/`, and they are what to keep
in step; if a slice ever disagrees with them, the slice is the stale one.

| Slice | What it did | Landed |
| --- | --- | --- |
| [SLICE_artifact_effects.md](SLICE_artifact_effects.md) | Made an artifact of ours carry real properties — our own set, our own effect id, our own numbers — through the engine's own arithmetic instead of a script imitating it. Found that equipment is never applied, only read, through one door (`CountEquipped`), which is why the whole extension is "call the original, add our term". Left one thing open: the six stats a SET wants to grant, now a ROADMAP entry. | 2026-07-29 |
| [SLICE_renderer_layout.md](SLICE_renderer_layout.md) | Cut the four files nobody could hold in their head — `renderer/app.ts` (8996 lines), `electron/main.ts` (3011), the 66 flat files of `src/`, and `renderer/index.html` (2023) — into layers, and wrote down the four rules that made it survivable. | 2026-07-31 |
| [SLICE_hero_specializations.md](SLICE_hero_specializations.md) | Gave the editor a hero specialization of its OWN — one entry appended to an enum the game declares no size for, and a term the extension adds where the engine sums its own. Read the first aid tent's whole arithmetic to find where that term goes, and proved value 84 in a battle. | 2026-08-01 |
| [SLICE_tent_branch.md](SLICE_tent_branch.md) | Gave the Witch's tent branch four perks that DO something — the machine's health, the healing, what it cleanses, and a use back per fifty mana. Read what the engine already does with a tent first, which threw the previous three away; the ultimate then turned out to need no engine address at all, only a battle trigger and one call. | 2026-08-03 |
| [SLICE_native_logging.md](SLICE_native_logging.md) | Took 395 unconditional log sites down to what was asked for: a switch per source file, folded to a constant at compile time, and a file per run. The build reads the units out of the sources rather than keeping a list, so a renamed file cannot leave a dead flag behind, and the test builds twice — the half that matters is the silent build NOT containing the lines. | 2026-08-08 |
| [SLICE_gelu_training.md](SLICE_gelu_training.md) | Gave Gelu a specialization that ACTS: a spell of the mod's put in his book at run time, a count window out of the engine's own, gold taken and elves turned into sharpshooters. Cost several launches to the same lesson — ask what an object IS before applying an offset to it (`CCombatHero` at `+0xEC` is not `CHero` at `+0x8C`), and a check that can only confirm is not a check. | 2026-08-08 |
| [SLICE_own_spell_resolver.md](SLICE_own_spell_resolver.md) | Stopped a spell of ours borrowing a shipped branch: it walks the field itself, calls the engine's leaves through entry points of its own, plays both visuals and picks the applier matching its element. Three runs to learn that `Resolve` writes nothing — the cast builds a CHAIN and the caller plays it — and that the applier must be called per stack, inside the loop. | 2026-08-10 |
