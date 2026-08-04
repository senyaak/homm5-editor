// The battle AI's own bugs, taken back out.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Three deletions, and not one line of behaviour of ours.
//
// WHOSE FIX THIS IS. RedHeavenHero's CombatAIFix v1.1 (forum.heroesworld.ru,
// thread 15624), which ships as a whole patched executable of the 3.1 build and
// names the three addresses it changed. Ours is a DIFFERENT build of the same
// version — compiled with SSE where that one is still x87, a megabyte of code
// apart — so nothing could be copied across; what follows is the same three
// changes found again here, by what the code DOES rather than by where it sat.
// The reconnaissance is written up in docs/engineInternals/COMBAT_AI.md.
//
// WHY DELETIONS. Every one of them removes something the compiler emitted: a
// multiplication done twice, a test that refuses, a starting value that pins a
// minimum. That is why none of this is a detour — there is nothing to call, and
// a jump out and straight back would be a worse way of writing `nop`.
//
// TURNED OFF IS THE ORIGINAL GAME. Nothing here runs unless the flag is set,
// and with it clear not a byte of the image is written. See qol/config.c.

/**
 * The stack's worth to the AI, with the Deflect Arrows term multiplied ONCE.
 *
 * The ids asked through vtable+0x28 are the engine's own spell/effect registry
 * (types.xml, 353 entries): 0x1D is SPELL_DEFLECT_ARROWS, and the neighbours in
 * this function are Phantom, Celestial Shield, Rune of Etherealness and
 * Invisibility — the function scores one creature stack for a spell about to be
 * cast, effect by effect. Every term has the same shape: work out a
 * per-creature figure, multiply by how many creatures there are. The Deflect
 * Arrows term is the only one that multiplies twice
 *
 *   xmm1 = n*k/(1-r) + (1-k)*n     <- n is already in both halves
 *   xmm1 = xmm1 * n                <- and here it is again
 *
 * so a stack of sixty is valued nine hundred times a stack of two rather than
 * thirty times, and every other term in the sum stops mattering beside it. The
 * second multiply is what goes; the arithmetic either side of it is untouched.
 */
#define AI_STACK_WORTH_RVA 0x971e9cu
static const BYTE WORTH_SQUARED[4] = { 0xF3, 0x0F, 0x59, 0xCA };
static const BYTE WORTH_LINEAR[4] = { 0x90, 0x90, 0x90, 0x90 };

/**
 * Casting considered even under COUNTERSPELL (0x41 in the same registry).
 *
 * The loop that decides what to cast reaches an object of the opposing side and
 * asks it for SPELL_ABILITY_COUNTERSPELL; a yes abandons the evaluation
 * entirely — jumping clean over the block that asks what the spell would be
 * worth (+0x244) and what it would cost (+0x40). The engine's reasoning is
 * visible ("my cast would be countered, so why weigh it") and it is WRONG as
 * play: a counterspell is spent when it fires, so casting into it burns it,
 * while refusing keeps the caster silent for as long as it is up. A spell that
 * never gets weighed never gets cast, which is an enemy hero standing through
 * a battle with a full book.
 *
 * `test eax,eax` and the near jump are what go, eight bytes together, so the
 * evaluation below them is reached whatever the answer was. Not "weigh it with
 * a penalty", which would be the ideal and needs new code rather than fewer
 * bytes — a detour here is possible with the machinery in core/detour.c if the
 * blunt version misplays in practice.
 */
#define AI_SPELL_BAILOUT_RVA 0x972555u
static const BYTE BAILOUT_TAKEN[8] = { 0x85, 0xC0, 0x0F, 0x85, 0x91, 0x00, 0x00, 0x00 };
static const BYTE BAILOUT_GONE[8] = { 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90 };

/**
 * The plan's rank, started at the bottom rather than the top.
 *
 * A combat plan carries a rank of 0, 1 or 2 at +0xAC, and the loop that fills
 * the plan in only ever LOWERS it — `cmp/cmovl`, a running minimum over every
 * candidate it walks. The constructor's starting value is therefore the identity
 * of that minimum, and at 2 a plan with no candidates to lower it keeps the
 * rank of the least urgent thing the AI can do.
 *
 * Zero instead, and the minimum can no longer be raised by an empty walk. This
 * is the change the fix's own changelog calls "lowered the priority of the
 * counterspell", and it is the one of the three whose consumer we have not read
 * end to end — what is known is the shape above, that the copy constructor
 * carries the field across, and that two plans comparing equal on it is part of
 * how the AI decides two plans are the same one.
 *
 * Only the immediate is written, and only its low byte differs.
 */
#define AI_PLAN_RANK_RVA 0x97f769u
static const BYTE RANK_FROM_LEAST[10] = {
  0xC7, 0x86, 0xAC, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00
};
static const BYTE RANK_FROM_MOST[10] = {
  0xC7, 0x86, 0xAC, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

/**
 * All three, or as many as this build turns out to have.
 *
 * Each is checked and applied on its own: a build that has moved one of them is
 * still better off with the other two than with none, and the log says which
 * ones went in rather than leaving "it did nothing" to be guessed at.
 */
static void install_combat_ai_fix(void) {
  int done = 0;
  done += overwrite_code(AI_STACK_WORTH_RVA, WORTH_SQUARED, WORTH_LINEAR,
                         sizeof WORTH_SQUARED, "the stack's worth, squared");
  done += overwrite_code(AI_SPELL_BAILOUT_RVA, BAILOUT_TAKEN, BAILOUT_GONE,
                         sizeof BAILOUT_TAKEN, "the spell evaluation's bail-out");
  done += overwrite_code(AI_PLAN_RANK_RVA, RANK_FROM_LEAST, RANK_FROM_MOST,
                         sizeof RANK_FROM_LEAST, "the plan's starting rank");
  log_num("combat ai: patches applied, of three: ", done);
}
