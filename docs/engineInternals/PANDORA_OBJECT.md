# A native object for the Pandora's Box — reconnaissance

Status: **entry points found, cut not yet made.** The goal, set after probe
run three: the box keeps the treasure chest's CLASS — the touch trigger fires
on it and the AI walks to it — but for OUR objects the chest's own behaviour
(the gold-or-experience dialog, the automatic goods, the vanishing) must not
run. The script is the whole behaviour; the engine's part is to say "touched"
and otherwise hold still.

## Where the box stands (11.08.2026)

**The look is finished and is entirely ours.** Nothing about the box is
borrowed except the four glow effects, which are the game's own artifact glows
by choice.

* the MESH is authored — eight positions, six faces, twenty-four render
  vertices, both remaps — because the geometry container round-trips byte for
  byte through our writer on all 3572 shipped files (GEOMETRY_FORMAT.md §6);
* the TEXTURE is drawn in code and written as DXT1 with mips;
* the RIG is authored too — a one-bone skeleton and a clip that turns it once
  about the vertical and bobs, both written as Granny GR2 (GR2_FORMAT.md §8);
* the DOCUMENTS — model, geometry, material, skeleton, animation, animset —
  are all ours and reference each other by path. Never inline: an inline href
  without an `id` takes the game down on map load (GEOMETRY_FORMAT.md §6.7).

Three engine facts were paid for with game runs and are worth not re-learning:
a skinned model's `<RootMesh>` names the BONE; a clip binds to a rig through a
`granny_model`, by name, so a Granny file with no `Models` makes the halves
work and the pair vanish; and the section-layout invariants of GR2_FORMAT.md
§8 have to be matched exactly.

## What is left, in two tracks

1. **This document's track — the engine.** Stop the chest's own dialog and
   pickup from running before our question. The plan is below and unchanged.
2. **The editor's track — the UI.** The box needs a palette entry that is not
   hidden, a contents dialog driven by the JSON schema (experience, gold, the
   six resources, artifacts, spells, creatures, guards), the computed value of
   those contents, and the tier substitution that picks which of the four glow
   documents a placement points at. `pandoraTier()` and the four shared
   documents already exist; what is missing is the window and the wiring.

## Why not a Stand, and why not a new class

The Stand — the class that does nothing on its own — cannot be given a touch
trigger at all. The refusal is explicit and per class: the `Trigger()` Lua
binder resolves the object and asks it for its touchable interface through a
virtual; a Stand answers null and the binder prints
`Object "%s" cannot be touched`. A whole new class would mean a vtable of some
sixty slots and RTTI the engine's loaders would have to accept — а detour in
one existing behaviour is the same result for one honest cut.

## What is found, and where

Everything below is the **installed** `bin/H5_Game_H5E.exe` (retail layout,
same one every other detour in this repo names).

**The `Trigger()` binder, touch case — `0x5f2b84`.** The switch over trigger
kinds sits at `0x5f2b04` (`sub ebx,4 / sub ebx,1 / sub ebx,5` — cases 4, 5,
10). The touch case:

    0x5f2b84  mov eax,[ebp]        ; ebp = the resolved map object
    0x5f2b89  call [eax+28h]       ; virtual: cast to the TOUCHABLE interface
    0x5f2b8e  test ecx,eax → null  ; null → "Object \"%s\" cannot be touched"
    0x5f2b74  (shared tail) call [touchable_vtbl+30h], push 0
                                   ; non-null → bind the handler

So touchability is **main-vtable slot `+0x28`**, and the capture trigger's
case at `0x5f2b4f` uses slot `+0x4` the same way (`cannot be captured`).

**The shared-message getter — `0xc7ae50`.** thiscall; `ecx` = the shared
document's message block (`shared+0x30` at the call sites), args (index, out).
Past the end of the list it formats `Invalid message index %d for object %s` —
the error probe run three produced, which is what led here. Sixty callers,
one per class-and-occasion.

**The treasure pickup flow — the region around `0xd20f00`–`0xd214a0`.** The
function bodies of `CAdvMapTreasure`'s second vtable (`0xfd4f84`: `+0xc` →
`0xd214a0`, 285 instructions) sit in the same few pages as four calls into the
message getter, among them `push 3` (the artifact-found line) at `0xd21015`
and the index-2 pickup dialog nearby. This is where the chest decides and
shows its dialog. `CAdvMapTreasure`'s RTTI descriptor is `0x10b8654`; the
first vtable is `0xfd4f60` (own methods `0xcb0970`, `0xcb0dd0`, `0xcb0df0`,
`0xcb1660`).

## The cut, as planned

At the entry of the treasure's visit behaviour (the exact slot still to be
pinned — the candidates above), ask whether the object is one of ours and
RETURN before anything of the chest's runs. "One of ours" should come from
the same place the script's data lives: the advmap Lua state already holds
`H5E_PANDORA` with the placement names — the extension can evaluate
`H5E_PANDORA[name]` the way the battle scripting layer already calls into a
fight's Lua (docs/engineInternals/BATTLE_SCRIPTING.md). No config file to
carry, no second source of truth: the map's own block is the registry.

The touch TRIGGER is a separate path from the behaviour, so with the
behaviour gated the touch still fires and the script runs the whole show —
question, fight, receipt, removal.

## The gate, refined — no Lua read at visit time

Reading a Lua value back from C is the expensive direction (the battle
scripting page says why), so the gate never does it. Instead the extension
REGISTERS two adventure-map Lua functions — the cost of adding one is on
docs/engineInternals/LUA.md — and the map's generated block calls them:

    H5EPandoraReset();          -- top of the block: this map's list starts empty
    H5EPandoraMark("Pandora01"); -- once per box, beside its Trigger line

The DLL keeps the names in its own set, and the treasure-visit detour checks
membership natively — a string compare, no script host in sight. The map's own
block stays the single source of truth; a save rewrites it, and the reset
keeps a loaded save or a next map from inheriting the previous list.

This also moves `pandora-box` from an archive-only flag to a native one
(`native: false` comes off, the name joins QOL_NAMES in C), since the hooks
now exist and must follow it.

## Still to do

1. Pin the visit slot. `0xd214a0` (285 instructions, `CAdvMapTreasure` vtable
   `0xfd4f84+0xc` and `0xfd4f90+0x0`) is the strongest candidate — the
   index-3 message push at `0xd21015` sits in the function just before it,
   and the entries past it (`0xd2189a`…) are adjuster thunks. What is missing
   is the caller chain from the interaction dispatcher (a virtual call, so
   `trace.ts calls` stays silent); the next probe is a log-only detour on
   `0xd214a0` and its `0xfd4f60+0xc`/`0xcb0970` sibling, saying which fires
   when a hero steps on a chest.
2. The object's Name string on `CAdvMapTreasure` — the placement name the
   script keys on — for the detour's membership test.
3. The detour itself in `native/` behind the `pandora-box` flag, bytes
   verified before writing, refusal logged — the same shape as every fix.
