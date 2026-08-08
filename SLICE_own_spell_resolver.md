# SLICE — a spell of ours resolves ITSELF

> **Status: THE DAMAGE LANDS, 08.08.2026 (run 3). The visual does not yet.**
>
> Calling the applier per stack was the fix. Eight… seven stacks, twenty each,
> and in game the creatures die.
>
> **And the probe answered the question the reading could not.** `creatures
> before 200` / `creatures after 200` — the count does NOT change while `Resolve`
> runs, and the damage lands all the same. So nothing inside `Resolve` writes:
> the cast builds a CHAIN of events and the CALLER plays it, `edi->vt[0x110]
> (chain, 0)` at `0xB7B3FF`. The `CCombatEventLog` entry an applier builds per
> stack is how the damage travels, which is why one entry for the whole cast, in
> the caster's name, did nothing at all.
>
> That is measured, not inferred, and it took asking the stack rather than
> reading one more function.
>
> **What is still missing: the visual.** Both shipped branches play it per stack
> and we did not. Now added, read out of the single-target branch:
> `SpellVisual(spell, which)` (`0xAD5050`, `ret`, so `ecx`/`edx` are the whole
> signature — the three pushes at the call site belong to the NEXT call) and
> `unit->vt[0x280](chain, visual, 0, 0, 1)`, both behind `combat->vt[0x108]()`,
> which is how a battle nobody watches costs nothing.
>
> The document's `visuals` are asked for by index — the mass routine takes `1`,
> the single-target branch `0` — and an index past the end answers NULL, so ours
> asks for the second and falls back to the first.
>
> ---
>
> **Runs 1–2. The numbers were right; the entry was not.**
>
> **Run 2 (after the accounting fix).** `the whole cast came to 160` — eight
> stacks, twenty each, exactly as it should read. And still nothing happened to
> anybody.
>
> **Why.** Nothing before the APPLIER changes anything a player can see: the
> worth is arithmetic, `0xB7D030` returns a number, `0xB75C10` writes a line and
> a floating figure. What the battle plays back is the entry `0xBD1980` builds —
> and it is built **once per stack**, with that stack and that stack's amount.
> The mass routine's call sits inside its loop (`mov edx,edi`, its loop variable,
> `0xD61152`); so does the area routine's. Ours called it once AFTER the loop
> with the cast's total and the caster: one entry, wrong amount, wrong unit, and
> eight stacks that had each been dealt twenty lost nothing.
>
> Fixed: the applier is called inside the loop, per stack, threading the chain.
> **Still an inference until the next run** — what would confirm it is creatures
> dying; what would refute it is the same "came to 160" with nothing lost again,
> which would mean the entry is not where the damage rides.
>
> ---
>
> **Run 1 — the path works, the accounting did not.**
>
> **What the run proved.** Casting *Unholy Word* no longer crashes: the resolver
> logged `[resolver] the game's own, spell id 21`, handed the cast back to the
> engine, and the battle carried on. That is criterion 1, and it used to be three
> crashes in a row.
>
> And our own cast went the whole way: `[resolver] OURS, spell id 353`, shape the
> whole field, **8 stacks considered**, each `worth 20 / damage 20`, the spare
> filter asked about all three abilities per stack and answered honestly.
>
> **What was wrong.** Every stack came back `landed 0`, so the cast summed to
> zero, called itself a spell that did nothing, and skipped the entry the battle
> shows — nothing appeared to happen. `0xB75C10` does not answer with the damage:
> it writes the combat log line and the floating number and returns only what a
> VULNERABILITY adds, which is zero unless something is vulnerable. Every shipped
> branch adds it to the damage it already had (`add ecx,eax`); ours counted only
> the second. Fixed: `total += dealt + extra`.
>
> Next run: the same three checks at the bottom of this page.

## The rule, and where its line actually falls

"Do not reuse engine code" cannot mean "do not touch the engine" — every hook we
own is a call into it. The line that is usable:

- **Allowed, and correct:** calling an engine function through **its own entry
  point**, with a signature taken from the code (arity from its `ret`).
- **Not allowed:** **jumping into the MIDDLE of another spell's branch** and
  inheriting its stack frame.

Only when there is no other way in does a mid-function entry get taken, and then
it is written down with what it costs. **One is left**, and it is not a spell's:
`0xB7CED1`, the worth switch's document-reading case, shared by twenty-one ids.
Its cost is written beside it in `native/combat/spell-cast.c`.

## What was there before, and the bill it ran up

`native/combat/spell-cast.c` sent every cast of ours into one of three branches
belonging to shipped spells:

| `IsAimed` | `IsAreaAttack` | branch borrowed | whose branch it was |
|---|---|---|---|
| false | false | `0xB7ED4A` | Armageddon, Holy Word, **Unholy Word** |
| true | true | `0xB7ED16` | Fireball, Frost Ring, Stone Spikes |
| true | false | `0xB7F6DC` | Magic Arrow, Lightning Bolt, Implosion |

Casting *Unholy Word* — id 21, the spell whose branch we borrowed — crashed the
game three times in a row, byte-identical registers each time. And on a run where
the ripple was cast **once**, our damage filter ran **178 times**. We were inside
someone else's loop on someone else's terms, and no care inside our own code
reaches that.

## What was built

`native/combat/spell-resolve.c` — the dispatch and the cast, ours. The three
`borrow_branch` calls are gone; `borrow_branch` itself is renamed `engine_code`,
because what it is really for is checking a function's head before we call it.

**Ours:** which stacks (the whole field, the tiles our row named, the one aimed
at), which of them this spell passes over, the loop and the running total, and
the "did nothing" byte the Payback perk reads.

