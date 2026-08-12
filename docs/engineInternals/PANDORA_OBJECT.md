# A native object for the Pandora's Box — reconnaissance

Status: **entry points found, class not yet built.** The goal, set by decision
on 11.08.2026: the box is its OWN native class, derived from the lootable one —
not a chest with its behaviour gated. It inherits everything that makes a
lootable work (the loader, the AI's appetite, pathing, saving, the touch
trigger) and overrides the behaviours that are ours, starting with the visit:
no chest dialog, no automatic goods, no vanishing.

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

1. **This document's track — the engine.** Build the class: a subclass of the
   lootable whose visit is ours rather than a chest's. The plan is below.
2. **The editor's track — DONE** (12.08.2026), and written up in
   `docs/PANDORA_BOX.md`. The box lists under Treasures, a placed one carries
   its own contents (message, experience, gold and resources, artifacts,
   spells, creatures given, creatures fought), the glow follows what those are
   worth — a guard costing exactly what a gift costs — and saving writes the
   generated block, the message texts and, where a map had none, a script to
   hook them into. The five probe twins are gone with it: what they asked is
   answered above, and they were five more ways for a map to reference
   something that only looks like a box.

## Why the parent is a lootable, and not a Stand

The Stand — the class that does nothing on its own — would have been the
obvious base, and it cannot be given a touch trigger at all. The refusal is
explicit and per class: the `Trigger()` Lua binder resolves the object and asks
it for its touchable interface through a virtual; a Stand answers null and the
binder prints `Object "%s" cannot be touched`. The lootable answers, the AI
walks to it, and the map's script gets its handler — so that is what the box
derives from.

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

## Why a subclass, and not a detour

An earlier plan here was to leave the box a chest and gate the chest's own
behaviour for our objects. That is rejected by decision: the box gets its **own
native class, derived from the lootable one**. The reasoning against — a class
means a vtable of some sixty slots and RTTI the loaders accept — is answered by
deriving rather than inventing: a subclass IS the parent's vtable with the
slots we mean to change replaced, and the parent's layout and RTTI underneath.
Everything the engine already does with a lootable — the loader, the AI's
appetite, pathing, saving, the touch trigger — keeps working because the object
still IS one, structurally. What changes is every behaviour we override, and we
override them properly rather than returning early out of somebody else's.

Two stages, and the first is the whole point:

**Stage 1 — the class exists at run time.** The DLL builds a vtable of its own
by copying `CAdvMapTreasure`'s and patching the slots it means to own, then
retags our objects to it. Our objects are recognised by their SHARED document:
the placements point at `PandoraBox_*.(AdvMapTreasureShared).xdb`, which the
object holds a pointer to, so no name list and no Lua is needed at visit time.
From that moment the object's behaviour is ours: the visit does not open a
chest's dialog because the chest's visit is not what runs.

**Stage 2 — the class exists in the DATA too**, as `AdvMapPandoraShared`, so a
map says what it means and the editor stops pretending. That needs the engine's
class registry (the factory that maps a serialized class name to a constructor)
and a matching `types.xml` entry, which is the same door the creature abilities
and the hero classes went through. Worth doing after stage 1 proves the
behaviour, not before.

## The vtable stores, found (12.08.2026)

`trace.ts writes <value>` — a command added for this: `calls` answers for code
that is CALLED, and a vtable address is never called, it is STORED.

    node tools/reverse/trace.ts writes 0xfd4f60
    3 instructions carry 0xfd4f60
      0xd20a19  mov dword ptr [edi],0FD4F60h
      0xd20bdf  mov dword ptr [esi],0FD4F60h
      0xd21d47  mov dword ptr [esi],0FD4F60h

Three, and the second vtable is written six bytes later in each of them
(`mov [edi+1Ch],0FD4F84h`) — so **the second vtable lives at object +0x1C**,
which is the offset the visit slot has to be counted from.

The one at `0xd20a19` sets up the whole object:

    0xd20a19  mov [edi],       0FD4F60h
    0xd20a1f  mov [edi+1Ch],   0FD4F84h
    0xd20a26  mov [edi+0ACh],  0FD4F90h
    0xd20a3f  mov [eax+edi+4], 0FD4F9Ch     ; and four more through a table of
    0xd20a53  mov [eax+edi+4], 0FD4FBCh     ; offsets read off [edi+4] — the
    0xd20a61  mov [eax+edi+4], 0FD5100h     ; virtual bases
    0xd20a6f  mov [eax+edi+4], 0FD5108h

**SEVEN vtables, three of them at fixed offsets and four placed through the
virtual-base table.** That is the shape a subclass has to reproduce.

### How long each table is — measured, and it corrects this document

