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

/** The last announcement the artifact command made — kept because it is the one
 *  worked example of a call that succeeds, and every mistake so far was found
 *  by holding ours up against it. */
static DWORD g_seen_this, g_seen_edx, g_seen_args[6];
static int g_seen;

/** Where the game is loaded — never 0x400000 in this build. */
static DWORD game_base(void) { return (DWORD)(INT_PTR)GetModuleHandleW(NULL); }

/**
 * WHOSE announcement it is, and it is not the hero's.
 *
 * Five crashes were spent on the first argument before a dump of the whole
 * object said it plainly: the working announcement's `this` is an
 * `NWorld::CWorld` and mine was an `NWorld::CHero`. The mistake goes back to
 * the very first reading — `CGiveArtefactCmd` keeps the WORLD at its field
 * 0x0c and the hero at 0x10, which the same function says out loud two
 * instructions earlier by asking 0x0c for the artifact factory. Every command
 * lays its fields out its own way, and `CAddHeroSpellCmd` really does keep the
 * hero at 0x0c — so the field number was carried across and the class was not.
 *
 * There is no world in the spell command to take, so it is REMEMBERED: every
 * announcement the engine makes passes it, and one game has one. Captured, not
 * guessed — the vtable is the whole test.
 */
#define CWORLD_VTABLE_RVA 0xbaf4bcu
static DWORD g_world;

/** The pair a flying sign is addressed by — caught, for the same reason. */
static DWORD g_signHolder, g_signSubject;

/**
 * Every word of something, and no opinion about which ones matter.
 *
 * Twice now a report has been filtered down to what seemed worth keeping and
 * twice the answer was in what was thrown away — the crash with no return
 * address, and before it a whole probe that logged the arguments but not the
 * objects behind them. The rule, in the author's words: ЛОГИРУЕМ ВСЁ. Whatever
 * is unreadable stops the dump; nothing else does.
 */
static void log_all_words(const char *what, DWORD at, int count) {
  log_hex(what, at);
  for (int i = 0; i < count; i++) {
    const DWORD *word = (const DWORD *)(DWORD_PTR)(at + (DWORD)i * 4);
    if (!readable(word, 4)) return;
    char label[24] = { ' ', ' ', ' ', ' ', '+', '0', 'x', '0', '0', ' ', ' ', ' ', ' ', 0 };
    label[7] = "0123456789abcdef"[(i * 4 >> 4) & 0xf];
    label[8] = "0123456789abcdef"[(i * 4) & 0xf];
    log_hex(label, *word);
  }
}

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
    // And everything behind it, not its first word. The announcement's payload
    // is structures, and for four crashes running the argument LIST looked
    // identical to the engine's while the structures behind it did not.
    // `readable` is core/log.c's — a probe that faults is a probe that costs a
    // run (docs/engineInternals/PANDORA_OBJECT.md).
    if (readable((const void *)(DWORD_PTR)stack[i], 4)) log_all_words("    behind it ", stack[i], 8);
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
  // THE TWO THAT CANNOT BE READ OUT OF THE LISTING. A sign that flies over a
  // hero is addressed by an object in `ecx` and another in `a0`, and both are
  // subobjects of the world reached by adjustments the compiler inlined — the
  // experience sign at 0xC25CF9 walks one through `[esi+4]`, `[+0x0c]`, `+4`.
  // The world itself was caught the same way and it is the method that finally
  // worked: a real sign passes here on the first experience the player earns,
  // so take them from that instead of deriving them.
  if (!g_signHolder && self && a0) {
    g_signHolder = self;
    g_signSubject = a0;
    log_hex("pandora: a flying sign is addressed by ", self);
    log_hex("pandora:   and speaks over ", a0);
  }
  if (!LOG_ON) {
    return ((DWORD(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD,
                                 DWORD))g_announce_many_orig)(self, edx, a0, a1, a2, a3, a4, a5,
                                                              a6, a7);
  }
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
// So it is written from the engine's own sites — first 0xC26BD0, which
// announces a NEW_SKILL, and then 0xB41500, which announces this very thing:
//
//   string_from_literal(&key, "HERO_RECEIVES_SPELL")  0x4DC940, one argument
//   params = params_ctor(&paramsBuf)                  0x4F7530, none
//   name   = spell_name(&nameBuf, spellId)            0xAD5160, none
//   icon   = spell_icon(spellId)                      0xAD5110, none
//   text   = text_from_key(&key)                      0xAB8D50, none
//   announce(hero, edx, text, name, icon, 0, 1, params)
//
// Reading those sites also settled an arity: the reference resolver at 0x525B30
// takes NO stack arguments, and the three that had been pushed at it were never
// popped, so every later argument in that frame was twelve bytes out of place.
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
/** The key's string turned into the first argument. */
#define ANNOUNCE_TEXT_RVA 0x6b8d50u
static const BYTE ANNOUNCE_TEXT_HEAD[7] = { 0x51, 0x64, 0xA1, 0x2C, 0x00, 0x00, 0x00 };
/** A spell's NAME, into a buffer of ours — `__fastcall(dst, spellId)`. */
#define SPELL_NAME_RVA 0x6d5160u
static const BYTE SPELL_NAME_HEAD[5] = { 0x56, 0x8B, 0xF1, 0x8B, 0xCA };
/** A spell's ICON — `__fastcall(spellId)`, the record's 0x64 or else its 0x5c. */
#define SPELL_ICON_RVA 0x6d5110u
static const BYTE SPELL_ICON_HEAD[3] = { 0x56, 0x57, 0xE8 };
/** And what that icon has to be, since the announcement dispatches on it. */
#define STEXTURE_VTABLE_RVA 0xba98b0u
/** One substitution into the announcement's dictionary — `(this, key, value)`. */
#define PARAMS_SET_RVA 0x895580u
static const BYTE PARAMS_SET_HEAD[6] = { 0xFF, 0x74, 0x24, 0x08, 0xFF, 0x74 };
/** The name the engine's own site substitutes a spell under, at 0xB41465. */
static const char SPELL_PARAM[] = "spell";

