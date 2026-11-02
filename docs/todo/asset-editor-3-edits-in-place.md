# Asset editor 3 — edits in place

**What.** The small fixes, made in the window against the chosen background:
pivot, scale, orientation (`TransformControls`); materials — texture
reference, AlphaMode, AddPlaced, L_SELFILLUM; which clip is `idle00` /
`attack` / `move` in an AnimSet; pointing a model at another model's
skeleton; clip timing and root motion with a dope sheet and curve editor
(theatre.js, Apache-2.0); nudging a vertex group; flipping UVs. Out of scope:
retopology, rigging from scratch, skin-weight painting (they come through
import).

**Source.** [SLICE_asset_editor.md](../../SLICE_asset_editor.md) §3, §5
step 3; ROADMAP Phase 5b "Model editing" (skeleton swap, material edits).

**Acceptance.** For each edit kind: an e2e that makes it through the window and
reads the written document back; the written files load through our readers;
undo returns the preset to its bytes before.

**Depends on.** asset-editor-2-gltf-import-and-viewer.
