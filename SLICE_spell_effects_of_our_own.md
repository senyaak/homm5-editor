# SLICE — effects of our own, and where a new TERM enters

> **Status: two of the three pieces landed; the third is not started.** Written
> 08.08.2026 as three pieces, smallest first. The element appliers (piece 1) and
> the term layer (piece 2) are done and in game; what is left is **entries of our
> own** — the case where the engine has no applier to call at all. The reading
> that all three rest on lives in
> [docs/engineInternals/SPELLS.md](docs/engineInternals/SPELLS.md) and is not
> repeated here.

## The goal, in Senya's words

> «когда мы введём артефакт +50% урона огнём — он будет работать всегда, а не
> через кривизну»

That is the right goal and it decides the shape of everything below. The
correction this page made is only about WHERE such a term enters — it is not the
appliers, and knowing that turned one large job into three small ones.

## The direction, above the steps — 09.08.2026

**We write our own, and a new thing of ours goes through OUR layer rather than
through one of the engine's.** Said while the gate was being fixed, and it
outranks the ordering: the mod was still borrowing four appliers it did not
write, and every one of them cost a battle to call correctly. The end state is
an applier of ours — piece 3 — that every spell of ours goes through, with the
engine's own called only where it still buys something, and never as the place a
new term is added.

## What landed, and where it lives now

**Piece 1 — the three element appliers, called through their own entry points.**
Done, and all three watched in a battle 09–10.08.2026. Our resolver picks the
applier from the document's element for **all three shapes**, which is more than
the game does for its own — only its area routine dispatches on element.
`applier_for` / `air_applier_for` / `water_applier_for` in
`native/combat/spell-resolve.c`; the arities, what each extra argument means, and
what each mark looks like on the field are in SPELLS.md, "What is not done yet"
§1. The claim this page used to make — that fire swaps the roles of `ecx` and
`edx` — was wrong, and it is what left this piece undone for two days.

**Piece 2 — the TERM layer.** Done, and it turned out to be two doors rather than
one. `SPELL_DAMAGE_RVA 0x7861a0` with `on_spell_damage` / `our_spell_damage_term`
in `native/combat/spell-cast.c` is the door this page predicted: one detour, and
the term reaches every damaging spell in the game, including one a mod adds next
year. The door this page did **not** know about is `SPELL_BONUSES_RVA 0x785e40`
— the one the spell BOOK asks. A term added only at the first was real in a
battle and invisible everywhere else, so the page a player reads before casting
disagreed with what the cast then did. Both are hooked now.

That is the general lesson worth keeping: a term added where the damage is
computed is not the same as a term the interface knows about, and the second has
to be found on purpose.

## Piece 3 — entries of our own, and this is where reimplementing IS right

**Not started.** For an effect the engine has **no** applier for: our own mark,
our own status, "a Lua function that hurts whom we choose and leaves what we
say". Here we do build the entry ourselves — but through the engine's own
constructor `0xC4B050` with a payload of ours, not by hand-rolling the 0x60
object and its refcount.

What an applier is, read while piece 1 was being done — four variants of "build
the entry the battle shows", differing only by what each adds:

```
if (damage <= 0) return chain            ; all four
edi = ecx->vt[8]()                       ; the combat
malloc(0x60) → 0xC4B050                  ; THE ENTRY
if (spell == 236 || spell == 335)        ; fire only: a second entry
    malloc(0x60) → 0xC4AD60
…the element's own term                  ; 0xBD1560 for fire
```

`0xC4B050` appears nowhere in `native/` yet — it is a row in SPELLS.md's table
and nothing more. It was deliberately left last: it is the only one of the three
that needs anything invented, and the two above are what make a spell of ours
behave like the game's. Its own entry in SPELLS.md is §4, "Effects, and effects
of our own".

## Still open, carried forward

- **`0xB70700` arrives as a spell id**, 32 times in one run, on Unholy Word's own
  path as well as ours. The guard on `0xB1EED0` answers NULL and names the caller
  (`0xAD45B8`, `isSpell`); where the number is born is still unknown. Prevented,
  not fixed — the guard lives in `native/combat/spell-record.c` — and it is the
  oldest open thread here.
