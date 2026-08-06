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
#define SPELL_CASTS_LOGGED 12

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
/** Non-zero while a command is executing — see the gate's log below. */
static int g_inCastCommand = 0;

static int __fastcall on_cast_command(void *self, void *edx) {
  int spell = readable_bytes(self, CAST_COMMAND_SPELL + 4) >= CAST_COMMAND_SPELL + 4
      ? *(int *)((BYTE *)self + CAST_COMMAND_SPELL) : -1;
  if (g_castCommandsLogged < SPELL_CASTS_LOGGED) {
    g_castCommandsLogged++;
    if (spell >= FIRST_SPELL_OF_OURS) log_num("cast command: OURS, spell id ", spell);
    else log_num("cast command: the game's own, spell id ", spell);
  }
  // WHAT THE COMMAND IS MADE OF — and for the GAME'S OWN spells too, which is
  // the point. Ours comes in with a caster and no target and returns zero; the
  // only way to know whether that is the fault is to see what a spell that works
  // brings with it. A comparison of two blocks says in one run what reading the
  // function has not.
  int dump = g_castCommandsLogged <= SPELL_CASTS_LOGGED && readable_bytes(self, 0x3C) >= 0x3C;
  if (dump) {
    log_hex("   caster +0x20 ", *(DWORD *)((BYTE *)self + 0x20));
    log_hex("   target +0x24 ", *(DWORD *)((BYTE *)self + 0x24));
    log_hex("   +0x0C ", *(DWORD *)((BYTE *)self + 0x0C));
    log_hex("   +0x14 ", *(DWORD *)((BYTE *)self + 0x14));
    log_hex("   +0x18 ", *(DWORD *)((BYTE *)self + 0x18));
    log_hex("   +0x28 ", *(DWORD *)((BYTE *)self + 0x28));
    log_hex("   +0x30 ", *(DWORD *)((BYTE *)self + 0x30));
    log_hex("   +0x38 ", *(DWORD *)((BYTE *)self + 0x38));
    // The engine's own liveness test on the caster, done here rather than
    // guessed at: Execute reads `[caster+4]`, then `[that+4]` as a displacement,
    // and refuses when the int at `caster + displacement + 8` is negative. It is
    // the second of the four early exits and the only one we cannot see from the
    // block alone.
    BYTE *caster = (BYTE *)*(DWORD *)((BYTE *)self + 0x20);
    if (readable_bytes(caster, 8) >= 8) {
      DWORD *shape = (DWORD *)*(DWORD *)(caster + 4);
      DWORD at = readable_bytes(shape, 8) >= 8 ? shape[1] : 0xFFFFFFFFu;
      if (at != 0xFFFFFFFFu && readable_bytes(caster + at, 12) >= 12) {
        log_num("   the caster's life count ", *(int *)(caster + at + 8));
      } else log_line("   the caster's life count cannot be read");
    }
  }
  // The gate is asked from two places and only one of them is interesting: the
  // interface asks it for every target the pointer passes over — twelve times in
  // one battle, which is what ate the log budget and made the gate look as
  // though it was never consulted during a cast at all. So it prints only while
  // a command is actually executing.
  g_inCastCommand++;
  int answer = g_castCommand(self, edx);
  g_inCastCommand--;
  if (dump) log_num("   the command returned ", answer & 0xFF);
  return answer;
}

static void install_cast_command_log(void) {
  g_castCommand = (CastCommandFn)detour(CAST_COMMAND_RVA, CAST_COMMAND_HEAD, CAST_COMMAND_HEAD_LEN,
                                        (void *)on_cast_command, "the combat cast command");
  if (g_castCommand) log_line("every combat cast command will say what it carries");
}

// ---------------------------------------------------------------------------
// AND THE GATE IN BETWEEN, because the second run narrowed it to one step.
//
// The command IS built with our id — "cast command: OURS, spell id 353", three
// times — and the resolver still never hears of it. Between them
// `CCastCombatSpellCmd::Execute` asks one question and returns on a no:
//
//   call 0xB7B4C0 ; test al,al ; je <the end>
//
// which is the routine carrying COMBAT_CANT_CAST_SPELL_ON_HERO and its
// neighbours — "may this spell be applied here". Its second argument points at
// the command's own block, and the spell id is that pointer's `+4`.
//
// So this logs the id it was asked about and the verdict it gave. A `no` names
// the gate; a `yes` means the cast dies in one of the three id questions that
// follow it (0xAD3E30, 0xAD4800, 0xAD40C0) and the next mark goes there.

