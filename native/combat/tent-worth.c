// What a first aid tent is worth, and the one place it is decided.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// The first aid tent — where a SPECIALIZATION of ours enters the arithmetic.
//
// WHAT THE TENT IS WORTH, and the only place it is decided:
//
//   amount = { 10, 20, 50, 100 }[war machines mastery]
//          + 5 * hero level, if his specialization is HERO_SPEC_EMPIRIC (36)
//
// Read off the code at 0x77fca0: a four-case jump table writing the constants,
// then `push 24h; call [vtable+294h]` — "does this hero hold specialization 36"
// — and inside that branch `lea eax,[eax+eax*4]`, which is the ×5.
//
// Two things about it are worth keeping, because each cost a run to learn. The
// number a mastery produces is an INDEX into that table and nothing more, so
// multiplying it walks off the end and the engine falls back to a constant —
// the tent BREAKS rather than strengthens. And the prediction the tooltip shows
// is computed by different code than the effect, so only the battle log says
// what happened.
//
// Both of the tent's spells come through this one number: `GetSpellPower` at
// 0x9c96d0 answers for machine type 3 with the owner's War Machines mastery for
// the heal (0xBD) and for the plague (0x160) alike — which is what the shipped
// Empiric text claims in words. So one term of ours reaches both, and the perk
// whose identifier reads `LAST_AID` and whose name in game is «Чумная палатка»
// needs nothing of its own.
//
// Signature, from the call site at 0xb82d16: two out-parameters in ecx and edx,
// then the unit and the mastery on the stack. Its first five bytes are two
// whole instructions, so an ordinary detour fits.
#define TENT_AMOUNT_RVA 0x77fca0u
static const BYTE TENT_AMOUNT_HEAD[5] = { 0x8B, 0x44, 0x24, 0x08, 0x56 };

