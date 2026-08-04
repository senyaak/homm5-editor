// Master of Fire, halving a defence that has since moved.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHAT IS WRONG. The perk's own words: "Существа, на которых подействовали эти
// заклинания, лишаются 50% защиты на один ход." A creature the spell caught has
// half its defence for a turn — a PROPORTION, held for as long as the effect is.
//
// The engine writes it down as a SUBTRACTION instead. When a fire spell lands
// (`0xBD1560`: the hero has `HERO_SKILL_MASTER_OF_FIRE`, the creature is not
// `ABILITY_ARMORED`, does not have `SPELL_SKILL_FIRE_PROTECTION`), it reads the
// creature's defence, adds back whatever an earlier fire effect took, halves
// what is left and hands that NUMBER to `SPELL_EFFECT_FIRE_DAMAGE`. The number
// is then subtracted, unchanged, for as long as the effect lasts: the walk over
// a creature's effects (`0xD52900`) has one case that does
// `sub ebx,[effect+0x20]`, shared by `SPELL_EFFECT_FIRE_DAMAGE` (202) and
// `SPELL_EFFECT_ARMOR_CRUSHING` (179), guarded by "is this creature Armored".
//
// So the two agree only while nothing else touches the creature's defence.
// Anything that does — a Stone Skin cast after the fireball, a defence buff
// running out, a hero's defence changing — leaves a subtraction that is no
// longer half of anything. Buff the creature and it lost less than half; let a
// buff expire and it can lose everything it had.
//
// WHAT WE WRITE. The proportion, where the proportion belongs. Two changes:
//
//   The walk stops subtracting. One byte in its case table (`0xD52C18`, indexed
//   by effect id minus 11) sends `SPELL_EFFECT_FIRE_DAMAGE` to the default —
//   the same case the ids nothing special happens for already sit on.
//   `SPELL_EFFECT_ARMOR_CRUSHING` keeps its case; only fire moves.
//
//   The defence getter halves at the end. `0xB66530` is the one that sums a
//   creature's defence — the effects walk above is called from it and from
//   nowhere else — and its last act is to scale by the necromancers' set debuff
//   and clamp at zero. We take the five bytes of that clamp and ask two
//   questions first: does the creature carry `SPELL_EFFECT_FIRE_DAMAGE`, and is
//   it `ABILITY_ARMORED` ("невосприимчиво ко всем заклинаниям и эффектам,
//   снижающим «Защиту»" — the exemption the walk's guard was), then halve.
//
// THE SAME NUMBER, ONLY LATER. The shipped code subtracts `trunc(D/2)`, which
// LEAVES `D - trunc(D/2)`, and that is what we compute: `ebx - (ebx >> 1)`, not
// `ebx >> 1`. On the turn a fireball lands, with nothing else moving, this
// produces exactly the defence the shipped game produced, odd numbers included.
// What changes is only that the half follows the defence.
//
// Ported from dredknight's MasterOfFireFix.cpp, which makes the same two
// changes; his halving is `shr ebx,1`, which is one point lower than the
// shipped game on an odd defence.

/** The case table of the effects walk, at its entry for the fire effect. */
#define FIRE_TABLE_RVA 0x952cc0u
/** `pop edi / xor eax,eax / test ebx,ebx` — the clamp that ends the getter. */
#define FIRE_CLAMP_RVA 0x766800u
/** …and where it goes on: `pop esi`, three bytes of the clamp still to run. */
#define FIRE_CLAMP_BACK_RVA 0x766805u

/**
 * Armor Crushing and the fire effect, both on case 1 — subtract a stored
 * number — with the default (10) between them. Twenty-four bytes because one
 * would be a claim about a byte value that repeats all over the image; this row
 * appears exactly once.
 */
static const BYTE FIRE_SUBTRACTS[24] = {
  0x01, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A,
  0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x01
};
/** The same, with the fire effect on the default. Armor Crushing is left alone. */
static const BYTE FIRE_SUBTRACTS_NOTHING[24] = {
  0x01, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A,
  0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A
};

static const BYTE FIRE_CLAMPS[5] = { 0x5F, 0x33, 0xC0, 0x85, 0xDB };
/** `jmp` to ours; the four zeroes are filled in when the stub is allocated. */
static BYTE FIRE_ASKS_FIRST[5] = { 0xE9, 0x00, 0x00, 0x00, 0x00 };

