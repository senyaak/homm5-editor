# Factions — the town screen as a scene to edit

**What.** A dialog that renders the town screen — the ArenaDesc scene: static
models under the baked lightmap, the cameras, one ArenaModObject per building
and level — where a building is switched off and MOVED, its pick hull moved
with it. A drag rewrites the model's positions (as `place` / `at` already do).
Built as the asset editor's scene switch, not as a second renderer.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §2e (decision pending; the
recommendation on record: build it as that switch).

**Acceptance.** e2e: open a faction's town screen, move a building, save; the
moved model and its hull read back where they were put.

**Depends on.** asset-editor-2-gltf-import-and-viewer, factions-own-pick-hull.

**Needs.** The owner's decision to start it.
