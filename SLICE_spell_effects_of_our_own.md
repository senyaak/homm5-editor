# SLICE — effects of our own, and where a new TERM enters

> **Status: agreed, not started.** Comes after `SLICE_own_spell_resolver.md` has
> had its run. Written 08.08.2026 so the next session does not re-derive any of
> it.

## The goal, in Senya's words

> «когда мы введём артефакт +50% урона огнём — он будет работать всегда, а не
> через кривизну»

That is the right goal and it decides the shape of everything below. The
correction this page makes is only about WHERE such a term enters — it is not
the appliers, and knowing that turns one large job into three small ones.

## The correction, and the measurement behind it

`0xB861A0` — "how much does this spell do to that stack" — has **exactly one
caller**: `0xB7D090`, inside `0xB7D030`. And `0xB7D030` has **twenty-one**, which
is every damage path in the game: the resolver's own branches, the mass routine,
the area routine, the mines, the wasps, the creature abilities.

So there is ONE DOOR, and we already stand in it — our spare filter is detoured
onto `0xB861A0` today, and the last run shows 600 calls through it in one battle,
almost all of them the game's own spells.

**An artifact that adds to fire damage is a term at that door**, not a rewrite of
anything:

```
dealt = original(power, block, caster, target)
if (our rows say the caster carries it and SpellElement(spell) == fire)
    dealt += dealt * row->percent / 100
return dealt
```

and it then applies to **Armageddon, Fireball, our ripple and a fire spell a mod
adds next year**, with nothing said about any of them. That is the same shape as
`CNecromancy::RaisePercent` in `combat/term.c` — call the original, add our term,
return the sum — which is the backbone of this extension already, and the same
shape as `CountEquipped`: one detour, fifty-four artifacts
([[homm5-equipment-is-read-not-applied]] in the session memory).

**Reimplementing the appliers buys none of that.** They are not where damage is
decided; they build the entry the battle shows. See below.

## Three pieces, smallest first

### 1. The three element appliers, called through their own entry points

**What is missing today:** a spell of ours leaves no Master of Fire / Ice /
Storms mark. Ours calls the element-LESS applier `0xBD1980`, which builds the
entry but asks for no perk.

**Why it cannot be bolted on.** `0xBD1560`, where the perk term is applied, is
**inside `0xBD1420`** — it opens `mov [esp+24h],eax`, a continuation, not a
prologue, and has zero direct callers. Reaching it means jumping into the middle
of that function and inheriting its frame. That is the exact thing
`SLICE_own_spell_resolver.md` exists to have removed.

**What each applier really is** — four variants of "build the entry the battle
shows", differing by what each adds:

```
if (damage <= 0) return chain            ; all four
edi = ecx->vt[8]()                       ; the combat
malloc(0x60) → 0xC4B050                  ; THE ENTRY
if (spell == 236 || spell == 335)        ; fire only: a second entry
    malloc(0x60) → 0xC4AD60
…the element's own term                  ; 0xBD1560 for fire
```

**What has to be read, and it is the whole job.** They are not interchangeable:

| applier | element | `ret` | stack args | where a call site is |
|---|---|---|---|---|
| `0xBD1790` | air | `14h` | 5 | `0xD60B3C`, `0xB7F789` |
| `0xBD1420` | fire | `10h` | 4 | `0xD60B19`, `0xB7812F` |
| `0xBD12C0` | water | `18h` | 6 | `0xD60AFF`, `0xB7F7AE` |
| `0xBD1980` | none | `10h` | 4 | done — we call it |

**And fire swaps `ecx` and `edx` against the element-less one** (fire does
`ecx->vt[8]`, plain does `edx->vt[8]`). A call written for one and pointed at
another is a stack four or eight bytes short — that was a real bug in
`mass-spell-element-fix`, fixed 08.08.2026, and it is the reason this table
exists rather than a pointer array.

`0xD608C0`, the area routine, calls all three in a row with 5 / 4 / 6 pushes —
one function to read and all three signatures fall out.

**Then** our resolver picks the applier from `SpellElement(spell)` for ALL THREE
shapes, which is more than the game does for its own: only its area routine
dispatches on element, its mass routine has a single `cmp eax,0Ah`.

