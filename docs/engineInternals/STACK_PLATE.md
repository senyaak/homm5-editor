# The plate over a stack in a battle

*Answers: what the number over a creature's head is made of, how its text comes
to be ours, how a bar was added beside it, and the one thing still missing.*

Two quality of life switches live here — `stack-losses` (done) and
`stack-health-bar` (half done). Addresses are from our unwrapped
`bin/H5_Game_H5E.exe` and are landmarks, not constants; see
[../ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md).

**The image is RELOCATED.** It loaded at `0x650000` in every run, so a pointer
logged from inside the game is `0x250000` above the address the disassembly
shows. Two hours went into "vtables in uninitialised data" before the extension
started printing `GetModuleHandleW(NULL)` on every page of its log. Anything
that prints an address should print that beside it.

## The widget is data

| | |
|---|---|
| `UI/UIGameRoot.(UIGameRoot).xdb` | `ID_STACKINFO_WINDOW` names the plate |
| `UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb` | the plate: one child, `Text`, and four visual states |
| `UI/CombatArena/StackInfo/StackText.(WindowTextView).xdb` | the number |
| `UI/AdventureScreen/StackInfo/{Normal,Negative,Positive,Mixed}` | its four backgrounds |
| `Textures/Interface/CombatArena/StackInfo/*.dds` | 15x15, `TF_8888`, no mipmaps |

The four states are the buff and debuff colouring — blue, red, green, purple —
and they are not ours to take. The backgrounds are **nine-slice** tiled
textures, which is why a strip of one draws its own border.

The ToE patch overrides none of these, so our own archive is the only override
that has to exist.

## The number, and how it becomes ours

Three functions, and the last of them is why this feature is cheap:

| | |
|---|---|
| `0x739c40` | place ONE plate. `this` is the window, the **second** stack argument is the number. `ret 10h` — four stack arguments, taken from the `ret` |
| `0x7c0ed0` | that number as text: the key `CREATURES_NUMBER` with `count` substituted, and "2K" above a thousand |
| `0x4dc940` | a string of the engine's from a C string. `ret 4` |

**`0x7c0ed0` has exactly one caller in the whole image, and it is the plate.**
So a detour there changes that text and nothing else in the game — no test of
"is this a plate", no state about which screen is up.

It returns a **static** string, `0x1112858`, filled by a format call whose
format string is `L"%d"` — `25 00 64 00` in the image.

### The string is UTF-16, and three crashes were that

A narrow assignment into it, and narrow bytes written into its buffer, both
left the window holding something that was not a string, and the game died in
the DRAWING rather than where the mistake was. The tell sat in the first log:
one character `6` measured **two bytes** long.

What the losses feature does now: no allocation and no free, the characters
written where the engine already put them — a one-digit count sits in thirty
bytes of room — and `end` moved to `begin + length * 2`. `end` excludes the
terminator, which is what the engine's own string constructor leaves behind.

### Which stack a plate is showing

The plate carries a count and nothing else. `stack-losses` therefore keys what
a stack walked in with on the **window**, which within one battle belongs to
one stack, and forgets it when `CFinishCombat` is applied — the one door out of
a battle there is, see [COMBAT.md](COMBAT.md).

For the bar the same count is matched against the fighting stacks, which arrive
as an argument to the plate pass (below), each taken once and in order.

## Where the plates are drawn from

`CCombatArenaScreen::vt[0x2C]` → `0x655520` → `0x651210`, which has **two
branches**, and this cost a day: the short one (`0x71dbc0`, walking 36-byte
requests against 24-byte rows) is not the one a battle takes. The battle takes
the long one, `0x739f60`, and its fourth argument is the vector of
`CCombatCreature*` — the fighting stacks themselves.

Both branches place their plates through `0x739c40`, which is why the text hook
needs to know nothing about either.

## The bar

Two child windows declared in `homm5-editor-qol.h5u`, built by
`tools/qol-ui.ts` out of the shipped files: a dark track and a bright green
fill, plus a texture of our own because the shipped `Positive` is meant for
tinting a whole badge and reads as almost nothing two pixels tall.

Its own archive rather than `homm5-editor.h5u`: it overrides two interface
files and extends no reference table, so it has no business inside twenty-six
megabytes of content rebuilt for other reasons.

**What works**: both strips are found on the plate by name — `vt[0x94]` on the
receiver adjusted for the virtual base, exactly as the placement call reaches
`Text` — and the stack behind a plate is matched by its count.

### What is missing: the width

`vt[0x58]` sets it, and the engine calls it on a child it has just put through
`__RTDynamicCast` to `IWindow` (`0x94AB92`, descriptors `0x10AAF54` and
`0x10AB114`). Both shortcuts around that cast failed:

| | |
|---|---|
| `vt[0x0C]` on the object | answered a heap address where a width belonged |
| `vt[0x0C]` on the adjusted receiver | crashed before answering |

So the next step is not another guess at a receiver — it is to make the cast
the way the engine makes it, and to take `vt[0x58]`'s arity from its `ret`
rather than from its call site. That last mistake has now been paid for five
times in this repository.

Until then the strips draw at the size the archive gives them, which is visible
the moment Shift is held: the plate grows to fit the longer text and they do
not follow.
