// A spell's DOCUMENT: how the engine gets from an id to one, and the two places
// it forgets to check that it got anything.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// WHY THIS IS ITS OWN FILE. Everything a spell of ours HAS — school, level,
// mana, the four damage entries, `IsAimed`, `IsAreaAttack`, the element — is
// read out of the loaded document, and the engine reads it the same way for
// every id, ours included. That is the half that needs no code at all, and it is
// worth keeping apart from the half that does (combat/spell-switches.c, the
// switches compiled against ids the executable was built with).
//
// The two hooks here are not features. They are a GUARD and a PROBE, both bought
// with crashes:
//
//   [record]  the table getter range-checks nothing, so one caller handing it a
//             number that is not an id reads off the end. Ours answers NULL, the
//             way an empty slot answers, and prints who asked.
//   [text]    "give me this spell's text" does not check that the record exists
//             either — `lea ecx,[eax+44h]` follows the call — so a NULL becomes
//             the address 0x44 and the copy after it is the crash.
//
// Neither is a fix: both turn a crash into a line in the log, and the line names
// the caller so the real cause stays findable. See docs/engineInternals/SPELLS.md.

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
  // The per-ask half of this probe, COMMENTED OUT rather than deleted — the
  // question it answered ("is +0x44 a readable string") is answered, and what
  // remains below is the SUBSTITUTION, which is a fix and stays. Uncomment these
  // two and the three field words below to watch every ask again.
  // log_num("[text] asked for the text of spell id ", spell);
  // log_hex("   asked from ", (DWORD)(INT_PTR)__builtin_return_address(0));
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
    // The three words on EVERY ask, off with the two lines above. What is left
    // in this block only speaks when the string is broken, which is an event.
    // log_hex("   +0x44 begin    ", field[0]);
    // log_hex("   +0x44 end      ", field[1]);
    // log_hex("   +0x44 capacity ", field[2]);
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
  DWORD from = (DWORD)(INT_PTR)__builtin_return_address(0);
  // EVERY ask, and it is COMMENTED OUT rather than deleted — switch it back on
  // by uncommenting these two lines.
  //
  // What it was for: the run-up to a bad id. Who asks about what, in what order,
  // just before the number stops being a number. That question is still open.
  //
  // WHY IT IS OFF. "A log that has to be switched on says nothing on the run
  // that mattered" is the rule here and it is right — but it is about EVENTS.
  // This prints a QUESTION, and the engine asks this one constantly: 125 946 of
  // one run's 293 547 lines were these, about 86% of the file once each ask's
  // second line is counted, against 4 465 for the gate and 827 for the damage.
  // The file reached 147 MB and the game started dying on it, which is a probe
  // that stops the run it was meant to watch.
  //
  // The BAD id below still prints everything, because that is an event.
  // log_num("[record] id ", spell);
  // log_hex("      asked from ", from);

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

/**
 * The two accessors, found once and shared by everything below and after.
 *
 * CALLED, never hooked: this is the engine answering about its own data, so it
 * is asked the way the engine asks — and the bytes at each head are checked
 * first, since an address of ours that has gone stale would be read as a spell
 * the game does not have.
 *
 * Runs BEFORE the guard, because the guard patches the getter's head and would
 * then refuse to recognise it.
 */
static void install_spell_record(void) {
  BYTE *record = (BYTE *)GetModuleHandleW(NULL) + SPELL_RECORD_RVA;
  if (record[0] == 0x56 && record[1] == 0x8B) g_spellRecord = (SpellRecordFn)record;
  else log_line("the spell record accessor is not where we left it");
  g_spellElement = (SpellElementFn)engine_code(SPELL_ELEMENT_RVA, SPELL_ELEMENT_HEAD,
                                               SPELL_ELEMENT_HEAD_LEN, "the spell's element");
}
