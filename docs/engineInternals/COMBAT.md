# A battle, and the one door it leaves by

Read out of the executable while trying to answer one question — whether a
battle already fought can be thrown away and fought again. The answer to that is
at the bottom; what is above it is the shape of a combat, which turned out to be
much simpler than the question suggested and is worth having on its own.

Addresses are from our unwrapped `bin/H5_Game_H5E.exe` and are landmarks, not
constants — see [../ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md).

## A quick battle is not a different kind of battle

It is the same `CCombat`, played by the AI for both sides and wound forward in
batches of turns.

| | |
|---|---|
| `CQuickCombat@NWorld@@` | a WRAPPER, holding the combat at `+0x8` |
| `CStepQuickCombatCmd` | wind it on; the count comes from `quick_combat_step_limit` |
| `CAcceptQuickCombatResultCmd` | take the outcome |
| `CCancelQuickCombatCmd` | throw it away |
| `CSetArmyAutocombatOptions` | who plays a side — a separate thing entirely |

So "the computer resolves it" is **not** a property of the battle. It is the
autocombat flag on each army, and it is set and cleared by its own command. The
wrapper's contribution is different and is the whole subject of this page: it is
what makes an outcome REFUSABLE.

Which of the two a battle will be is decided once, at the start, by `0xc5b010` —
the player's own setting or the `adventure_quick_combat` variable, and then
`AllowQuickCombat` from both sides. One byte of the start block carries the
answer; on "no" `0xcfd290` clears it and drops the wrapper beside it. Both
answers then walk into the same builder.

## Nothing leaves a battle while it runs

Losses, resurrections and summons are all the combat's own state. This is not
only measured, it has to be so: a stack raised from the dead would otherwise
have to be written back out again, and a summoned one would have to be written
out and then taken away.

A battle reaches the world **once**, through a command:

```
CFinishCombat@NWorld@@          vtable 0xf55818
  +0x0C   who won, roughly — a side
  +0x10   the combat
  +0x14   another side
  +0x18   the outcome (the wrapper's +0x10: 2 or 3)
```

and its apply (`0xb73230`) is four instructions of substance:

```
combat = cmd[+0x10]
if (combat is alive)
    combat->vt[0xDC](cmd[+0x0C], cmd[+0x14], cmd[+0x18])
```

`CCombat::vt[0xDC]` is `0xbb0260` — the finish. It sets the combat's state word
`+0x9C` to 3, stops the sides, works out the winner through `vt[0xE0]`, and from
there hands everything outward. It is a large function and is not fully read.

**Nine places build a `CFinishCombat`**, and the two that matter are at opposite
ends of the same idea:

- `CQuickCombat::Accept` (`0xc5c050`) — when the player presses OK on the
  preview. Before that it drains the combat's clock into `CSetCombatTime`
  commands, and that is all it does besides;
- the combat's own end (`0xbad28e`) — when the fighting is over.

So the difference between a quick battle and a hand-fought one is **not what is
handed over**. It is the same command, carrying the same combat, reaching the
same function. The difference is only **who sends it and when**: for a quick
battle a person does, by pressing a button; for a hand-fought one the battle
does, by ending.

`EnableAutoFinish`, the Lua name behind `combatEnableFinish` (`0x601bb0`), is a
third sender: it turns the finish CHECKS on through
`CEnableCombatFinishChecksCmd` → `CCombat::vt[0xD0](bool)`, and then sends
`CFinishCombat` itself.

## The results window is one screen wearing two faces

`CombatResults`, and which face it wears is one byte of the screen, `+0x21C`.

| | after a battle | previewing a quick one |
|---|---|---|
| `+0x21C` | 0 | 1 |
| `Ok` → `Close` | closes the window | `CAcceptQuickCombatResultCmd` |
| `Replay` (`+0x20C`) | hidden; handler returns "not mine" | shown; `CCancelQuickCombatCmd` |
| `ReplaySave` (`+0x248`) | shown | hidden |

The screen's init hides `Replay` the instant it has found it (`push 0` before
`SetVisible`, at `0x722d8b`), and only the quick branch of `Show` (`0x7243b0`)
turns it back on. Two creators make this screen: `0x722400` for the preview,
which refuses to open at all without a live wrapper in its arguments, and
`0x724e8f` for the report.

## What a cancel actually does, and what it does not

`CQuickCombat::Cancel` (`0xc5bf60`) — «Вручную»:

