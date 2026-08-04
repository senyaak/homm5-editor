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

// ---------------------------------------------------------------------------
// AND THE THIRTEENTH DRAGON. The table above is four ids compiled into the
// executable, and a creature of the editor's can never be in it — so the fix
// above ends exactly where the shipped game ends, and a new dragon takes the
// rune it should refuse.
//
// So a creature says it for itself. `ABILITY_DRAGON` is an ability id of ours
// carried in the creature's own record; the executable's name-to-id parser ends
// in `xor eax,eax`, so it reads that name as `ABILITY_NONE` and ignores it,
// while the editor writes the creatures that carry it into our config as
// `dragon <id> …`. See src/mods/creatures.ts.
//
// The question is asked from ONE place (`0xDA0759`, three instructions above
// the refusal string), so that call is the whole hook: ours answers the
// engine's answer first — the table, now with its fallback — and our own list
// after it. With no such creature the call is left alone.

/** `mov ecx,[eax+0x1C] / call IsDragon / test al,al` — the one place it is asked. */
#define DRAGON_ASKED_RVA 0x9a0756u
/** The engine's own, which we still ask first. */
#define DRAGON_IS_DRAGON_RVA 0x6bc9f0u

static const BYTE DRAGON_ASKS_ENGINE[10] = {
  0x8B, 0x48, 0x1C, 0xE8, 0x92, 0xC2, 0xD1, 0xFF, 0x84, 0xC0
};
/** The same, asking us. The four zeroes are filled in when we know where we are. */
static BYTE DRAGON_ASKS_US[10] = {
  0x8B, 0x48, 0x1C, 0xE8, 0x00, 0x00, 0x00, 0x00, 0x84, 0xC0
};

typedef int(__fastcall *IsDragonFn)(int creature, int unused);
static IsDragonFn g_engineIsDragon = NULL;

/** The engine's answer, or ours: a creature the editor tagged as a dragon. */
static int __fastcall our_is_dragon(int creature, int unused) {
  (void)unused;
  if (g_engineIsDragon && g_engineIsDragon(creature, 0)) return 1;
  for (int i = 0; i < g_dragonCount; i++) if (g_dragons[i] == creature) return 1;
  return 0;
}

static void install_dragon_form_fix(void) {
  overwrite_code(DRAGON_BASE_RVA, DRAGON_BASE_ONLY, DRAGON_BASE_OR_SELF,
                 sizeof DRAGON_BASE_ONLY, "the dragon a rune asks about");

  // Nothing of ours to say, nothing of the image touched.
  if (!g_dragonCount) return;
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  g_engineIsDragon = (IsDragonFn)(base + DRAGON_IS_DRAGON_RVA);
  *(DWORD *)(DRAGON_ASKS_US + 4) =
      (DWORD)&our_is_dragon - ((DWORD)(base + DRAGON_ASKED_RVA) + 8);
  overwrite_code(DRAGON_ASKED_RVA, DRAGON_ASKS_ENGINE, DRAGON_ASKS_US,
                 sizeof DRAGON_ASKS_ENGINE, "who else is a dragon");
}