**The engine's, each through its own entry point, arity from its `ret`:**

| function | `ret` | callers of the engine's own | what it is |
|---|---|---|---|
| `0xBAB520` | — | | every stack on the field, both sides |
| `0xB57100` | `4` | | may a spell touch this stack |
| `0xB7CE70` | `0Ch` | 19 | what the spell is worth at this power |
| `0xB7D030` | `18h` | 21 | what it does to one stack |
| `0xB75C10` | `10h` | 14 | the stack loses it, **and the combat log line** |
| `0xBD1980` | `10h` | 6 | the entry the battle shows |

Between them sits `0xB861A0`, where magic resistance, anti-magic, protection
from the school and our own row's filter all apply — so nothing is skipped by
resolving the cast ourselves.

**The cast object is the source, not the frame.** `Resolve`'s prologue copies ten
of its fields onto the stack, which is how each shipped branch reads them; we
read the object. `+0x04` spell, `+0x14` caster, `+0x18` the one stack aimed at,
`+0x24`/`+0x28` the affected stacks, `+0x2C` spell power, `+0x30` mastery,
`+0x34` a scale. Each read out of the code that uses it.

**The area shape needed no tile lookup at all** — the command has already turned
the covered tiles into a list of stacks, and those tiles are ours, from the row.

**The exit is not a borrowed branch.** `0xB7FAF0` is the epilogue every one of the
250 cases jumps to; it belongs to the function, not to a spell.

## Found on the way, and fixed

`mass-spell-element-fix` made a **four-argument** call site dispatch to any of
three appliers whose `ret`s are `10h`, `14h` and `18h` — a water or air mass
spell would have returned with the stack four or eight bytes short. It never
fired (the only elemental spell reaching that routine is Armageddon, and
Armageddon is fire). The fix now asks the one question the site can act on and
leaves the `call` the game wrote.

`tools/test-native-anchors.ts` only recognised arrays named `_HEAD`, so nine
`_MARK` anchors were silently unchecked — including the exit our own stub jumps
to. It reads both now: 53 anchors became 60.

`tools/reverse/trace.ts bytes <addr>` is new. Head constants used to be typed out
from the mnemonics `show` prints, which is how `mov esi,edx` was written as
`8B D2` (it is `8B F2`) and cost a game run to find out.

## What is NOT done, and is not hidden

**A spell of ours leaves no Master's mark.** The four appliers are one per
element and they are not interchangeable — `ret 10h`, `14h`, `18h`, and fire even
swaps the roles of `ecx` and `edx` against the plain one. Ours calls the
element-less one, which builds the entry the battle shows but asks for no Master
perk. Each of the other three needs its own reading before it can be called.

This is a regression only for the AREA shape, which used to reach the element
dispatch inside `0xD608C0` and was measured leaving the mark. The whole-field
shape never left one.

**One assumption, and what would disprove it.** The entry a cast leaves is built
"around" an object; the shipped single-target branch hands it the stack aimed at
(`+0x18`), and a whole-field cast aims at nobody — so there we hand it the
CASTER. Both answer the vtable slot the applier asks (`+8`, the combat), so the
call is safe either way, but where the effect is PLACED is assumed. What would
disprove it: a whole-field cast of ours whose effect appears on the caster
instead of over the field.

## The run that settles it

1. **A battle in which only *Unholy Word* is cast, and not one line of ours
   appears in the log.** Before this it crashed. It must now be silent.
2. **Sabotage it** — cast the ripple in the same battle and see our lines come
   back. A check that can only pass is not a check.
3. The ripple's own run: `[resolver] OURS`, the shape, the stacks considered, and
   one `worth / damage / landed` triple each. The undead spared by name.

## Carried over — keep, do not re-derive

- **Log tags are places, not deeds.** `[gate]` / `[cast command]` / `[resolver]`
  / `[worth]` / `[damage]` / `[record]` / `[text]`, documented in
  `docs/engineInternals/SPELLS.md`. Nothing is rationed anywhere.
- **The guard on `0xB1EED0`.** The getter range-checks nothing and `isSpell` at
  `0xAD45B0` calls it without a bounds check, so a bad number walks off the
  table. Ours answers NULL and prints the number, the table size and the
  caller's return address. It caught the crash 32 times in one run. Keep it — and
  note it is a guard, not a fix.
- **The bad number is `0xB70700`**, an adjustor-thunk block — a vtable slot read
  where a spell id was expected. Reached via `0xB5ADB0` → `0xBCB9D0` →
  `0xD6AE00` → `isSpell`. Where it is born is still unknown; the new resolver may
  never go there.
- **`0xAD5140` does not check the record** — `lea ecx,[eax+44h]` follows the call
  — so a NULL becomes address `0x44`. Our hook builds the string off a spell that
  exists (id 1). Returning the caller's string untouched was tried and is wrong:
  the caller does not always construct it and then destroys it.
- **`block+4` IS the spell id** in the damage function. Measured across ids 11,
  12, 13, 14, 15, 18, 19, 21, 278, 353 in one run. The "we misread the id" theory
  is dead — do not revive it.
- **The spell table ceiling is consistent at 358** everywhere. The crashes were
  not the ceiling.
- **Heads under relocation.** The game does not always get its preferred base
  (one session it loaded at `0x003B0000`), so a head naming an absolute address
  must be matched with `detour_relocated` and a skip mask, or trimmed to the
  bytes before the operand.

## Still open

- Where the vtable slot enters as a spell id.
- Why one cast produced 178 damage calls — expected to be answered by the walk
  being ours, but not yet seen.
- Why the spare filter answered yes almost never.
