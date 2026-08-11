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

### And it does not happen while you watch

`Execute` hands over a command — two slot numbers and a number, no counts — and
the army goes on reading exactly as it did. By the next click it is up to date;
within the one call that sent it, nothing has moved.

So a gesture cannot look at the army between its own moves. One that does works
the second move out as though the first had not happened, and the controller it
builds for it is judging a state that has not arrived: `Validate` says no, to
the wrong question. Alt gathering one stack of five and stopping, and an even
split of 4, 4, 4 coming out as 8, 0, 4, were both this.

The answer is a plan: decide the whole gesture on a copy of the army kept here,
then send the moves in order. Commands carry no counts, so they mean the same
thing whenever the engine gets round to them, and only the FIRST of them can
usefully be put to `Validate`.

## A window of ours out of the engine's own

The split slider is the only window in this game that asks "how many of these",
and it holds **no army, no slot and no screen**. It holds a controller, at
`+0x128`, and everything it draws and everything it does it asks that controller
for. So a controller of ours is a window of ours, with the game's own frame,
slider and buttons around it — which is where `H5EAskCount` comes from.

Nine places read `+0x128`, and between them they are the whole vocabulary:

| slot | |
|---|---|
| `+0x00` (side) | the stack drawn on that side, for the picture |
| `+0x0C` | may this be shown at all |
| `+0x10` (n) | may the slider stand at n — `Validate` |
| `+0x14` (n) | it stands at n, do the thing — `Execute`, the OK button |
| `+0x18` | what the LEFT side may not go below |
| `+0x1C` | the lowest n the slider will reach |
| `+0x20` | where the slider starts |
| `+0x24` | the total the two sides share |
| `+0x28` | may this be closed without answering — the Cancel button |

**The arguments in that table are the `ret` of the ENGINE'S slot, and reading
them off the call site instead crashed the game.** `+0x24` is called as
`push ebp; call [eax+24h]`, which reads as a side being passed and is not: the
matching `pop ebp` is at the far end of the block and the branch that skips the
block lands after it, so the push is a saved register. Ours took it as an
argument, returned `ret 4`, ate the saved `ebp` — and four bytes later the
engine returned into the next thing on the stack, which was the controller we
had handed to `Show`. The processor ran our own data as code, and the Windows
report said `homm5-editor.dll +0x1f9dc` with no hint of what it had been doing.
`tools/test-controller-slots.ts` now compares every slot of ours against the
`ret` of the engine's own, so this cannot come back quietly.

The window keeps `total - (+0x18)` as the highest n and `+0x1C` as the lowest,
and clamps between them. Ours is the plain case: the total IS the maximum,
nothing is held back on either side.

**The picture is made from a NUMBER, not from an army.** `+0x00` is answered
with the thing the window draws, and the engine's own controller makes that out
of one field of the stack it holds — `stack->+0x1C`, which creature it is. So
`H5EAskCount` takes a `CREATURE_…` number, fills that one field of a block of
its own, and hands it to the same call (`0xabafb0`): the creature table refuses
an id it does not have, so a wrong number costs a blank picture and nothing
else. Nothing is a legal answer too — the engine tests for it and leaves the
picture empty, which is what it draws for an empty slot.

The window asks for **side 0 only** and puts the answer in *both* pictures.
Right for a split, and as right as this window gets for a conversion: one
creature is what the player is counting.

**OK and Cancel are each one measured path.** OK asks `Validate` and, if it
passes, calls `Execute` and closes the window (0x7f84a0). Cancel asks `+0x28`
and closes only if the answer is yes (0x7f8640) — so a controller that always
says yes hears about a cancellation exactly once, when it happened. Neither is
asked while the window merely opens, which is what makes "we were cancelled"
safe to record in `+0x28`.

**A controller is more than a vtable.** Before the window calls one it asks
whether the pointer still points, in the engine's own way — `[[self+4]+4]` is a
displacement, the word at that displacement plus eight has to be positive, and
the one four further along is the count `Show` raises and lowers. Ours is a
static object whose count starts out of reach of zero, deliberately: a count
that cannot reach zero cannot reach the engine's destroyer, which is a function
we have not measured and would be calling on an object the engine never made.

**The engine's own opener cannot be used.** `0x7f8310`'s first act is to build a
controller of its own out of six army-and-slot words, and a controller is
exactly what we are bringing. What is left of it after that is the whole of
ours: `operator new` for `0x160` bytes, the constructor at `0x7f8d30` with the
engine's own `1`, hold it while `Show` runs, let go after.

**And an unmeasured slot cannot be stubbed safely.** These virtuals take their
arguments off the stack themselves, so a stub that does not know how many there
are leaves the caller's stack wrong however it returns. The one in
`native/ui/count-window.c` is not a safety net — it is a NAME for a crash that
would otherwise happen at a wild address, and the line it writes is the point of
it.

### Building a window is not showing it

`CSplitStack::Show` builds the window, loads its layout by name
(`N_SPLIT_STACK_WINDOW_ID`) and finds the widgets it drives — and none of that is
on screen. The engine's opener stops there and hands its caller `window+0xF8`;
each of its three callers then passes that to `CBaseScreen::ShowWindow`
(0x6cf590) on the screen it is a method of. Miss that step and you get a clean
log, no crash, and an empty screen.

**The screen can be asked for.** It is not a global and not reachable from the
adventure map — every call site has it as `this` — but `CBaseScreen`'s own "am I
the active one" (slot `+0x10`) compares itself against **0x5ba730**, which takes
nothing and answers with the top of the interface stack. That is the screen the
player is looking at.

**And what it answers with is a BASE, 0x844 bytes into `CAdventureScreen`.** The
class name reads correctly off that pointer, which is what made this expensive:
every field read at its documented offset belonged to something else, so
`ShowWindow` saw an empty root widget and returned without a word. RTTI carries
the distance — the complete-object locator's `+0x04` is how far the subobject
sits from the start of the object, so subtracting it is the whole conversion
(`whole_object_of` in `native/lua/hero-specialization.c`).

`this+0xA0`, the root widget, is worth reading before building anything: it is
what `ShowWindow` checks first, so it is also the honest answer to "is this
screen ready to be shown something".

### Giving a stack away whole is not a split

`CHeroScreen::Split` is only half named that. Its first act is to read one byte —
the engine's Shift binding, the thing that turns a drop into an offer to divide —
and when it is clear the function takes an entirely different branch: compare the
two creatures, and build a **merge**, a different and smaller command than the
split one.

That is the only command the army panel knows how to draw the result of. A split
command told to hand over everything leaves its source holding nothing, which the
panel never has to cope with otherwise, and it goes on drawing the slot: six
stacks on screen where the army has five, until the screen is reopened. The army
itself was right the whole time, which is why the log kept saying so.

So each half of the feature uses the engine's own door: a merge goes through that
function with the byte cleared for the call and put back after, and only a real
division of a stack goes through a controller of ours. Which is also the answer
to the Shift binding — the gesture means the same thing whatever the player is
leaning on.
