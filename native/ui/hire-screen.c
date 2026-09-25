// A hire screen of our own contents: a list of "this creature, this many".
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT ui_hire_screen

// ---------------------------------------------------------------------------
// WHAT THIS IS, AND WHAT IT IS NOT. It is the game's own hire screen, shown
// over a list a script hands over: `H5EHireScreen(creature, count, creature,
// count, …)`. It is NOT a refugee camp, not a dwelling and not a shop — it
// knows nothing about where the creatures came from, who is paying, or where
// they go. Every purchase comes back to the map's Lua as an event:
//
//     H5EHireBought(creature, count)
//
// and what that means — the gold, the army, a caravan, a quest — is the
// script's, written where the feature is written. That division is the whole
// design: the extension opens doors the Lua does not have, and holds no
// state of its own.
//
// THE SCREEN IS ONE SCREEN. `HIRE_CREATURES` serves towns, map dwellings and
// caravans alike, and what tells them apart is an interface each seller
// carries as a virtual base — five slots (docs/FACTION_PLAN.md §2b):
//
//   +0x00  vector<Entry>* Entries()          the raw entries, at `this-0x44`
//   +0x04  CopyEntries(vector<Entry>* out)   `ret 4`
//   +0x08  Take(creature, count)             `ret 8`
//   +0x0C  Available(creature)               `ret 4`
//   +0x10  Items(vector<Item>* out)          `ret 4` — the screen's lines
//
// where an Entry is sixteen bytes, `{count, vector<creature>}`. Three of the
// five read nothing but that vector, so the engine's own code answers them on
// an object of ours laid out the same way.
//
// WHAT THE ENGINE ASKS OF THE OBJECT BESIDES ITS SLOTS: one thing, `[obj+4]`,
// the vbtable, whose entries are the way to the object base — the liveness
// word, the reference count, who owns the goods, and the cast that asks
// whether the seller is a town. All of that is THE TOWN'S, because a
// displacement is only the difference of two addresses and ours are the
// town's own base (see `g_sourceVbtable`).
//
// AND THE PURCHASE IS NOT THE ENGINE'S. `CHireCreaturesCmd::Execute` pays the
// player and adds the stack to an army; for a source of OURS it is refused
// outright. The sale is heard one step earlier, at the gesture — the window's
// own "the player pressed hire" — because the window reaches that same command
// to ask "may he?" as well, and a question answered by selling is how a screen
// of ours came to empty itself on opening (see THE TWO GESTURES below).
// A script that wants the shipped behaviour writes it in three lines
// (`GetPlayerResource`, `SetPlayerResource`, `AddObjectCreatures`) and a script
// that wants something else is not fighting the engine for it.

/** `CCreateHireScreen`'s constructor: `push ebx; push esi; push edi; push 30h; mov edi,edx; mov ebx,ecx`.
 *  (ecx, edx, source, object, army, int*, sound, pointer, bool, bool, bool), `ret 24h`, answers the request. */
#define CREATE_HIRE_SCREEN_RVA 0x438700u
static const BYTE CREATE_HIRE_SCREEN_HEAD[8] = { 0x53, 0x56, 0x57, 0x6A, 0x30, 0x8B, 0xFA, 0x8B };
/** The interface stack taking a request to open a screen: `push edi; mov edi,ecx; test edi,edi; je +3`. */
#define PUSH_SCREEN_REQUEST_RVA 0x1ba210u
static const BYTE PUSH_SCREEN_REQUEST_HEAD[8] = { 0x57, 0x8B, 0xF9, 0x85, 0xFF, 0x74, 0x03, 0xFF };
/** The town's sound-screen builder, out of its town type: `push esi; push 10h; mov esi,ecx; call`. */
#define TOWN_SOUND_BUILDER_RVA 0x2f1740u
static const BYTE TOWN_SOUND_BUILDER_HEAD[8] = { 0x56, 0x6A, 0x10, 0x8B, 0xF1, 0xE8, 0x86, 0xBB };
/** The three slots the engine answers on a vector at `this-0x44` — a dwelling's. */
#define SOURCE_ENTRIES_RVA 0x90ffe0u
static const BYTE SOURCE_ENTRIES_HEAD[4] = { 0x8D, 0x41, 0xBC, 0xC3 };
#define SOURCE_COPY_RVA 0x90fff0u
static const BYTE SOURCE_COPY_HEAD[8] = { 0x51, 0x53, 0x8B, 0x5C, 0x24, 0x0C, 0x85, 0xDB };
#define SOURCE_ITEMS_RVA 0x9101b0u
static const BYTE SOURCE_ITEMS_HEAD[8] = { 0x83, 0xEC, 0x40, 0x53, 0x8B, 0x5C, 0x24, 0x48 };
/** `CHireCreaturesCmd::Execute` — `sub esp,54h; push ebx; mov ebx,ecx; push ebp; push esi`, `ret`, answers in al. */
#define HIRE_EXECUTE_RVA 0x860240u
#define HIRE_EXECUTE_HEAD_LEN 6
static const BYTE HIRE_EXECUTE_HEAD[HIRE_EXECUTE_HEAD_LEN] = { 0x83, 0xEC, 0x54, 0x53, 0x8B, 0xD9 };
/** Its fields, as its constructor (0x8456F0) fills them and Execute reads them. */
#define CMD_SOURCE 0x18u
#define CMD_CREATURE 0x1Cu
#define CMD_COUNT 0x20u

