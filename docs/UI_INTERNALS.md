# The interface, from the inside

How a screen is put together, as the executable has it: what a click on a widget
actually is, how a screen finds its own parts, and what a mod may hold onto.
Written from measurement — a run of the game with a log — rather than from
reading, because most of it contradicted the reading.

The worked example throughout is the **army panel**, because that is what was
being changed when this was established (see [QOL.md](QOL.md)). The shapes are
the engine's own and are not particular to it.

## A click on a stack is not an event

There is no message for it. `slot_click` and `slot_dbl_click` exist as UI
message names, and screens like the market handle them — but in the hero screen
a click on a stack never becomes a message at all: `CHeroScreen2`'s message
handler saw exactly one message across a run spent clicking stacks, and it came
from a dialog.

What handles it is **drag and drop**, as a three-state machine:

| | |
|---|---|
| `CDNDStateReady` | pressing over something remembers what is under the cursor |
| `CDNDStatePrepare` | becomes Drag when the mouse MOVES **or** when the button is released |
| `CDNDStateDrag` | releasing here is the drop |

Both of Prepare's exits arrive at one function (`+0x1c`, with `+0x24` tail
jumping into it), which is why a plain click already picks a stack up in this
game — and why a single hook there catches a click and a drag alike. It is also
why the first click and the second are different functions: picking up is
Prepare, putting down is Drag.

## Where the slots are

Not in a field of the screen. A scan for the clicked widget across the screen's
own fields, and one indirection past them, found only "the last thing touched".
The slots are windows, found by name, three deep:

```
the screen's root window
  └── "Army"
        ├── "Attributes"
        └── "ArmyStacks"
              └── "Slot_1" … "Slot_7"
```

The executable keeps that very list of names as seven static strings twelve
bytes apart (`Slot_1` at 0x1110628), built lazily — asking for them before the
screen has run answers with seven nothings.

Looking a child up by name is `+0x94`, taking `{begin, end, capacity}` and a
flag. **It cannot be called on a pointer of our choosing.** In this hierarchy
that vtable slot holds a virtual-inheritance thunk (`sub ecx,[ecx-4]`), which
adjusts `this` by a displacement stored just before the subobject; given the
start of an object it reads the heap's own bookkeeping and takes the game down.
Twice, here. The way to get a receiver that is right by construction is to take
one the compiler made: hook the function the screen uses to build its slot list
and use the window it was handed.

A screen builds **more than one** army — the hero's and whoever it is standing
next to — so keeping only the last one means a click on the other matches
nothing.
That is how the slots were first found, and it is worth knowing because the
lookup by name is a general tool. It is **not** how they are found now: the
screen keeps its own list of them, which is better in every way — see below.

## Reading an object at all

Reading an object's fields without first asking what the object IS gives a slot
name on one run and a fragment of code on the next: the drag helper is generic,
and a town screen lays out differently from a hero screen. Match the vtable
before reading a field.

And a search across an object graph must not ask Windows about every pointer it
meets — that is a system call each, tens of thousands per click, and the game
stops while it happens.

## The screen, and everything a split needs

All of this comes out of one function, `CHeroScreen::Split` (0x759360) — the
four-argument thing a drop calls. It builds a controller out of its own fields,
so reading it once answers every question the feature had been asking the
interface for.

| field of the screen | |
|---|---|
| `+0x53C` | the first army's slot list — seven entries, twelve bytes apart |
| `+0x654` | the second army's, when there is one |
| `+0x1B0` | the first army |
| `+0x1B4` | the second |
| `+0x4B8` | which of `+0x338` and `+0x1B8` says whether the second army is there |
| `+0x1A4`, `+0x1A8`, `+0x758` | three of the controller's nine fields, unchanging |

The screen proper starts `0x174` before the drag-client subobject a drag hands
over.

**A slot entry's widget is not its first word.** The entry begins with the
object; the widget the drag deals in is the subobject inside it, reached the way
the screen reaches it — `obj + [[obj+4]+8] + 4`. Matching a clicked widget
against those fourteen entries answers *both* questions at once: which slot, and
which army. No names, no hook, no bookkeeping of our own that can go stale.

### What is in a slot

An army is asked for the thing that holds its stacks (`army->+0x48`), and that
for the vector of them (`owner->+0x08`, a plain `{begin, end}`); the entry at a
slot's index is the stack, or **null when the slot is empty**.

| a creature stack | |
|---|---|
| `+0x1C` | which creature |
| `+0x20` | how many |

Both measured from the code that builds a split, not from staring at memory —
which is what the earlier "the count is not readable" conclusion came from. It
was reached honestly (the fields that held 250 for one army held a file path for
the next) and it was wrong, because the object being read was the one behind the
*widget*, not the stack.

## A controller of our own

`CHeroDragStackController`'s constructor (0x812190) takes one argument: a block
of nine words. Every one of them is the screen's, and the screen assembles them
in front of us:

| | | | |
|---|---|---|---|
| 0 | screen `+0x1A8` | 5 | target army's owner |
| 1 | screen `+0x1A4` | 6 | target slot |
| 2 | source army's owner | 7 | target army |
| 3 | source slot | 8 | screen `+0x758` |
| 4 | source army | | |

So a split is two numbers in a block, and no drag, no window and no held key are
anywhere near it. (An earlier version of this page had the block captured from a
real split and only its two slot fields understood. That worked, but it meant
nothing could be done until the player had split something by hand, and it
carried whatever else was stale in it.)

### The number is what the TARGET ends up with

Not how many cross. This is the single most expensive thing on this page.

`Init` (vtable `+0x30`) fills in the numbers the controller is judged by:

```
if the target slot is empty       total = source count
else if the creatures differ      total = 0
else                              total = source count + target count
```

and `Validate(n)` (`+0x10`) refuses unless `total - n` clears the source's
minimum and `n` clears the target's; `Execute` (`+0x14`) then leaves the target
holding `n` and the source `total - n`.

Which means:

- into an **empty** slot the two readings are the same number, so every gesture
  that split into a free slot was right;
- into an **occupied** one, "hand over two more" was being read as "leave the
  target with the two it already has" — a call that validates, executes, and
  changes nothing.

That is the whole of the 6 → 4, 6, 2 that no amount of arithmetic above it could
have fixed. It cost several rounds of "the logic must be wrong" before anyone
read the four instructions that say so.

`total == 0` is also the same-creature test, free: a pair the engine would not
merge is left at zero, and nothing else has to know what a creature is.

### What this replaced

For the record, since two of them look like doors and are not:

- `CHeroScreen2::OnDrop` (0x755e10) takes **four** arguments and ends in
  `ret 10h`. Calling it moves the *whole* stack into an empty slot. Read that
  `ret` before writing the hook: declaring a fifth argument made the hook take
  four bytes more off the stack than the caller put on, and the three symptoms —
  a crash *after* the call returned, a phantom argument that changed between two
  identical drops, and a deferred call that did nothing — all looked like other
  problems entirely.
- `CSplitStack::Show` (0x7f8fb0) and the generic 0x7f8310 are not on the hero
  screen's path at all.
- **The engine binds Shift** on a drop: it is what turns "move the stack" into
  "offer to split". Anything that moves creatures through the drop inherits
  whatever the keyboard is doing at that moment; a controller built directly does
  not, and that is reason enough on its own.