#define CAST_GATE_RVA 0x77b4c0u
#define CAST_GATE_HEAD_LEN 6
static const BYTE CAST_GATE_HEAD[CAST_GATE_HEAD_LEN] = {
  0x83, 0xEC, 0x30, 0x53, 0x55, 0x56
};
/** The spell id, in the block the gate's `edx` points at. */
#define CAST_GATE_SPELL 0x04u

/**
 * `SpellRecord(id)` — the engine's own way from an id to the loaded document.
 *
 * One array indexed by the id, sixteen bytes a slot, and a null when the slot
 * holds nothing. Worth asking ourselves rather than inferring: if this comes
 * back null for our id then the game never loaded the document, and everything
 * downstream is explained at once. The three fields below are the ones the gate
 * and its neighbours read out of it.
 */
#define SPELL_RECORD_RVA 0x71eed0u
#define SPELL_RECORD_SCHOOL 0x88u
#define SPELL_RECORD_AIMED 0xCCu
#define SPELL_RECORD_AREA 0xCDu

typedef void *(__fastcall *SpellRecordFn)(int spell);
static SpellRecordFn g_spellRecord = NULL;

/** What the engine thinks our spell IS, printed once per cast. */
static void log_spell_record(int spell) {
  if (!g_spellRecord) return;
  void *record = g_spellRecord(spell);
  if (!record) { log_line("   the engine has NO record for it"); return; }
  if (readable_bytes(record, SPELL_RECORD_AREA + 1) < SPELL_RECORD_AREA + 1) {
    log_line("   the record is there but will not be read");
    return;
  }
  // 0 destructive, 1 dark, 2 light, 3 summoning, 4 adventure, 5 runic, 7 special.
  log_num("   school ", *(int *)((BYTE *)record + SPELL_RECORD_SCHOOL));
  log_num("   needs a target ", *((BYTE *)record + SPELL_RECORD_AIMED));
  log_num("   hits an area ", *((BYTE *)record + SPELL_RECORD_AREA));
}

typedef int(__fastcall *CastGateFn)(void *ecx, void *block, void *a1, void *a2, int a3,
                                    void *a4, void *a5, int a6, int a7);
static CastGateFn g_castGate = NULL;
static int g_castGatesLogged = 0;

static int __fastcall on_cast_gate(void *ecx, void *block, void *a1, void *a2, int a3,
                                   void *a4, void *a5, int a6, int a7) {
  int spell = readable_bytes(block, CAST_GATE_SPELL + 4) >= CAST_GATE_SPELL + 4
      ? *(int *)((BYTE *)block + CAST_GATE_SPELL) : -1;
  int answer = g_castGate(ecx, block, a1, a2, a3, a4, a5, a6, a7);
  // Only during a real cast, and for every spell rather than only ours: the
  // question is why the same block passes with Armageddon's id and fails with
  // ours, so both verdicts have to be in the same log.
  if (g_inCastCommand && g_castGatesLogged < SPELL_CASTS_LOGGED) {
    g_castGatesLogged++;
    log_num("may it be cast? spell id ", spell);
    log_num("   the gate says ", answer & 0xFF);
    log_spell_record(spell);
  }
  return answer;
}

static void install_cast_gate_log(void) {
  // Called, never hooked: this is the engine answering about its own data, so it
  // is asked the way the engine asks — and the two bytes at its head are checked
  // first, since an address of ours that has gone stale would be read as a spell
  // the game does not have.
  BYTE *record = (BYTE *)GetModuleHandleW(NULL) + SPELL_RECORD_RVA;
  if (record[0] == 0x56 && record[1] == 0x8B) g_spellRecord = (SpellRecordFn)record;
  else log_line("the spell record accessor is not where we left it");
  g_castGate = (CastGateFn)detour(CAST_GATE_RVA, CAST_GATE_HEAD, CAST_GATE_HEAD_LEN,
                                  (void *)on_cast_gate, "the cast's target check");
  if (g_castGate) log_line("a cast of ours will say whether the gate let it through");
}
