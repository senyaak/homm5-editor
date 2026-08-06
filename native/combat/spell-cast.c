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
// WHAT THIS DOES. Six bytes at the head of the dispatch — `cmp ecx,115h`, and
// ecx IS the id at that instant — become a jump to a stub of ours. The stub logs
// the number, hands a cast of ours to its script, and then either jumps into the
// branch the word spells use (which is where the damage comes from — see "the
// branch we borrow" below) or does the comparison it displaced and returns.
// Nothing about the game's own spells changes.
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

// NOTHING HERE IS RATIONED. Two runs were lost to a budget: the interface asks
// the gate once per target the pointer crosses, and a session holds several
// battles, so an allowance that looked generous was spent before the cast we
// were watching. A probe that goes quiet exactly when it matters is worse than
// no probe, and the file is cheap. Every cast, every verdict, every time — the
// session's own banner ("--- homm5-editor extension loaded") is where one run
// ends and the next begins.

/** The battle-side event a spell of ours is written against. */
#define H5E_SPELL_CAST 4

/**
 * `SpellRecord(id)` — the engine's own way from an id to the loaded document.
 *
 * One array indexed by the id, sixteen bytes a slot, and a null when the slot
 * holds nothing. Worth asking ourselves rather than inferring: if this comes
 * back null for our id then the game never loaded the document, and everything
 * downstream is explained at once. The three fields below are the ones the gate,
 * its neighbours and the branch chooser read out of it.
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

// ---------------------------------------------------------------------------
// WHICH SHAPE A SPELL OF OURS IS.
//
// The engine has one branch per SHAPE, not per spell, and for damage there are
// exactly three. What separates them is not something we have to invent: it is
// the two flags every spell document already carries, and they separate the
// shipped ones cleanly.
//
//   IsAimed  IsAreaAttack   branch      the game's own
//   -------  ------------   ---------   -------------------------------------
//   false    false          0xB7ED4A    Armageddon, Holy Word, Unholy Word
//   true     true           0xB7ED16    Fireball, Frost Ring, Stone Spikes
//   true     false          0xB7F6DC    Magic Arrow, Lightning Bolt, Implosion
//
// So the editor's two checkboxes ARE the choice, and nothing new has to be said
// anywhere: no field in the document, no row in the config. A spell of ours is
// pointed at the branch its own record implies.
//
// THE LIMIT, written down before it bites. The flags separate the three DAMAGE
// shapes and no more: Curse and Bless read `true`/`false` too, exactly like
// Magic Arrow, because they aim at one stack as well. The day a spell of ours
// puts an EFFECT on that stack instead of hurting it, the flags will not be
// enough and the config row will have to say which shape it is. Until then this
// is the whole rule and it needs no upkeep.

/** The three branches, and the bytes each is recognised by. */
#define WHOLE_FIELD_RVA 0x77ed4au
#define WHOLE_FIELD_MARK_LEN 6
static const BYTE WHOLE_FIELD_MARK[WHOLE_FIELD_MARK_LEN] = {
  0xF3, 0x0F, 0x10, 0x44, 0x24, 0x68                          // movss xmm0,[esp+68h]
};

// Its first six bytes are the whole-field branch's first six — both begin by
// loading the power off the frame — so the mark runs on to the instructions that
// tell them apart. A six-byte mark here would pass at the wrong address.
#define AN_AREA_RVA 0x77ed16u
#define AN_AREA_MARK_LEN 14
static const BYTE AN_AREA_MARK[AN_AREA_MARK_LEN] = {
  0xF3, 0x0F, 0x10, 0x44, 0x24, 0x68,                         // movss xmm0,[esp+68h]
  0x8D, 0x44, 0x24, 0x13,                                     // lea eax,[esp+13h]
  0x8B, 0x54, 0x24, 0x14                                      // mov edx,[esp+14h]
};

#define ONE_STACK_RVA 0x77f6dcu
#define ONE_STACK_MARK_LEN 10
static const BYTE ONE_STACK_MARK[ONE_STACK_MARK_LEN] = {
  0x8B, 0x03, 0x8B, 0xCB,                                     // mov eax,[ebx] / mov ecx,ebx
  0x8B, 0x80, 0x08, 0x01, 0x00, 0x00                          // mov eax,[eax+108h]
};

