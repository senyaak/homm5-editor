# A native object for the Pandora's Box — reconnaissance

Status: **entry points found, cut not yet made.** The goal, set after probe
run three: the box keeps the treasure chest's CLASS — the touch trigger fires
on it and the AI walks to it — but for OUR objects the chest's own behaviour
(the gold-or-experience dialog, the automatic goods, the vanishing) must not
run. The script is the whole behaviour; the engine's part is to say "touched"
and otherwise hold still.

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

## Still to do

1. Pin the visit slot: which vtable entry the interaction dispatcher calls
   when a hero steps on the active tile (candidates: `0xfd4f60+0xc/…`,
   `0xfd4f84+0xc` → `0xd214a0`). `trace.ts calls` on each, looking for the
   caller that also reaches heroes.
2. Find the advmap Lua state the way battle scripting found the fight's, and
   the object's Name string on `CAdvMapTreasure` (the placement name the
   script keys on).
3. The detour itself in `native/` behind the `pandora-box` flag, bytes
   verified before writing, refusal logged — the same shape as every fix.
