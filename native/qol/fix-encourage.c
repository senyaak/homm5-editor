// Encourage, refused by a target that cannot be enchanted.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_fix_encourage

// ---------------------------------------------------------------------------
// WHAT IS WRONG. `CanCastSpellOnTarget` refuses with
// COMBAT_CANT_CAST_SPELL_IMMUNITY when the target's immunity comes back at
// 100 — but only for the handful of abilities a switch says to check, and
// SPELL_ENCOURAGE (0x34) is one of them. So a Knight's Encourage, which does
// nothing to a creature but move its turn up, is refused by his OWN stack
// being immune to magic. The six the switch checks are Encourage, Prayer, Lay
// Hands, Resurrect Allies, Fear and Mark of Fire: two hostile and four cast on
// one's own side.
//
// WHAT THE GAME SAYS. The ability's own description is "Особое боевое
// свойство, позволяющее воодушевлять войска на поле сражения, тем самым
// ускоряя наступление их очереди драться" — a special combat property that
// hastens a friendly stack's turn. Nothing about magic, nothing an immunity
// has any business stopping. That check is what this takes off.
//
// WHERE IT IS. `0xAD46A0` is the switch: `add ecx,-0x34`, bounds-check against
// 0xC2, and index a byte table at `0xAD46C8` whose entries pick between "yes"
// (`mov al,1`) and "no" (`xor al,al`). The table is DATA, and the same 195
// bytes in the retail build the fix was written against — which is how this
// site was found at all, our own being compiled for SSE and a megabyte away.
// One byte of it is Encourage's answer.
//
// ONLY ENCOURAGE. Prayer, Lay Hands and Resurrect Allies are cast on one's own
// side too and are checked the same way, so the same argument would seem to
// carry — but the fix this comes from changes one byte, and inventing three
// more changes in somebody else's name is not porting it. See
// docs/engineInternals/RULES_FIXES.md.

/** Encourage's entry in `CanCastSpellOnTarget`'s table: checked, then exempt. */
#define ENCOURAGE_IMMUNITY_RVA 0x6d46c8u
static const BYTE ENCOURAGE_CHECKED[1] = { 0x00 };
static const BYTE ENCOURAGE_EXEMPT[1] = { 0x01 };

static void install_encourage_fix(void) {
  overwrite_code(ENCOURAGE_IMMUNITY_RVA, ENCOURAGE_CHECKED, ENCOURAGE_EXEMPT,
                 sizeof ENCOURAGE_CHECKED, "Encourage's immunity check");
}
