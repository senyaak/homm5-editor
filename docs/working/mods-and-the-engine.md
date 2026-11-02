# Mods, and how we extend the engine

The owner's standing decisions about where content lives and how the game is
extended. The engine-side rules (verify the bytes, call the way the engine
calls) are [ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md#the-rules-that-hold-everywhere-here);
native craft is [native.md](native.md).

## A real modding tool, not workarounds

The goal is a real extension: a new slot, re-allocated per-race tables, racial
mechanics done natively. The mod scene's workarounds — replacing an existing
faction by its ordinal, borrowing another slot, reusing someone else's class
or screen — are facts about the scene, never a path offered to us. When the
ledger looks expensive, list its price and its patch sites; do not fold to the
workaround.

## Where content lives

- **The editor first, then the mod.** While a mechanism is being made, the
  example it is made on (artifacts, a set, a map) lives in the editor and its
  tests — the dialog and the e2e. Only once the scheme works end to end is a
  map or a content set built BY it and moved out. A second path that installs
  the same mod (a port's build beside the editor's dialog) gives two copies of
  the data and two ways to install them, and they drift apart silently.
  Fixtures are committed: specs in `e2e/mods.ts`, files under `assets/`;
  what was extracted from the game stays in the ignored `data-unpacked/`.
- **One mod, `homm5-editor.h5u`, and the editor is its only writer.**
  Creatures and artifacts extend reference tables declared in `types.xml`; a
  mod REPLACES that file rather than merging, and the executable's ceilings
  count that copy. Two mods with creatures do not add up — the game reads one.
  So everything global goes into the one archive, found by its manifest, not
  by its name; project content that costs the game nothing globally (dwellings,
  plain objects, texture overrides) may ship as an archive of its own. Probes
  extend the one mod too, never a second archive with its own `types.xml`. The
  uid salt (`homm5-units:uid:`) is frozen and is not `MOD_STEM`.
- **A faction's files live apart.** Everything of a new faction sits in its
  own folder, every file copied — no hrefs into the donor's files. A relative
  href in a clone (`Heaven-town.xdb`) is a trap: a clone in the same folder
  silently takes the donor's file. The copy has bounds: `stopAt` by document
  type (a `CamerasSet` pulls in every hero and creature of the game, 380 MB),
  and `leave` for what the engine recognises BY IDENTITY — the one
  `CragTerrain` material and `Textures/Terrain/**` (copied, the material is a
  slab of stone under a town on grass). Copy what is ours; leave the engine's
  inventory where it is (`src/mods/town-files.ts`, `copyArt`).
- **A faction's Lua is global.** A building stands in any town on any map, so
  its script is a file of the mod (`scripts/homm5-editor/faction-<file>.lua`,
  `TownSpec.script`) loaded from the mod's `advmap-common.lua` — never in one
  map's script. Anything that must work "on any map" goes into the mod at once.
- **Own files are copied first.** Any path on disk that reaches the mod is
  copied into `<game>/H5E/sources/<id>/…` first (`intakeOwnFiles`), the
  manifest points at the copy, the form shows the copy, and a rebuild never
  reads the author's original. A manifest that kept the original's path was a
  bug, not "a design question".
- **Nothing lies as a copy of a table.** If the engine reads a file, we read
  the same file through the resource layer, mods included; if the engine holds
  it in code, we read it out of the executable. A literal table in our code
  silently disagrees with a game a mod has changed — and changed games are
  what this tool is for.

## Extending the engine

- **New dimensions live in our DLL.** Extending a compiled table means moving
  it to us: the DLL holds the array from a config the editor writes, and each
  accessor of the executable is detoured onto ours. The executable is patched
  only where there is no function to detour — an inline `cmp N`, a jump table.
  Writing into `.data`/`.text` of the executable is not a path even when there
  is room.
- **Write our own; don't enter the middle of theirs.** Our spell has its own
  implementation, not a jump into the branch of Unholy Word as "the
  whole-field shape" — crashes then showed up in Unholy Word's casts, with no
  way to tell our bug from their path. Calling the engine's functions through
  their own entry points with the right signature is right and necessary;
  inheriting someone else's stack frame is not.
- **Don't change the shared path; let our caller ask.** The game announced a
  learned spell to nobody, and the announcement was hung on the command
  everyone uses to give spells — so a map whose init script gives a spell
  announced it at load, and three evenings went on telling "being set up" from
  "being played". Our caller asks explicitly (`H5EAnnounceGain()` from the
  box's script) and the shared path stays factory-exact. The tell, in advance:
  catching oneself asking "how do I tell our case from theirs?". A request is a
  COUNTER, not a flag — requests and deliveries part in time, and a bool merges
  three into one.
- **The mechanism's own entry point first.** Before a hook, a poll or a
  detour, ask whether there is a moment our code already runs at and what is
  available then (the battle file is top-level code, run when the battle is
  already built — "just look"). An operation the mechanism has is done by ITS
  call: forcing the split command to hand over a whole stack validated and ran,
  and left the panel drawing a slot the army did not have.
- **One door for a new term.** A property that must work for every spell —
  shipped and future — goes on the one function all of them pass through,
  found by walking `trace.ts calls` up until the number of callers jumps. Count
  the callers before calling something a layer: a door with ONE caller is not
  one (the term worked in battle and showed nowhere). The display is an
  argument of the same door — the report the engine fills with every artifact
  that fired — so our id goes there too. A door is called hundreds of times a
  battle: no logging inside the term.
- **We add terms; we never answer for shipped content**:
  `result = original(...) + ourTerm(config)`.
