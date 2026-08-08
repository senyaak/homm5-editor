// Every spell cast in a battle, WATCHED: the command a click becomes, the gate
// that may refuse it, the reason the engine gives, and the damage each stack
// takes.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
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
// WHERE THE REST OF A SPELL LIVES. This file is one of four, and the split is by
// subject rather than by what happened to be open:
//
//   combat/spell-record.c    a spell's document, and the two places the engine
//                            forgets to check it got one
//   combat/spell-cast.c      HERE — the command, the gate, the refusal, the
//                            damage one stack takes
//   combat/spell-switches.c  the switches on the NUMBER, taught about our ids
//   combat/spell-resolve.c   what a cast of ours DOES, resolved by us
//
// Nothing in any of them borrows a branch of a shipped spell's. That used to
// live here, and spell-resolve.c exists to have undone it.
//
// HOW THE LINES IN THE LOG ARE NAMED, and why it is worth a paragraph.
//
// Every line opens with the HOOK it came from, in brackets, and never with what
// a person did. That rule was bought: the lines used to open with "cast", and a
// log full of them was read — by the author of this file — as a player casting
// eleven spells in a row. What had actually happened was the engine walking a
// hero's whole school, level by level, asking the gate about each; the only
// click in the session was opening the book.
//
//   [gate]         may this be cast — asked from the book, by the AI weighing a
//                  move, by a tooltip, and again inside a real cast. Says which.
//   [cast command] CCastCombatSpellCmd::Execute ran. A command exists.
//   [damage]       the per-stack damage function ran, once per target.
//   [resolver]     the dispatch that picks what a spell DOES was reached
//                  (spell-resolve.c, which owns it).
//   [worth]        the damage lookup asked what this spell is worth
//                  (spell-switches.c).
//   [record]       somebody asked the table for a spell's document.
//   [text]         somebody asked for a spell's text (both spell-record.c).
//
// NONE of them, on its own, means somebody pressed anything: a walk of a school
// reaches [gate] and [resolver] without a click, and one cast reaches [damage]
// once per stack on the field. Read the sequence, not a single line — and if a
// new hook is added anywhere, give it a tag of its own rather than borrowing one.
//
// NOTHING IS RATIONED, here or in the three beside it. Two runs were lost to a
// budget: the interface asks the gate once per target the pointer crosses, and a
// session holds several battles, so an allowance that looked generous was spent
// before the cast we were watching. A probe that goes quiet exactly when it
// matters is worse than no probe, and the file is cheap. Every cast, every
// verdict, every time — the session's own banner ("--- homm5-editor extension
// loaded") is where one run ends and the next begins.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT combat_spell_cast

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
  if (spell >= FIRST_SPELL_OF_OURS) log_num("[cast command] OURS, spell id ", spell);
  else log_num("[cast command] the game's own, spell id ", spell);
  // WHAT THE COMMAND IS MADE OF — COMMENTED OUT rather than deleted, and worth
  // keeping in the file because of what it bought: ours came in with a caster
  // and no target and returned zero, and the only way to know whether that was
  // the fault was to see what a spell that WORKS brings with it. A comparison of
  // two blocks said in one run what reading the function had not. The fields it
  // named are now written down in docs/engineInternals/SPELLS.md, so this is the
  // way back to them rather than the only record of them.
  //
  // Uncomment the whole block to watch a command's insides again.
  int dump = readable_bytes(self, 0x3C) >= 0x3C;
  // if (dump) {
  //   log_hex("   caster +0x20 ", *(DWORD *)((BYTE *)self + 0x20));
  //   log_hex("   target +0x24 ", *(DWORD *)((BYTE *)self + 0x24));
  //   log_hex("   +0x0C ", *(DWORD *)((BYTE *)self + 0x0C));
  //   log_hex("   +0x14 ", *(DWORD *)((BYTE *)self + 0x14));
  //   log_hex("   +0x18 ", *(DWORD *)((BYTE *)self + 0x18));
  //   log_hex("   +0x28 ", *(DWORD *)((BYTE *)self + 0x28));
  //   log_hex("   +0x30 ", *(DWORD *)((BYTE *)self + 0x30));
  //   log_hex("   +0x38 ", *(DWORD *)((BYTE *)self + 0x38));
  //   // The engine's own liveness test on the caster, done here rather than
  //   // guessed at: Execute reads `[caster+4]`, then `[that+4]` as a
  //   // displacement, and refuses when the int at `caster + displacement + 8` is
  //   // negative. It is the second of the four early exits and the only one we
  //   // cannot see from the block alone.
  //   BYTE *caster = (BYTE *)*(DWORD *)((BYTE *)self + 0x20);
  //   if (readable_bytes(caster, 8) >= 8) {
  //     DWORD *shape = (DWORD *)*(DWORD *)(caster + 4);
  //     DWORD at = readable_bytes(shape, 8) >= 8 ? shape[1] : 0xFFFFFFFFu;
  //     if (at != 0xFFFFFFFFu && readable_bytes(caster + at, 12) >= 12) {
  //       log_num("   the caster's life count ", *(int *)(caster + at + 8));
  //     } else log_line("   the caster's life count cannot be read");
  //   }
  // }
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
  // EVERY verdict of a real cast, and none of the rest.
  //
  // WHERE THE QUESTION CAME FROM. In a battle the book asks this same routine
  // before anything is pressed — and so does the AI weighing a move, and so does
  // a tooltip for every target the pointer crosses. Those are QUESTIONS, and
  // there were 4 465 of them in one battle against 24 casts. A cast is an event
  // and still prints in full.
  //
  // THE ADVENTURE MAP'S BOOK DOES NOT COME THROUGH HERE — measured 07.08.2026:
  // a run in which the book was opened on the map, on a hero holding a spell of
  // ours, logged not one line of this. Whatever greys a page out there is another
  // gate, and it is not found yet.
  //
  // To watch the walk again — which is what found that the gate refuses a spell
  // of ours SILENTLY — drop the `if` and let both cases through.
  if (g_inCastCommand) {
    log_line("[gate] inside a cast command");
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
  // The record and element accessors this reads through are found once, in
  // combat/spell-record.c, and `install_spell_record` has to have run first.
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
  // EVERY call and the block it read the number out of — COMMENTED OUT rather
  // than deleted, because it settled a real question and may have to settle
  // another. Uncomment the block below to watch every call again.
  //
  // WHAT IT SETTLED. A run in which the player cast Unholy Word — the game's
  // own, number 21 — had this hook claim 171 hits for 353, ours. Either `+4`
  // was not the spell here, or the number was real and arrived by a road the
  // dispatch never saw. The block's first words answered it: `block+0x04` IS
  // the id, measured across 11, 12, 13, 14, 15, 18, 19, 21, 278 and 353 in one
  // run. The "we misread the id" theory is dead; do not revive it.
  //
  // WHY IT IS OFF. This fires once per stack per cast and the game's own spells
  // come through it too — 827 calls in one battle, seven lines each. What is
  // left below speaks only for a spell of OURS, which is an event.
  //
  // log_num("[damage] one target, the block says spell id ", spell);
  // log_hex("   asked from ", (DWORD)(INT_PTR)__builtin_return_address(0));
  // log_hex("   the block  ", (DWORD)(INT_PTR)block);
  // if (readable_bytes(block, 16) >= 16) {
  //   DWORD *w = (DWORD *)block;
  //   log_hex("   block+0x00 ", w[0]);
  //   log_hex("   block+0x04 ", w[1]);
  //   log_hex("   block+0x08 ", w[2]);
  //   log_hex("   block+0x0C ", w[3]);
  // }
  if (spell >= FIRST_SPELL_OF_OURS) {
    const SpellRow *row = spell_row(spell);
    log_num("[damage] treated as OURS, spell id ", spell);
    if (!row) log_line("   no filter row - it may touch anything");
    // What the engine ANSWERED, not only when it answered yes. A whole run
    // spared nobody, and a filter that never matches looks exactly like a filter
    // that never ran — so the answer per ability is printed either way.
    for (int i = 0; row && i < row->spareCount; i++) {
      int has = unit_has_ability(target, row->spares[i]);
      log_num("   ability ", row->spares[i]);
      log_num("      the engine answers ", has);
      if (!has) continue;
      log_line("      spared");
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