`trace.ts dump <addr>` prints each word with a verdict beside it (code, data,
or a string), and a vtable ENDS where a word stops being a function: what
follows is the RTTI pointer the next table carries in front of it.

    0xfd4f5c  0x01036a10  data    <- RTTI of the first table
    0xfd4f60 … 0xfd4f7c           <- EIGHT slots
    0xfd4f80  0x01036a98  data    <- RTTI
    0xfd4f84 … 0xfd4f88           <- TWO slots (0xacc4f0, 0xacc510)
    0xfd4f8c  0x01036aac  data    <- RTTI
    0xfd4f90 … 0xfd4f94           <- TWO slots (0xd214a0, 0x42b6c0)
    0xfd4f98  0x01036ac0  data    <- RTTI
    0xfd4f9c …                    <- the long one

So the earlier line here — "the visit is `0xfd4f84+0xc`" — was a slot read
past the end of a two-slot table, which is exactly the mistake this repo has
already paid for once: **a slot needs its table's START, and a class has
several**. `0xd214a0` is not `0xfd4f84+0xc`; it is `0xfd4f90+0x0`, the first
slot of a different table.

### What is known about the three, and what is not

All three are CONSTRUCTORS, not a constructor and a destructor: each opens with
the most-derived flag test (`cmp dword ptr [esp+…],0` / `je`) that a compiler
emits for a class with virtual bases, and each then writes the base classes'
tables before its own. They differ in how many arguments they take — the one at
`0xd21b90` reads its flag from `[esp+4]`, so it has none of its own.

**The object is 0x100 bytes.** Its call site allocates before constructing:

    0xb529bd  push 100h
    0xb529c2  call 004DD2D0h        ; the allocator
    0xb529d2  push 1                ; most-derived
    0xb529de  call 00D20940h        ; the constructor

That call sits inside `0xb5256c`, a function with 26 callers — the shape of a
factory that builds map objects by kind, and the natural place to look for
where a shared document becomes an object.

Still open: which table each fixed offset carries (the constructor writes
`[this]`, `[this+0x1C]` and `[this+0xAC]`, while `0xd214a0` corrects `ecx` by
`-0xA8` on entry, so the two have to be reconciled before any slot is
replaced), and whether `0xd214a0` is the visit at all — it is 285 instructions
that call through `[eax+8Ch]` and reach `0xcbb7c0` and `0xa45880`, and the
cheap way to settle it is a log-only detour that says when it fires.

## Stage 1, step by step

1. **Find the constructor**, by the vtable store — DONE above, to three
   candidates. What remains is to tell them apart: disassemble each function
   from its start (the starts are not found yet) and look at what follows the
   stores — a constructor goes on to initialise fields, a destructor to free
   them.
2. **Measure the vtable**: how many slots before the next descriptor begins.
   Copying a vtable needs its length, and a slot read past the end is the
   mistake docs/… already records ([[vtable-slot-needs-its-vtable-start]] in
   memory): a class has SEVERAL vtables and +0x184 from the wrong one lands in
   the neighbour and lies plausibly.
3. **Find where the object holds its shared document** — the pointer the
   loader stores — and how to compare it to ours. The message getter at
   `0xc7ae50` already takes `shared+0x30`, so the shared pointer is reachable
   from the object; the offset is what is missing.
4. **Build the subclass vtable** in the DLL: allocate, copy the parent's slots
   verbatim, keep the RTTI pointer at -4 pointing at the PARENT's descriptor
   (so anything the engine does by RTTI still finds a lootable), then replace
   the slots we own.
5. **Retag**: at the end of construction, if the shared document is one of
   ours, store our vtable pointer instead. That is the subclassing, and it is
   one store.
6. **Own the visit slot** first — the one that shows the chest's dialog and
   hands out its goods. Ours asks our question and lets the script do the rest.
   `0xd214a0` is the standing candidate (vtable `0xfd4f84+0xc`); step 1's hook
   makes it cheap to confirm with a log.

Everything else stays as it is: the touch trigger still fires (a separate
path), the AI still walks to it, and the map's generated block still carries
the contents.

## Still to do

1. **The constructor**, found by the vtable store `mov [ecx], 0xfd4f60` — the
   hook point, and the place an object learns which shared document it is.
2. **The vtable's length**, and the slot the visit lives in. `0xd214a0` (285
   instructions, `CAdvMapTreasure` vtable `0xfd4f84+0xc` and `0xfd4f90+0x0`) is
   the strongest candidate — the index-3 message push at `0xd21015` sits in the
   function just before it, and the entries past it (`0xd2189a`…) are adjuster
   thunks. The caller chain is a virtual call, so `trace.ts calls` stays silent:
   a log-only detour on `0xd214a0` and its `0xfd4f60+0xc`/`0xcb0970` sibling
   says which one fires when a hero steps on a chest.
3. **The shared-document pointer's offset** on the object, for telling ours
   apart at construction.
4. **The subclass itself** in `native/` behind the `pandora-box` flag: vtable
   copied, slots replaced, retag on construction, bytes verified before
   writing, refusal logged — the same shape as every fix here.
5. The flag becomes native (`native: false` comes off, the name joins
   `QOL_NAMES` in C), since the hooks now exist and must follow it.