/** Where the announcement is handed to its audience — probed only to say which
 *  half of the work a crash happened in. `ret 4`, and it reads through ESP. */
#define ANNOUNCE_HOLD_RVA 0x7f9b30u
static const BYTE ANNOUNCE_HOLD_HEAD[7] = { 0x53, 0x56, 0x57, 0x8B, 0x7C, 0x24, 0x10 };
static void *g_announce_hold_orig;

/**
 * The key the game announces a RECEIVED SPELL under — its own, not one of ours.
 *
 * The fourth crash is what found it. The announcement's third argument is not
 * the thing gained at all: RTTI says the artifact passes an `NDb::STexture`,
 * an ICON, and a spell record handed over in its place had the wrong virtuals
 * at the slot the engine reached for — so the call went to a heap address and
 * `eip` came back as data. [[take-the-value-dont-derive-it]]: the engine keeps
 * a whole site for this at 0xB41500, and it says the wording is
 * `HERO_RECEIVES_SPELL`, the kind is 1 rather than the skill's 3, the name is
 * the spell's own, and the icon comes off the record. All four are its answers,
 * not mine. A KEY, not a sentence: UI/UIGameRoot.xdb resolves it to a text
 * file, which is what makes the wording follow the language the install was
 * bought in.
 */
static const char SPELL_KEY[] = "HERO_RECEIVES_SPELL";
#define SPELL_ANNOUNCEMENT_KIND 1u

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

/**
 * The WHOLE object an interface pointer points into.
 *
 * The third crash, and the one the addresses had been hinting at all along: the
 * announcer's `this` came through the log ending in 0x400 where ours ended in
 * 0x41c. `CAdvMapHero` declares four vtables — subobjects at 0, 0x1c, 0x150 and
 * 0x180 — and the command that teaches a spell keeps its hero as the one at
 * 0x1c. Slot 0x14 of THAT vtable is not the slot the announcement holder means
 * by 0x14, so it answered null and the holder read 0x1c bytes past null.
 *
 * MSVC leaves the way back in plain sight: one dword before every vtable is its
 * complete-object locator, and the locator's second word is how far this
 * subobject sits into the whole. Subtract it and any interface pointer becomes
 * the object itself — no guessing, and a no-op when there was nothing to fix.
 * See [[vtable-slot-needs-its-vtable-start]]: a slot number without the vtable
 * it belongs to is not an address, it is a coincidence waiting to happen.
 */
static DWORD complete_object(DWORD obj) {
  if (!obj || !readable((const void *)(DWORD_PTR)obj, 4)) return obj;
  DWORD vt = *(const DWORD *)(DWORD_PTR)obj;
  if (!readable((const void *)(DWORD_PTR)(vt - 4), 4)) return obj;
  DWORD locator = *(const DWORD *)(DWORD_PTR)(vt - 4);
  if (!readable((const void *)(DWORD_PTR)locator, 8)) return obj;
  DWORD into = ((const DWORD *)(DWORD_PTR)locator)[1];
  // The largest this class declares is 0x180; anything past a page says the
  // dword before the vtable was not a locator at all.
  return into < 0x1000 ? obj - into : obj;
}

