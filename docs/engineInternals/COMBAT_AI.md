# The battle AI, and three bugs taken out of it

The AI that plays a battle scores what it could do and picks the best. Three
places in that scoring are wrong in the shipped 3.1 executable, and the QoL flag
`combat-ai-fix` writes over them in memory at load time. This is the
reconnaissance behind `native/qol/combat-ai.c`; the flag itself is described in
[../QOL.md](../QOL.md).

## Whose fix this is

RedHeavenHero's **CombatAIFix v1.1**, published on forum.heroesworld.ru (thread
15624) and later folded into the unofficial patch. It ships as a whole patched
`H5_Game.exe` of the 3.1 build, and its post names the three file offsets it
changed — `0x7fb190` → four `nop`, `0x7fb4f0` → eight `nop`, `0x4d697e` → `00`.

**Nothing could be copied across.** That executable is a *different build of the
same version*: 13.0 MB against our 14.5 MB, and compiled for x87 where ours uses
SSE — its `fmul st,dword ptr [esp+2Ch]` is our `mulss xmm1,xmm2`. Addresses,
register allocation and instruction encodings all differ. What follows is the
same three changes found again in our build, by what the code does.

## How each one was found again

The two builds share their **structure**, which is what made this possible: the
same functions, the same virtual slots, the same ability ids asked about in the
same order.

- The **scoring function** — one stack's worth to a spell — is `0xBFBA50` there
  and `0xD71AB0` here. Both end in `ret 18h`, both call vtable `+0x84`, `+0x1E0`
  and `+0x198`, and both ask about abilities `0x28`, `0x100`, `0x22`, `0x1D`
  and `0x13D` in that order.
- Its **caller**, the loop over the stacks, is `0xBFBE50` there and `0xD71FF0`
  here.
- The **plan constructor** is `0x8D7550` there and `0xD7F730` here: zero the
  first five words, construct a member at `+0x14`, then `+0xA8 = 1`, `+0xAC`,
  `+0xB0 = 0`, `+0xB4 = 0`, then two eight-byte string buffers. Identical field
  for field. In their build it was found by the console variable
  `combat_ai_lookahead` registered in the next function along; here that
  registration sits elsewhere (`0x4CA140`) and the constructor was found by the
  field pattern instead.

## The three

### 1. A stack's worth, counted as its size squared

`0xD71E9C`, RVA `0x971E9C`, four bytes.

Every term in the score has one shape: a per-creature figure, multiplied by how
many creatures there are. The term guarded by ability `0x1D` multiplies twice:

```
xmm1 = n*k/(1-r) + (1-k)*n     ; n is already in both halves
xmm1 = xmm1 * n                ; and here it is again
```

So sixty creatures are worth nine hundred times two creatures rather than
thirty times, and this one term drowns out every other reason to prefer a
target. The second `mulss` goes; the arithmetic either side of it is untouched.

### 2. A spell abandoned before it is ever weighed

`0xD72555`, RVA `0x972555`, eight bytes.

The loop that decides what to cast fetches the spell, asks it about ability
`0x41`, and on yes jumps clean over the block that asks what the spell would be
worth (`+0x244`) and what it would cost (`+0x40`). A spell that is never weighed
is never cast — which is what an enemy hero standing through a battle with a full
book looks like from the outside, and why fifth-circle spells in particular were
never seen.

`test eax,eax` and the near jump that follows it are what go, so the evaluation
below is reached whatever the answer was.

### 3. A plan's rank started at the bottom

`0xD7F769 + 6`, RVA `0x97F769`, the immediate of one `mov`.

A combat plan carries a rank of 0, 1 or 2 at `+0xAC`. The loop that fills the
plan in only ever **lowers** it — `cmp` / `cmovl`, at `0xD777EF`, a running
minimum over every candidate walked. The constructor's value is therefore the
*identity* of that minimum, and at 2 a plan whose walk turns up nothing keeps the
rank of the least urgent thing the AI can do. Zero instead.

This is the one of the three whose **consumer we have not read end to end**. What
is known: the shape above, that the copy constructor carries the field across
(`0xD7EE49`), that a reset method zeroes it (`0xD76682`), and that two plans
comparing equal on it is part of how the AI decides two plans are the same one
(`0xD7DED2`). The fix's own changelog calls this change *"lowered the priority of
the counterspell"*.

Note that our build's constructor writes **2** where the disassembly of the
patched one shows 0. Their original value is not recoverable from a patched file
— one byte was overwritten — but the surrounding code is identical, so 2 is
almost certainly what it was there too.

## How this is kept honest

`tools/test-combat-ai.ts` reads the addresses and the byte rows out of the C
source and checks them against the installed `bin/H5_Game_H5E.exe`. It matters
because the failure mode is **silent**: the extension refuses to write when the
bytes are not the ones it knows, the game plays on with the AI it always had, and
the switch in the panel does nothing. The check also asserts the same row does
*not* match a byte to either side, so a row of `nop`s cannot pass by accident.

Run it with the game said out loud:

```bash
node tools/test-combat-ai.ts --game "<install>"
```

## What is not done

Proving the *effect* in a running battle. The patches are verified as bytes and
the extension logs how many went in (`bin/homm5-editor.log`), but "the enemy hero
now casts" is a thing to watch in a game, and nothing here automates that.
