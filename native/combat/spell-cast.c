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
// WHAT THIS FILE DOES, and what it no longer does. It WATCHES a cast — the gate,
// the command, the record, the text, the damage — and it teaches four of the
// engine's switches about ids they were never compiled against. What a spell of
// ours actually DOES lives one file along, in combat/spell-resolve.c, which
// carries the dispatch itself.
//
// It used to live here, as a jump into the middle of a shipped spell's branch,
// and that is what spell-resolve.c exists to undo. Nothing in this file borrows
// a branch any more.
//
// HOW THE LINES IN THE LOG ARE NAMED, and why it is worth a paragraph.
//
// Every line below opens with the HOOK it came from, in brackets, and never with
// what a person did. That rule was bought: the lines used to open with "cast",
// and a log full of them was read — by the author of this file — as a player
// casting eleven spells in a row. What had actually happened was the engine
// walking a hero's whole school, level by level, asking the gate about each; the
// only click in the session was opening the book.
//
//   [gate]         may this be cast — asked from the book, by the AI weighing a
//                  move, by a tooltip, and again inside a real cast. Says which.
//   [cast command] CCastCombatSpellCmd::Execute ran. A command exists.
//   [resolver]     the dispatch that picks what a spell DOES was reached.
//                  Printed by spell-resolve.c, which now owns that dispatch.
//   [worth]        the damage lookup asked what this spell is worth.
//   [damage]       the per-stack damage function ran, once per target.
//   [record]       somebody asked the table for a spell's document.
//   [text]         somebody asked for a spell's text.
//
// NONE of them, on its own, means somebody pressed anything: a walk of a school
// reaches [gate] and [resolver] without a click, and one cast reaches [damage]
// once per stack on the field. Read the sequence, not a single line — and if a
// new hook is added here, give it a tag of its own rather than borrowing one.

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

/**
 * `SpellRecord(id)` — the engine's own way from an id to the loaded document.
 *
 * One array indexed by the id, sixteen bytes a slot, and a null when the slot
 * holds nothing. Worth asking ourselves rather than inferring: if this comes
 * back null for our id then the game never loaded the document, and everything
 * downstream is explained at once. The three fields below are the ones the gate,
 * its neighbours and our own resolver read out of it.
 */
#define SPELL_RECORD_RVA 0x71eed0u
#define SPELL_RECORD_SCHOOL 0x88u
#define SPELL_RECORD_AIMED 0xCCu
#define SPELL_RECORD_AREA 0xCDu

typedef void *(__fastcall *SpellRecordFn)(int spell);
static SpellRecordFn g_spellRecord = NULL;

/**
 * `SpellElement(id)` — the engine's own answer to "what element is this".
 *
 * Worth asking rather than reading the record ourselves, because it is the
 * WHOLE question: it normalises the id, fetches the record, returns 0 unless
 * `DamageIsElemental` is set, and only then gives `Element`. Twenty-two places
 * in the executable ask it and none of them looks at a spell's number — the
 * elemental protections, the three Master perks, the burn a Master of Fire
 * leaves. So what this answers for a spell of ours is exactly what every one of
 * them will act on.
 *
 * 0 none, 1 air, 2 fire, 3 water, 4 earth.
 */
#define SPELL_ELEMENT_RVA 0x6d4e50u
#define SPELL_ELEMENT_HEAD_LEN 3
static const BYTE SPELL_ELEMENT_HEAD[SPELL_ELEMENT_HEAD_LEN] = {
  0x56, 0x8B, 0xF1                                            // push esi / mov esi,ecx
};
typedef int(__fastcall *SpellElementFn)(int spell);
static SpellElementFn g_spellElement = NULL;

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
  // ASKED, not read off the record: this is the one question every elemental
  // rule in the game goes through — the protections, the three Master perks,
  // the burn a Master of Fire leaves — so its answer is what all of them act
  // on. Zero means "not elemental", which is also what a record whose
  // `DamageIsElemental` is false gives.
  if (g_spellElement) log_num("   element the engine sees ", g_spellElement(spell));
}

/**
 * A piece of the engine's own code, if its bytes are still the ones we mapped.
 *
 * Checked before anything is written or called, and refused rather than guessed
 * at: an address of ours that has gone stale would send a cast into the middle
 * of some other instruction, and the crash would land in a battle instead of
 * here. Something we cannot recognise costs a spell of ours its effect and costs
 * the game nothing, which is the right way round.
 *
 * Used for FUNCTION HEADS almost everywhere — that is the kind of engine code we
 * are allowed to reach for. See combat/spell-resolve.c for where the line falls.
 */
