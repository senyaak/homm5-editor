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
// SO THIS FILE LISTENS AND THEN SPEAKS. The two announcers are hooked and every
// real gain that passes through them is written down; the bottom half of the
// file is the call that reading was written from. Both halves pass the original
// its own arguments — the listening changes nothing the game does.
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
    // THE ONE THING THE LISTING WILL NOT SAY. `edx` reaches the holder as the
    // object it asks for the announcement's audience (0xBF9B30 alive-checks it
    // and calls its slot 0x1BC), and each site gets it somewhere else: the
    // artifact command from `[cmd+0x10]->vt[0]()`, the skill site from a plain
    // `[edi+0x128]`. A hero taught a spell has no command field to take it from,
    // so the question is whether the hero himself is what carries it at 0x128 —
    // and the cheapest answer is this line, printed beside the real one.
    if (readable((const DWORD *)(DWORD_PTR)edx, 4))
      log_hex("  edx's class  ", *(const DWORD *)(DWORD_PTR)edx - game_base());
    static const char *const labels[5] = {
      "  hero+120   ", "  hero+124   ", "  hero+128   ", "  hero+12c   ", "  hero+130   "
    };
    if (readable((const DWORD *)(DWORD_PTR)(self + 0x120), 0x14))
      for (int i = 0; i < 5; i++)
        log_hex(labels[i], ((const DWORD *)(DWORD_PTR)(self + 0x120))[i]);
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
// AND THE CALL, WRITTEN FROM THE SITE THAT ALREADY DOES IT.
//
// Two attempts were made before this one and both took the game down; between
// them they said everything the listing alone could not. The first REPLAYED the
// artifact's own arguments and died in the engine's string code, because `a0`,
// `a1` and `a5` are twelve-byte temporaries on the CALLER's stack — by the time
// a spell is taught that frame belongs to somebody else. The second built them
// and died in the same place, and the reason is now exact:
//
//   0x4DCA10 is the copy loop of the wide-string copy constructor, and it was
//   reading from ESI = 0. `a1` was a zeroed buffer. A zeroed buffer is not an
//   empty string — an empty string is three words the engine allocates for it.
//
// So this is written from 0xC26BD0, the site that announces a NEW_SKILL, which
// does the same job with a quarter of the artifact's ceremony:
//
//   string_from_literal(&key, "NEW_ABILITY")   0x4DC940, one argument
//   params  = params_ctor(&paramsBuf)          0x4F7530, none
//   subject = ref_resolve(&{record, 0})        0x525B30, none  <- and NOT three
//   text    = text_from_key(&key)              0xAB8D50, none
//   announce(hero, edx, text, name, subject, 0, kind, params)
//
// `ref_resolve` taking no stack arguments matters twice over: the three that
// were being pushed at it were never popped, so every later argument in that
// frame was twelve bytes out of place.
//
// The author's permission for the shape of this work, verbatim: "можно. хай
// падает" — but a crash here costs the whole run, and this run has a second
// question in it, so every pointer is checked before it is used.

/** `CAddHeroSpellCmd::execute` — 22 instructions that announce nothing. */
#define ADD_SPELL_RVA 0x72e820u
static const BYTE ADD_SPELL_HEAD[6] = { 0x56, 0x8B, 0xF1, 0x8B, 0x4E, 0x0C };  // push esi/mov esi,ecx/mov ecx,[esi+0Ch]
static void *g_add_spell_orig;

// Five helpers of somebody else's, each recognised by its first bytes so that
// `tools/test-native-anchors.ts` fails on disk instead of in the game.

/** The engine's string-from-literal — `__thiscall(dst, const char*)`. */
#define STRING_FROM_LITERAL_RVA 0x0dc940u
static const BYTE STRING_FROM_LITERAL_HEAD[6] = { 0x53, 0x55, 0x56, 0x8B, 0x74, 0x24 };
/** The announcement's last argument, built into a buffer of ours. No arguments. */
#define ANNOUNCE_PARAMS_RVA 0x0f7530u
static const BYTE ANNOUNCE_PARAMS_HEAD[6] = { 0x51, 0x53, 0x8B, 0xD9, 0x56, 0x57 };
/** A `{pointer, stale?}` pair resolved to a live object. No arguments either. */
#define REF_RESOLVE_RVA 0x125b30u
static const BYTE REF_RESOLVE_HEAD[6] = { 0xA0, 0x0D, 0x8C, 0x0F, 0x01, 0x56 };
/** The key's string turned into the first argument. */
#define ANNOUNCE_TEXT_RVA 0x6b8d50u
static const BYTE ANNOUNCE_TEXT_HEAD[7] = { 0x51, 0x64, 0xA1, 0x2C, 0x00, 0x00, 0x00 };
/** An EMPTY wide string, allocated the way the engine allocates one. */
#define WSTRING_EMPTY_RVA 0x2b9a70u
static const BYTE WSTRING_EMPTY_HEAD[5] = { 0x56, 0x6A, 0x10, 0x8B, 0xF1 };

/** The key the game announces a new ability under. A KEY, not a sentence:
 *  UI/UIGameRoot.xdb resolves it to a text file, which is what makes the
 *  wording follow the language the install was bought in. */
static const char NEW_ABILITY_KEY[] = "NEW_ABILITY";