/**
 * THE TWO GESTURES, which is where a purchase of ours is decided.
 *
 * `CHireWindow` carries an interface at its +0x40 whose first two virtuals both
 * read `(object, creature, count)` and both build a `CHireCreaturesCmd`. They
 * are NOT the same thing:
 *
 *   +0x00  the deed     — hands the command to `Do` (`manager->vt[0]`), and is
 *                         called from the OK button's handler (+0x4422CF);
 *   +0x04  the question — hands it to `CanDo` (`manager->vt[8]`) and answers in
 *                         `al` whether the button may be enabled. The window's
 *                         refresh asks it over and over (+0x43F5DC), counting
 *                         down from the stock to find the largest allowed.
 *
 * Launch 48 showed the town's own screen asking the question eleven times in a
 * row — ten, ten, nine, eight … one — and buying nothing, and then, when the
 * player did press hire, the deed once. A screen of OURS bought its whole stock
 * the moment it opened, because we had detoured the COMMAND's `Execute` and
 * called every arrival at it a sale. One of those two paths reaches Execute for
 * a source of ours; which one hardly matters now, because a question is not a
 * purchase and the command is the wrong place to listen.
 *
 * So the extension listens where the gesture is: the deed is our sale, the
 * question is ours to answer out of the stock, and the engine's own purchase of
 * a source of ours is refused outright — nothing of ours is ever bought by the
 * engine's own hand (see `hire_execute_hook`).
 *
 * Both heads are the same nine bytes: `sub esp,18h; push ebx; push ebp; mov
 * ebp,ecx; xor ebx,ebx`. Where the interface keeps the source it is selling:
 * `+0x1C` is one when there is one, `+0x20` is the source itself — read by both
 * virtuals at 0x83EA2F and 0x83EDAF to fill the command.
 */
#define HIRE_WINDOW_HIRE_RVA 0x43e9f0u
#define HIRE_WINDOW_HIRE2_RVA 0x43ed70u
#define HIRE_WINDOW_HIRE_HEAD_LEN 9
static const BYTE HIRE_WINDOW_HIRE_HEAD[HIRE_WINDOW_HIRE_HEAD_LEN] =
    { 0x83, 0xEC, 0x18, 0x53, 0x55, 0x8B, 0xE9, 0x33, 0xDB };
#define WINDOW_HAS_SOURCE 0x1Cu
#define WINDOW_SOURCE 0x20u

/** The two screens' main vtables — what the screen on screen is compared with. */
#define TOWN_SCREEN_VTABLE_RVA 0xb73418u
#define HIRE_SCREEN_VTABLE_RVA 0xb72b8cu
/** The town screen's fields the engine's own hire opener reads (0x84FB60). */
#define TOWN_SCREEN_P0 0x21Cu
#define TOWN_SCREEN_OBJECT 0x220u
#define TOWN_SCREEN_P1 0x224u
#define TOWN_SCREEN_P6 0x19Cu
#define TOWN_SCREEN_QUEUE 0x2C0u
#define TOWN_SCREEN_CHILD_UP 0x478u
/**
 * The chain to the army the screen SHOWS beside the offers — the engine's own,
 * reproduced rather than guessed: the screen's object at `+0x220`, its
 * `vt+0x90`, that thing's `vt+0x04`, and THAT thing's `vt+0x2C`. Nothing is
 * ever added to it by us; it is the panel the player looks at.
 */