static BYTE *engine_code(DWORD rva, const BYTE *mark, int len, const char *what) {
  BYTE *at = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < len; i++) {
    if (at[i] == mark[i]) continue;
    log_text("not where we left it - what needs it will do nothing: ", what);
    return NULL;
  }
  return at;
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
  if (spell >= FIRST_SPELL_OF_OURS) log_num("[cast command] OURS, spell id ", spell);
  else log_num("[cast command] the game's own, spell id ", spell);
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
  // Every verdict, every time, ours and the game's alike — the budget that used
  // to stand here is gone and the comment that described it went with it.
  {
    // WHERE THE QUESTION CAME FROM. In a battle the book asks this same routine
    // before anything is pressed, so a verdict from the book and a verdict
    // during a cast are different events and are named apart.
    //
    // THE ADVENTURE MAP'S BOOK DOES NOT COME THROUGH HERE — measured 07.08.2026:
    // a run in which the book was opened on the map, on a hero holding a spell
    // of ours, logged not one line of this. Whatever greys a page out there is
    // another gate, and it is not found yet.
    // "no command" is the honest name for the second one: the book asks it, so
    // does the AI weighing a move and so does a tooltip, and this hook cannot
    // tell those apart. It used to say "from the book", which reads like a
    // person opened one.
    log_line(g_inCastCommand ? "[gate] inside a cast command" : "[gate] no command — the book, the AI or a tooltip");
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
  g_spellElement = (SpellElementFn)engine_code(SPELL_ELEMENT_RVA, SPELL_ELEMENT_HEAD,
                                                 SPELL_ELEMENT_HEAD_LEN, "the spell's element");
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
  // EVERY call, and the block it read the number out of.
  //
  // A run in which the player cast Unholy Word — the game's own, number 21 —
  // had this hook claim 171 hits for 353, ours, and no `[resolver] OURS` beside
  // any of them. So either `+4` is not the spell here, or the number is real and
  // arrives by a road the dispatch never sees. The block's first words and the
  // caller's address tell those apart, and nothing else will.
  log_num("[damage] one target, the block says spell id ", spell);
  log_hex("   asked from ", (DWORD)(INT_PTR)__builtin_return_address(0));
  log_hex("   the block  ", (DWORD)(INT_PTR)block);
  if (readable_bytes(block, 16) >= 16) {
    DWORD *w = (DWORD *)block;
    log_hex("   block+0x00 ", w[0]);
    log_hex("   block+0x04 ", w[1]);
    log_hex("   block+0x08 ", w[2]);
    log_hex("   block+0x0C ", w[3]);
  }
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

// ---------------------------------------------------------------------------
// A PROBE: WHOSE TEXT IS BROKEN.
//
// A cast of the ripple finished — eight stacks, twenty each, the command
// returned 1 — and the game then died copying a string, inside `0x4E08C4`,
// reached from `0xAD5140`:
//
//   0xad5140  push esi / mov esi,ecx / mov ecx,edx      ; out, spell id
//   0xad5145  call 0xB1EED0                             ; the record
//   0xad514a  lea ecx,[eax+44h]                         ; a field of it
//   0xad514d  call 0x956620                             ; make a string of it
//   0xad5155  call 0x4DC9B0                             ; assign it to out
//
// Thirty-nine places call it, so it is the engine's ordinary "give me this
// spell's text". Which field `+0x44` is has NOT been measured — the layout says
// it should land inside the third file-ref, the icon, but a layout worked out
// from two known offsets is a guess and this probe is here to replace it.
//
// It prints the id, then the three words at `+0x44` — a std::string is
// begin/end/capacity, so a first word that points at nothing readable IS the
// crash, one call before it happens. Not rationed, like everything else here.
#define SPELL_TEXT_RVA 0x6d5140u
#define SPELL_TEXT_HEAD_LEN 5
static const BYTE SPELL_TEXT_HEAD[SPELL_TEXT_HEAD_LEN] = {
  0x56, 0x8B, 0xF1, 0x8B, 0xCA                                // push esi/mov esi,ecx/mov ecx,edx
};
#define SPELL_TEXT_FIELD 0x44u

typedef void *(__fastcall *SpellTextFn)(void *out, int spell);
static SpellTextFn g_spellText = NULL;

/**
 * A spell that certainly has a record, for when the one asked about has none.
 *
 * `SPELL_NONE` is 0 and its slot in the table is EMPTY, so it would land in the
 * same hole; 1 is Magic Arrow, which every installation has.
 */
#define A_SPELL_THAT_EXISTS 1

static void *__fastcall on_spell_text(void *out, int spell) {
  log_num("[text] asked for the text of spell id ", spell);
  log_hex("   asked from ", (DWORD)(INT_PTR)__builtin_return_address(0));
  void *record = g_spellRecord ? g_spellRecord(spell) : NULL;
  if (!record) {
    // TWO WRONG ANSWERS BEFORE THIS ONE, both measured, both worth keeping:
    //
    // 1. Let it through. `0xAD5140` never checks the record — `lea ecx,[eax+44h]`
    //    comes straight after the call — so a NULL becomes the address 0x44 and
    //    the copy dies with esi = 0x44. That was the register in the run.
    // 2. Return `out` untouched. The caller does NOT always construct the string
    //    first, so it went on to destroy one that was never made and died in
    //    the allocator instead. One crash traded for another, four frames later.
    //
    // So the engine still builds the string, through its own code, off a spell
    // that certainly exists. The text is the wrong one — and a wrong word in a
    // combat log line is a cost worth paying for a battle that finishes.
    log_num("   NO record for it - building the string off spell id ", A_SPELL_THAT_EXISTS);
    return g_spellText(out, A_SPELL_THAT_EXISTS);
  }
  if (readable_bytes(record, SPELL_TEXT_FIELD + 12) < SPELL_TEXT_FIELD + 12) {
    log_line("   the record does not read that far");
  } else {
    DWORD *field = (DWORD *)((BYTE *)record + SPELL_TEXT_FIELD);
    log_hex("   +0x44 begin    ", field[0]);
    log_hex("   +0x44 end      ", field[1]);
    log_hex("   +0x44 capacity ", field[2]);
    if (!field[0]) log_line("   begin is null");
    else if (readable_bytes((void *)(INT_PTR)field[0], 1) < 1)
      log_line("   BEGIN POINTS AT NOTHING READABLE - the copy after this is the crash");
    else if (field[1] < field[0])
      log_line("   END IS BEFORE BEGIN - the length below zero is the crash");
  }
  return g_spellText(out, spell);
}

static void install_spell_text_probe(void) {
  g_spellText = (SpellTextFn)detour(SPELL_TEXT_RVA, SPELL_TEXT_HEAD, SPELL_TEXT_HEAD_LEN,
                                    (void *)on_spell_text, "a spell's text");
  if (g_spellText) log_line("every ask for a spell's text will show the field it reads");
}

// ---------------------------------------------------------------------------
// A GUARD ON THE RECORD GETTER, AND WHY IT IS ALSO THE PROBE.
//
// `0xB1EED0` trusts what it is handed — it multiplies the id by sixteen, adds
// the table and reads. No range check anywhere in it:
//
//   push esi / mov esi,[1205AB8h] / shl ecx,4 / add esi,ecx / cmp [esi+0Ch],0
//
// The engine's own callers bound-check first (the artifact table's getter is
// documented the same way, ARTIFACTS_AND_EQUIPMENT.md). `isSpell` at `0xAD45B0`
// does NOT: it calls straight in and only tests the pointer that comes back.
// So one caller anywhere handing it a number that is not an id walks off the
// table — which is the crash we keep landing on, with `ecx` holding a code
// address and the read a page past everything.
//
// This answers the same way an in-range slot with nothing in it answers: NULL.
// Every caller already tests for that — `test eax,eax / je` is the line after
// the call in all of them — so nothing downstream learns a new case.
//
// AND IT NAMES THE CULPRIT. The line prints the return address, so the caller
// that invented the number is in the log rather than inferred from a stack
// dump. That is the whole reason this is a detour and not a jump over the
// crash: a guard that only prevented would leave the question open.
//
// The count comes from the accessor beside it, `0xB1EEC0` — the one the
// table-limit patcher edits — so the guard moves with the table instead of
// carrying a number of its own.
#define SPELL_COUNT_RVA 0x71eec0u
typedef int(__cdecl *SpellCountFn)(void);
static SpellCountFn g_spellCount = NULL;

// The head names an ABSOLUTE address, and the game does not always get its
// preferred base — this run loaded at 0x003b0000, so the loader had rewritten
// the operand and the first attempt at this guard refused a head that was
// perfectly correct. The four operand bytes are the loader's business; `skip`
// says so, and the trampoline copies whatever is actually there.
#define SPELL_RECORD_HEAD_LEN 7
static const BYTE SPELL_RECORD_HEAD[SPELL_RECORD_HEAD_LEN] = {
  0x56,                                                       // push esi
  0x8B, 0x35, 0xB8, 0x5A, 0x20, 0x01                          // mov esi,[1205AB8h]
};
static const BYTE SPELL_RECORD_SKIP[SPELL_RECORD_HEAD_LEN] = { 0, 0, 0, 1, 1, 1, 1 };
static SpellRecordFn g_recordInner = NULL;

/**
 * The neighbourhood, not just the spot.
 *
 * `faults.c` has a walker like this, but it is included AFTER this file in the
 * one translation unit, so it is not visible here — and a run that reaches this
 * point has not faulted, which is the whole idea: the stack is printed while it
 * still means something, one call BEFORE the read that would end the process.
 * Every word that looks like code, from the top down, is a caller in order.
 */
#define RECORD_STACK_WORDS 48

static void log_record_stack(const BYTE *from) {
  for (int i = 0; i < RECORD_STACK_WORDS; i++) {
    const DWORD *at = (const DWORD *)(from + i * 4);
    if (readable_bytes(at, 4) < 4) return;
    DWORD word = *at;
    if (!points_at_code((void *)(INT_PTR)word)) continue;
    log_hex("      a caller above us ", word);
  }
}

static void *__fastcall on_spell_record(int spell) {
  // EVERY ask, not only the wrong ones. What the last run could not answer is
  // what the run-up looks like — who asks about what, in what order, just before
  // the number stops being a number. One line each, and the file is cheap.
  DWORD from = (DWORD)(INT_PTR)__builtin_return_address(0);
  log_num("[record] id ", spell);
  log_hex("      asked from ", from);

  int count = g_spellCount ? g_spellCount() : 0;
  if (count > 0 && (spell < 0 || spell >= count)) {
    log_line("[record] THAT IS NOT A SPELL ID - here is everything around it");
    log_hex("      the number, in hex ", (DWORD)spell);
    log_num("      the table holds    ", count);
    log_hex("      asked from         ", from);
    log_record_stack((const BYTE *)&spell);
    log_line("      answering NULL, the way an empty slot answers - prevented, not fixed");
    return NULL;
  }
  return g_recordInner(spell);
}

static void install_spell_record_guard(void) {
  BYTE *count = (BYTE *)GetModuleHandleW(NULL) + SPELL_COUNT_RVA;
  if (count[0] == 0xB8 && count[5] == 0xC3) g_spellCount = (SpellCountFn)count;
  else { log_line("the spell count accessor is not where we left it - no guard on the record getter"); return; }
  log_num("the spell table holds ", g_spellCount());
  g_recordInner = (SpellRecordFn)detour_relocated(SPELL_RECORD_RVA, SPELL_RECORD_HEAD,
                                                  SPELL_RECORD_SKIP, SPELL_RECORD_HEAD_LEN,
                                                  (void *)on_spell_record, "the spell record getter");
  if (g_recordInner) {
    // Everything that used the raw address now goes through the guard too: the
    // head is patched, so a call to the old address arrives here anyway. Said
    // out loud because the variable's name no longer tells the truth.
    log_line("an id that is not one will be refused instead of read off the end");
  }
}

// ---------------------------------------------------------------------------
// AND THE SECOND DISPATCH, WHICH IS WHERE THE FIRST RUN STOPPED.
//
// A cast of ours walked every stack on the field and the filter spared the
// undead — and every living stack took ZERO. The reason is one function earlier
// than the damage: `0xB7CE70` is "what is this spell worth at this power", and
// it is a switch on the number too:
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
// ours did nothing even once the field was walked: it had no damage to do.
//
// So for our ids the comparison sends the function to the case that READS THE
// DOCUMENT. `0xAD4EC0` is generic — it is handed the id, the mastery and the
// spell power and reads `<damage>` out of the loaded document, four entries by
// mastery — so from there on the numbers are the ones the editor wrote.
//
// AND THIS IS THE ONE PLACE LEFT WHERE WE ENTER A FUNCTION PART-WAY, so it is
// written down with what it costs (see combat/spell-resolve.c for the rule).
// `0xB7CED1` is not a spell's branch — it is this switch's document-reading
// default, shared by twenty-one ids, and none of its instructions belongs to
// Armageddon or to either Word. The alternative is to write our own epilogue for
// somebody else's function, which buys nothing and can be wrong. What it costs:
// if a future build moves that case, every spell of ours is worth zero — which
// the byte check turns into a refusal and a line in the log, not a crash.
//
// Safe to arrive by a jump: nothing between the comparison and that case pushes,
// so the frame `mov edx,[esp+14h]` reads is the frame it expects.

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
  if (spell >= FIRST_SPELL_OF_OURS) log_num("[worth] what is it worth? spell id ", spell);
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

// ---------------------------------------------------------------------------
// AND THE THIRD DISPATCH: WHICH TILES AN AREA COVERS.
//
// Setting `IsAreaAttack` says a spell hits an area. It does not say WHAT area,
// and the document has no field that does — twenty-two fields and not one is a
// radius. The shape is decided by `CCombatSpell::TilesCovered` (0xB7BE30), and
// it is a switch on the number like the other two:
//
//   edi = normalise(spellId)
//   if (!IsAreaAttack(edi) && !isMassSpell(edi)) return {}   ; nothing to cover
//   cmp edi,11Ah / … / jmp [eax*4+0xB7C67C]                  ; the shape
//   …
//   0xB7C59A:  if (!isMassSpell(edi)) return {}              ; the default
//
// Every area spell has a case of its own — Fireball, Frost Ring, Stone Spikes,
// Meteor Shower, the Firewall, the death cloud, the scatter shot — and 221 ids
// share a default that is only for the MASS spells and answers with NOTHING for
// anything else. (`isMassSpell` is 0xAD40C0, and it is exactly the twelve ids
// 210…221 mapped back to the spell they are the mass version of.)
//
// So a spell of ours with the flag set gets into this function and out of it
// with an empty list: it would have asked where to aim and then hit nothing at
// all. The flag is the door, not the shape.
//
// WHAT WE DO INSTEAD OF BORROWING ONE. The engine does not keep a menu of
// shapes: it builds the list by pushing one tile at a time, and each of its
// cases is only a different loop around that one call. So ours is a loop over
// the offsets the mod wrote, and a spell of ours may cover anything.
//
// The offsets are plain (dx, dy) because the combat grid is SQUARE — the
// engine's own "adjacent tiles" table is the eight offsets of a 3×3 block, so a
// fireball is a 3×3 and none of this needs a word about hexes.
//
// ONLY AN AREA SPELL OF OURS GETS HERE. The whole-field and the one-stack shapes
// both have `IsAreaAttack` false and neither is a mass spell, so the early exit
// above turns them away before the switch. That is why this stub asks about the
// number and nothing else.

/** `cmp edi,11Ah` — edi is the spell id, and the shape switch is about to use it. */
#define AREA_SHAPE_RVA 0x77be7fu
#define AREA_SHAPE_LEN 6
static const BYTE AREA_SHAPE_HEAD[AREA_SHAPE_LEN] = {
  0x81, 0xFF, 0x1A, 0x01, 0x00, 0x00
};

/**
 * `vector<Point>::push_back` — how the engine adds ONE tile to the list.
 *
 * Every shape it has is only a different loop around this call: the default is
 * a 4×4 block, a fireball is the point plus the eight around it, a frost ring is
 * those eight without the point. So a shape of ours is our own loop, and no menu
 * of the engine's limits what a spell of ours may cover.
 *
 * A Point is two ints and the container is a plain vector — `sar ecx,3` on the
 * capacity is the whole proof of the element size.
 */
#define ADD_TILE_RVA 0x184970u
#define ADD_TILE_HEAD_LEN 6
static const BYTE ADD_TILE_HEAD[ADD_TILE_HEAD_LEN] = {
  0x83, 0xEC, 0x08, 0x53, 0x55, 0x8B                          // sub esp,8 / push ebx / push ebp
};
typedef void(__thiscall *AddTileFn)(void *tiles, const int *point);
static AddTileFn g_addTile = NULL;

/** `push [esp+14h]` — where the engine goes once the tiles are collected. */
#define TILES_DONE_RVA 0x77c19bu
#define TILES_DONE_MARK_LEN 8
static const BYTE TILES_DONE_MARK[TILES_DONE_MARK_LEN] = {
  0xFF, 0x74, 0x24, 0x14, 0x8B, 0x06, 0x8B, 0xCE
};

/**
 * The tiles a spell of ours covers: its own row, or the engine's own shape.
 *
 * A row with no offsets falls through to nothing here and the stub sends the
 * cast to the tail with an empty list — which is what a spell that says it hits
 * an area and does not say where would do anyway. The mod is expected to say.
 */
/** Set by the C, read by the stub after its `popad` — `al` does not survive that. */
static BYTE g_tilesWereOurs = 0;

/** Non-zero when the mod said which tiles this spell covers, and they were laid. */
static char __cdecl our_tiles(int spell, void *tiles, int x, int y) {
  SpellRow *row = spell_row(spell);
  if (!row || !row->areaCount || !g_addTile) return 0;
  for (int i = 0; i < row->areaCount; i++) {
    int point[2] = { x + row->areaX[i], y + row->areaY[i] };
    g_addTile(tiles, point);
  }
  return 1;
}

/**
 * The stub: our ids collect their own tiles and join the engine at the tail.
 *
 * `edi` is the spell id, `ebx` the list being filled and `[ebp+0Ch]`/`[ebp+10h]`
 * the point aimed at — all three set before the switch, so the arguments are
 * read straight off the frame. Registers and flags go back untouched, because
 * the tail reads `esi` and `ebx` exactly as the shipped cases leave them.
 */
#define AREA_STUB_LEN 50
static BYTE AREA_STUB[AREA_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0xFF, 0x75, 0x10,                         // push dword ptr [ebp+10h]   — y
  0xFF, 0x75, 0x0C,                         // push dword ptr [ebp+0Ch]   — x
  0x53,                                     // push ebx                   — the list
  0x57,                                     // push edi                   — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call our_tiles  — 0 if nothing was said
  0x83, 0xC4, 0x10,                         // add esp,16
  0xA2, 0x00, 0x00, 0x00, 0x00,             // mov [g_tilesWereOurs],al
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x80, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // cmp byte ptr [g_tilesWereOurs],0
  0x74, 0x05,                               // je +5           — the game's own shape
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the tail>
  0x81, 0xFF, 0x1A, 0x01, 0x00, 0x00,       // cmp edi,11Ah    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE AREA_TO_STUB[AREA_SHAPE_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_area_shape(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *tail = engine_code(TILES_DONE_RVA, TILES_DONE_MARK, TILES_DONE_MARK_LEN,
                             "the tail an area spell joins");
  BYTE *add = engine_code(ADD_TILE_RVA, ADD_TILE_HEAD, ADD_TILE_HEAD_LEN,
                            "adding one tile to the list");
  if (!tail || !add) return;
  g_addTile = (AddTileFn)add;

  BYTE *stub = (BYTE *)VirtualAlloc(NULL, AREA_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("area shape: no memory for the stub"); return; }
  for (int i = 0; i < AREA_STUB_LEN; i++) stub[i] = AREA_STUB[i];
  // No log anywhere here, deliberately: the interface asks this routine for every
  // tile the cursor crosses while an area spell is armed, so a line each would
  // bury the cast it belongs to. What shape a cast used is said once, at the cast.
  *(DWORD *)(stub + 11) = (DWORD)(void *)our_tiles - (DWORD)(stub + 15);
  *(DWORD *)(stub + 19) = (DWORD)(void *)&g_tilesWereOurs;
  *(DWORD *)(stub + 27) = (DWORD)(void *)&g_tilesWereOurs;
  *(DWORD *)(stub + 35) = (DWORD)tail - (DWORD)(stub + 39);
  *(DWORD *)(stub + 46) =
      (DWORD)(base + AREA_SHAPE_RVA + AREA_SHAPE_LEN) - (DWORD)(stub + AREA_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, AREA_STUB_LEN);

  *(DWORD *)(AREA_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + AREA_SHAPE_RVA) + 5);
  if (overwrite_code(AREA_SHAPE_RVA, AREA_SHAPE_HEAD, AREA_TO_STUB, AREA_SHAPE_LEN,
                     "the tiles an area spell covers")) {
    log_line("an area spell of ours covers the tiles its row names");
  }
}