/** What the holder demands of the object in `edx`, in its own order (0xBF9B30):
 *  a vtable, then `[[p+4]+4]` as an offset, then a count at `p+off+8` that has
 *  not gone negative. Anything unreadable on the way is answered no. */
static int alive_object(DWORD p) {
  if (!p || !readable((const void *)(DWORD_PTR)p, 8)) return 0;
  if (!readable((const void *)(DWORD_PTR)((const DWORD *)(DWORD_PTR)p)[0], 4)) return 0;
  DWORD holder = ((const DWORD *)(DWORD_PTR)p)[1];
  if (!readable((const void *)(DWORD_PTR)holder, 8)) return 0;
  DWORD off = ((const DWORD *)(DWORD_PTR)holder)[1];
  const DWORD *count = (const DWORD *)(DWORD_PTR)(p + off + 8);
  if (!readable(count, 4)) return 0;
  return (LONG)*count >= 0;
}

/** A string the announcement's constructor may copy — three words, and the
 *  first of them a buffer that exists. The whole of the second crash. */
static int wstring_ok(DWORD s) {
  if (!s || !readable((const void *)(DWORD_PTR)s, 12)) return 0;
  DWORD buf = ((const DWORD *)(DWORD_PTR)s)[0];
  return buf && readable((const void *)(DWORD_PTR)buf, 2);
}

static char __fastcall add_spell_replay(void *self, void *unused) {
  char taught = ((char(__fastcall *)(void *, void *))g_add_spell_orig)(self, unused);
  // WHAT THE LINE BELOW IS FOR, and it is not the announcement. A war cry given
  // to a barbarian may or may not land, and the last two runs could not say
  // because they ended here. Written before anything else is attempted, this
  // costs nothing and answers that question even if the rest of the function
  // goes wrong: the id is the cry, and `taught` is the command's own verdict.
  int spellId = (int)((DWORD *)self)[4];
  log_num(taught ? "pandora: a spell was taught, id " : "pandora: a spell was REFUSED, id ",
          spellId);
  if (!taught || g_replayed) return taught;
  g_replayed = 1;

  DWORD base = game_base();
  // The hero the command was made for — its field 0x0c, which is what the
  // artifact command hands the announcer as `this`.
  DWORD hero = ((DWORD *)self)[3];
  log_hex("pandora:   for hero ", hero);

  // The subject is a POINTER to the thing gained, never its number: field 0x10
  // is the spell's id — 0x122 came through the log once, dereferenced, and the
  // access violation was one call deeper. The engine's own registry turns one
  // into the other.
  void *record = ((void *(__fastcall *)(int))(DWORD_PTR)(SPELL_RECORD_RVA + base))(spellId);
  log_hex("pandora:   its record ", (DWORD)(DWORD_PTR)record);
  if (!record) {
    log_line("pandora: the game never loaded that spell — not announcing");
    return taught;
  }

  // Ours to lend the engine's constructors. They are never destroyed: a probe
  // that guesses at a destructor is a probe that corrupts a heap, and a handful
  // of small allocations per launch is the cheaper mistake.
  DWORD key[8] = { 0 }, paramsBuf[16] = { 0 }, nameBuf[8] = { 0 };
  DWORD subjectRef[2] = { (DWORD)(DWORD_PTR)record, 0 };

  ((void(__fastcall *)(void *, void *, const char *))(DWORD_PTR)(STRING_FROM_LITERAL_RVA + base))(
    key, 0, NEW_ABILITY_KEY);
  DWORD params = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_PARAMS_RVA + base))(
    paramsBuf, 0);
  DWORD name = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(WSTRING_EMPTY_RVA + base))(
    nameBuf, 0);
  DWORD subject = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(REF_RESOLVE_RVA + base))(
    subjectRef, 0);
  DWORD text = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_TEXT_RVA + base))(key, 0);

  // And the audience. The skill site reads it out of a field at 0x128; whether
  // the hero is what carries it there is the one thing still unmeasured, so it
  // is TRIED, checked the way the holder checks it, and the artifact's own — if
  // one has come past already this launch — stands behind it. With neither, the
  // holder would drop the announcement on the floor anyway (0xBF9C38), so there
  // is nothing to gain by calling.
  DWORD edx = 0;
  const char *where = "nothing";
  if (readable((const void *)(DWORD_PTR)(hero + 0x128), 4)
      && alive_object(*(const DWORD *)(DWORD_PTR)(hero + 0x128))) {
    edx = *(const DWORD *)(DWORD_PTR)(hero + 0x128);
    where = "the hero's field 0x128";
  } else if (alive_object(g_seen_edx)) {
    edx = g_seen_edx;
    where = "the artifact that came past earlier";
  }
  log_hex("pandora:   params  ", params);
  log_hex("pandora:   name    ", name);
  log_hex("pandora:   subject ", subject);
  log_hex("pandora:   text    ", text);
  log_hex("pandora:   edx     ", edx);
  log_line(where);

  if (!wstring_ok(text) || !wstring_ok(name)) {
    log_line("pandora: a string came back empty-handed — not announcing");
    return taught;
  }
  if (!edx) {
    log_line("pandora: nobody to announce it to — the holder would drop it");
    return taught;
  }
  ((void(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
   (DWORD_PTR)(ANNOUNCE_ONE_RVA + base))(hero, edx, text, name, subject, 0, 3, params);
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
