# Asset editor 2 — the window, its scene switch, and glTF import

**What.** A window that edits a model's PRESET (shared by every placement),
opened from the palette or from a placed object ("Open model in editor"), with
a background switch:

- **Preset** — the grid; an animation panel at least as good as the shipped
  editor's (AnimSet list, per-clip speed, Global Move, User sequence, Color
  model);
- **Map** — the open map, read-only, the camera on the placement it was opened
  from;
- **Arena** — for the `-arena` AnimSets (attack, move, hit, death);
- **Dialog scene** — for heroes and talking heads.

One renderer for the window and the map viewport. An edit to the preset
invalidates the model cache by uid and reloads every placement of that model
at once. glTF import is the first brick: glTF → Geometry + Skeleton + clips +
`(Model).xdb` + materials + AnimSet, through the writers that exist
(`src/format/geometry-write.ts`, `src/format/gr2-write.ts`). Use the three.js
editor's parts (MIT) rather than writing them.

**Source.** [SLICE_asset_editor.md](../../SLICE_asset_editor.md) §2, §3, §5
step 2.

**Acceptance.** e2e: open a placed object's model in the window, switch all
four backgrounds, play every clip of its AnimSet; import a glTF fixture
(committed, our own) and place the result from the palette; the imported
model's files round-trip byte-exact through our readers. A preset edit shows
on the map without reopening it.

**Depends on.** asset-editor-1-play-as-the-game (the viewer must not lie).