#define VT_OBJECT_HOLDER 0x90u
#define VT_HOLDER_OWNER 0x04u
#define VT_TOWN_GARRISON 0x2Cu
/** The queue's slot that takes a request when there is a queue: (request), answers whether it did. */
#define VT_QUEUE_TAKE 0x24u
/** The vbtable of the town's interface: `[+8]` is the way to its object base. */
#define VB_OBJECT_BASE 8

typedef void *(__fastcall *CreateHireScreenFn)(void *p0, void *p1, void *source, void *object, void *army,
                                               int *number, void *sound, void *p6, BYTE b7, BYTE b8, BYTE b9);
typedef void (__fastcall *PushScreenRequestFn)(void *request);
typedef void *(__fastcall *TownSoundBuilderFn)(int townType);
/** Any slot of the engine's that takes nothing and answers with an object. */
typedef void *(__thiscall *ObjectSlotFn)(void *self);
typedef int (__thiscall *QueueTakeFn)(void *queue, void *request);
typedef int (__fastcall *HireExecuteFn)(void *cmd, void *edx);
/** The probe's two: `__thiscall(object, creature, count)`, `ret 0Ch`. */
typedef int (__fastcall *HireWindowHireFn)(void *self, void *edx, void *object, int creature, int count);

static CreateHireScreenFn g_createHireScreen = NULL;
static PushScreenRequestFn g_pushScreenRequest = NULL;
static TownSoundBuilderFn g_townSoundBuilder = NULL;
static HireExecuteFn g_hireExecute = NULL;
static HireWindowHireFn g_hireWindowHire = NULL;
static HireWindowHireFn g_hireWindowHire2 = NULL;
static void *g_sourceEntries = NULL;
static void *g_sourceCopy = NULL;
static void *g_sourceItems = NULL;

// --- the list, and the object the screen reads it through ------------------------
//
// Bytes rather than a struct, on purpose: the engine says exactly where its
// words are and C says nothing about where it would put a member. The vector
// the engine's three slots read sits 0x44 bytes BEFORE the object, so the
// block starts there.

/** How many lines one screen may show. The engine's own container scrolls; this is our ceiling. */
#define HIRE_MOST 32

/** An entry as the engine keeps one: a count and a vector of creature ids. */
typedef struct { int count; int *begin; int *end; int *cap; } HireEntry;
/** A vector of them: three words. */
typedef struct { HireEntry *begin; HireEntry *end; HireEntry *cap; } HireVector;

#define SOURCE_VECTOR_BACK 0x44u
#define SOURCE_BYTES 8
#define SOURCE_SLOTS 16

static BYTE g_sourceBlock[SOURCE_VECTOR_BACK + SOURCE_BYTES];
#define SOURCE_OBJECT (g_sourceBlock + SOURCE_VECTOR_BACK)
/** A NULL where a complete-object locator would be: nothing casts the source ITSELF — see the vbtable below. */
static void *g_sourceVtableWithLocator[1 + SOURCE_SLOTS];
#define g_sourceVtable (g_sourceVtableWithLocator + 1)
/**
 * `[0]` the vbptr's own offset; `[1]` and `[2]` the way to the object the
 * engine asks everything else of — THE TOWN'S OWN BASE, both of them.
 *
 * Launch 43 crashed on this and it is worth the paragraph. Every "is it still
 * alive" the engine makes is `[[obj+4]+4]` — vbtable[1] — plus eight, and the
 * screen goes further: it takes `obj + 4 + vbtable[1]` and hands THAT to
 * `__RTDynamicCast(…, CObjectBase, IAdvMapTown)` to ask whether the seller is
 * a town (0x840833). So vbtable[1] does not point at "some words of ours with
 * a refcount in them" — it points at a CObjectBase, with RTTI. Ours pointed at
 * a block of ours, the cast read a vtable that was not one, and the run died
 * in VCRUNTIME with our own address in ecx.
 *
 * Pointing both entries at the town's base answers all of it with the truth:
 * the town is alive, the town is who owns the goods, and the refcount raised
 * and lowered around the screen is the town's, which the world holds anyway.
 */
static int g_sourceVbtable[4];
/** The screen of ours that is up, or nothing — for `H5EHireOpen`. */
static int g_hireOpen = 0;