// ---------------------------------------------------------------------------
// AND THE FOURTH: "DOES THIS SPELL DEAL DAMAGE".
//
// The fire Armageddon of ours has ELEMENT_FIRE in its document and the engine's
// own accessor reads it — the element is DATA, and every elemental rule in the
// game goes through that one accessor. And a Master of Fire still left no burn
// on what it hit.
//
// The reason is one gate earlier. The block that applies the three Master perks
// (`0xBD3BD0`) asks `0xBD0E80` before it looks at the element at all, and that
// is a switch on the number like the rest:
//
//   eax = normalise(spellId)
//   cmp eax,117h / jg <second table> / je <yes>
//   dec eax / cmp eax,0F7h / ja <no>
//   jmp [eax*4+0BD0EE0h]                       ; 22 spells say yes
//   …
//   0xBD0ED9:  xor al,al ; ret                 ; everything else says no
//
// Twenty-seven ids answer yes and they are exactly the damaging ones — the nine
// destructive spells, Armageddon, both Words, the mines, the wasps, the
// firewalls, the shields that burn, and five more above the range. Ours is not
// among them, so the perk block turns away before the element is asked and no
// burn is left. NINE places ask this question, so it is not the perk's own: it
// is "is this a spell that hurts", and the perks are one reader.
//
// OURS ANSWER YES, and today that is true by construction: our own resolver
// hurts every stack it picks, whichever of the three shapes the record asks for.
// The day a spell of ours puts an EFFECT on a stack instead of damage, the
// resolver will have to tell the two apart — and this answer moves with it, to
// the same question the row will then be answering.

