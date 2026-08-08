// Barbarian Learning, left out of the switch that takes a skill back off.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_fix_barbarian_learning

// ---------------------------------------------------------------------------
// WHAT IS WRONG. One switch over skill ids undoes what a skill granted, and it
// has a case for HERO_SKILL_LEARNING (3) — the one case in the whole table used
// by a single skill, and it is the one that asks the hero his mastery of it and
// walks back what it gave. HERO_SKILL_BARBARIAN_LEARNING (183), which is the
// same skill in barbarian clothing, falls to the table's DEFAULT: three
// instructions that pop and return. So the primary-stat bonuses it granted stay
// granted after the skill is gone.
//
// THE PROOF IS THE TABLE ITSELF. Case 0 has exactly one member, skill 3; the
// barbarian's copy sits on the same default as every id the switch never heard
// of. Pointing 183 at case 0 is not inventing behaviour — it is giving the
// barbarian's Learning the case its own Learning already has.
//
// WHERE IT IS. The switch is at `0xC1E87B` inside `0xC1D3B0`: index is
// `skillId - 3`, bounds 0xB7, byte table at `0xC1EA48`, jump table at
// `0xC1EA14`. Barbarian Learning is index 180, so `0xC1EAFC` — and it reads 12,
// the default case, where Learning's own entry reads 0.
//
// FOUND BY SHAPE, NOT BY BYTES. The retail build the fix was written against
// has this as a function of its own (`0xB55D80`); ours inlined it, and numbered
// the cases differently because it deduplicated two identical bodies. What
// matched was which ids share a case and which sit on the default — the
// switch's own structure, which survives recompilation when its bytes do not.
//
// ONE HOLE IS LEFT. HERO_SKILL_WARCRY_LEARNING (185) sits on the same default.
// Whether it grants what Learning grants is not something we have checked, and
// the fix this comes from does not touch it. See
// docs/engineInternals/RULES_FIXES.md.

/** Barbarian Learning's case: the do-nothing default, then Learning's own. */
#define BARBARIAN_LEARNING_RVA 0x81eafcu
static const BYTE BARB_LEARNING_IGNORED[1] = { 0x0C };
static const BYTE BARB_LEARNING_HANDLED[1] = { 0x00 };

static void install_barbarian_learning_fix(void) {
  overwrite_code(BARBARIAN_LEARNING_RVA, BARB_LEARNING_IGNORED, BARB_LEARNING_HANDLED,
                 sizeof BARB_LEARNING_IGNORED, "Barbarian Learning's case");
}
