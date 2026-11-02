# Asset editor 5 — our particle system and its baker

**What.** `bin/effects` is a recording of a baked particle run, with no emitter
logic in the file ([EFFECTS_FORMAT.md](../EFFECTS_FORMAT.md) §1). So an
effects editor is our own particle system — emitter, forces, colour / size /
texture-frame curves over life — plus a baker into the format, previewed live
by the renderer. A spell of ours needs it (two visuals: the cast and the hit).

**Source.** [SLICE_asset_editor.md](../../SLICE_asset_editor.md) §4, §5
step 5.

**Acceptance.** A baked effect round-trips through our reader; an e2e builds an
effect in the window and attaches it to a spell of ours; the game plays it
(needs play).

**Depends on.** asset-editor-1-play-as-the-game, asset-editor-one-particle-probe.

**Needs.** The owner sees the baked effect in the game.
