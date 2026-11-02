# Asset editor 4 — the texture debts

**What.** A recolour today writes uncompressed `TF_8888` without mips (1 MB
where the shipped texture is 256 KB) and loses the mip chain. Write DXT3 with
a full mip chain and the right `AverageColor`; import an image as a texture;
target a recolour per material; undo, and revert to the donor's texture.

**Source.** [SLICE_asset_editor.md](../../SLICE_asset_editor.md) §5 step 4;
ROADMAP Phase 7 "The recolour editor, properly".

**Acceptance.** A DXT3 + mips texture of ours decodes back within the format's
error to its source and matches the shipped textures' header shape; a
recoloured texture's size is the shipped one's; e2e imports an image as a
texture of a creature through the window.

**Depends on.** asset-editor-2-gltf-import-and-viewer.