/** Filled in at load time, once each — zero for one we could not recognise. */
static BYTE *g_wholeField = NULL;
static BYTE *g_anArea = NULL;
static BYTE *g_oneStack = NULL;

/**
 * WHERE THE STUB JUMPS. Written per cast and read by the stub's own `jmp`.
 *
 * Zero means "not ours, or we could not tell" and the stub carries on into the
 * comparison it displaced — which is what the engine would have done anyway. So
 * a branch we failed to recognise costs the spell its effect and costs the game
 * nothing, which is the right way round for a patch that runs inside a battle.
 */
static BYTE *g_ourBranch = NULL;

/** The branch a spell's own record asks for. */
static BYTE *branch_for(int spell) {
  if (!g_spellRecord) return NULL;
  void *record = g_spellRecord(spell);
  if (!record || readable_bytes(record, SPELL_RECORD_AREA + 1) < SPELL_RECORD_AREA + 1) return NULL;
  int aimed = *((BYTE *)record + SPELL_RECORD_AIMED);
  int area = *((BYTE *)record + SPELL_RECORD_AREA);
  if (!aimed) return g_wholeField;
  return area ? g_anArea : g_oneStack;
}

/**
 * Called from the stub with the id the dispatch is about to switch on.
 *
 * THE SECOND HALF OF THE BRIDGE. For a number of ours the dispatch below has no
 * branch and would send the cast to the tail that means "nothing happened", so
 * the spell's own behaviour is run from here — as Lua, in the battle, through
 * the same door every other event of ours goes through — and the stub is told
 * which of the engine's own branches to jump into afterwards.
 */
static void __cdecl on_spell_cast(int spell) {
  g_ourBranch = NULL;
  if (spell < FIRST_SPELL_OF_OURS) { log_num("cast: the game's own, spell id ", spell); return; }
  log_num("cast: OURS, spell id ", spell);
  g_ourBranch = branch_for(spell);
  if (g_ourBranch == g_wholeField && g_wholeField) log_line("   shape: the whole field");
  else if (g_ourBranch == g_anArea && g_anArea) log_line("   shape: an area");
  else if (g_ourBranch == g_oneStack && g_oneStack) log_line("   shape: one stack");
  else log_line("   shape: NONE — it will do nothing");
  fire_trigger(H5E_SPELL_CAST, 1, spell, 0, 0);
}

// ---------------------------------------------------------------------------
// AND THE BRANCHES WE BORROW. Everything above gets the cast as far as the
// dispatch and no further: the dispatch has no case for a number of ours, so
// the cast falls out of the tail that means "nothing happened". The effect has
// to come from somewhere, and it cannot come from us.
//
// WHY NOT FROM US. Damage in this game is not a subtraction. `0xB861A0` — the
// one function that answers "how much does this spell do to that stack" —
// applies magic resistance, the anti-magic that may be on the stack, protection
// from the school, the caster's own terms, and writes the combat log line. A
// number of ours arrived at by arithmetic of ours would bypass all five, and the
// result would look exactly like our bugs.
//
// SO WE BORROW THE ENGINE'S. Each branch is a handful of instructions — the
// whole-field one is six:
//
//   0xB7ED4A  movss xmm0,[esp+68h]     ; the spell's power, from the frame
//             mov edx,ebp              ; the caster
//             mov ecx,[esp+18h]        ; the combat
//             push … ; push edi        ; the frame's own arguments
//             call 0xD60C30            ; every stack on the field, one by one
//             mov byte ptr [esp+13h],0 ; it worked
//             jmp 0xB7FAF0             ; the success tail
//
// and every register any of the three reads is set BEFORE the dispatch, by the
// prologue, from the cast's own block — none of it belongs to the spell whose
// branch it is. The routines take the spell id from that block (`+4`) rather
// than as an argument, so a cast of ours stays OURS all the way down: the
// damage comes off our document, the log line names our spell, and the only
// thing still keyed on a number the executable knows is the kind filter, which
// is what the config row supplies below.
//
// So the stub, having logged and fired the script, jumps to whichever branch
// the spell's own record asked for. The stack is untouched: the dispatch reaches
// those branches through a `jmp`, not a `call`, so arriving by another jmp
// arrives with exactly the frame each expects.