static HireVector *source_vector(void) { return (HireVector *)g_sourceBlock; }

static void source_free_entries(void) {
  HireVector *v = source_vector();
  if (!v->begin) return;
  for (HireEntry *e = v->begin; e < v->end; e++) if (e->begin) g_engineFree(e->begin);
  g_engineFree(v->begin);
  v->begin = v->end = v->cap = NULL;
}

/**
 * The entries, out of the list — allocated with the engine's own allocator,
 * because the engine copies them with its own vector code and frees what it
 * copied with its own free, and a static of ours handed to that is a crash.
 */
static int source_fill(const int *creature, const int *count, int offers) {
  source_free_entries();
  int n = 0;
  for (int i = 0; i < offers; i++) if (creature[i] > 0) n++;
  if (!n) return 0;
  HireEntry *entries = (HireEntry *)g_allocate(sizeof(HireEntry) * (SIZE_T)n);
  if (!entries) return 0;
  int at = 0;
  for (int i = 0; i < offers; i++) {
    if (creature[i] <= 0) continue;
    /* ONE LINE PER CREATURE. The engine tells lines apart by nothing but the
       creature — a purchase says "this many of that", no more — so a second
       line of the same creature is a line nobody can buy from: launch 49 sold
       the second footman out of the first. The later one is dropped, said. */
    int twice = 0;
    for (int j = 0; j < at; j++) if (*entries[j].begin == creature[i]) twice = 1;
    if (twice) {
      log_num("hire screen: a creature listed twice is shown once, dropping the later line of ", creature[i]);
      continue;
    }
    int *id = (int *)g_allocate(sizeof(int));
    if (!id) { g_engineFree(entries); return 0; }
    *id = creature[i];
    entries[at].count = count[i] < 0 ? 0 : count[i];
    entries[at].begin = id;
    entries[at].end = id + 1;
    entries[at].cap = id + 1;
    at++;
  }
  HireVector *v = source_vector();
  v->begin = entries;
  v->end = entries + at;
  v->cap = entries + at;
  for (HireEntry *e = v->begin; e < v->end; e++) {
    log_num("hire screen: the list holds creature ", *e->begin);
    log_num("hire screen:                    count ", e->count);
  }
  return at;
}

/** The entry that lists a creature, or nothing. */
static HireEntry *source_entry_of(int creature) {
  HireVector *v = source_vector();
  for (HireEntry *e = v->begin; e < v->end; e++) {
    for (int *c = e->begin; c < e->end; c++) if (*c == creature) return e;
  }
  return NULL;
}

/** Slot +0x08: what is left after a purchase. */
static void __fastcall source_take(void *self, void *edx, int creature, int count) {
  (void)self; (void)edx;
  HireEntry *e = source_entry_of(creature);
  if (!e) { log_num("hire screen: a purchase of a creature the list lacks, ", creature); return; }
  e->count -= count;
  if (e->count < 0) e->count = 0;
}

/** Slot +0x0C: what is left of a creature. */
static int __fastcall source_available(void *self, void *edx, int creature) {
  (void)self; (void)edx;
  HireEntry *e = source_entry_of(creature);
  log_num("hire screen: asked how many of creature ", creature);
  log_num("hire screen:                    answered ", e ? e->count : 0);
  return e ? e->count : 0;
}

/** Slot +0x10: the screen's lines, the engine's own — with a word about being asked. */
static int __fastcall source_items(void *self, void *edx, void *out) {
  log_line("hire screen: the screen asked for the lines");
  return ((int(__fastcall *)(void *, void *, void *))g_sourceItems)(self, edx, out);
}

/** A slot the engine asked that was not measured — named, so the run says which. */
#define SOURCE_STUB(n) \
  static int __fastcall source_stub_##n(void *self, void *edx) { \
    (void)self; (void)edx; \
    log_hex("hire screen: the screen asked the source an unmeasured slot +", (n) * 4); \
    return 0; \
  }
#define SOURCE_EVERY_SLOT(X) \
  X(0) X(1) X(2) X(3) X(4) X(5) X(6) X(7) \
  X(8) X(9) X(10) X(11) X(12) X(13) X(14) X(15)
