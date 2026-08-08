// The build we know, as landmarks rather than constants.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT core_landmarks

// ---------------------------------------------------------------------------
// The build we know, as landmarks rather than constants.

/** `CNecromancy::RaisePercent`, RVA in the 3.1 build. Verified before use. */
#define RAISE_PERCENT_RVA 0x877850u
/** Its first five bytes: sub esp,8 / push ebx / push ebp. A whole number of
 *  instructions, which is why the detour is exactly this long. */
static const BYTE RAISE_PERCENT_HEAD[5] = { 0x83, 0xEC, 0x08, 0x53, 0x55 };
/**
 * `CNecromancy::RaiseCost` — what one creature costs in dark energy.
 *
 * Hooked only to watch, for now. The percentage says how many the engine will
 * OFFER; this says what each one is paid for, and which of the two is doing the
 * limiting is not something to reason about from the outside. Its prologue is
 * five pushes, so the detour is again a whole number of instructions.
 */
#define RAISE_COST_RVA 0x877270u
static const BYTE RAISE_COST_HEAD[5] = { 0x51, 0x53, 0x55, 0x56, 0x57 };

/** Where a hero hands over the artifacts it is WEARING. */
#define VT_WORN_ARTIFACTS 0x74u
/**
 * `GetSkillMastery(skillId)` — 0 when he does not have it, 1…4 when he does.
 *
 * The one slot every question about a hero's skills goes through: the Lua
 * `HasHeroSkill` calls it and tests the result against zero, and
 * `GetHeroSkillMastery` returns it as it is (0x5d1656 and 0x5d18b6, the same
 * three instructions apiece). On the hero's PRIMARY vtable, the one the worn
 * artifacts come from — no virtual base adjustment, unlike the tent's questions.
 */
#define VT_SKILL_MASTERY 0x174u
/** `CountEquipped(collection, artifactId)`, and the bytes that say it is. */
#define COUNT_EQUIPPED_RVA 0x74c270u
static const BYTE COUNT_EQUIPPED_HEAD[5] = { 0x53, 0x8B, 0x19, 0x56, 0x57 };

