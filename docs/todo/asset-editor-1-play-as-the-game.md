# Asset editor 1 — play every asset as the game does

**What.** Before any editing, the viewer must show what the game shows. Read
the engine's playback, one note per question in `docs/engineInternals/`, and
fix every place where the renderer plays an asset differently. In order of
cheapness ([SLICE_asset_editor.md](../../SLICE_asset_editor.md) §6, and the
open list of [SLICE_effects_probe.md](../../SLICE_effects_probe.md) §7):

1. `gfx_particles` (boolean or density) and `gfx_effect_alpha_treshold`
   (whose threshold — ours is 0.003 / 0.01): find their readers.
2. The particle shader and its pass: blend state, alpha test, whether the
   engine sorts before drawing.
3. The `bin/effects` loader: the in-memory structure, where `EndCycle` and
   `Speed` apply, whether instances get spread phases (ours: `i * 0.37`).
4. `<Lights>` and `<Models>` inside an effect: placement and animation.
5. The scale channel of a clip.

**Source.** SLICE_asset_editor.md §5 step 1 and §6; SLICE_effects_probe.md.

**Acceptance.** Each answered question has its note with addresses, and each
place the renderer changes has a test asserting the read value (not the
renderer's own output). Invented numbers (`0.37`, the thresholds) are replaced
by read ones or marked as ours.

**Depends on.** none.

**Needs.** Which branch the device takes at run time (`fx_tnl_mode`, the
fixed-function fallback) is only seen in a launch: one launch by the owner,
traced over the whole effects subsystem (the reading produces the function
list for it).