SOURCE_EVERY_SLOT(SOURCE_STUB)
#define SOURCE_STUB_NAME(n) (void *)&source_stub_##n,
static void *const g_sourceStubs[SOURCE_SLOTS] = { SOURCE_EVERY_SLOT(SOURCE_STUB_NAME) };

/**
 * The object, built over the town whose screen is up: its own five slots, its
 * own reference words, and the town's object base where the engine looks for
 * an owner. `townInterface` is the base the town's holder hands out (+0xF8 of
 * the whole town), whose vbtable knows the way to that base.
 */
static int source_build(BYTE *townInterface) {
  if (!readable(townInterface + 4, 4)) return 0;
  const int *townVb = *(const int **)(townInterface + 4);
  if (!readable(townVb, VB_OBJECT_BASE + 4)) return 0;
  BYTE *townBase = townInterface + 4 + townVb[VB_OBJECT_BASE / 4];
  if (!readable(townBase, 4)) return 0;

  for (int i = 0; i < SOURCE_SLOTS; i++) g_sourceVtable[i] = g_sourceStubs[i];
  g_sourceVtable[0x00 / 4] = g_sourceEntries;
  g_sourceVtable[0x04 / 4] = g_sourceCopy;
  g_sourceVtable[0x08 / 4] = (void *)&source_take;
  g_sourceVtable[0x0C / 4] = (void *)&source_available;
  g_sourceVtable[0x10 / 4] = (void *)&source_items;
  g_sourceVtableWithLocator[0] = NULL;

  BYTE *self = SOURCE_OBJECT;
  int toTown = (int)(townBase - (self + 4));
  g_sourceVbtable[0] = -4;
  g_sourceVbtable[1] = toTown;
  g_sourceVbtable[2] = toTown;
  g_sourceVbtable[3] = 0;
  *(void ***)(self + 0) = g_sourceVtable;
  *(int **)(self + 4) = g_sourceVbtable;
  return 1;
}

// --- the purchase, which is the script's --------------------------------------------

/** One purchase, told to the map's Lua the way a town button tells a click. */
static void hire_say_bought(int creature, int count) {
  char line[160];
  int at = 0;
  line[0] = 0;
  append_text(line, &at, sizeof line, "if H5EHireBought ~= nil then H5EHireBought(");
  append_num(line, &at, sizeof line, creature);
  append_text(line, &at, sizeof line, ", ");
  append_num(line, &at, sizeof line, count);
  append_text(line, &at, sizeof line, "); end;");
  if (!say_to_the_map(line)) {
    log_line("hire screen: the purchase could not be told to the map — no script of ours has fetched it yet");
    return;
  }
  log_text("hire screen: said to the map: ", line);
  /* ONE TICK, HERE, so the script runs while the screen is still up: the
     world's own scheduler does not run under a screen, which is how a purchase
     came to be written down a visit late (native/faction/town-button.c). */
  if (!tick_the_map_scripts()) log_line("hire screen:   but the scheduler could not be ticked, so it runs later");
}

/**
 * The engine's own purchase, which for a source of ours never happens.
 *
 * It used to be where we heard a sale, and that was the bug: the window reaches
 * the same command for its "may he?" as for its "he did", so every enable pass
 * over a stock of ten sold ten. Now a sale is heard at the gesture and this is
 * only a wall — with a line saying who walked into it, because a wall nobody
 * ever hits and a wall nobody ever logs look the same.
 */
static int __fastcall hire_execute_hook(void *cmd, void *edx) {
  if (readable(cmd, CMD_COUNT + 4) && *(void **)((BYTE *)cmd + CMD_SOURCE) == (void *)SOURCE_OBJECT) {
    log_hex("hire screen: the engine would run a purchase of its own, from +",
            (DWORD)((BYTE *)__builtin_return_address(0) - (BYTE *)GetModuleHandleW(NULL)));
    log_num("hire screen:   of creature ", *(int *)((BYTE *)cmd + CMD_CREATURE));
    log_num("hire screen:   this many ", *(int *)((BYTE *)cmd + CMD_COUNT));
    log_line("hire screen:   refused — a screen of ours is the script's to sell");
    return 0;
  }
  return g_hireExecute(cmd, edx);
}

/** Is this window selling the list of ours, or something of the engine's? */
static int window_sells_ours(void *self) {
  BYTE *sub = (BYTE *)self;
  if (!readable(sub + WINDOW_SOURCE, 4)) return 0;
  return *(int *)(sub + WINDOW_HAS_SOURCE) == 1 && *(void **)(sub + WINDOW_SOURCE) == (void *)SOURCE_OBJECT;
}

