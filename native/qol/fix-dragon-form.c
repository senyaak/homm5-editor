// Dragon Form, offered to a dragon that never upgraded.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHAT IS WRONG. `IsDragon` (`0xABC9F0`) is asked one creature id and answers
// from a table of four: Bone (41), Green (55), Deep (83) and Fire (104) — the
// four BASE dragons. But it does not look up the id it was given: it looks up
// `[record+0x100]`, the creature's **base** creature, which is
// `CREATURE_UNKNOWN` for a creature that is a base itself. So the id falls out
// of the table's range and the answer is "not a dragon".
//
// Every upgraded dragon is caught (Magma's base is Fire, Rainbow's is Green),
// and the four the table actually names are not. A Fortress player who never
// upgraded his Fire Dragon can put Dragon Form on it.
//
// WHAT THE GAME SAYS. The rune's own description ends in a parenthesis:
// "Отряд на один ход получает +100% к «Защите» и «Нападению» и +50% к
// невосприимчивости к магии (неприменимо к драконам)" — and the refusal it
// prints has a string of its own, COMBAT_RUNIC_SPELL_CANT_DRAGONFORM,
// "Драконье обличье неприменимо к драконам". A Fire Dragon is a dragon.
//
// WHAT THE ENGINE ITSELF DOES. Reading a base creature, everywhere else in this
// executable, is two steps: take `[record+0x100]`, and when it is zero take the
// creature's own id from `[unit+0x1C]` — the same `+0x1C` that is handed to
// `IsDragon` in the first place. There are three copies of that idiom in our
// build and eighteen in the retail one. `IsDragon` has the first half and not
// the second, which is the whole bug.
//
// WHAT WE WRITE. The missing half, in the thirteen bytes the second lookup was
// wasting: the record is ALREADY in `eax` from the call four instructions up
// (it was fetched, tested against null, and nothing has touched it since), so
// `mov ecx,esi / call GetCreature / mov eax,[eax+0x100]` is the same fetch
// done twice. Dropping the repeat pays for `test eax,eax / cmovz eax,esi` with
// two bytes to spare.
//
//   mov eax,[eax+0x100] / test eax,eax / cmovz eax,esi / nop / nop
//
// NOT dredknight's, whose patch replaces the table lookup with "tier >= 7". His
// covers the same four, but it also makes a dragon of every other tier-7
// creature — an Archangel or a Titan in a dwarf's army would be refused a rune
// the shipped game allows. The rune's text says dragons, and the engine already
// knows which creatures those are.

/** The repeated lookup in `IsDragon`, where the fallback belongs. */
#define DRAGON_BASE_RVA 0x6bc9fcu

/** `mov ecx,esi / call GetCreature / mov eax,[eax+0x100]` — fetched twice. */
static const BYTE DRAGON_BASE_ONLY[13] = {
  0x8B, 0xCE, 0xE8, 0x2D, 0xAC, 0x06, 0x00, 0x8B, 0x80, 0x00, 0x01, 0x00, 0x00
};
/** The record we already have, its base, and the creature itself when it has
 *  none — `mov eax,[eax+0x100] / test eax,eax / cmovz eax,esi`. */
static const BYTE DRAGON_BASE_OR_SELF[13] = {
  0x8B, 0x80, 0x00, 0x01, 0x00, 0x00, 0x85, 0xC0, 0x0F, 0x44, 0xC6, 0x90, 0x90
};

static void install_dragon_form_fix(void) {
  overwrite_code(DRAGON_BASE_RVA, DRAGON_BASE_ONLY, DRAGON_BASE_OR_SELF,
                 sizeof DRAGON_BASE_ONLY, "the dragon a rune asks about");
}