/** `cmp eax,117h` — eax is the normalised spell id, and the switch follows. */
#define DAMAGING_SPELL_RVA 0x7d0e88u
#define DAMAGING_SPELL_LEN 5
static const BYTE DAMAGING_SPELL_HEAD[DAMAGING_SPELL_LEN] = {
  0x3D, 0x17, 0x01, 0x00, 0x00
};

/** `mov al,1` / `pop esi` / `ret` — the answer "yes", and its own way out. */
#define DAMAGING_YES_RVA 0x7d0ebdu
#define DAMAGING_YES_MARK_LEN 4
static const BYTE DAMAGING_YES_MARK[DAMAGING_YES_MARK_LEN] = {
  0xB0, 0x01, 0x5E, 0xC3
};

// No call and no pushad: eax already holds the id, and the displaced `cmp` sets
// the flags the switch below reads. It logged for a while — that is how the
// Master perks' block was found among the nine readers, at 0xBD3BE4 — and the
// line is gone because nine callers ask this constantly and the answer is now
// written down rather than watched.
#define DAMAGING_STUB_LEN 22
static BYTE DAMAGING_STUB[DAMAGING_STUB_LEN] = {
  0x3D, 0x61, 0x01, 0x00, 0x00,             // cmp eax,161h    — 353, the first of ours
  0x72, 0x05,                               // jb +5           — the game's own, carry on
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <yes>
  0x3D, 0x17, 0x01, 0x00, 0x00,             // cmp eax,117h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE DAMAGING_TO_STUB[DAMAGING_SPELL_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00
};