/**
 * THE DEED: the player pressed hire. For a list of ours this is the whole sale
 * — what is left is decremented and the map is told — and the engine's command
 * is never built, so nothing is paid or given behind the script's back.
 */
static int __fastcall hire_window_hire_hook(void *self, void *edx, void *object, int creature, int count) {
  if (!window_sells_ours(self)) return g_hireWindowHire(self, edx, object, creature, count);
  HireEntry *e = source_entry_of(creature);
  int left = e ? e->count : 0;
  if (left <= 0) {
    log_num("hire screen: hire pressed with nothing left of creature ", creature);
    return 0;
  }
  if (count > left) {
    log_num("hire screen: hire pressed for more than there is, giving what is left of creature ", creature);
    count = left;
  }
  log_num("hire screen: the player bought ", count);
  log_num("             of creature ", creature);
  source_take(NULL, NULL, creature, count);
  hire_say_bought(creature, count);
  return 0; /* the engine's own path answers with nothing the caller reads */
}

/**
 * THE QUESTION: may he hire that many? Asked over and over while the window is
 * up, so it says nothing and builds nothing — the stock is the whole answer.
 *
 * NOT THE PRICE, yet. What a creature costs is the script's (the level's
 * multiplier is not the engine's to know), so the button is enabled by what is
 * left and a player who cannot pay is turned away by the script, which leaves
 * the line looking sold until the screen is opened again. When that matters,
 * the script will hand the screen a price with the list rather than the
 * extension guessing one.
 */
static int __fastcall hire_window_hire2_hook(void *self, void *edx, void *object, int creature, int count) {
  if (!window_sells_ours(self)) return g_hireWindowHire2(self, edx, object, creature, count);
  HireEntry *e = source_entry_of(creature);
  return e && count > 0 && count <= e->count ? 1 : 0;
}

// --- opening it ----------------------------------------------------------------------

static int hire_screen_ready(void) {
  if (g_createHireScreen) return 1;
  if (!count_window_ready()) return 0; /* the allocator and the screen on screen */
  /* Both are race-order's statics and it fills them only for a race with a
     picture of its own, so they are asked for here rather than assumed. */
  if (!g_engineFree) {
    g_engineFree = (EngineFreeFn)code_at(ENGINE_FREE_RVA, ENGINE_FREE_HEAD, sizeof ENGINE_FREE_HEAD, "engine free");
  }
  if (!g_objectRelease) {
    g_objectRelease = (ObjectReleaseFn)code_at(OBJECT_RELEASE_RVA, OBJECT_RELEASE_HEAD,
                                               sizeof OBJECT_RELEASE_HEAD, "object release");
  }
  CreateHireScreenFn create = (CreateHireScreenFn)code_at(CREATE_HIRE_SCREEN_RVA, CREATE_HIRE_SCREEN_HEAD,
                                                          sizeof CREATE_HIRE_SCREEN_HEAD, "the hire screen's request");
  g_pushScreenRequest = (PushScreenRequestFn)code_at(PUSH_SCREEN_REQUEST_RVA, PUSH_SCREEN_REQUEST_HEAD,
                                                     sizeof PUSH_SCREEN_REQUEST_HEAD, "the interface stack's take");
  g_townSoundBuilder = (TownSoundBuilderFn)code_at(TOWN_SOUND_BUILDER_RVA, TOWN_SOUND_BUILDER_HEAD,
                                                   sizeof TOWN_SOUND_BUILDER_HEAD, "the town's sound builder");
  g_sourceEntries = code_at(SOURCE_ENTRIES_RVA, SOURCE_ENTRIES_HEAD, sizeof SOURCE_ENTRIES_HEAD, "a source's entries");
  g_sourceCopy = code_at(SOURCE_COPY_RVA, SOURCE_COPY_HEAD, sizeof SOURCE_COPY_HEAD, "a source's copy");
  g_sourceItems = code_at(SOURCE_ITEMS_RVA, SOURCE_ITEMS_HEAD, sizeof SOURCE_ITEMS_HEAD, "a source's items");
  if (!g_engineFree || !g_objectRelease || !create || !g_pushScreenRequest || !g_townSoundBuilder
      || !g_sourceEntries || !g_sourceCopy || !g_sourceItems) return 0;
  g_createHireScreen = create;
  return 1;
}

