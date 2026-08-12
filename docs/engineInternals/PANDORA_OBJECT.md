# A native object for the Pandora's Box

Status: **DONE, and cheaper than the plan** — 12.08.2026, confirmed in play. A
box is no longer a chest to the player: no dialog of its own, no goods of its
own, and no vanishing before the answer. Real chests are untouched.

**And the plan below is not what was built.** It called for a subclass — a copy
of the treasure's vtable with the slots we own replaced, and our objects
retagged to it at construction. What the reconnaissance turned up made that
unnecessary:

* the behaviour to take away is ONE slot — the chest's dialog-and-goods at
  `0xD20C80`, `0xFD5108 +0x0c`;
* and a box can be recognised where it matters, because a shared definition
  carries the path it was loaded from at **+0x20**: ours read
  `/Buildings/PandoraBox/PandoraBox_Green.(AdvMapTreasureShared).xdb`.

So `native/qol/pandora-box.c` detours that one function, asks the object which
document it came from, and returns without doing anything when the answer is
ours — otherwise it calls the original. No vtable copied, no object retagged,
no `TreasureType` added and no ceiling raised in the executable. The parts of
the plan that turned out to matter are kept below, because the NEXT thing we
take from the chest will need them.

What is still a chest is the DATA: the class in the map is
`AdvMapTreasureShared`, and **it stays that way** — stage 2 below is DROPPED
(12.08.2026, the author's call after playing it: "сокровище вроде норм"). It
would buy nothing a player can see, and the class the map names is exactly what
the engine needs to find the object and walk the AI to it. The design is kept
below because it is the door a future object of ours would go through, not
because this one is waiting for it.

Three things this cost, all worth not repeating:

* **arity comes from `ret`.** Every exit of `0xD20C80` is `ret 8`, so the hook
  takes two stack arguments even though it reads one. Declared with one, the
  refusal left the caller's stack four bytes out and the game died frames later
  somewhere else entirely — with the log already saying the gate had worked.
* **`this` is the SUBOBJECT.** The slot is reached through a vtordisp thunk, so
  what arrives is object+0xF8, not the object.
* **a probe that reads memory it has not proven is a probe that crashes.** The
  word-by-word dump of the shared document caught an access violation per box
  through the fault handler. It answered the question and was then removed.

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

**The treasure pickup flow — `0xd20c80`.** Four calls into the message getter,
among them `push 3` (the artifact-found line) at `0xd21015` and the index-2
pickup dialog nearby: this is where the chest decides and speaks. Which slot it
answers, and where that slot's table hangs off the object, is measured below —
the first reading of this paragraph named `0xd214a0` from a slot counted off
the wrong table, and that function calls the getter not at all.
`CAdvMapTreasure`'s RTTI descriptor is `0x10b8654`; its first vtable is
`0xfd4f60` (own methods `0xcb0970`, `0xcb0dd0`, `0xcb0df0`, `0xcb1660`).

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
and the hero classes went through.

**NOT DONE, AND NOT PLANNED.** Stage 1 proved the behaviour and the answer was
that the box plays right as a treasure, so the cost of a class of our own buys
a word in a file nobody reads. Written out here because the next object that
needs a class the engine does not have will start from this paragraph.

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

### The chest's dialog is 0xd20c80, and 0xd214a0 is not it

The message getter's `push 3` (the artifact-found line) sits at `0xd21015`,
and `start` — now that it verifies its own answer — puts that inside
**`0xd20c80`**, a function that reaches the message getter four times. That is
where the chest decides and speaks.

`0xd214a0`, the standing candidate this document carried, calls the getter not
at all. It is `0xfd4f90+0x0`, it corrects `ecx` by `-0xA8` on entry, and what
it does is still unread — but it is not the dialog.

`0xd20c80` appears in no vtable directly, so it is reached through an adjustor
thunk (`sub ecx,[ecx-4] / sub ecx,<N> / jmp <real>`, the shape every slot of
this class uses). Finding WHICH slot holds that thunk is the next step, and it
is a mechanical one: walk the class's tables, follow each slot through its
thunk, and see which lands here.

**A warning about the workbench.** `callsTo` scans BYTES, so an `0xE8`/`0xE9`
inside a constant reads as a call — `sub ecx,0B4h` supplied one, and the false
function start it produced looked exactly like a true one. `start` now
disassembles from each candidate and says whether the stream actually lands on
the address asked about; two of the three candidates for `0xd21015` were false.

### The slot, found — and it is in the seventh table

`trace.ts slots <vtable>` walks a table to its end and follows every entry
through its adjustor thunks, which is what makes a slot listing mean anything:
a slot of this class never holds the code that does the work, it holds
`sub ecx,[ecx-4] / sub ecx,<N> / jmp <real>`.

Walked over all seven tables, `0xd20c80` shows up exactly once:

    0xfd5108  +0x0c  0xd21b07  -> 0xd20c80

**The chest's dialog is slot `+0x0c` of the table at `0xfd5108`** — seventeen
slots, one of the four the constructor places through the virtual-base table
rather than at a fixed offset.

### Where that table's pointer lives in the object: +0xF8

The constructor writes it as `mov [eax+edi+4], 0FD5108h`, and `eax` comes from
the base-offset table the object carries at `+4`, which is `0xfd514c`:

    0xfd514c  -4          the vbptr itself
    0xfd5150  0xd0   ->  edi+4+0xd0 = +0xD4   gets 0xfd4f9c
    0xfd5154  0xe0   ->  edi+4+0xe0 = +0xE4   gets 0xfd4fbc
    0xfd5158  0xec   ->  edi+4+0xec = +0xF0   gets 0xfd5100
    0xfd515c  0xf4   ->  edi+4+0xf4 = +0xF8   gets 0xfd5108

**The pointer to patch sits at object `+0xF8`.** It checks out against the base
class's own constructor, which fills `+0xF0` and `+0xF8` with its tables before
the derived one overwrites them.

The thunk is a VTORDISP one — `sub ecx,[ecx-4]` — so the real `this` is
`ecx - [ecx-4]`, read at run time rather than a constant. Ours has to do the
same before it touches the object.

### How the chest finds its own shared document — it asks

    0xd20d30  call dword ptr [eax+8Ch]     ; virtual: give me my shared
    0xd20d45  call 0094AB92h               ; __RTDynamicCast, descriptors
                                           ; 0x10a79f8 / 0x10b5e4c
    0xd20d57  mov eax,[esi+0ECh]           ; the shared's Type, compared to 0xC

So recognising OUR boxes needs no new offset: the same virtual `+0x8C` hands
over the shared document, and comparing that pointer with the four tier
documents the archive loads is the whole test. The offset this document was
looking for does not have to be found.

### What stage 1 is, concretely

1. copy the seventeen slots of `0xfd5108`, with the RTTI word in front of it;
2. replace `+0x0c` with a thunk of ours that does `sub ecx,[ecx-4]` and jumps
   into our handler;
3. detour the constructor at `0xd20940`, and for an object whose shared is one
   of ours store the copy's address at `[this+0xF8]`.

Still open: whether `0xd214a0` (`0xfd4f90+0x0`) concerns us at all — it is 285
instructions that never call the message getter — and what the other sixteen
slots of `0xfd5108` do. The copy carries them unchanged, so they are not in the
way; the visit may still not be the only behaviour worth owning.

## What is left

Four of the six questions this section used to list are answered above: the
constructor, the tables and their lengths, the slot the dialog sits in, and
how an object names its shared document. What remains:

1. **The subclass itself** in `native/`, behind the `pandora-box` flag: the
   seventeen slots copied, `+0x0c` replaced, the pointer at `[this+0xF8]`
   retagged at the end of construction, bytes verified before anything is
   written and every refusal logged — the same shape as every fix here.
2. **What our visit does.** The chest at `0xd20c80` decides, speaks and hands
   over; ours asks the map’s script instead and lets the generated block do
   the rest (docs/PANDORA_BOX.md). Nothing about that needs a new hook — the
   touch trigger already fires and already carries the contents.
3. **The flag becomes native** (`native: false` comes off, the name joins
   `QOL_NAMES` in C), since the hooks then exist and must follow it.
4. **Stage 2** — the class in the DATA too, as `AdvMapPandoraShared`, through
   the engine’s class registry and a `types.xml` entry. Dropped once stage 1
   was played: it changes nothing a player sees.

Everything else stays as it is: the touch trigger still fires, the AI still
walks to the box, and the map’s generated block still carries the contents.