static void install_damaging_spell(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *yes = engine_code(DAMAGING_YES_RVA, DAMAGING_YES_MARK, DAMAGING_YES_MARK_LEN,
                            "a spell that deals damage");
  if (!yes) return;
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, DAMAGING_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("damaging spell: no memory for the stub"); return; }
  for (int i = 0; i < DAMAGING_STUB_LEN; i++) stub[i] = DAMAGING_STUB[i];
  *(DWORD *)(stub + 8) = (DWORD)yes - (DWORD)(stub + 12);
  *(DWORD *)(stub + 18) =
      (DWORD)(base + DAMAGING_SPELL_RVA + DAMAGING_SPELL_LEN) - (DWORD)(stub + DAMAGING_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, DAMAGING_STUB_LEN);

  *(DWORD *)(DAMAGING_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + DAMAGING_SPELL_RVA) + 5);
  if (overwrite_code(DAMAGING_SPELL_RVA, DAMAGING_SPELL_HEAD, DAMAGING_TO_STUB,
                     DAMAGING_SPELL_LEN, "a spell that deals damage")) {
    log_line("a spell of ours counts as one that hurts");
  }
}

// ---------------------------------------------------------------------------
// AND THE FIFTH SWITCH: WHOSE ELEMENT THE DAMAGE IS DEALT IN.
//
// The whole-field routine has FOUR appliers and they are one per element — each
// asks the caster for that element's Master perk:
//
//   0xBD1790  45, Master of Storms — air
//   0xBD1420  44, Master of Fire
//   0xBD12C0  43, Master of Ice — water
//   0xBD1980  nothing at all — the NO-ELEMENT applier
//
// EXCEPT THAT IT DOES NOT CHOOSE BETWEEN FOUR. Only the AREA routine does that;
// this one has a single comparison, `cmp eax,0Ah`, and behind it the fire
// applier and nothing else:
//
//   cmp eax,0Ah / jne → 0xBD1980 for every unit          ; not Armageddon
//   …            → 0xBD1980 for units NEAR the point     ; the local hit
//                → 0xBD1420 for every unit               ; FIRE, unconditionally
//
// So there are two decisions bundled in one comparison — "is the damage
// elemental" and "which element" — and the second was answered by there being
// only one spell to answer it for. Reading it as "the elemental branch" and
// letting anything elemental in sent an ICE spell of ours down the fire path;
// that was a real hole and this is where it is closed.
//
// WHAT WE DO. ONE change, and it is not a case for a spell: the comparison
// becomes `SpellElement(id) == fire` — the question `cmp eax,0Ah` was a shortcut
// for, asked of the document instead of of the number. The `call 0xBD1420`
// behind it is left exactly as the game wrote it.
//
// AND WHY ONLY FIRE, which took a second reading to get right. The site pushes
// FOUR arguments, and the four appliers do not agree on how many they take —
// their `ret`s are 10h (fire), 14h (air) and 18h (water). An earlier version of
// this made the call indirect and pointed it at whichever applier the element
// named, which for water or air would have returned with the stack four or eight
// bytes short — a crash somewhere else entirely, and one that would never have
// been traced back to here. It never fired, because the only elemental spell
// that reaches this routine is Armageddon and Armageddon is fire. A spell of
// OURS does not come through here at all any more: it is resolved in
// combat/spell-resolve.c, which picks its own applier and calls it with its own
// argument list.
//
// ARMAGEDDON IS UNTOUCHED by both: its element is fire, so it takes the same
// branch to the same applier, and its own near-point hit is not in the way. Nor
// does that hit reach a spell of ours with anything: its amount is decided at
// `0xD60E29`, where a `cmp ecx,0Ah` gives everything but Armageddon a zero, and
// `0xBD1980` bails on a zero in its first two instructions.
//
// AND THE SITE IS SHARED. It is the third of the three
// `native/qol/fix-empowered-armageddon.c` documents, and asking the record
// answers that one too: the accessor normalises the empowered Armageddon (232)
// to 10 and finds it elemental, so that site is not a case anybody adds — it
// falls out of asking properly, and so will any elemental whole-field spell the
// game is ever given.
//
// BEHIND ITS OWN FLAG, WHOLE. `mass-spell-element-fix` decides whether any of
// this is written at all — not a branch inside it. With the flag off not a byte
// moves and the game is the game, ours included; with it on the question is the
// document's, for every spell alike and with no number compared anywhere.