/** The screen on screen as its whole object, when it is the one asked for. */
static BYTE *screen_up_of(DWORD vtableRva) {
  if (!g_currentScreen) return NULL;
  void *top = g_currentScreen();
  if (!top) return NULL;
  BYTE *screen = (BYTE *)whole_object_of(top);
  if (!readable(screen, 4)) return NULL;
  return *(BYTE **)screen == (BYTE *)GetModuleHandleW(NULL) + vtableRva ? screen : NULL;
}

/**
 * The screen, asked for the way the town screen's own hire button asks
 * (0x84FB60): the request built out of the town screen's fields, with a source
 * of ours where the town would stand; handed to the queue when there is one,
 * to the interface stack otherwise; the town screen told a child is up.
 *
 * ONLY FROM THE TOWN SCREEN for now — that is the opener that was read. The
 * adventure map has its own (a dwelling's visit, 0x767107), which is what a
 * building on the map or a spell would want; when it is written, this function
 * grows a second half and the script's call does not change.
 */
static int open_hire_screen(const int *creature, const int *count, int offers) {
  BYTE *screen = screen_up_of(TOWN_SCREEN_VTABLE_RVA);
  if (!screen) { log_line("H5EHireScreen: the town screen is not the screen on screen"); return 0; }
  if (!readable(screen + TOWN_SCREEN_CHILD_UP, 1) || !readable(screen + TOWN_SCREEN_QUEUE, 4)) return 0;
  if (screen[TOWN_SCREEN_CHILD_UP]) { log_line("H5EHireScreen: the town screen already has a child up"); return 0; }
  BYTE *town = (BYTE *)screen_town(screen);
  if (!town) { log_line("H5EHireScreen: the town screen shows no town"); return 0; }
  void *p0 = *(void **)(screen + TOWN_SCREEN_P0);
  void *p1 = *(void **)(screen + TOWN_SCREEN_P1);
  void *object = *(void **)(screen + TOWN_SCREEN_OBJECT);
  /* THE ADDRESS of the field, not its contents: the call site is `lea
     eax,[screen+0x19C]; push eax`, and the constructor refcounts what is AT
     that address — an object embedded in the screen. */
  void *p6 = screen + TOWN_SCREEN_P6;
  if (!p0 || !p1 || !object) { log_line("H5EHireScreen: the town screen is not shaped as measured"); return 0; }

  /* The army the screen SHOWS, down the engine's own chain — each step named,
     so one launch says which of them is not what it was read to be. */
  ObjectSlotFn holder_of = (ObjectSlotFn)vtable_entry(object, VT_OBJECT_HOLDER);
  void *holder = holder_of ? holder_of(object) : NULL;
  if (!holder || !town_alive(holder)) { log_line("H5EHireScreen: the screen's object holds nothing"); return 0; }
  ObjectSlotFn owner_of = (ObjectSlotFn)vtable_entry(holder, VT_HOLDER_OWNER);
  void *owner = owner_of ? owner_of(holder) : NULL;
  if (!owner || !town_alive(owner)) { log_line("H5EHireScreen: the holder answers with nothing"); return 0; }
  ObjectSlotFn garrison_of = (ObjectSlotFn)vtable_entry(owner, VT_TOWN_GARRISON);
  void *army = garrison_of ? garrison_of(owner) : NULL;
  if (!army || !town_alive(army)) { log_line("H5EHireScreen: the town has no army to show beside the offers"); return 0; }
  if (!source_build(town)) { log_line("H5EHireScreen: the town's object base is out of reach"); return 0; }
  int shown = source_fill(creature, count, offers);
  if (!shown) { log_line("H5EHireScreen: the list is empty, nothing to show"); return 0; }

  void *sound = g_townSoundBuilder(town_type_of(town));
  int number = 0;
  void *request = g_createHireScreen(p0, p1, SOURCE_OBJECT, object, army, &number, sound, p6, 1, 1, 1);
  if (!request) { log_line("H5EHireScreen: the request would not be built"); return 0; }
  /* Held while the stack takes it, as the engine holds its own; the stack keeps its own hold. */
  *(int *)((BYTE *)request + 8) += 1;
  void *queue = *(void **)(screen + TOWN_SCREEN_QUEUE);
  int taken = 0;
  if (queue && readable(queue, 8) && *(int *)((BYTE *)queue + 4) >= 0) {
    QueueTakeFn take = (QueueTakeFn)vtable_entry(p1, VT_QUEUE_TAKE);
    if (take) taken = take(p1, queue) & 0xFF;
  }
  if (!taken) g_pushScreenRequest(request);
  *(int *)((BYTE *)request + 8) -= 1;
  if (*(int *)((BYTE *)request + 8) == 0) g_objectRelease(request);
  screen[TOWN_SCREEN_CHILD_UP] = 1;
  g_hireOpen = 1;
  log_num("H5EHireScreen: the screen goes up with offers: ", shown);
  return 1;
}

