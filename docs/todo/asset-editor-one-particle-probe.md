# Asset editor — the one-particle probe

**What.** There is no writer for `bin/effects`, and the game has never read an
effect of ours. Write a file holding ONE particle, by hand through a minimal
writer, place it on a probe map (on the hero's line, to his left), and have the
owner look. A "no" changes the whole of asset-editor-5.

**Source.** [SLICE_asset_editor.md](../../SLICE_asset_editor.md) §4.

**Acceptance.** The minimal writer's output reads back through our reader
identically; the probe map packs with it.

**Depends on.** none.

**Needs.** One launch by the owner: is the particle there.
