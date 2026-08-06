// Every spell cast in a battle, as the engine resolves it — and what it does
// with one it has never heard of.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHERE A CAST IS DECIDED. `CCombatSpellCast::Resolve` (0xB7EA00) is the one
// function a cast goes through, and its shape is the whole story for a spell of
// ours:
//
//   mov byte ptr [esp+13h],1     "this spell did nothing" — set BEFORE the id
//   call 0xAD44C0                ecx = the spell's id
//   cmp ecx,115h  /  lea eax,[ecx-0Bh]  /  jmp [eax*4+0B7FB40h]   … the dispatch
//   …
//   ja 0xB7FADA                  everything it does not know goes to the tail
//
// So an id the executable was never compiled against is not a crash and not an
// error: it is carried through the book, through the click, into this function,
// and out the other end with the byte still saying "nothing happened". (Which
// the Payback perk then reads as a resisted spell and refunds — see
// qol/fix-payback.c. The two are the same byte.)
//
// WHAT THIS DOES, for now: says so out loud. Six bytes at the head of the
// dispatch — `cmp ecx,115h`, and ecx IS the id at that instant — become a jump
// to a stub of ours that logs the number and then does the comparison it
// displaced. Nothing about the cast changes; this is the log that says whether
// a spell of ours reaches the engine at all, which is the one thing a first run
// has to answer before anything is built on top of it.
//
// Written as an in-place stub rather than a detour on the function, because the
// id is not an argument: it is fetched inside, and only from the dispatch
// onwards is there anything to read. The same reason fix-payback.c writes a stub
// instead of hooking a function head.

/** `cmp ecx,115h` at the head of the dispatch — ecx is the spell id. */
#define SPELL_DISPATCH_RVA 0x77eaf8u
#define SPELL_DISPATCH_LEN 6
static const BYTE SPELL_DISPATCH_HEAD[SPELL_DISPATCH_LEN] = {
  0x81, 0xF9, 0x15, 0x01, 0x00, 0x00
};

/**
 * The first id that can only be ours.
 *
 * The shipped table is 353 long (`SPELL_NONE` = 0 … 352), and a mod appends, so
 * anything at or above this came from the editor. Kept here as a number rather
 * than read from the config: this is a LOG, and a log that needs configuring to
 * say what it saw is a log that says nothing on the run that mattered.
 */
#define FIRST_SPELL_OF_OURS 353

/** How many casts print themselves. Enough for a battle, not for a session. */
#define SPELL_CASTS_LOGGED 40

static int g_spellCastsLogged = 0;

/** Called from the stub with the id the dispatch is about to switch on. */
static void __cdecl on_spell_cast(int spell) {
  if (g_spellCastsLogged >= SPELL_CASTS_LOGGED) return;
  g_spellCastsLogged++;
  if (spell >= FIRST_SPELL_OF_OURS) log_num("cast: OURS, spell id ", spell);
  else log_num("cast: the game's own, spell id ", spell);
}

/**
 * pushad / pushfd / call / popfd / popad, then the `cmp` we displaced and back.
 *
 * The flags are saved and restored around the call and the comparison is done
 * AFTER, so the dispatch below reads flags set by its own instruction — a stub
 * that logged and then let the caller keep our flags would send every cast to
 * whichever branch our arithmetic happened to imply.
 */
#define SPELL_STUB_LEN 24
static BYTE SPELL_STUB[SPELL_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0x51,                                     // push ecx        — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call on_spell_cast
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x81, 0xF9, 0x15, 0x01, 0x00, 0x00,       // cmp ecx,115h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

/** The six bytes that replace the comparison: a jump to the stub, and a nop. */
static BYTE SPELL_TO_STUB[SPELL_DISPATCH_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_spell_log(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, SPELL_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("spell log: no memory for the stub"); return; }
  for (int i = 0; i < SPELL_STUB_LEN; i++) stub[i] = SPELL_STUB[i];
  // The call's distance is measured from the end of the call instruction, which
  // is the eighth byte of the stub.
  *(DWORD *)(stub + 4) = (DWORD)(void *)on_spell_cast - (DWORD)(stub + 8);
  // And the jump home, from the end of the stub to just past what we displaced.
  *(DWORD *)(stub + 20) =
      (DWORD)(base + SPELL_DISPATCH_RVA + SPELL_DISPATCH_LEN) - (DWORD)(stub + SPELL_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, SPELL_STUB_LEN);

  *(DWORD *)(SPELL_TO_STUB + 1) =
      (DWORD)stub - ((DWORD)(base + SPELL_DISPATCH_RVA) + 5);
  if (overwrite_code(SPELL_DISPATCH_RVA, SPELL_DISPATCH_HEAD, SPELL_TO_STUB,
                     SPELL_DISPATCH_LEN, "the spell dispatch")) {
    log_line("every spell cast will say what it was");
  }
}

// ---------------------------------------------------------------------------
// ONE STEP EARLIER, because the first run came back with nothing.
//
// The dispatch above logged eighteen casts in a battle and not one of them was
// ours: the spell is in the book, its page draws, the button takes a click —
// and the engine's resolver never hears about it. So the question is no longer
// "what does the resolver do with our id" but "where between the click and the
// resolver is it dropped", and that wants a mark on the step in between.
//
// `CCastCombatSpellCmd::Execute` (0xB72790, the command's vtable +0x1C) is that
// step: the command is what a click becomes, and it carries the spell id in its
// own field `+0x10` — the same field the function tests against 0BDh two
// instructions in. A line here and no line at the dispatch means the command was
// built and refused; no line at all means the click never became a command, and
// the next look is the book.

#define CAST_COMMAND_RVA 0x772790u
#define CAST_COMMAND_HEAD_LEN 6
static const BYTE CAST_COMMAND_HEAD[CAST_COMMAND_HEAD_LEN] = {
  0x83, 0xEC, 0x58, 0x53, 0x8B, 0xD9
};
/** The command's own copy of what is being cast. */
#define CAST_COMMAND_SPELL 0x10u

typedef int(__fastcall *CastCommandFn)(void *self, void *edx);
static CastCommandFn g_castCommand = NULL;
static int g_castCommandsLogged = 0;

static int __fastcall on_cast_command(void *self, void *edx) {
  if (g_castCommandsLogged < SPELL_CASTS_LOGGED) {
    g_castCommandsLogged++;
    int spell = readable_bytes(self, CAST_COMMAND_SPELL + 4) >= CAST_COMMAND_SPELL + 4
        ? *(int *)((BYTE *)self + CAST_COMMAND_SPELL) : -1;
    if (spell >= FIRST_SPELL_OF_OURS) log_num("cast command: OURS, spell id ", spell);
    else log_num("cast command: the game's own, spell id ", spell);
  }
  return g_castCommand(self, edx);
}

static void install_cast_command_log(void) {
  g_castCommand = (CastCommandFn)detour(CAST_COMMAND_RVA, CAST_COMMAND_HEAD, CAST_COMMAND_HEAD_LEN,
                                        (void *)on_cast_command, "the combat cast command");
  if (g_castCommand) log_line("every combat cast command will say what it carries");
}
