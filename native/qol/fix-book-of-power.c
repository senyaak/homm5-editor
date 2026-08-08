// The Book of Power's knowledge, which buys no mana.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_fix_book_of_power

// ---------------------------------------------------------------------------
// WHAT IS WRONG. One function applies an artifact to a hero and takes it off
// again (`0xC2EE80`). Its main path walks the six primary stats in order —
// attack `+0x64`, defence `+0x68`, spell power `+0x6C`, knowledge `+0x70`,
// morale `+0x74`, luck `+0x78` — and the KNOWLEDGE one is the only one that
// does anything else: it asks the hero what his knowledge now is (`GetKnowledge`,
// the hero's vtable `+0x1C`), asks what mana that buys (`+0x130`) and writes the
// answer to `+0x15C`. The engine's own one-stat-at-a-time setters do the same:
// `0xC1FFE9` adds to `+0x70` and recomputes `+0x15C`, `0xC1FFD7` adds to `+0x6C`
// and does not. So "knowledge changed, recompute the mana" is the engine's own
// rule, written twice.
//
// The Book of Power does not go down that path. Its bonus depends on a SKILL —
// +1 to spell power and knowledge, +2 with Advanced Education, +3 with Expert —
// so it is one of seven special cases in a switch below (ours at `0xC2F0B7`,
// case 5 of the table at `0xC2F148`): ask the hero his mastery of Learning
// (`vtable+0x174`, skill 3), floor it at 1, and write it to a knowledge slot of
// its own, `+0x25C`. Then it marks the hero changed and returns — without
// recomputing the mana. The other special cases sit on `+0x250`, `+0x254`,
// `+0x258`, `+0x260` and `+0x264`, which is the same six stats again, and the
// knowledge one is the only one that would have needed it.
//
// So the hero screen shows the knowledge the artifact gave and the mana ball
// does not follow. It shows up on a LEVEL UP because that is when the bonus
// changes on its own: take Education and the book is taken off and put back at
// its new value, with the mana left at what it was before.
//
// WHAT THE GAME SAYS. The artifact's own description: "Добавляет +1 к
// «Колдовству» и «Знанию», если у героя еще нет навыков из области
// «Образование». Добавляет +2 … если у героя есть «Среднее образование» или +3,
// если у героя есть «Высшее образование»." Knowledge, in the plain sense the
// rest of the game gives it — and everywhere else in the game knowledge is
// mana.
//
// WHAT WE WRITE. The engine's own six instructions, in the case that lacks
// them. Both branches are patched: the one that grants the bonus and the one
// that takes it back off, because the mana has to fall again as well.
//
// Each branch ends with `call 0xBB49C0` — mark the hero changed — and there is
// no room in front of it, so those five bytes become a jump to forty of ours:
// recompute the mana, make the call we displaced, and jump back to the epilogue
// the branch was going to anyway. Nothing is displaced and the stack is
// untouched.
//
// Ported from dredknight's BookOfPowerLevelUp.cpp, which lifts the same six
// instructions from the same function.

/** `call 0xBB49C0` at the end of the branch that grants the bonus. */
#define BOOK_GRANTED_RVA 0x82f0e5u
/** …and where it returns: the epilogue, five bytes on. */
#define BOOK_GRANTED_BACK_RVA 0x82f0eau
/** The same call at the end of the branch that takes the bonus back off. */
#define BOOK_REMOVED_RVA 0x82f100u
#define BOOK_REMOVED_BACK_RVA 0x82f105u
/** "This hero changed" — what both branches call, and what we make for them. */
#define BOOK_CHANGED_RVA 0x7b49c0u

/** `call 0xBB49C0`, as both branches spell it. */
static const BYTE BOOK_MARKS_CHANGED[5] = { 0xE8, 0xD6, 0x58, 0xF8, 0xFF };
static const BYTE BOOK_MARKS_CHANGED_AGAIN[5] = { 0xE8, 0xBB, 0x58, 0xF8, 0xFF };
/** `jmp` to ours; the four zeroes are filled in when the stub is allocated. */
static BYTE BOOK_THROUGH_US[5] = { 0xE9, 0x00, 0x00, 0x00, 0x00 };
static BYTE BOOK_THROUGH_US_AGAIN[5] = { 0xE9, 0x00, 0x00, 0x00, 0x00 };

/**
 * The knowledge, the mana it buys, the mark, and back.
 *
 * ```
 * mov eax,[edi+1Ch] / lea ecx,[edi+1Ch] / call [eax+1Ch]     GetKnowledge
 * push eax
 * mov eax,[edi+1Ch] / lea ecx,[edi+1Ch] / call [eax+130h]    the mana it buys
 * mov [edi+15Ch],eax
 * mov ecx,edi / call 0xBB49C0                                the call we took
 * jmp back
 * ```
 *
 * `edi` is the hero for the whole function (`mov edi,ecx` at its head) and both
 * calls preserve it, which is what the engine's own copy of these instructions
 * relies on. The vtable is reloaded after the first call because the first call
 * returns through the register it was in. The argument is the callee's to clean
 * — again, as the engine's copy has it, which pops into `edi` straight after.
 */
static BYTE BOOK_RECOMPUTES_MANA[40] = {
  0x8B, 0x47, 0x1C,
  0x8D, 0x4F, 0x1C,
  0xFF, 0x50, 0x1C,
  0x50,
  0x8B, 0x47, 0x1C,
  0x8D, 0x4F, 0x1C,
  0xFF, 0x90, 0x30, 0x01, 0x00, 0x00,
  0x89, 0x87, 0x5C, 0x01, 0x00, 0x00,
  0x8B, 0xCF,
  0xE8, 0x00, 0x00, 0x00, 0x00,
  0xE9, 0x00, 0x00, 0x00, 0x00
};

/** Copy the stub out, fill its call and its jump home, and say where it is. */
static BYTE *book_stub(DWORD backRva) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  int len = (int)sizeof BOOK_RECOMPUTES_MANA;
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, len, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("book of power: no memory for a stub"); return NULL; }
  for (int i = 0; i < len; i++) stub[i] = BOOK_RECOMPUTES_MANA[i];
  *(DWORD *)(stub + 31) = (DWORD)(base + BOOK_CHANGED_RVA) - (DWORD)(stub + 35);
  *(DWORD *)(stub + 36) = (DWORD)(base + backRva) - (DWORD)(stub + 40);
  FlushInstructionCache(GetCurrentProcess(), stub, len);
  return stub;
}

static void install_book_of_power_fix(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  int done = 0;

  BYTE *granted = book_stub(BOOK_GRANTED_BACK_RVA);
  if (granted) {
    *(DWORD *)(BOOK_THROUGH_US + 1) = (DWORD)granted - ((DWORD)(base + BOOK_GRANTED_RVA) + 5);
    done += overwrite_code(BOOK_GRANTED_RVA, BOOK_MARKS_CHANGED, BOOK_THROUGH_US,
                           sizeof BOOK_MARKS_CHANGED, "the book of power granting knowledge");
  }

  BYTE *removed = book_stub(BOOK_REMOVED_BACK_RVA);
  if (removed) {
    *(DWORD *)(BOOK_THROUGH_US_AGAIN + 1) =
        (DWORD)removed - ((DWORD)(base + BOOK_REMOVED_RVA) + 5);
    done += overwrite_code(BOOK_REMOVED_RVA, BOOK_MARKS_CHANGED_AGAIN, BOOK_THROUGH_US_AGAIN,
                           sizeof BOOK_MARKS_CHANGED_AGAIN, "the book of power taken back off");
  }

  log_num("book of power: branches that recompute the mana, of two: ", done);
}
