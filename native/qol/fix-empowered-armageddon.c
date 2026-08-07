// Empowered Armageddon, which the impact code does not recognise.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHAT IS WRONG. A Wizard's Empowered Spells perk casts a spell of its own:
// `SPELL_EMPOWERED_ARMAGEDDON` is id 232, not id 10. The engine knows the two
// are the same spell — `0xAD44C0` maps every empowered id to the spell it is a
// version of, and 232 comes back as 10, which is how the cast dispatcher sends
// both to the same code. The impact function it sends them to (`0xD60C30`) then
// asks three questions about the spell, and asks all three of the RAW id:
//
//   `0xD60E29`  is this Armageddon? — else the extra damage at the point of
//               impact is zero.
//   `0xD60EA6`  is this Armageddon? — else a target with no creature on it (a
//               war machine) is skipped.
//   `0xD610BA`  is this Armageddon? — else the damage is applied by the routine's
//               NO-ELEMENT applier, so nothing elemental happens to the target:
//               no Master of Fire, and no fire resistance either. This site is
//               now written by `combat/spell-cast.c`, which asks the wider
//               question and carries this flag's answer inside it.
//
// So the empowered Armageddon costs double mana, hits for 50% more, and is the
// weaker spell in every way the shipped code decides by id.
//
// WHAT THE GAME SAYS. Empowered Armageddon: "Наносит урон всем существам и
// боевым машинам на поле сражения" — war machines, in the spell's own
// description. The plain one adds "и локальный физический урон в месте
// применения", the local damage the first and third questions decide. And
// Master of Fire names the spell it applies to: "«Огненный шар», «Стена огня» и
// «Армагеддон»".
//
// WHAT WE WRITE. The engine's own question, in the engine's own words. The
// first site needs one byte: `0xAD44C0` was called four instructions earlier
// and its answer is still in `eax` — unused by the comparison, which reads the
// raw id out of `ecx` instead. `cmp ecx,0Ah` becomes `cmp eax,0Ah`, and `ecx`
// keeps the raw id the code below it still wants.
//
// The other two sites have no answer at hand, so each jumps to ten-odd bytes of
// ours that ask for one and jump on to whichever of that site's two
// continuations the answer picks. Nothing else changes: the spells that map to
// themselves (Holy Word, id 35, shares this code) compare exactly as before.
//
// Ported from dredknight's EmpoweredArmageddonFixes.cpp, which makes the same
// three changes by hard-coding id 232 next to id 10 — and, at the first site,
// by removing the comparison altogether.

/** `mov ecx,[esi+4] / cmp ecx,0Ah / jne` — the raw id, with the answer in eax. */
#define ARMAGEDDON_LOCAL_RVA 0x960e26u
/** `cmp [esi+4],0Ah / je` — war machines, skipped for everything else. */
#define ARMAGEDDON_MACHINES_RVA 0x960ea6u

/** Continuations: not-Armageddon, then Armageddon, for the one site that stubs. */
#define ARMAGEDDON_MACHINES_CHECK_RVA 0x960eacu
#define ARMAGEDDON_MACHINES_HIT_RVA 0x960ebdu

/** `SpellOf`, the engine's own: an empowered id in, the spell it is in eax. */
#define ARMAGEDDON_SPELL_OF_RVA 0x6d44c0u

static const BYTE ARMAGEDDON_ASKS_RAW[8] = {
  0x8B, 0x4E, 0x04, 0x83, 0xF9, 0x0A, 0x75, 0x1B
};
/** The same, comparing the answer already in `eax`. One byte: `F9` -> `F8`. */
static const BYTE ARMAGEDDON_ASKS_ANSWER[8] = {
  0x8B, 0x4E, 0x04, 0x83, 0xF8, 0x0A, 0x75, 0x1B
};

static const BYTE ARMAGEDDON_MACHINES_RAW[6] = { 0x83, 0x7E, 0x04, 0x0A, 0x74, 0x11 };
/** `jmp` to ours; the four zeroes are filled in when the stub is allocated. */
static BYTE ARMAGEDDON_MACHINES_ASKED[6] = { 0xE9, 0x00, 0x00, 0x00, 0x00, 0x90 };


/**
 * `mov ecx,[esi+4] / call SpellOf / cmp eax,0Ah / je +5 / jmp else / jmp then`
 *
 * The spell object is in `esi` at both sites, and both continuations reload
 * every register this touches — so the only thing that has to survive the ask
 * is `esi`, which `SpellOf` preserves.
 */
static BYTE ARMAGEDDON_ASK[23] = {
  0x8B, 0x4E, 0x04,
  0xE8, 0x00, 0x00, 0x00, 0x00,
  0x83, 0xF8, 0x0A,
  0x74, 0x05,
  0xE9, 0x00, 0x00, 0x00, 0x00,
  0xE9, 0x00, 0x00, 0x00, 0x00
};

static BYTE *armageddon_stub(const BYTE *shape, int len, int callAt, int elseAt, int thenAt,
                             DWORD elseRva, DWORD thenRva) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, len, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("empowered armageddon: no memory for a stub"); return NULL; }
  for (int i = 0; i < len; i++) stub[i] = shape[i];
  *(DWORD *)(stub + callAt + 1) =
      (DWORD)(base + ARMAGEDDON_SPELL_OF_RVA) - (DWORD)(stub + callAt + 5);
  *(DWORD *)(stub + elseAt + 1) = (DWORD)(base + elseRva) - (DWORD)(stub + elseAt + 5);
  *(DWORD *)(stub + thenAt + 1) = (DWORD)(base + thenRva) - (DWORD)(stub + thenAt + 5);
  FlushInstructionCache(GetCurrentProcess(), stub, len);
  return stub;
}

static void install_empowered_armageddon_fix(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  int done = overwrite_code(ARMAGEDDON_LOCAL_RVA, ARMAGEDDON_ASKS_RAW, ARMAGEDDON_ASKS_ANSWER,
                            sizeof ARMAGEDDON_ASKS_RAW, "the damage at the point of impact");

  BYTE *machines = armageddon_stub(ARMAGEDDON_ASK, sizeof ARMAGEDDON_ASK, 3, 13, 18,
                                   ARMAGEDDON_MACHINES_CHECK_RVA, ARMAGEDDON_MACHINES_HIT_RVA);
  if (machines) {
    *(DWORD *)(ARMAGEDDON_MACHINES_ASKED + 1) =
        (DWORD)machines - ((DWORD)(base + ARMAGEDDON_MACHINES_RVA) + 5);
    done += overwrite_code(ARMAGEDDON_MACHINES_RVA, ARMAGEDDON_MACHINES_RAW,
                           ARMAGEDDON_MACHINES_ASKED, sizeof ARMAGEDDON_MACHINES_RAW,
                           "the war machines an armageddon hits");
  }

  // AND THE THIRD SITE IS NOT OURS ANY MORE. `combat/spell-cast.c` replaces it
  // to ask a wider question — which ELEMENT the damage is dealt in, since the
  // four appliers there are one per element and `cmp eax,0Ah` was only ever
  // "is this spell's damage elemental" written against the one id for which it
  // is. That stub asks OUR question too, keyed on this very flag, so an
  // empowered Armageddon still answers yes here exactly when this fix is on.
  // Two patches over twelve bytes would have been one refusing silently.

  log_num("empowered armageddon: sites taught the question, of two (the third is the spell code's): ", done);
}
