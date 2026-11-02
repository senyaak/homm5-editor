# Mods, and how we extend the engine

The owner's standing decisions. Engine-side rules:
[ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md#the-rules-that-hold-everywhere-here);
native craft: [native.md](native.md).

## A real tool, not workarounds

Build the real extension: a new slot, re-allocated per-race tables, native
racial mechanics. Never propose the mod scene's workarounds (replacing a
faction by ordinal, borrowing a slot, reusing another class or screen) as our
path. When it is expensive, list the cost and the patch sites.

## Where content lives

- While a mechanism is being made, its example content lives in the editor
  and its tests (dialog + e2e). Only once it works end to end does content
  built BY it move out. Never a second path that installs the same mod.
- Fixtures are committed: specs in `e2e/mods.ts`, files under `assets/`.
  Extracted game data stays in the ignored `data-unpacked/`.
- One mod, `homm5-editor.h5u`, written only by the editor and found by its
  manifest. Everything global (creatures, artifacts, `types.xml`) goes into
  it; project content that changes nothing global may be its own archive.
  Probes extend the one mod. The uid salt (`homm5-units:uid:`) never changes.
- A faction's files live in its own folder, every file copied, no hrefs into
  the donor. Bound the copy: `stopAt` by document type, `leave` for what the
  engine recognises by identity (`CragTerrain`, `Textures/Terrain/**`)
  (`src/mods/town-files.ts`, `copyArt`).
- Anything that must work on any map — a faction's Lua included — is a file of
  the mod, loaded from the mod's `advmap-common.lua`; never one map's script.
- A user's file is copied into `<game>/H5E/sources/<id>/…` first
  (`intakeOwnFiles`); the manifest and the form point at the copy; a rebuild
  never reads the original.
- No literal copies of engine tables: a table the engine reads from a file is
  read from that file (mods included); one it holds in code is read from the
  executable.

## Extending the engine

- A new dimension of a compiled table lives in our DLL, filled from the
  editor's config; the executable's accessors are detoured onto it. Patch the
  executable only where there is no function (inline `cmp N`, jump tables).
  Never write into its `.data`/`.text`.
- Call engine functions through their own entry points with the right
  signature; never jump into the middle of another feature's branch.
- Do not change a shared path for our feature: our own caller asks explicitly
  (`H5EAnnounceGain()`), the shared path stays as shipped. If you are asking
  "how do I tell our case from theirs", the hook is in the wrong place. A
  deferred request is a counter, not a flag.
- Before a hook, poll or detour: find the moment our code already runs at.
  An operation the mechanism has is done through its own call.
- A term that must apply to everything (all spells, shipped and future) goes
  on the one function they all pass through: walk callers up
  (`trace.ts calls`) until their number jumps; a function with one caller is
  not that door. Its display is the same door's report argument. No logging
  inside a door.
- We add terms, never answer for shipped content:
  `result = original(...) + ourTerm(config)`.
