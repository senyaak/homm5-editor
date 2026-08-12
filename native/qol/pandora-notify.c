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
#define ARTEFACT_ANNOUNCE_RETURN 0xb2d13du
/** And the one inside CRiseCreatureCmd::execute. */
#define RISE_ANNOUNCE_RETURN 0xc7779eu

static void *g_announce_one_orig;
static void *g_announce_many_orig;

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
  log_args(from == ARTEFACT_ANNOUNCE_RETURN
           ? "announce(one): the artifact command" : "announce(one)",
           self, edx, stack, 6, from);
  return ((DWORD(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
          g_announce_one_orig)(self, edx, a0, a1, a2, a3, a4, a5);
}

static DWORD __fastcall announce_many_probe(DWORD self, DWORD edx,
                                            DWORD a0, DWORD a1, DWORD a2, DWORD a3,
                                            DWORD a4, DWORD a5, DWORD a6, DWORD a7) {
  DWORD from = (DWORD)(INT_PTR)__builtin_return_address(0);
  DWORD stack[8] = { a0, a1, a2, a3, a4, a5, a6, a7 };
  log_args(from == RISE_ANNOUNCE_RETURN
           ? "announce(many): the necromancer's raise" : "announce(many)",
           self, edx, stack, 8, from);
  return ((DWORD(__fastcall *)(DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD))
          g_announce_many_orig)(self, edx, a0, a1, a2, a3, a4, a5, a6, a7);
}

/** Listen to both announcers. False when the build was not asked to log. */
static int install_pandora_notify_probe(void) {
  if (!LOG_ON) return 0;
  g_announce_one_orig = detour(ANNOUNCE_ONE_RVA, ANNOUNCE_ONE_HEAD, sizeof ANNOUNCE_ONE_HEAD,
                               (void *)announce_one_probe, "announce(one)");
  g_announce_many_orig = detour(ANNOUNCE_MANY_RVA, ANNOUNCE_MANY_HEAD, sizeof ANNOUNCE_MANY_HEAD,
                                (void *)announce_many_probe, "announce(many)");
  return g_announce_one_orig != NULL || g_announce_many_orig != NULL;
}
