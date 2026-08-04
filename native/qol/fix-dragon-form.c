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
// So a creature says it for itself, the way it says it is undead: with an
// ABILITY in its own record. `ABILITY_DRAGON` is one of ours — a real ability,
// with a number and a caption, added to the game's own table (see
// src/mods/ability-files.ts) and asked about by nothing in the engine, which is
// what makes it a tag rather than a behaviour.
//
// SO WE ASK THE CREATURE, not a list. The only thing that cannot be worked out
// here is which NUMBER the editor gave that ability, since that is decided when
// the mod is built; the config line `dragon-ability <n>` carries it, and moving
// the ability moves the line.
//
// FINDING THE ABILITIES. A creature record holds its abilities as a vector —
// `begin` and `end` pointers, four bytes an entry, which is the shape the
// engine's own accessor at `0xABA730` reads a record's vector with. WHERE that
// vector sits is not guessed: the Fire Dragon (104) carries exactly Elemental
// (12), Immunity to Fire (21), Fire Shield (62) and Fire Breath (76), in that
// order and nothing else, so the record is searched once for the pointer pair
// whose contents are those four. One hit is the offset; no hit means the data
// under us is not what we measured, and then this answers nothing rather than
// reading a wild pointer.
//
// The question is asked from ONE place (`0xDA0759`, three instructions above
// the refusal string), so that call is the whole hook: ours gives the engine's
// answer first — the table, now with its fallback — and the creature's own
// ability after it.

/** `mov ecx,[eax+0x1C] / call IsDragon / test al,al` — the one place it is asked. */
#define DRAGON_ASKED_RVA 0x9a0756u
/** The engine's own, which we still ask first. */
#define DRAGON_IS_DRAGON_RVA 0x6bc9f0u
/** `GetCreature(id)` — the record, or null. Its `this` is the id itself. */
#define DRAGON_RECORD_RVA 0x727630u

static const BYTE DRAGON_ASKS_ENGINE[10] = {
  0x8B, 0x48, 0x1C, 0xE8, 0x92, 0xC2, 0xD1, 0xFF, 0x84, 0xC0
};
/** The same, asking us. The four zeroes are filled in when we know where we are. */
static BYTE DRAGON_ASKS_US[10] = {
  0x8B, 0x48, 0x1C, 0xE8, 0x00, 0x00, 0x00, 0x00, 0x84, 0xC0
};

typedef int(__fastcall *IsDragonFn)(int creature, int unused);
typedef void *(__fastcall *CreatureRecordFn)(int creature, int unused);
static IsDragonFn g_engineIsDragon = NULL;
static CreatureRecordFn g_creatureRecord = NULL;

/** The creature the abilities vector is measured against, and what it carries. */
#define DRAGON_PROBE_CREATURE 104
static const int DRAGON_PROBE_ABILITIES[4] = { 12, 21, 62, 76 };
/** Byte offset of the vector's `begin` in a record: -1 unknown, -2 looked and failed. */
static int g_abilitiesAt = -1;

/** A pointer worth dereferencing: aligned, and the kernel says the span is there. */
static int reachable(const void *p, SIZE_T n) {
  return p && !((DWORD)p & 3) && readable(p, n);
}

/**
 * Measure where a record keeps its abilities, from a creature whose abilities
 * we know. Done once, on the first question, because the creature table is not
 * loaded when the DLL is.
 */
static void find_abilities_offset(void) {
  g_abilitiesAt = -2;
  if (!g_creatureRecord) return;
  BYTE *rec = (BYTE *)g_creatureRecord(DRAGON_PROBE_CREATURE, 0);
  if (!reachable(rec, 0x200)) { log_line("dragon tag: no record to measure against"); return; }
  const int want = (int)(sizeof DRAGON_PROBE_ABILITIES / sizeof DRAGON_PROBE_ABILITIES[0]);
  for (int at = 0; at + 8 <= 0x200; at += 4) {
    int *begin = *(int **)(rec + at);
    int *end = *(int **)(rec + at + 4);
    if (!reachable(begin, (SIZE_T)want * 4) || end != begin + want) continue;
    int same = 1;
    for (int i = 0; i < want; i++) if (begin[i] != DRAGON_PROBE_ABILITIES[i]) { same = 0; break; }
    if (!same) continue;
    g_abilitiesAt = at;
    log_num("dragon tag: a record keeps its abilities at +", at);
    return;
  }
  log_line("dragon tag: the abilities vector is not where it was measured - not asking");
}

/** Does this creature's own record carry the ability the config names? */
static int creature_has_dragon_ability(int creature) {
  if (g_abilitiesAt == -1) find_abilities_offset();
  if (g_abilitiesAt < 0 || !g_creatureRecord) return 0;
  BYTE *rec = (BYTE *)g_creatureRecord(creature, 0);
  if (!reachable(rec, (SIZE_T)g_abilitiesAt + 8)) return 0;
  int *begin = *(int **)(rec + g_abilitiesAt);
  int *end = *(int **)(rec + g_abilitiesAt + 4);
  if (!begin || end < begin || end > begin + 64) return 0;
  if (!reachable(begin, (SIZE_T)((BYTE *)end - (BYTE *)begin))) return 0;
  for (int *p = begin; p < end; p++) if (*p == g_dragonAbility) return 1;
  return 0;
}

/** The engine's answer, or the creature's own: it carries the dragon ability. */
static int __fastcall our_is_dragon(int creature, int unused) {
  (void)unused;
  if (g_engineIsDragon && g_engineIsDragon(creature, 0)) return 1;
  return creature_has_dragon_ability(creature);
}

static void install_dragon_form_fix(void) {
  overwrite_code(DRAGON_BASE_RVA, DRAGON_BASE_ONLY, DRAGON_BASE_OR_SELF,
                 sizeof DRAGON_BASE_ONLY, "the dragon a rune asks about");

  // No ability to ask about, nothing of the image touched.
  if (!g_dragonAbility) return;
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  g_engineIsDragon = (IsDragonFn)(base + DRAGON_IS_DRAGON_RVA);
  g_creatureRecord = (CreatureRecordFn)(base + DRAGON_RECORD_RVA);
  *(DWORD *)(DRAGON_ASKS_US + 4) =
      (DWORD)&our_is_dragon - ((DWORD)(base + DRAGON_ASKED_RVA) + 8);
  overwrite_code(DRAGON_ASKED_RVA, DRAGON_ASKS_ENGINE, DRAGON_ASKS_US,
                 sizeof DRAGON_ASKS_ENGINE, "who else is a dragon");
}