```
clear autocombat on both sides    side->vt[0x88](0)
put the battle down               wrapper[+8] = 0, release
tell the owner                    wrapper[+0x54], invoked through 0xbf8bf0
```

It does not start a second battle. The player goes on fighting **the same
combat object**, now with no wrapper — which is exactly why it ends in a report:
`CFinishCombat` still arrives, but nobody was ever going to be asked first.

### Four things that were tried, and what each ruled out

All by patching, all confirmed by a launch, none of them the answer:

| | |
|---|---|
| stop the init hiding `Replay` | the button appears and is dead — the report's handler is `xor al,al; ret` |
| force every battle quick (`0xc5b010` → `mov al,1; ret 4`) | the question is asked at the START, and after a cancel the battle does not start again |
| stop the cancel putting the battle down | harmless, and changes nothing: nobody consults the wrapper at the end |
| hold the wrapper by its own reference count | it survives — and is **invalidated**: its liveness word reads `0x80000000`, and every path in the engine tests that word and walks away |

The last one is the useful negative. Objects here are not reclaimed by reference
counting alone; the world marks them dead, and a dead object is inert however
many references are held. Keeping one is not the same as keeping one usable.

## What a battle costs, and where it is charged

Measured rather than read, with the army printed on both sides of one call. A
hero's stacks are reached the way the army panel reaches them — vtable `+0x48`
for the thing that holds them, then a plain `{begin, end}`, a slot's creature at
`+0x1C` and its count at `+0x20`, all of it in
[../UI_INTERNALS.md](../UI_INTERNALS.md).

**Nothing is charged while the battle runs.** The army entering `CCombat::Finish`
equalled the army before a blow was struck, in every battle recorded. The whole
cost is inside that one call.

**Inside it, the charge has more than one road.** Four were shut, one after
another, and the army fell every time from somewhere new:

| shut | who paid instead |
|---|---|
| `0xBAE6A0` — walks a side's creatures, raises the "lost N" announcements | `0xBADA90` |
| and `0xBADA90` | `0xBAE3F0` |
| and `0xBAE3F0` | something past `0xA46BD0` |

Each looked like the answer until it was shut, because a road with nothing left
to carry is indistinguishable from no road at all. `CHero::vt[0xE8]` (`0xc246e0`)
looked like the write itself — a thunk pushing `this` back 0x1C into `0xC20170`,
with only two callers in the image — but a detour there never fired once, so it
is not on the road the others take.

**So the army is put BACK instead.** A count is a plain int in a slot; writing
it is one instruction and cannot be moved somewhere else next time. Snapshot
before the finish, write back after: 12 → 8 → 12, and 12 → 3 → 12, with no slot
lost and no slot holding a different creature. That much works.

### What it does not cover

A battle changes more than an army, and the rest is not undone by this:

- **experience** is granted and stays;
- **the guard leaves the map** — and silencing the initiator the finish keeps at
  `+0x188` does not stop it;
- untested: mana, war machines, loot, the kills counter, objectives.

Which is the same shape as the four roads, one floor up: each thing closed
reveals the next, and the list cannot be seen from inside.

### A record the battle is made from — there is not one

`CHero::vt[0x38C]` (`0xc2a6d0`) reads like the door: it compares `+0x300` with
`+0x304`, takes 0x48 bytes off the top of what is between them, and reaches the
combat builder. If a battle were one record on that stack, fighting it again
would be the record put back rather than an undo of anything.

It is not. The method is called constantly and the stack is empty every time —
`+0x300` null, the first comparison sends it straight out, and the builder
inside it is on a path these battles never take.

## Where that leaves "fight it again"

**One thing works and one does not.** A hand-fought battle can be made to cost
the army nothing, reliably and by measurement. It cannot yet be made not to have
happened: the guard is gone, the experience is kept, and what else went out with
them is not known.

Not with the wrapper. It is destroyed and invalidated before a hand-fought
battle ends, and no reference saves it.

But the map above says the interesting thing anyway: **the point of no return is
a single command.** Until `CFinishCombat` is applied, the world has not been
told, whoever was fighting and however it went. A hand-fought battle differs
from a preview only in that nothing stands between its ending and that command.

Putting something there — holding the finish, showing the outcome, and letting
it through only when the player accepts — is what would make the two
indistinguishable. That is a detour on one function with a known signature,
rather than the construction of an engine object, and it is where this goes
next. What it has to survive is the teardown: whether a combat whose finish
never arrived can be left, and whether the map is still in a state to be
attacked again.
