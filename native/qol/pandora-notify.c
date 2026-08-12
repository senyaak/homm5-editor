// What the engine says out loud when it hands something over — measured.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_pandora_notify

// ---------------------------------------------------------------------------
// WHAT IS MISSING. A hero who is handed an artifact is told about it; a hero
// taught a spell or given creatures is not. Played, the boxes that gave a
// spell or a stack read as boxes that did nothing at all.
//
// It is not the Lua binding's doing. All three are deferred COMMANDS of the
// world, and the announcement lives in the command:
//
//   CGiveArtefactCmd::execute   0xB2D030, 131 instructions, ends in 0xC16F20
//   CAddHeroSpellCmd::execute   0xB2E820,  22 instructions, announces nothing
//   CGiveCreaturesCmd::execute  0xB2EB10,  93 instructions, announces nothing
//   CRiseCreatureCmd::execute   0xC775B0, 182 instructions — necromancy, and
//                               it announces through 0xC16810 + 0xC16750
//
// (The class names are the executable's own, out of RTTI; the vtable slot is
// +0x1c in each.) There is no Lua door to any of it: the announcement system
// is CAnnouncement/CAnnouncementsHolder and the 306 functions the engine
// exposes to scripts do not include it.
//
// WHY THIS FILE ONLY LOGS, FOR NOW. To announce a spell we have to call what
// the artifact and the necromancer call, with the arguments they pass — and
// those arguments are six and eight dwords of somebody else's structures.
// Guessing them is the same mistake as guessing an arity from a call site:
// it does not fail politely, it takes the game down a few frames later. So
// this hooks the two announcers, writes down what real gains pass through
// them, and the reading is what the calling code is written from.
//
// Nothing here changes what the game does: every hook calls the original with
// the arguments it arrived with.
//
// Build it with logging on, or it does not install at all:
//
//   npm run build-native -- --log qol/pandora-notify

/** The announcer the artifact hands its gain to. `ret 18h` — six stack args. */
#define ANNOUNCE_ONE_RVA 0x816f20u
static const BYTE ANNOUNCE_ONE_HEAD[6] = { 0x83, 0xEC, 0x1C, 0x53, 0x55, 0x56 };

/** The one necromancy uses. `ret 20h` — eight.
 *
 *  Its head reads `push esi / push edi / push [esp+28h]`, and the third of
 *  those is why the whole instruction is copied rather than five bytes of it:
 *  it addresses through ESP, so a trampoline may only run it with the stack
 *  exactly as the function found it. A jmp-based detour leaves it that way. */
#define ANNOUNCE_MANY_RVA 0x816750u
static const BYTE ANNOUNCE_MANY_HEAD[6] = { 0x56, 0x57, 0xFF, 0x74, 0x24, 0x28 };

/** The site inside CGiveArtefactCmd::execute, so its line is recognisable. */
#define ARTEFACT_ANNOUNCE_RVA 0x72d13du
/** And the one inside CRiseCreatureCmd::execute. */
#define RISE_ANNOUNCE_RVA 0x87779eu

static void *g_announce_one_orig;
static void *g_announce_many_orig;

/** The last announcement the artifact command made, kept to be replayed —
 *  see "the experiment the reading cannot settle" at the bottom. */
static DWORD g_seen_this, g_seen_edx, g_seen_args[6];
static int g_seen;
/** Said once: a hero learning six spells should not write six blocks. */
static int g_replayed;

/** Where the game is loaded — never 0x400000 in this build. */
static DWORD game_base(void) { return (DWORD)(INT_PTR)GetModuleHandleW(NULL); }

/** One line per argument, in the order the engine pushed them. */
static void log_args(const char *what, DWORD self, DWORD edx, const DWORD *stack, int count,
                     DWORD from) {
  log_line(what);
  log_hex("  called from  ", from);
  log_hex("  this         ", self);
  log_hex("  edx          ", edx);
  for (int i = 0; i < count; i++) {
    char label[16] = { ' ', ' ', 'a', 'r', 'g', '0', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 0 };
    label[5] = (char)('0' + i);
    log_hex(label, stack[i]);
    // A dword that points at readable memory is worth one level deeper: the
    // announcement's payload is structures, and their first word is what tells
    // one kind from another. `readable` is core/log.c's — a probe that faults
    // is a probe that costs a run (docs/engineInternals/PANDORA_OBJECT.md).
    const DWORD *inner = (const DWORD *)(DWORD_PTR)stack[i];
    if (readable(inner, 4)) log_hex("    -> [0]   ", *inner);
  }
}