### 2. The TERM layer — one door, every spell

The artifact case, and the one that pays for itself. A row in
`bin/homm5-editor-effects.txt` of the shape "this subject adds this much to
damage of this element", read at the `0xB7D030` / `0xB861A0` door.

**What can be a subject, and none of it is new machinery** — the extension
already asks all three through questions the executable knows how to answer:

| subject | asked by |
|---|---|
| an artifact, or a set of them | `CountEquipped`, hero vtable `+0x328` |
| a specialization | `HasSpecialization` — `lua/hero-specialization.c` |
| a skill or perk | `GetSkillMastery` |
| a creature ability on the TARGET | `HasAbility`, unit vtable `+0x28C` |

So adding a subject costs a config row and a virtual call; adding a SUM still
costs a detour, and this slice buys the one sum that covers every damaging spell
in the game.

**Where the element comes from:** `SpellElement` (`0xAD4E50`), asked of the
document. Twenty-two places in the executable ask it and not one looks at a
number — so a row that says "fire" means fire for every spell alike.

**What to be careful about:** the door is asked once per stack per cast, 600
times in one battle in the measured run. Read the rows, do not walk them per
call — and no logging in the term itself, for the same reason the tiles stub has
none.

### 3. Entries of our own — and this is where reimplementing IS right

For an effect the engine has **no** applier for: our own mark, our own status,
"a Lua function that hurts whom we choose and leaves what we say". Here we do
build it ourselves — but through the engine's own constructor `0xC4B050` with a
payload of ours, not by hand-rolling the 0x60 object and its refcount.

Deliberately last: it is the only one of the three that needs anything invented,
and the two above are what make a spell of ours behave like the game's.

## What is already true, and must not be re-derived

- **The resolver is ours** and borrows no branch. `SPELL_ARMAGEDDON` and
  `SPELL_UNHOLY_WORD` are untouched — measured 08.08.2026, casting the Word no
  longer crashes.
- **Resistance was never lost.** `0xB861A0` — four `SpellElement` calls each
  paired with a flag on the target (the elemental protections), `[vt+0x28]` for
  an effect on the stack, `[vt+0x1A8]`, `[vt+0x2BC]` — is reached through
  `0xB7D030`'s own entry point. Proof from the run: `[damage] … asked from
  0x00b2d095` is `0xB7D095`, the instruction after `call 0xB861A0`. The magic
  resistance PERCENTAGE is one level up, `0xB7D870` inside `0xB7D030`, applied as
  `1 − eax/100`.
- **A cast's total is `damage + extra` per stack.** `0xB75C10` answers only what
  a vulnerability ADDS; it writes the combat log line (four composers,
  `0xC49DB0` / `0xC49F20` / `0xC49D90` / `0xC49E00`) and the floating number
  (`FLYING_SIGN_ELEMENTAL_DAMAGE`). Calling its answer "the damage" cost a run.
- **The cast object's fields** — `+0x04` spell, `+0x14` caster, `+0x18` the one
  stack aimed at, `+0x24`/`+0x28` the affected stacks already built from OUR
  tiles, `+0x2C` spell power, `+0x30` mastery, `+0x34` a float scale.
- **Master of Fire's shipped bug is a RULE bug and is already ours.** The engine
  subtracts a fixed number where the perk promises a proportion;
  `qol/fix-master-of-fire.c` fixes it on the DEFENCE side (`0xB66530` and the
  effects walk `0xD52900`). Nothing in the appliers needs rewriting for it.
- **Arity from `ret`, and roles of `ecx`/`edx` from the callee's own first
  instructions.** Two bugs came from taking the shape of a call site instead.

## Still open, carried forward

- **`0xB70700` arrives as a spell id**, 32 times in one run, on the Word's own
  path as well as ours. The guard on `0xB1EED0` answers NULL and names the
  caller (`0xAD45B8`, `isSpell`); where the number is born is unknown. Prevented,
  not fixed — and it is the oldest open thread here.
- Whether the entry an applier builds is placed at the object handed to it. Ours
  hands the caster when a whole-field cast aims at nobody; what would disprove
  it is an effect appearing on the caster instead of over the field.