/**
 * pushad / pushfd / call / popfd / popad, then either the branch we were told or
 * the `cmp` we displaced.
 *
 * The flags are saved and restored around the call and the comparison is done
 * AFTER, so the dispatch below reads flags set by its own instruction — a stub
 * that logged and then let the caller keep our flags would send every cast to
 * whichever branch our arithmetic happened to imply. Our own test sits between
 * them for the same reason: it is spent by the `je` two bytes later and the
 * displaced `cmp` sets the flags again for the engine.
 *
 * The jump is INDIRECT, through `g_ourBranch`, because there are three branches
 * and which one a cast wants is a question about its record. `on_spell_cast`
 * has just answered it; a zero means "not ours, or we could not tell" and the
 * stub carries on as though it were not there.
 */
#define SPELL_STUB_LEN 39
static BYTE SPELL_STUB[SPELL_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0x51,                                     // push ecx        — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call on_spell_cast
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x83, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // cmp dword ptr [g_ourBranch],0
  0x74, 0x06,                               // je +6           — not ours, carry on
  0xFF, 0x25, 0x00, 0x00, 0x00, 0x00,       // jmp dword ptr [g_ourBranch]
  0x81, 0xF9, 0x15, 0x01, 0x00, 0x00,       // cmp ecx,115h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

/** The six bytes that replace the comparison: a jump to the stub, and a nop. */
static BYTE SPELL_TO_STUB[SPELL_DISPATCH_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

/**
 * One branch, if its bytes are still the ones we mapped — otherwise nothing.
 *
 * Checked before anything is written, and refused rather than guessed at: an
 * address of ours that has gone stale would send every cast of that shape into
 * the middle of some other instruction, and the crash would land in a battle
 * instead of here. A shape we cannot recognise costs its spells their effect and
 * costs the game nothing, which is the right way round.
 */
static BYTE *borrow_branch(DWORD rva, const BYTE *mark, int len, const char *what) {
  BYTE *at = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < len; i++) {
    if (at[i] == mark[i]) continue;
    log_text("the branch is not where we left it - spells of that shape will do nothing: ", what);
    return NULL;
  }
  return at;
}

static void install_spell_log(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  g_wholeField = borrow_branch(WHOLE_FIELD_RVA, WHOLE_FIELD_MARK, WHOLE_FIELD_MARK_LEN,
                               "the whole field");
  g_anArea = borrow_branch(AN_AREA_RVA, AN_AREA_MARK, AN_AREA_MARK_LEN, "an area");
  g_oneStack = borrow_branch(ONE_STACK_RVA, ONE_STACK_MARK, ONE_STACK_MARK_LEN, "one stack");

  BYTE *stub = (BYTE *)VirtualAlloc(NULL, SPELL_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("spell log: no memory for the stub"); return; }
  for (int i = 0; i < SPELL_STUB_LEN; i++) stub[i] = SPELL_STUB[i];
  // The call's distance is measured from the end of the call instruction, which
  // is the eighth byte of the stub.
  *(DWORD *)(stub + 4) = (DWORD)(void *)on_spell_cast - (DWORD)(stub + 8);
  // Both halves of the indirection name the same variable — the test at byte 13
  // and the jump at byte 22 — and both take its ABSOLUTE address, because the
  // stub lives in memory of its own and nothing relocates it.
  *(DWORD *)(stub + 15) = (DWORD)(void *)&g_ourBranch;
  *(DWORD *)(stub + 24) = (DWORD)(void *)&g_ourBranch;
  // And the jump home, from the end of the stub to just past what we displaced.
  *(DWORD *)(stub + 35) =
      (DWORD)(base + SPELL_DISPATCH_RVA + SPELL_DISPATCH_LEN) - (DWORD)(stub + SPELL_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, SPELL_STUB_LEN);

  *(DWORD *)(SPELL_TO_STUB + 1) =
      (DWORD)stub - ((DWORD)(base + SPELL_DISPATCH_RVA) + 5);
  if (overwrite_code(SPELL_DISPATCH_RVA, SPELL_DISPATCH_HEAD, SPELL_TO_STUB,
                     SPELL_DISPATCH_LEN, "the spell dispatch")) {
    log_line("every spell cast will say what it was, and ours will land");
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
/** Non-zero while a command is executing — see the gate's log below. */
static int g_inCastCommand = 0;

/**
 * Set while the gate is refusing WITH A REASON — and that is the whole point.
 *
 * The gate says no to a spell of ours because it has never heard of the number,
 * and it does that silently: no reason pushed, no message. Its other refusals —
 * immunity, no mana, a blocked spell — go through the funnel below first. So
 * this flag tells "we do not know this spell" apart from "this may not be cast",
 * and only the first is ours to overrule. Without it we answered yes to
 * everything, and the ripple could be aimed at a black dragon — which is immune
 * to magic, and which is exactly what the first run in the game found.
 *
 * Declared here rather than beside the funnel because this is one translation
 * unit read top to bottom: the gate is above, and it is the reader.
 */
static int g_gateGaveAReason = 0;

static int __fastcall on_cast_command(void *self, void *edx) {
  int spell = readable_bytes(self, CAST_COMMAND_SPELL + 4) >= CAST_COMMAND_SPELL + 4
      ? *(int *)((BYTE *)self + CAST_COMMAND_SPELL) : -1;
  if (spell >= FIRST_SPELL_OF_OURS) log_num("cast command: OURS, spell id ", spell);
  else log_num("cast command: the game's own, spell id ", spell);
  // WHAT THE COMMAND IS MADE OF — and for the GAME'S OWN spells too, which is
  // the point. Ours comes in with a caster and no target and returns zero; the
  // only way to know whether that is the fault is to see what a spell that works
  // brings with it. A comparison of two blocks says in one run what reading the
  // function has not.
  int dump = readable_bytes(self, 0x3C) >= 0x3C;
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


typedef int(__fastcall *CastGateFn)(void *ecx, void *block, void *a1, void *a2, int a3,
                                    void *a4, void *a5, int a6, int a7);
static CastGateFn g_castGate = NULL;

static int __fastcall on_cast_gate(void *ecx, void *block, void *a1, void *a2, int a3,
                                   void *a4, void *a5, int a6, int a7) {
  int spell = readable_bytes(block, CAST_GATE_SPELL + 4) >= CAST_GATE_SPELL + 4
      ? *(int *)((BYTE *)block + CAST_GATE_SPELL) : -1;
  g_gateGaveAReason = 0;
  int answer = g_castGate(ecx, block, a1, a2, a3, a4, a5, a6, a7);
  // THE FIRST HALF OF THE BRIDGE. A spell the executable was never compiled
  // against is refused here, silently, and the refusal is not about its
  // document: a copy of Armageddon differing in nothing but its number — same
  // school, same level, same mana, the same two visuals — is refused exactly the
  // same way. So the engine decides what a spell may touch from what it was
  // built with, and no data can answer for a number it has never seen.
  //
  // Ours therefore answers for itself: yes. What that buys is everything the
  // engine does around a cast — the mana, the hero's turn, the animation — and
  // it costs nothing to the game's own spells, whose answer is left alone.
  // ONLY THE SILENT REFUSAL IS OURS TO OVERRULE. A named one is the engine
  // applying a rule that has nothing to do with our number — a black dragon is
  // immune to magic whatever the spell is — and answering yes over it would make
  // ours the one spell in the game that ignores immunity.
  if (spell >= FIRST_SPELL_OF_OURS && g_inCastCommand && !(answer & 0xFF)
      && !g_gateGaveAReason) {
    log_line("   ours, and refused without a reason — answering for it: yes");
    answer = 1;
  }
  // Only during a real cast — and OURS keeps its own budget, because one shared
  // one goes blind exactly when it matters. A session holds several battles, the
  // log is one file, and the casts of the battle before ours used the whole
  // allowance twice now: first the interface's per-target questions, then the
  // previous fight's spells. So a spell of ours prints every time and the game's
  // own share a small quota beside it.
  {
    // WHERE THE QUESTION CAME FROM. The book greys a spell it cannot cast, and
    // it decides that by asking this same routine before anything is pressed —
    // so a verdict from the book and a verdict during a cast are different
    // events and are named apart.
    log_line(g_inCastCommand ? "may it be cast? (during the cast)" : "may it be cast? (from the book)");
    log_num("   spell id ", spell);
    log_num("   the gate says ", answer & 0xFF);
    log_spell_record(spell);
  }
  return answer;
}

// ---------------------------------------------------------------------------
// AND THE REASON, IN THE ENGINE'S OWN WORDS.
//
// The gate says no to our spell — that much the log now shows. Every one of its
// refusals ends the same way: push the NAME of the reason, jump to one place
// that turns it into the message the player sees.
//
//   push 0FBCE28h            ; "COMBAT_NO_ENOUGH_MANA"
//   jmp  0B7B51Eh
//
// So one mark on that funnel prints which of them fired, and the engine names
// its own reason rather than us inferring it from a disassembly. The string is
// the word on the stack when we arrive.
#define GATE_REFUSAL_RVA 0x77b51eu
#define GATE_REFUSAL_LEN 9
// The call is a BACKWARD one — its displacement is negative (0xFF961419), which
// is why the last byte is 0xFF and not the 0x00 a forward call would leave. The
// byte test caught the guess, which is what it is for.
static const BYTE GATE_REFUSAL_HEAD[GATE_REFUSAL_LEN] = {
  0x8D, 0x4C, 0x24, 0x20, 0xE8, 0x19, 0x14, 0x96, 0xFF
};

static void __cdecl on_gate_refusal(const char *reason) {
  g_gateGaveAReason = 1;
  log_text("   the gate refuses: ", reason && readable_bytes(reason, 4) >= 4 ? reason : "(unreadable)");
}

/**
 * pushad / pushfd, read the reason from where the push left it, log, restore,
 * then run the two instructions we displaced and jump back.
 *
 * The string sits at `[esp]` on arrival, so after pushad (32 bytes) and pushfd
 * (4) it is at `[esp+36]`. The displaced `lea ecx,[esp+20h]` reads esp too,
 * which is why the flags and the registers go back first — it must see the
 * stack exactly as the engine left it.
 */
#define GATE_STUB_LEN 30
static BYTE GATE_STUB[GATE_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0xFF, 0x74, 0x24, 0x24,                   // push dword ptr [esp+36]  — the reason
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call on_gate_refusal
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x8D, 0x4C, 0x24, 0x20,                   // lea ecx,[esp+20h]        — displaced
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call <the string ctor>   — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE GATE_TO_STUB[GATE_REFUSAL_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90, 0x90, 0x90, 0x90
};

static void install_gate_refusal_log(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *target = base + GATE_REFUSAL_RVA;
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, GATE_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("gate refusal log: no memory for the stub"); return; }
  for (int i = 0; i < GATE_STUB_LEN; i++) stub[i] = GATE_STUB[i];
  *(DWORD *)(stub + 7) = (DWORD)(void *)on_gate_refusal - (DWORD)(stub + 11);
  // The displaced call is relative, so its target is worked out from where it
  // SAT, not from where the copy sits: 0x8D4C2420 then E8 <rel32> at target+4.
  DWORD callee = (DWORD)(target + 9) + *(DWORD *)(target + 5);
  // The stub's own layout, counted out: the displaced call's operand is byte 21
  // and its instruction ends at 25; the jump home is byte 26, ending at 30.
  *(DWORD *)(stub + 21) = callee - (DWORD)(stub + 25);
  *(DWORD *)(stub + 26) = (DWORD)(target + GATE_REFUSAL_LEN) - (DWORD)(stub + GATE_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, GATE_STUB_LEN);

  *(DWORD *)(GATE_TO_STUB + 1) = (DWORD)stub - ((DWORD)target + 5);
  if (overwrite_code(GATE_REFUSAL_RVA, GATE_REFUSAL_HEAD, GATE_TO_STUB, GATE_REFUSAL_LEN,
                     "the gate's refusal funnel")) {
    log_line("a refused cast will name its reason");
  }
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

// ---------------------------------------------------------------------------
// WHAT A SPELL OF OURS MAY TOUCH.
//
// `CCombatSpell::DamageTo` (0xB861A0) is where the engine turns a spell, a
// caster and a stack into a number, and its first act is the kind filter:
//
//   ebx = normalise(block->spellId)               ; 0xAD44C0
//   if (target) {
//     if (ebx == SPELL_UNHOLY_WORD) {             ; 21
//       if (target->HasAbility(ABILITY_UNDEAD))  return 0;
//       if (target->HasAbility(ABILITY_DEMONIC)) return 0;
//     } else if (ebx == SPELL_HOLY_WORD) {        ; 35 — the same rule inverted
//       if (!undead && !demonic && !demon-raged) return 0;
//     }
//   }
//   … resistance, anti-magic, protection from the school, the combat log …
//
// Two cases, both compiled against a literal. A number of ours has none, so
// every stack on the field is fair game — which is the Death Ripple damaging the
// undead. The row in the config file says which kinds it must pass over, and
// this answers zero for them BEFORE the engine's own arithmetic, exactly where
// the engine answers zero for Unholy Word's. Everything after that point still
// happens to whoever is left, which is the whole reason the damage is taken from
// here rather than worked out by us.

#define SPELL_DAMAGE_RVA 0x7861a0u
#define SPELL_DAMAGE_HEAD_LEN 5
static const BYTE SPELL_DAMAGE_HEAD[SPELL_DAMAGE_HEAD_LEN] = {
  0x51, 0x53, 0x8B, 0xC2, 0x56
};
/** The spell id, in the block the function's `edx` points at. */
#define SPELL_DAMAGE_SPELL 0x04u

/**
 * `CCombatUnit::HasAbility(int)` — the engine's own question about a stack, at
 * vtable +0x28C.
 *
 * Asked rather than answered from a table of ours on purpose: this is the slot
 * the engine itself calls three lines above, so whatever it counts — the
 * creature's record, a spell that granted the kind, a form the stack has taken —
 * is counted for us too, and a creature the mod adds needs nothing said about it.
 */
#define UNIT_HAS_ABILITY_SLOT 0x28Cu
typedef BYTE(__thiscall *HasAbilityFn)(void *unit, int ability);

static int unit_has_ability(void *unit, int ability) {
  if (readable_bytes(unit, 4) < 4) return 0;
  void **vtable = *(void ***)unit;
  if (readable_bytes(vtable, UNIT_HAS_ABILITY_SLOT + 4) < UNIT_HAS_ABILITY_SLOT + 4) return 0;
  HasAbilityFn has = (HasAbilityFn)vtable[UNIT_HAS_ABILITY_SLOT / 4];
  if (!points_at_code((void *)has)) return 0;
  return has(unit, ability) ? 1 : 0;
}

typedef int(__fastcall *SpellDamageFn)(int power, void *block, void *caster, void *target);
static SpellDamageFn g_spellDamage = NULL;

static int __fastcall on_spell_damage(int power, void *block, void *caster, void *target) {
  int spell = readable_bytes(block, SPELL_DAMAGE_SPELL + 4) >= SPELL_DAMAGE_SPELL + 4
      ? *(int *)((BYTE *)block + SPELL_DAMAGE_SPELL) : -1;
  if (spell >= FIRST_SPELL_OF_OURS) {
    const SpellRow *row = spell_row(spell);
    log_num("damage of ours, spell id ", spell);
    if (!row) log_line("   no filter row - it may touch anything");
    for (int i = 0; row && i < row->spareCount; i++) {
      if (!unit_has_ability(target, row->spares[i])) continue;
      log_num("   the target is spared, ability ", row->spares[i]);
      return 0;
    }
    int dealt = g_spellDamage(power, block, caster, target);
    // AFTER the engine, not instead of it: this is the number resistance and
    // anti-magic have already been applied to, and it is the one the stack loses.
    log_num("   the engine says ", dealt);
    return dealt;
  }
  return g_spellDamage(power, block, caster, target);
}

static void install_spell_damage_filter(void) {
  g_spellDamage = (SpellDamageFn)detour(SPELL_DAMAGE_RVA, SPELL_DAMAGE_HEAD,
                                        SPELL_DAMAGE_HEAD_LEN, (void *)on_spell_damage,
                                        "the spell's damage to one stack");
  if (g_spellDamage) log_line("a spell of ours will spare what its row says");
}

// ---------------------------------------------------------------------------
// AND THE SECOND DISPATCH, WHICH IS WHERE THE FIRST RUN STOPPED.
//
// With the branch borrowed, a cast of ours walks every stack on the field and
// the filter spares the undead — and every living stack takes ZERO. The reason
// is one function earlier than the damage: `0xB7CE70` is "what is this spell
// worth at this power", asked ONCE before the loop, and it is a switch on the
// number too:
//
//   edi = normalise(spellId)
//   cmp edi,117h  /  je 0xB7CED1                    ; the ones that hurt
//   lea eax,[edi-1] / cmp eax,0EEh / ja 0xB7CEBD    ; out of range
//   jmp [table]                                     ; 21 in, 218 out
//   …
//   0xB7CEBD:  xor esi,esi                          ; a spell I do not know
//   0xB7CED1:  ecx = the id ; push the power ; call 0xAD4EC0   ; READ THE RECORD
//
// Twenty-one spells reach `0xB7CED1` — the nine destructive ones, Armageddon,
// Plague, both Words, the mines, the wasps and a handful of creature abilities.
// Everything else gets a hard zero, and that is the entire reason a spell of
// ours did nothing after the branch worked: it had no damage to do.
//
// So the same trick again, at the same kind of place: for our ids, take the
// branch that reads the record. `0xAD4EC0` is generic — it is handed the id and
// the power and reads `<damage>` out of the loaded document, four entries by
// mastery — so from there on the numbers are the ones the editor wrote.
//
// Safe to arrive by a jump: nothing between the comparison and that branch
// pushes, so the frame `mov edx,[esp+14h]` reads is the frame it expects.

/** `cmp edi,117h` — edi IS the spell id, and the switch is about to use it. */
#define DAMAGE_LOOKUP_RVA 0x77ce8au
#define DAMAGE_LOOKUP_LEN 6
static const BYTE DAMAGE_LOOKUP_HEAD[DAMAGE_LOOKUP_LEN] = {
  0x81, 0xFF, 0x17, 0x01, 0x00, 0x00
};

/** `mov edx,[esp+14h]` / `mov ecx,edi` — the branch that reads the record. */
#define DAMAGE_FROM_RECORD_RVA 0x77ced1u
#define DAMAGE_FROM_RECORD_MARK_LEN 6
static const BYTE DAMAGE_FROM_RECORD_MARK[DAMAGE_FROM_RECORD_MARK_LEN] = {
  0x8B, 0x54, 0x24, 0x14, 0x8B, 0xCF
};

/** Says what was asked about, so a zero has somewhere to be blamed. */
static void __cdecl on_spell_power(int spell) {
  if (spell >= FIRST_SPELL_OF_OURS) log_num("what is it worth? spell id ", spell);
}

#define POWER_STUB_LEN 37
static BYTE POWER_STUB[POWER_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0x57,                                     // push edi        — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call on_spell_power
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x81, 0xFF, 0x61, 0x01, 0x00, 0x00,       // cmp edi,161h    — 353, the first of ours
  0x72, 0x05,                               // jb +5           — the game's own, carry on
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <read the record>
  0x81, 0xFF, 0x17, 0x01, 0x00, 0x00,       // cmp edi,117h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE POWER_TO_STUB[DAMAGE_LOOKUP_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_spell_power(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *branch = base + DAMAGE_FROM_RECORD_RVA;
  for (int i = 0; i < DAMAGE_FROM_RECORD_MARK_LEN; i++) {
    if (branch[i] == DAMAGE_FROM_RECORD_MARK[i]) continue;
    log_line("the branch that reads a spell's damage is not where we left it - ours will do nothing");
    return;
  }
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, POWER_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("spell power: no memory for the stub"); return; }
  for (int i = 0; i < POWER_STUB_LEN; i++) stub[i] = POWER_STUB[i];
  *(DWORD *)(stub + 4) = (DWORD)(void *)on_spell_power - (DWORD)(stub + 8);
  *(DWORD *)(stub + 22) = (DWORD)branch - (DWORD)(stub + 26);
  *(DWORD *)(stub + 33) =
      (DWORD)(base + DAMAGE_LOOKUP_RVA + DAMAGE_LOOKUP_LEN) - (DWORD)(stub + POWER_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, POWER_STUB_LEN);

  *(DWORD *)(POWER_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + DAMAGE_LOOKUP_RVA) + 5);
  if (overwrite_code(DAMAGE_LOOKUP_RVA, DAMAGE_LOOKUP_HEAD, POWER_TO_STUB, DAMAGE_LOOKUP_LEN,
                     "the spell's own damage")) {
    log_line("a spell of ours is worth what its document says");
  }
}
