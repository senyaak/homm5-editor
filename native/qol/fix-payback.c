// Payback, paid out for a spell that worked.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_fix_payback

// ---------------------------------------------------------------------------
// WHAT IS WRONG. The function that resolves a cast keeps one byte on its stack
// — "the spell did nothing" — sets it to 1 before it dispatches on the spell,
// and hands it back to its caller. A damage spell clears it (`sete` on the
// total, so zero damage counts as nothing); the three spells that put an
// OBSTACLE on the field never touch it, and it goes home still saying 1. The
// caller reads that as a resisted spell: it prints "Payback!", refunds the
// whole cost and moves the hero's turn up. So Arcane Crystal, Summon Hive and
// Blade Barrier — cast successfully, standing on the field — are free, every
// time, for a hero with the perk.
//
// WHAT THE GAME SAYS. Payback's own description: "Если заклинание не
// подействовало на отряд существ благодаря их сопротивлению магии, то герою
// возвращается вся потраченная на заклятие мана, и его следующий ход наступает
// раньше." Mana comes back when a STACK RESISTED the spell. Nothing resisted a
// crystal that is standing there.
//
// WHERE IT IS. `0xB7EA00` is the cast, `[esp+0x13]` is the byte, and its
// consumers are the two `cmp byte ptr [esp+13h],0` at `0xB764DE` and
// `0xB768CD` — three instructions above the "Payback!" the string table only
// uses there, which is how this site was found in a build a megabyte away from
// the one the original patch names.
//
// The three spells reach one place. Ids 0x11A, 0x11B and 0x11C index a
// four-entry jump table at `0xB7FC8C`: Arcane Crystal and Summon Hive share a
// body at `0xB7F8F4`, Blade Barrier places its three tiles at `0xB7F917` and
// jumps back into that same body for the last of them. So every one of them
// leaves through `call 0xD54520` at `0xB7F90D` — put the obstacle down — and
// the `jmp` to the common tail immediately after it.
//
// HOW WE DO IT. That `jmp` is redirected to ten bytes of ours: clear the byte,
// jump on to the tail it was going to anyway. dredknight's writes the same
// clear over the retail build's last placement call, where his compiler left
// room for it; ours has ten bytes between the call and the tail and needs five
// more, so the five that ARE there become the jump that buys them. Nothing is
// displaced, nothing is stale, and the stack is untouched — the tail reads
// `[esp+0x13]` at exactly the esp we hand it.
//
// dredknight's file is ArcaneRenewalFix.cpp, which is what Heroes 5.5 renamed
// this perk to; the shipped game calls it Payback.

/** `call 0xD54520` then `jmp 0xB7FADA` — the last obstacle placed, and out. */
#define PAYBACK_PLACE_RVA 0x77f90du
/** The common tail, where the byte is copied out to the caller. */
#define PAYBACK_TAIL_RVA 0x77fadau

static const BYTE PAYBACK_STRAIGHT_TO_TAIL[10] = {
  0xE8, 0x0E, 0x4C, 0x1D, 0x00, 0xE9, 0xC3, 0x01, 0x00, 0x00
};
/** The same call, then a jump through us. The four zeroes are the distance to
 *  the stub, which is only known once it is allocated — filled in below. */
static BYTE PAYBACK_THROUGH_US[10] = {
  0xE8, 0x0E, 0x4C, 0x1D, 0x00, 0xE9, 0x00, 0x00, 0x00, 0x00
};

/** `mov byte ptr [esp+0x13],0` — the spell did something — and on to the tail. */
static BYTE PAYBACK_STUB[10] = {
  0xC6, 0x44, 0x24, 0x13, 0x00, 0xE9, 0x00, 0x00, 0x00, 0x00
};

static void install_payback_fix(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, sizeof PAYBACK_STUB, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("payback fix: no memory for the stub"); return; }
  for (int i = 0; i < (int)sizeof PAYBACK_STUB; i++) stub[i] = PAYBACK_STUB[i];
  *(DWORD *)(stub + 6) = (DWORD)(base + PAYBACK_TAIL_RVA) - (DWORD)(stub + sizeof PAYBACK_STUB);
  FlushInstructionCache(GetCurrentProcess(), stub, sizeof PAYBACK_STUB);

  // The jump we are about to write sits at the sixth byte of the row, and the
  // distance is measured from the instruction's end — the row's end here.
  *(DWORD *)(PAYBACK_THROUGH_US + 6) =
      (DWORD)stub - ((DWORD)(base + PAYBACK_PLACE_RVA) + (DWORD)sizeof PAYBACK_THROUGH_US);
  overwrite_code(PAYBACK_PLACE_RVA, PAYBACK_STRAIGHT_TO_TAIL, PAYBACK_THROUGH_US,
                 sizeof PAYBACK_STRAIGHT_TO_TAIL, "an obstacle spell that worked");
}