/** `mov eax,[esi+4] / cmp eax,0Ah / jne` — which element the damage is dealt in. */
#define WHOLE_FIELD_ELEMENT_RVA 0x9610b7u
#define WHOLE_FIELD_ELEMENT_LEN 12
static const BYTE WHOLE_FIELD_ELEMENT_HEAD[WHOLE_FIELD_ELEMENT_LEN] = {
  0x8B, 0x46, 0x04, 0x83, 0xF8, 0x0A, 0x0F, 0x85, 0xBC, 0x00, 0x00, 0x00
};
/** Its two continuations: elemental, and not. */
#define WHOLE_FIELD_ELEMENTAL_RVA 0x9610c3u
#define WHOLE_FIELD_PLAIN_RVA 0x96117fu

/** Where the stub keeps the answer across its own `popad`. */
static BYTE g_wholeFieldElemental = 0;

/**
 * ONE RULE, FOR EVERY SPELL IN THE GAME: the element comes from the document.
 *
 * No number is asked here, and that is the point. `SpellElement` IS the question
 * `cmp eax,0Ah` was a shortcut for — it normalises the id, reads the record, and
 * answers 0 unless `DamageIsElemental` is set — so asking it directly is asking
 * what the engine already meant, for Armageddon exactly as for a spell of ours.
 *
 * WHY NOT BEHIND A FLAG, when a changed shipped behaviour usually is. Because
 * the change is not a behaviour: it is the same question asked properly, and it
 * moves exactly ONE shipped spell. Only three reach this routine — Armageddon
 * (elemental, fire applier, as before), Holy Word and Unholy Word (both name an
 * element and leave `DamageIsElemental` false, so both answer 0 and take the
 * plain applier, as before). The fourth is the Empowered Armageddon, which the
 * accessor normalises to 10 and finds elemental — and that is the shipped BUG
 * `fix-empowered-armageddon` exists for, not a rule anybody chose.
 *
 * And a spell of ours must not need a fix switched on to have the element its
 * own document gives it. See docs/QOL.md for the line between the two.
 */