// --- and what a script sees ------------------------------------------------------------

/**
 * `H5EHireScreen(creature, count, creature, count, …)` — the hire screen over
 * that list, on the town screen that is up.
 *
 * The pairs are read until they run out, so a list of one and a list of twenty
 * are the same call; the ORDER is the list's, the screen sorts nothing. A pair
 * whose creature is zero is skipped, which is what a script's empty slot is.
 */
static void *__fastcall lua_hire_screen(void *ctx) {
  if (!hire_screen_ready()) return NULL;
  int creature[HIRE_MOST];
  int count[HIRE_MOST];
  int offers = 0;
  for (int i = 0; i < HIRE_MOST; i++) {
    int id = 0;
    int many = 0;
    if (!lua_arg_int(ctx, 1 + i * 2, &id)) break;
    (void)lua_arg_int(ctx, 2 + i * 2, &many);
    creature[offers] = id > 0 ? id : 0;
    count[offers] = many > 0 ? many : 0;
    offers++;
  }
  if (!offers) {
    log_line("H5EHireScreen: takes pairs of creature and count, and was given none");
    return NULL;
  }
  if (g_hireOpen && screen_up_of(HIRE_SCREEN_VTABLE_RVA)) {
    log_line("H5EHireScreen: a hire screen of ours is already up");
    return NULL;
  }
  g_hireOpen = 0;
  (void)open_hire_screen(creature, count, offers);
  return NULL;
}

/** `H5EHireOpen()` — 1 while a hire screen of ours is the screen on screen. */
static void *__fastcall lua_hire_open(void *ctx) {
  if (g_hireOpen && !screen_up_of(HIRE_SCREEN_VTABLE_RVA)) g_hireOpen = 0;
  return (void *)(INT_PTR)lua_push_int(ctx, g_hireOpen);
}

static void add_hire_screen_map_functions(void) {
  add_map_function("H5EHireScreen", (void *)&lua_hire_screen);
  add_map_function("H5EHireOpen", (void *)&lua_hire_open);
}

/** The purchase is only ours when the source is: the detour is installed once, at start-up. */
static void install_hire_screen(void) {
  g_hireExecute = (HireExecuteFn)detour(HIRE_EXECUTE_RVA, HIRE_EXECUTE_HEAD, HIRE_EXECUTE_HEAD_LEN,
                                        (void *)&hire_execute_hook, "a creature purchase");
  if (!g_hireExecute) log_line("hire screen: a purchase in a screen of ours will be the engine's, which is wrong");
  /* The two gestures. Without the first there is no sale at all; without the
     second the button is the engine's to enable, which for a source of ours it
     cannot do. Both say so, because silence reads as "it never happened". */
  g_hireWindowHire = (HireWindowHireFn)detour(HIRE_WINDOW_HIRE_RVA, HIRE_WINDOW_HIRE_HEAD, HIRE_WINDOW_HIRE_HEAD_LEN,
                                              (void *)&hire_window_hire_hook, "the hire window's deed");
  g_hireWindowHire2 = (HireWindowHireFn)detour(HIRE_WINDOW_HIRE2_RVA, HIRE_WINDOW_HIRE_HEAD, HIRE_WINDOW_HIRE_HEAD_LEN,
                                               (void *)&hire_window_hire2_hook, "the hire window's question");
  log_line(g_hireWindowHire ? "hire screen: a sale of ours is heard at the window's own hire"
                            : "hire screen: the window's hire is NOT hooked, so nothing of ours can be bought");
  log_line(g_hireWindowHire2 ? "hire screen: and the window's question is answered out of the list"
                             : "hire screen: the window's question is NOT hooked, so its button is the engine's");
}
