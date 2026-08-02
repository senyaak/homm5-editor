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
| [SLICE_renderer_layout.md](SLICE_renderer_layout.md) | Cut the four files nobody could hold in their head — `renderer/app.ts` (8996 lines), `electron/main.ts` (3011), the 66 flat files of `src/`, and `renderer/index.html` (2023) — into layers, and wrote down the four rules that made it survivable. | 2026-07-31 |
| [SLICE_hero_specializations.md](SLICE_hero_specializations.md) | Gave the editor a hero specialization of its OWN — one entry appended to an enum the game declares no size for, and a term the extension adds where the engine sums its own. Read the first aid tent's whole arithmetic to find where that term goes, and proved value 84 in a battle. | 2026-08-01 |