/** Is this the world? Its vtable is the whole test. */
static int is_the_world(DWORD p) {
  return p && readable((const void *)(DWORD_PTR)p, 4)
         && *(const DWORD *)(DWORD_PTR)p == game_base() + CWORLD_VTABLE_RVA;
}

/**
 * Keep it if this is the world — and keep the LATEST one, which is the whole
 * point.
 *
 * A launch is not a game. Load one map, then another, and the first world is
 * destroyed under a pointer that was captured once and never looked at again;
 * the next announcement then hands the engine a dead object and the game goes
 * down. That is exactly what happened on the run with two maps in it, and the
 * run with one survived — which is what a stale pointer looks like from the
 * outside: a crash that will not reproduce.
 */
static void remember_the_world(DWORD self) {
  DWORD whole = complete_object(self);
  if (!is_the_world(whole) || whole == g_world) return;
  g_world = whole;
  // A new world means a new game: what was caught for the old one is gone too.
  g_signHolder = 0;
  g_signSubject = 0;
  log_hex("pandora: this announcement comes from the world ", whole);
}

/**
 * IS THIS THE GAME, OR IS IT STILL BEING SET UP?
 *
 * A map's init script hands out spells, and on the Sharpshooter test map the
 * player was told about one he had had since before the first turn. The engine
 * itself never announces then, and the holder says how it knows: before it
 * keeps anything it asks the world two questions (0xBF9B9E, 0xBF9BB2), and
 * either answer can mean "not now". Rather than invent a signal, ours are the
 * same two, asked of the same object and read the same way round.
 *
 * Both are logged whatever they say, because a gate that is never seen to
 * refuse is a gate nobody can trust ([[metric-must-be-checked-by-sabotage]]).
 */
static int the_game_is_being_played(DWORD world) {
  const DWORD *vt = (const DWORD *)(DWORD_PTR)*(const DWORD *)(DWORD_PTR)world;
  DWORD who = ((DWORD(__fastcall *)(DWORD, DWORD))(DWORD_PTR)vt[0x14 / 4])(world, 0);
  DWORD busy = ((DWORD(__fastcall *)(DWORD, DWORD))(DWORD_PTR)vt[0x138 / 4])(world, 0) & 0xff;
  log_hex("pandora:   the world answers 0x14 ", who);
  log_hex("pandora:   and 0x138 ", busy);
  if (busy) {
    log_line("pandora: the world is busy — this is setting up, not playing");
    return 0;
  }
  if (!who || !readable((const void *)(DWORD_PTR)(who + 0x1c), 1)
      || *(const BYTE *)(DWORD_PTR)(who + 0x1c)) {
    log_line("pandora: nobody is watching — this is setting up, not playing");
    return 0;
  }
  return 1;
}

/** A string the announcement's constructor may copy — three words, and the
 *  first of them a buffer that exists. The whole of the second crash. */
static int wstring_ok(DWORD s) {
  if (!s || !readable((const void *)(DWORD_PTR)s, 12)) return 0;
  DWORD buf = ((const DWORD *)(DWORD_PTR)s)[0];
  return buf && readable((const void *)(DWORD_PTR)buf, 2);
}