/**
 * ```
 * lea ecx,[ebp+4] / mov eax,[ebp+4] / push 0CAh / mov eax,[eax+8]
 * add ecx,eax / mov eax,[ecx] / call [eax+28h]      does it carry the effect
 * test eax,eax / je done
 * lea ecx,[ebp+4] / mov eax,[ebp+4] / push 55h  / mov eax,[eax+8]
 * add ecx,eax / mov eax,[ecx] / call [eax+28Ch]     is it Armored
 * test al,al / jne done
 * test ebx,ebx / jle done
 * mov eax,ebx / sar eax,1 / sub ebx,eax             half of it, rounded its way
 * done:
 * pop edi / xor eax,eax / test ebx,ebx              the clamp we displaced
 * jmp back
 * ```
 *
 * `ebp` is the creature for the whole getter and `ebx` is the defence being
 * summed; both survive a virtual call, which is what the getter's own code four
 * instructions above this relies on. The walk from the object to the vtable —
 * `(ebp+4) + [[ebp+4]+8]` — is the getter's own, copied from the question it
 * asks about the necromancers' set immediately before.
 */
static BYTE FIRE_HALVES[70] = {
  0x8D, 0x4D, 0x04,
  0x8B, 0x45, 0x04,
  0x68, 0xCA, 0x00, 0x00, 0x00,
  0x8B, 0x40, 0x08,
  0x03, 0xC8,
  0x8B, 0x01,
  0xFF, 0x50, 0x28,
  0x85, 0xC0,
  0x74, 0x23,
  0x8D, 0x4D, 0x04,
  0x8B, 0x45, 0x04,
  0x6A, 0x55,
  0x8B, 0x40, 0x08,
  0x03, 0xC8,
  0x8B, 0x01,
  0xFF, 0x90, 0x8C, 0x02, 0x00, 0x00,
  0x84, 0xC0,
  0x75, 0x0A,
  0x85, 0xDB,
  0x7E, 0x06,
  0x8B, 0xC3,
  0xD1, 0xF8,
  0x2B, 0xD8,
  0x5F,
  0x33, 0xC0,
  0x85, 0xDB,
  0xE9, 0x00, 0x00, 0x00, 0x00
};

/** Are these the bytes we know, without writing anything? */
static int bytes_are(DWORD rva, const BYTE *row, int len) {
  const BYTE *there = (const BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < len; i++) if (there[i] != row[i]) return 0;
  return 1;
}

static void install_master_of_fire_fix(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);

  // BOTH halves are read before EITHER is written, because half of this fix is
  // worse than none of it: with only the table written the perk does nothing,
  // and with only the getter written a creature would lose the stored number
  // AND half of what is left. Neither half is written unless both can be.
  if (!bytes_are(FIRE_TABLE_RVA, FIRE_SUBTRACTS, sizeof FIRE_SUBTRACTS)
      || !bytes_are(FIRE_CLAMP_RVA, FIRE_CLAMPS, sizeof FIRE_CLAMPS)) {
    log_line("master of fire: not the bytes we know, leaving both alone");
    return;
  }

  BYTE *stub = (BYTE *)VirtualAlloc(NULL, sizeof FIRE_HALVES, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("master of fire: no memory for the stub"); return; }
  for (int i = 0; i < (int)sizeof FIRE_HALVES; i++) stub[i] = FIRE_HALVES[i];
  *(DWORD *)(stub + 66) =
      (DWORD)(base + FIRE_CLAMP_BACK_RVA) - (DWORD)(stub + sizeof FIRE_HALVES);
  FlushInstructionCache(GetCurrentProcess(), stub, sizeof FIRE_HALVES);
  *(DWORD *)(FIRE_ASKS_FIRST + 1) = (DWORD)stub - ((DWORD)(base + FIRE_CLAMP_RVA) + 5);

  int done = overwrite_code(FIRE_TABLE_RVA, FIRE_SUBTRACTS, FIRE_SUBTRACTS_NOTHING,
                            sizeof FIRE_SUBTRACTS, "the fire effect's stored subtraction");
  done += overwrite_code(FIRE_CLAMP_RVA, FIRE_CLAMPS, FIRE_ASKS_FIRST, sizeof FIRE_CLAMPS,
                         "the defence a fire effect halves");
  log_num("master of fire: halves of the fix installed, of two: ", done);
}
