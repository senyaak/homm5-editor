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
  and `+0x198`, and both ask about effects `0x28`, `0x100`, `0x22`, `0x1D`
  and `0x13D` in that order.

The ids asked through vtable `+0x28` are the engine's own spell/effect registry
— the 353-entry enum in `types.xml`, `SPELL_NONE` through the ability effects:

| id | name |
|---|---|
| `0x1D` | `SPELL_DEFLECT_ARROWS` |
| `0x22` | `SPELL_CELESTIAL_SHIELD` |
| `0x28` | `SPELL_PHANTOM` |
| `0x41` | `SPELL_ABILITY_COUNTERSPELL` |
| `0x100` | `SPELL_RUNE_OF_ETHEREALNESS` |
| `0x13D` | `SPELL_ABILITY_INVISIBILITY` |

That the id space is this enum is not a guess: the function at `0xBC6270` asks
for `0x22` and then logs *"Celectial shield: damage reduced by"* (sic, the
engine's own typo) about what it found.
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
many creatures there are. The Deflect Arrows term multiplies twice:

```
xmm1 = n*k/(1-r) + (1-k)*n     ; n is already in both halves
xmm1 = xmm1 * n                ; and here it is again
```

So sixty creatures are worth nine hundred times two creatures rather than
thirty times, and this one term drowns out every other reason to prefer a
target. The second `mulss` goes; the arithmetic either side of it is untouched.

### 2. A hero's magic, deleted from the army's value by a counterspell

`0xD72555`, RVA `0x972555`, eight bytes.

The function this sits in (`0xD71FF0`) values one **side** of a battle, and its
builder (`0xD73230`) makes one such block per side: every stack goes through the
scorer of §1, and then the hero's magic enters as a factor — the spellbook
summed through `+0x244`, something of the hero's added through `+0x40`, folded
into the army total as a multiplier (`out+0x14`, initialised to 1.0f). The
check asks for `SPELL_ABILITY_COUNTERSPELL` and skips that whole factor while
one is up: a countered hero's magic counts for nothing.

Which reads sensibly — and plays terribly, because these valuations are what
spell plans are *judged against*. With the check in, a counterspell in force
"deletes" the enemy hero's entire magic factor from their army's worth, so
casting one looks worth that whole factor, every turn, for the price of one
spell. That is the AI everyone remembers recasting counterspell instead of
fighting. With the check gone, the valuation no longer moves with counterspell
at all, and the spell is left to be judged by what it actually does — which is
why the fix's one v1.1 changelog line, *"lowered the priority of the
counterspell"*, is this patch.

`test eax,eax` and the near jump that follows it are what go, so the factor
below is counted whatever the answer was.

### 3. A plan with no creature targets, ranked with the best

`0xD7F769 + 6`, RVA `0x97F769`, the immediate of one `mov`.

A combat plan carries a rank at `+0xAC`: the class of the best creature among
its targets. `0xD776E0` computes it — a running minimum (`cmp`/`cmovl`, at
`0xD777EF`) over the plan's candidate creatures, each classed 0, 1 or 2 by
whether it answers to a hero (`vt+0x6C`, `vt+0x58`), whether it is a `PHANTOM`
(effect `0x28` again), and relative power. The plan comparator (`0xD7D610`)
settles on rank before almost anything else: ranks differing decides the
ordering right there (`0xD7DED2` → `setg` at `0xD7DF30`).

As the identity of a minimum, the constructor's 2 is **correct arithmetic** —
but a plan whose spell has no creature targets at all walks an empty list and
keeps it. Mass spells with no aim, summons, counterspell: rank 2, loser to
nearly every targeted plan, its spells never cast. That is where "the enemy
never casts its high circles" comes from — the high circles are where the
targetless spells live — and it matches the fix's own description: mass spells
used more actively, the summons finally seen.

Zero instead: a targetless plan competes in the best class, and what decides is
the worth actually computed for it. **Not a repair of the arithmetic — a
reclassification** of "no targets" from "worst" to "best". It is the blunt end
of the fix, and it is *why* patch 2 exists: ranked competitive, counterspell
(targetless too) needed its inflated worth taken away in the same breath.

Note that our build's constructor writes **2** where the disassembly of the
patched one shows 0. Their original value is not recoverable from a patched file
— one byte was overwritten — but the surrounding code is identical, so 2 is
almost certainly what it was there too.

What is read, and what is inferred: the valuation builder, the rank computer and
the comparator's rank short-cut are read from the disassembly; that lower rank
wins the comparison is inferred from the behaviour the fix demonstrably changes
(targetless spells going from never cast to cast) rather than proved
instruction by instruction.

## How this is kept honest

`tools/test-fixes.ts` reads the addresses and the byte rows out of the C
source and checks them against the installed `bin/H5_Game_H5E.exe`. It matters
because the failure mode is **silent**: the extension refuses to write when the
bytes are not the ones it knows, the game plays on with the AI it always had, and
the switch in the panel does nothing. The check also asserts the same row does
*not* match a byte to either side, so a row of `nop`s cannot pass by accident.

Run it with the game said out loud:

```bash
node tools/test-fixes.ts --game "<install>"
```

## What is not done

Proving the *effect* in a running battle. The patches are verified as bytes and
the extension logs how many went in (build with `--log qol/combat-ai`, then read
the newest `bin/homm5-editor-*.log`), but "the enemy hero
now casts" is a thing to watch in a game, and nothing here automates that.
