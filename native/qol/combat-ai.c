// The battle AI's own bugs, taken back out.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_combat_ai

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
 * A hero's magic counted into the army's value even under COUNTERSPELL.
 *
 * The function this sits in values one SIDE of a battle: every stack through
 * the scorer above, and then the hero — a factor built from the spellbook
 * (+0x244 summed, +0x40 added) multiplied into the army total. The check asks
 * for SPELL_ABILITY_COUNTERSPELL (0x41 in the same registry) and skips that
 * whole factor while one is up: a countered hero's magic counts for nothing.
 *
 * Which reads sensibly and plays terribly, because these valuations are what
 * spells are JUDGED against: with the check in, having a counterspell up
 * "deletes" the enemy hero's entire magic factor from their army's worth, so
 * casting one looks worth that whole factor — every turn, for one spell. That
 * is the AI that keeps recasting counterspell instead of fighting. With the
 * check gone the valuation no longer moves with counterspell at all, and the
 * spell is left to be judged by what it actually does. The fix's own v1.1
 * changelog line — "lowered the priority of the counterspell" — is this patch.
 *
 * `test eax,eax` and the near jump are what go, eight bytes together, so the
 * factor below them is counted whatever the answer was.
 */
#define AI_SPELL_BAILOUT_RVA 0x972555u
static const BYTE BAILOUT_TAKEN[8] = { 0x85, 0xC0, 0x0F, 0x85, 0x91, 0x00, 0x00, 0x00 };
static const BYTE BAILOUT_GONE[8] = { 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90 };

/**
 * A plan with no creature targets, ranked with the best rather than the worst.
 *
 * A combat plan carries a rank at +0xAC: the class of the best creature among
 * its targets, a running minimum over 0, 1 and 2 (which class a creature is
 * depends on its master, on PHANTOM, and on relative power — 0xD776E0). As the
 * identity of a minimum the constructor's 2 is CORRECT arithmetic — but a plan
 * whose spell has no creature targets at all walks an empty list and keeps it.
 * Mass spells with no aim, summons, counterspell: rank 2, and the plan
 * comparator settles on rank before almost anything else, so the targetless
 * plan loses to nearly every targeted one and its spells go uncast.
 *
 * Zero instead: a targetless plan competes in the best class, and what decides
 * is the worth actually computed for it. Not a repair of the arithmetic — a
 * reclassification of "no targets" from "worst" to "best", which is the blunt
 * end of this fix, and the reason the counterspell patch above exists: ranked
 * competitive, counterspell needed its inflated worth taken away too.
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