static void __cdecl decide_whole_field(int spell) {
  // 2 is fire, and fire is the only answer this site can act on — the `call`
  // behind it is `0xBD1420` and stays so. See the paragraph above for why.
  g_wholeFieldElemental = (BYTE)(g_spellElement && g_spellElement(spell) == 2);
}

#define WHOLE_FIELD_STUB_LEN 34
static BYTE WHOLE_FIELD_STUB[WHOLE_FIELD_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0xFF, 0x76, 0x04,                         // push dword ptr [esi+4]  — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call decide_whole_field
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x80, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // cmp byte ptr [g_wholeFieldElemental],0
  0x74, 0x05,                               // je +5           — not fire
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the fire applier's caller>
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the plain applier's caller>
};

static BYTE WHOLE_FIELD_TO_STUB[WHOLE_FIELD_ELEMENT_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90
};

static void install_whole_field_element(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, WHOLE_FIELD_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("whole-field element: no memory for the stub"); return; }
  for (int i = 0; i < WHOLE_FIELD_STUB_LEN; i++) stub[i] = WHOLE_FIELD_STUB[i];
  *(DWORD *)(stub + 6) = (DWORD)(void *)decide_whole_field - (DWORD)(stub + 10);
  // The answer travels in a byte of ours rather than in a register: `popad`
  // would put the old eax back, so the C writes `g_wholeFieldElemental` itself
  // and the stub reads it after the registers are restored.
  *(DWORD *)(stub + 17) = (DWORD)(void *)&g_wholeFieldElemental;
  *(DWORD *)(stub + 25) = (DWORD)(base + WHOLE_FIELD_ELEMENTAL_RVA) - (DWORD)(stub + 29);
  *(DWORD *)(stub + 30) = (DWORD)(base + WHOLE_FIELD_PLAIN_RVA) - (DWORD)(stub + 34);
  FlushInstructionCache(GetCurrentProcess(), stub, WHOLE_FIELD_STUB_LEN);

  *(DWORD *)(WHOLE_FIELD_TO_STUB + 1) =
      (DWORD)stub - ((DWORD)(base + WHOLE_FIELD_ELEMENT_RVA) + 5);
  if (overwrite_code(WHOLE_FIELD_ELEMENT_RVA, WHOLE_FIELD_ELEMENT_HEAD, WHOLE_FIELD_TO_STUB,
                     WHOLE_FIELD_ELEMENT_LEN, "which element a whole-field spell hits in")) {
    log_line("a whole-field spell hits in the element its record names");
  }
}