static DWORD __fastcall announce_one_probe(DWORD self, DWORD edx,
                                           DWORD a0, DWORD a1, DWORD a2,
                                           DWORD a3, DWORD a4, DWORD a5) {
  DWORD from = (DWORD)(INT_PTR)__builtin_return_address(0);
  DWORD stack[6] = { a0, a1, a2, a3, a4, a5 };
  // WHERE FROM, in RVA. The module does not load at 0x400000 — the first
  // reading came back with return addresses 0x270000 below the disassembly's,
  // because Windows put the image at 0x190000 — so a site is recognised by
  // what it is inside the file, not by an address from a listing.
  DWORD rva = from - game_base();
  log_args(rva == ARTEFACT_ANNOUNCE_RVA
           ? "announce(one): the artifact command" : "announce(one)",
           self, edx, stack, 6, rva);
  if (rva == ARTEFACT_ANNOUNCE_RVA) {
    g_seen_this = self;
    g_seen_edx = edx;
    for (int i = 0; i < 6; i++) g_seen_args[i] = stack[i];
    g_seen = 1;
  }
  return ((DWORD(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
          g_announce_one_orig)(self, edx, a0, a1, a2, a3, a4, a5);
}

static DWORD __fastcall announce_many_probe(DWORD self, DWORD edx,
                                            DWORD a0, DWORD a1, DWORD a2, DWORD a3,
                                            DWORD a4, DWORD a5, DWORD a6, DWORD a7) {
  DWORD from = (DWORD)(INT_PTR)__builtin_return_address(0);
  DWORD stack[8] = { a0, a1, a2, a3, a4, a5, a6, a7 };
  DWORD rva = from - game_base();
  log_args(rva == RISE_ANNOUNCE_RVA
           ? "announce(many): the necromancer's raise" : "announce(many)",
           self, edx, stack, 8, rva);
  return ((DWORD(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
          g_announce_many_orig)(self, edx, a0, a1, a2, a3, a4, a5, a6, a7);
}

// ---------------------------------------------------------------------------
// AND THE EXPERIMENT THE READING CANNOT SETTLE.
//
// The announcer takes six arguments and three of them are structures built by
// the caller out of what it is announcing — an artifact asks the artifact, a
// skill asks the skill. What none of that says is whether the call can be made
// from OUTSIDE those paths at all: whether the holder in `ecx` is the hero,
// whether anything in the payload has to be freshly made, whether it is even
// legal on the turn a script runs.
//
// So the cheapest question first, and it is answered by a launch rather than by
// a week of reading: REPLAY. The last announcement the artifact command made is
// kept, exactly as it passed, and when a spell is taught the same call is made
// again with the same arguments. What comes up on screen says the artifact's
// name, which is the wrong word and the right answer: it means the call works
// from our side and only the payload has to be built. Nothing on screen, or a
// crash, says the opposite just as clearly.
//
// The author's permission for this shape, verbatim: "можно. хай падает".

/** `CAddHeroSpellCmd::execute` — 22 instructions that announce nothing. */
#define ADD_SPELL_RVA 0x72e820u
static const BYTE ADD_SPELL_HEAD[6] = { 0x56, 0x8B, 0xF1, 0x8B, 0x4E, 0x0C };  // push esi/mov esi,ecx/mov ecx,[esi+0Ch]
static void *g_add_spell_orig;

// WHAT THE FIRST ATTEMPT ANSWERED, and it was worth the crash. Replaying the
// artifact's arguments died inside the engine's string code, and the reason is
// in the numbers the probe wrote down: `a0`, `a1` and `a5` were 0x01effa2c and
// twice twelve bytes on — the caller's own STACK. They are temporaries the
// caller builds and the announcer reads, so by the time a spell is taught that
// frame is somebody else's. They have to be BUILT, and the skill site says with
// what: a string from a KEY, and two helpers of the same family.

/** The engine's string-from-literal — `__thiscall(dst, const char*)`. */
#define STRING_FROM_LITERAL_RVA 0x0dc940u
/** Builds the announcement's last argument out of a zeroed buffer. */
#define ANNOUNCE_PARAMS_RVA 0x0f7530u
/** And the object it carries: `(this, 0, kind, params)`. */
#define ANNOUNCE_SUBJECT_RVA 0x125b30u
/** Turns the key's string into the first argument. */
#define ANNOUNCE_TEXT_RVA 0x6b8d50u

/** The key the game announces a new ability under. A KEY, not a sentence:
 *  UI/UIGameRoot.xdb resolves it to a text file, which is what makes the
 *  wording follow the language the install was bought in. */
static const char NEW_ABILITY_KEY[] = "NEW_ABILITY";

static char __fastcall add_spell_replay(void *self, void *unused) {
  char taught = ((char(__fastcall *)(void *, void *))g_add_spell_orig)(self, unused);
  if (!taught || g_replayed) return taught;
  g_replayed = 1;

  DWORD base = game_base();
  // The hero the command was made for — its field 0x0c, which is what the
  // artifact command hands the announcer as `this`.
  DWORD hero = ((DWORD *)self)[3];
  log_hex("pandora: a spell was taught, announcing for ", hero);

  // Buffers of our own, zeroed the way the skill site zeroes its locals —
  // except the subject's, which may NOT be zeroed. Two crashes taught this pair
  // of lines. With `this` = {0, 0} the builder took its "nothing to announce"
  // branch and answered null, and the announcer walked through it. With the
  // command's field 0x10 it answered worse: that field is the spell's ID — 0x122
  // came through the log — and an id dereferenced as a pointer is an access
  // violation one call deeper. What the site is passed is a POINTER to the thing
  // gained, so the id goes through the engine's own registry first.
  DWORD key[8] = { 0 }, params[8] = { 0 };
  int spellId = (int)((DWORD *)self)[4];
  void *record = ((void *(__fastcall *)(int))(DWORD_PTR)(SPELL_RECORD_RVA + base))(spellId);
  log_num("pandora:   the spell ", spellId);
  log_hex("pandora:   its record ", (DWORD)(DWORD_PTR)record);
  if (!record) {
    log_line("pandora: the game never loaded that spell — not announcing");
    return taught;
  }
  DWORD subjectThis[2] = { (DWORD)(DWORD_PTR)record, 0 };

  ((void(__fastcall *)(void *, void *, const char *))(DWORD_PTR)(STRING_FROM_LITERAL_RVA + base))(
    key, 0, NEW_ABILITY_KEY);
  DWORD paramsArg = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_PARAMS_RVA + base))(
    params, 0);
  DWORD subject = ((DWORD(__fastcall *)(void *, void *, DWORD, DWORD, DWORD))
                   (DWORD_PTR)(ANNOUNCE_SUBJECT_RVA + base))(subjectThis, 0, 0, 3, paramsArg);
  DWORD text = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_TEXT_RVA + base))(key, 0);
  log_hex("pandora:   params  ", paramsArg);
  log_hex("pandora:   subject ", subject);
  log_hex("pandora:   text    ", text);

  // A null subject is what killed the last attempt inside the announcer, so it
  // is refused here instead: the log then says which step gave up, and the game
  // keeps running.
  if (!subject) {
    log_line("pandora: the subject came back null — not announcing");
    return taught;
  }
  ((void(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
   (DWORD_PTR)(ANNOUNCE_ONE_RVA + base))(
    hero, g_seen_edx, text, (DWORD)(DWORD_PTR)params, subject, 0, 3, paramsArg);
  log_line("pandora: it did not crash");
  return taught;
}

/** Listen to both announcers. False when the build was not asked to log. */
static int install_pandora_notify_probe(void) {
  if (!LOG_ON) return 0;
  g_add_spell_orig = detour(ADD_SPELL_RVA, ADD_SPELL_HEAD, sizeof ADD_SPELL_HEAD,
                            (void *)add_spell_replay, "spell taught");
  g_announce_one_orig = detour(ANNOUNCE_ONE_RVA, ANNOUNCE_ONE_HEAD, sizeof ANNOUNCE_ONE_HEAD,
                               (void *)announce_one_probe, "announce(one)");
  g_announce_many_orig = detour(ANNOUNCE_MANY_RVA, ANNOUNCE_MANY_HEAD, sizeof ANNOUNCE_MANY_HEAD,
                                (void *)announce_many_probe, "announce(many)");
  return g_announce_one_orig != NULL || g_announce_many_orig != NULL;
}