static char __fastcall announce_spell_taught(void *self, void *unused) {
  char taught = ((char(__fastcall *)(void *, void *))g_add_spell_orig)(self, unused);
  // WHAT THE LINE BELOW IS FOR, and it is not the announcement. A war cry given
  // to a barbarian may or may not land, and two runs could not say because they
  // ended here. Written before anything else is attempted, it costs nothing and
  // answers that question even if the rest of the function goes wrong: the id is
  // the cry, and `taught` is the command's own verdict. It said yes.
  int spellId = (int)((DWORD *)self)[4];
  log_num(taught ? "pandora: a spell was taught, id " : "pandora: a spell was REFUSED, id ",
          spellId);
  if (!taught) return taught;

  DWORD base = game_base();
  // The hero the command was made for — its field 0x0c, and then the whole of
  // him rather than the interface the command happened to keep.
  DWORD given = ((DWORD *)self)[3];
  DWORD hero = complete_object(given);
  log_hex("pandora:   for hero ", given);
  if (hero != given) log_hex("pandora:   the whole of him ", hero);
  // Everything about both, because the world is still being taken from a
  // memory of another announcement rather than from something at hand, and one
  // of these words is very likely it.
  log_all_words("pandora:   the command ", (DWORD)(DWORD_PTR)self, 0x10);
  log_all_words("pandora:   the hero ", hero, 0x20);

  // The game has to know the spell at all before anything else is worth doing.
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

  ((void(__fastcall *)(void *, void *, const char *))(DWORD_PTR)(STRING_FROM_LITERAL_RVA + base))(
    key, 0, SPELL_KEY);
  DWORD params = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_PARAMS_RVA + base))(
    paramsBuf, 0);
  DWORD name = ((DWORD(__fastcall *)(void *, int))(DWORD_PTR)(SPELL_NAME_RVA + base))(
    nameBuf, spellId);
  DWORD text = ((DWORD(__fastcall *)(void *, void *))(DWORD_PTR)(ANNOUNCE_TEXT_RVA + base))(key, 0);

  // AND THE DICTIONARY, which is what the last argument is for. The key names a
  // TEMPLATE, and the template has holes in it: the engine's own site fills a
  // `spell` hole before it announces, and a `player` one before the message it
  // sends the rest of the team. Ours went over empty, which is the difference
  // between the two calls that a right-looking log would not have shown.
  DWORD paramKey[8] = { 0 }, paramValue[8] = { 0 };
  ((void(__fastcall *)(void *, void *, const char *))(DWORD_PTR)(STRING_FROM_LITERAL_RVA + base))(
    paramKey, 0, SPELL_PARAM);
  DWORD value = ((DWORD(__fastcall *)(void *, int))(DWORD_PTR)(SPELL_TEXT_RVA + base))(
    paramValue, spellId);
  ((void(__fastcall *)(DWORD, DWORD, DWORD, DWORD))(DWORD_PTR)(PARAMS_SET_RVA + base))(
    params, 0, (DWORD)(DWORD_PTR)paramKey, value);
  log_hex("pandora:   spell= ", value);

  // The icon, and only if it is one. The announcement dispatches on this
  // argument, so anything that is not an `NDb::STexture` is a jump into data —
  // which is exactly how the last run ended. Its vtable is the whole test, and
  // an announcement with no icon is a shape the constructor already allows
  // (0xCA5F1D checks for null before it touches it).
  DWORD icon = ((DWORD(__fastcall *)(int))(DWORD_PTR)(SPELL_ICON_RVA + base))(spellId);
  log_hex("pandora:   its icon ", icon);
  if (icon && readable((const void *)(DWORD_PTR)icon, 4)
      && *(const DWORD *)(DWORD_PTR)icon != base + STEXTURE_VTABLE_RVA) {
    log_hex("pandora:   but its class is ", *(const DWORD *)(DWORD_PTR)icon - base);
    log_line("pandora: that is no texture — announcing without one");
    icon = 0;
  }

  // And the audience — MEASURED, this time. The skill site reads it out of a
  // field at 0x128, and the field 0x128 of the pointer the command carries came
  // back 0x10d3201c, which is to the dword what a real artifact's announcement
  // passed. Now that the pointer has been walked back to the whole object, the
  // same field is a different one, so both are read and both are printed: the
  // one that answers to the holder's own liveness check wins, the interface's
  // first because that is the one with a reading behind it.
  DWORD edx = 0;
  const char *where = "nothing";
  DWORD asGiven = readable((const void *)(DWORD_PTR)(given + 0x128), 4)
                  ? *(const DWORD *)(DWORD_PTR)(given + 0x128) : 0;
  DWORD asWhole = readable((const void *)(DWORD_PTR)(hero + 0x128), 4)
                  ? *(const DWORD *)(DWORD_PTR)(hero + 0x128) : 0;
  log_hex("pandora:   0x128 of the interface ", asGiven);
  log_hex("pandora:   0x128 of the whole     ", asWhole);
  if (alive_object(asGiven)) { edx = asGiven; where = "the interface's field 0x128"; }
  else if (alive_object(asWhole)) { edx = asWhole; where = "the whole object's field 0x128"; }
  else if (alive_object(g_seen_edx)) {
    edx = g_seen_edx;
    where = "the artifact that came past earlier";
  }
  log_hex("pandora:   params  ", params);
  log_hex("pandora:   name    ", name);
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
  // And WHOSE announcement it is. Not the hero's: five crashes were spent on
  // that before a dump of the whole object named the class. The world is only
  // ever the one the engine itself announced through, so if none has yet, this
  // says so and stops — which is a line in the log instead of the rest of the
  // run.
  log_hex("pandora:   the world ", g_world);
  if (!is_the_world(g_world)) {
    log_line("pandora: no world of this game yet — not announcing");
    return taught;
  }
  if (!the_game_is_being_played(g_world)) return taught;
  ((void(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
   (DWORD_PTR)(ANNOUNCE_ONE_RVA + base))(g_world, edx, text, name, icon, 0,
                                         SPELL_ANNOUNCEMENT_KIND, params);
  log_line("pandora: it did not crash");
  return taught;
}

// ---------------------------------------------------------------------------
// AND THE OTHER HALF: A STACK THAT JOINS THE HERO.
//
// There is no key for it. The executable holds exactly one HERO_RECEIVES_* —
// the spell's — and TEAM_RECEIVE_CREATURES is the message the rest of the team
// gets, not the thing the player sees. What the player sees when necromancy
// raises a stack is a SIGN that flies off the hero, and that is what was asked
// for, so that is the call: 0xC16750, eight arguments, and the necromancer's
// own site at 0xC77799 spells out every one of them —
//
//   arg0  the object the sign flies from      caught, see g_signSubject
//   arg1  2
//   arg2  the text, built from a number       0xC16810(&out, count)
//   arg3  the picture                         0xABC700(0xABAFB0(stack), 0)
//   arg4  0    arg5  1    arg6  1    arg7  1  (the experience sign uses 0/0/2/1)
//
// Two of those are objects of the world that the compiler inlined the walk to,
// so they are caught off a real sign rather than derived. What is NOT yet known
// is this command's own shape — which field holds the creature and which the
// count — so for now it only writes itself down. Every field, because guessing
// which ones matter is what cost the evening.

/** `CGiveCreaturesCmd::execute` — 93 instructions that announce nothing. */
#define GIVE_CREATURES_RVA 0x72eb10u
static const BYTE GIVE_CREATURES_HEAD[6] = { 0x57, 0x8B, 0xF9, 0x8B, 0x4F, 0x0C };
static void *g_give_creatures_orig;

/** `+N` as the engine writes it on a sign — `__fastcall(out, number)`. */
#define SIGN_NUMBER_RVA 0x816810u
static const BYTE SIGN_NUMBER_HEAD[6] = { 0x81, 0xEC, 0x80, 0x00, 0x00, 0x00 };

static char __fastcall announce_creatures_given(void *self, void *unused) {
  char given = ((char(__fastcall *)(void *, void *))g_give_creatures_orig)(self, unused);
  log_num(given ? "pandora: creatures were given, and the command says "
                : "pandora: creatures were REFUSED, and the command says ", given);
  log_all_words("pandora:   the command ", (DWORD)(DWORD_PTR)self, 0x10);
  if (!given) return given;

  // THE COMMAND CARRIES IT ALL, which the spell's does not: field 0x0c is the
  // world (its vtable says so), 0x10 the player, 0x14 and 0x18 two interfaces
  // of the hero, and 0x1c a pair — the creature and how many. One reading of
  // that dump replaced a whole capture.
  DWORD base = game_base();
  DWORD world = ((DWORD *)self)[3];
  DWORD player = ((DWORD *)self)[4];
  DWORD hero = ((DWORD *)self)[5];
  int count = (int)((DWORD *)self)[8];
  if (!is_the_world(world) || !alive_object(player)) {
    log_line("pandora: that command is not shaped as expected — not announcing");
    return given;
  }
  remember_the_world(world);
  if (!the_game_is_being_played(world)) return given;

  // Whom the sign flies off. The necromancer's site asks the world for it and
  // then walks to a subobject through the class descriptor — `X + [[X+4]+0x0c]
  // + 4` — which is a walk the compiler inlined and no listing spells out, so
  // it is done here the same way and checked before it is passed on.
  DWORD over = ((DWORD(__fastcall *)(DWORD, DWORD, DWORD))
                (DWORD_PTR)((const DWORD *)(DWORD_PTR)*(const DWORD *)(DWORD_PTR)world)[0x100 / 4])(
                  world, 0, hero);
  log_hex("pandora:   the sign flies off ", over);
  if (readable((const void *)(DWORD_PTR)over, 8)) {
    DWORD descriptor = ((const DWORD *)(DWORD_PTR)over)[1];
    if (readable((const void *)(DWORD_PTR)(descriptor + 0x0c), 4))
      over += ((const DWORD *)(DWORD_PTR)descriptor)[3] + 4;
  }
  log_hex("pandora:   as its subobject ", over);
  log_hex("pandora:   a sign was seen over ", g_signSubject);
  if (!readable((const void *)(DWORD_PTR)over, 4)) {
    log_line("pandora: no one to fly it off — not announcing");
    return given;
  }

  DWORD numberBuf[8] = { 0 };
  DWORD number = ((DWORD(__fastcall *)(void *, int))(DWORD_PTR)(SIGN_NUMBER_RVA + base))(
    numberBuf, count);
  log_num("pandora:   how many ", count);
  log_hex("pandora:   written as ", number);
  // The picture is left out for now: the necromancer takes it off the raised
  // STACK, and a command that has not raised one has no stack to ask. A sign
  // without a picture is a shape the engine builds itself (the experience one
  // passes a texture, the constructor checks for null either way).
  ((void(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
   (DWORD_PTR)(ANNOUNCE_MANY_RVA + base))(world, 0, over, 2, number, 0, 0, 1, 1, 1);
  log_line("pandora: the stack was announced and it did not crash");
  return given;
}

/**
 * Where the world is caught, and where a crash used to be located.
 *
 * This hook earns its place twice. It is the only thing that ever sees the
 * world — every announcement the engine makes passes it as `this` — and while
 * the call was still being found it bracketed the last step: the announcer
 * allocates an announcement, constructs it, and hands it on, and a jump into
 * the heap looked the same from all three. A missing "held" meant the
 * constructor died; a lone "held" meant the audience did.
 *
 * Everything it dumps is compiled out of a build that was not asked to log, so
 * a shipping build pays for one comparison per announcement and nothing else.
 */
static DWORD __fastcall announce_hold_probe(DWORD self, DWORD edx, DWORD announcement) {
  remember_the_world(self);
  if (LOG_ON) {
    log_line("pandora: holding an announcement");
    // ALL of it, both times. The engine's own announcements come through here
    // as well as ours, so one run puts a working object and a fatal one side by
    // side in the same file — which is the comparison that settled every
    // mistake in this file. 0x78 bytes is what the announcer allocates for one.
    log_all_words("pandora:   the announcement ", announcement, 0x1e);
    log_all_words("pandora:   its holder ", self, 0x10);
    log_all_words("pandora:   its player ", edx, 0x10);
  }
  DWORD kept = ((DWORD(__fastcall *)(DWORD, DWORD, DWORD))g_announce_hold_orig)(
    self, edx, announcement);
  log_line("pandora: held");
  return kept;
}

/**
 * Speak, and — in a build asked to log — listen as well.
 *
 * The two announcers are hooked only for the log: they change nothing, and what
 * they write is what the calling code above was written from. The other two go
 * in always. The holder is what catches the world; without it nothing can be
 * announced at all.
 */
static int install_pandora_notify(void) {
  g_add_spell_orig = detour(ADD_SPELL_RVA, ADD_SPELL_HEAD, sizeof ADD_SPELL_HEAD,
                            (void *)announce_spell_taught, "spell taught");
  g_announce_hold_orig = detour(ANNOUNCE_HOLD_RVA, ANNOUNCE_HOLD_HEAD, sizeof ANNOUNCE_HOLD_HEAD,
                                (void *)announce_hold_probe, "announcement holder");
  // Always as well: the one that catches what a flying sign is addressed by,
  // which the stack half is going to need.
  g_announce_many_orig = detour(ANNOUNCE_MANY_RVA, ANNOUNCE_MANY_HEAD, sizeof ANNOUNCE_MANY_HEAD,
                                (void *)announce_many_probe, "announce(many)");
  g_give_creatures_orig = detour(GIVE_CREATURES_RVA, GIVE_CREATURES_HEAD,
                                 sizeof GIVE_CREATURES_HEAD,
                                 (void *)announce_creatures_given, "creatures given");
  if (!LOG_ON) return g_add_spell_orig != NULL && g_announce_hold_orig != NULL;
  g_announce_one_orig = detour(ANNOUNCE_ONE_RVA, ANNOUNCE_ONE_HEAD, sizeof ANNOUNCE_ONE_HEAD,
                               (void *)announce_one_probe, "announce(one)");
  return g_add_spell_orig != NULL && g_announce_hold_orig != NULL;
}
