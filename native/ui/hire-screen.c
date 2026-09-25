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
// over a list a script hands over: `H5EHireScreen(creature, count, price,
// …)`, the price in percent of the creature's own cost. It is NOT a refugee
// camp, not a dwelling and not a shop — it knows nothing about where the
// creatures came from, who is paying, or where they go. It asks what the
// engine's own screen asks before a purchase (what is left, room in the army,
// the money at the line's price) and every purchase that passes comes back to
// the map's Lua as an event:
//
//     H5EHireBought(creature, count)
//
// and what that means — the gold (`H5EHireCost` says what the screen showed),
// the army, a caravan, a quest — is the script's, written where the feature
// is written, down to what is left (`H5EHireLeft`). That division is the
// whole design: the extension opens doors the Lua does not have, and holds no
// state past the screen.
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

/**
 * THE QUESTION, ANSWERED THE ENGINE'S WAY. `Execute` (0xC60240) decides a
 * purchase with three calls, and a list of ours is asked the same three:
 *
 *   what is left    the source's `Available` ≥ count            (0xC6030E)
 *   room            `0xB433E0(army, creature)`, answers in al    (0xC60320)
 *   money           the payer's `vt+0xE0(int cost[7])`, al       (0xC6037B)
 *
 * — unless the command's free byte is set, which skips the money (0xC6032D).
 * The command gets all three from the words the two virtuals read around the
 * interface (0x83EA56…0x83EA88): the payer from `-0x0C` (the command's
 * `+0x10`), the army from `-0x04` (`+0x14`), the free byte at `+0x08`
 * (`+0x24`). Launch 51 is why: an army with seven stacks took the purchase,
 * the script's `AddObjectCreatures` found no slot, and the creatures were
 * simply gone — where the engine's own screen says "your army is full".
 */
#define WINDOW_PAYER_BACK 0x0Cu
#define WINDOW_ARMY_BACK 0x04u
#define WINDOW_FREE 0x08u
#define VT_CAN_PAY 0xE0u
/** Room for a stack of a creature in an army: `push esi; mov esi,ecx; call` — `__fastcall(army, creature)`, `ret`. */
#define ARMY_ROOM_RVA 0x7433e0u
static const BYTE ARMY_ROOM_HEAD[6] = { 0x56, 0x8B, 0xF1, 0xE8, 0x88, 0xFE };
/**
 * A line's price, as the window draws it (the refresh, 0x83F6F9, on the
 * selected line at `window+0x1A0`): `__thiscall(line, int out[7])`, `ret 4` —
 * the creature at `line+0x1C`, its record's `Cost` unpacked by `0xA458C0` into
 * seven resources. Detoured and REPLACED, never called through: the head is
 * `mov ecx,[ecx+1Ch]` and a relative call, which a trampoline cannot carry.
 */
#define LINE_COST_RVA 0x6ba5a0u
#define LINE_COST_HEAD_LEN 8
static const BYTE LINE_COST_HEAD[LINE_COST_HEAD_LEN] = { 0x8B, 0x49, 0x1C, 0xE8, 0x88, 0xD0, 0x06, 0x00 };
#define LINE_CREATURE 0x1Cu

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
typedef int (__fastcall *ArmyRoomFn)(void *army, int creature);
typedef int (__thiscall *CanPayFn)(void *payer, const int *cost);

static CreateHireScreenFn g_createHireScreen = NULL;
static PushScreenRequestFn g_pushScreenRequest = NULL;
static TownSoundBuilderFn g_townSoundBuilder = NULL;
static HireExecuteFn g_hireExecute = NULL;
static HireWindowHireFn g_hireWindowHire = NULL;
static HireWindowHireFn g_hireWindowHire2 = NULL;
static ArmyRoomFn g_armyRoom = NULL;
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
/**
 * Each line's price, in percent of the creature's own cost — beside the
 * entries rather than in them, because an entry is the engine's sixteen bytes.
 * Same index as the entry. The SCRIPT's number: a tier half price, a first
 * tier free, free for a hero with some skill — whatever it decided at opening.
 */
static int g_hirePercent[HIRE_MOST];
/** The hire screen that shows the list of ours, caught when it asks the list something; nothing when another is up. */
static void *g_ourHireScreen = NULL;

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
static int source_fill(const int *creature, const int *count, const int *percent, int offers) {
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
    g_hirePercent[at] = percent[i] < 0 ? 0 : percent[i];
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
    log_num("hire screen:                    price % ", g_hirePercent[e - v->begin]);
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

/** The screen on top, as its whole object, or nothing. */
static void *top_screen(void) {
  if (!g_currentScreen) return NULL;
  void *top = g_currentScreen();
  return top ? whole_object_of(top) : NULL;
}

/**
 * What `count` of a creature cost on the open list, the seven resources in the
 * record's order (Wood … Gold, the Lua's WOOD … GOLD): the creature's own cost
 * times the line's percent, rounded down. 0 when the list does not hold it.
 */
static int hire_cost(int creature, int count, int out[COST_RESOURCES]) {
  for (int i = 0; i < COST_RESOURCES; i++) out[i] = 0;
  HireEntry *e = source_entry_of(creature);
  BYTE *record = creature_record(creature);
  if (!e || !record) return 0;
  long long percent = g_hirePercent[e - source_vector()->begin];
  for (int i = 0; i < COST_RESOURCES; i++) {
    out[i] = (int)((long long)*(int *)(record + RECORD_COST + i * 4) * count * percent / 100);
  }
  return 1;
}

/**
 * Why the window may NOT hire that many of a creature from the list of ours, or
 * nothing when it may — the engine's three questions (THE QUESTION, above),
 * asked with the line's own price.
 */
static const char *hire_refusal(void *self, int creature, int count) {
  HireEntry *e = source_entry_of(creature);
  if (!e || count <= 0 || count > e->count) return "not that many left";
  BYTE *sub = (BYTE *)self;
  if (!readable(sub - WINDOW_PAYER_BACK, WINDOW_PAYER_BACK + WINDOW_FREE + 1)) return "the window is not shaped as measured";
  void *army = *(void **)(sub - WINDOW_ARMY_BACK);
  if (g_armyRoom && army && town_alive(army) && !(g_armyRoom(army, creature) & 0xFF)) return "no room in the army";
  if (!sub[WINDOW_FREE]) {
    void *payer = *(void **)(sub - WINDOW_PAYER_BACK);
    CanPayFn can = payer && town_alive(payer) ? (CanPayFn)vtable_entry(payer, VT_CAN_PAY) : NULL;
    int cost[COST_RESOURCES];
    hire_cost(creature, count, cost);
    if (can && !(can(payer, cost) & 0xFF)) return "the player cannot pay";
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
  g_ourHireScreen = top_screen(); /* only a screen of ours asks the list anything */
  HireEntry *e = source_entry_of(creature);
  log_num("hire screen: asked how many of creature ", creature);
  log_num("hire screen:                    answered ", e ? e->count : 0);
  return e ? e->count : 0;
}

/** Slot +0x10: the screen's lines, the engine's own — with a word about being asked. */
static int __fastcall source_items(void *self, void *edx, void *out) {
  log_line("hire screen: the screen asked for the lines");
  g_ourHireScreen = top_screen();
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
 * THE DEED: the player pressed hire. For a list of ours the extension decides
 * nothing: it asks the engine's three questions once more (the state can have
 * moved since the button was lit) and, if they all say yes, tells the map. The
 * SCRIPT sells — takes the money, gives the creatures — and says what is left
 * with `H5EHireLeft`, which it does inside this very call (the event is run by
 * one tick of the scheduler before this returns); the window reads the list
 * again right after (`Available`, launch 50), so the screen shows what the
 * script decided. A script that refuses leaves the line as it was — launch 51
 * sold five executioners out of the screen that the script had refused.
 */
static int __fastcall hire_window_hire_hook(void *self, void *edx, void *object, int creature, int count) {
  if (!window_sells_ours(self)) return g_hireWindowHire(self, edx, object, creature, count);
  const char *why = hire_refusal(self, creature, count);
  if (why) {
    log_num("hire screen: hire pressed and refused, creature ", creature);
    log_text("hire screen:   because ", why);
    return 0;
  }
  log_num("hire screen: the player hires ", count);
  log_num("             of creature ", creature);
  hire_say_bought(creature, count);
  return 0; /* the engine's own path answers with nothing the caller reads */
}

/**
 * THE QUESTION: may he hire that many? Asked over and over while the window is
 * up, so it says nothing and builds nothing — the engine's three questions,
 * with the line's price, are the whole answer. The button goes dark exactly
 * where the engine's own would: nothing left, no room, no money.
 */
static int __fastcall hire_window_hire2_hook(void *self, void *edx, void *object, int creature, int count) {
  if (!window_sells_ours(self)) {
    g_ourHireScreen = NULL; /* a window of the engine's is the one up now */
    return g_hireWindowHire2(self, edx, object, creature, count);
  }
  g_ourHireScreen = top_screen();
  return hire_refusal(self, creature, count) ? 0 : 1;
}

/** Is the screen on top the one showing the list of ours? */
static int our_screen_on_top(void) {
  BYTE *top = (BYTE *)top_screen();
  return top && top == g_ourHireScreen && readable(top, 4)
      && *(BYTE **)top == (BYTE *)GetModuleHandleW(NULL) + HIRE_SCREEN_VTABLE_RVA;
}

/**
 * A line's price, REPLACING the engine's (LINE_COST_RVA): the record's cost,
 * unpacked as `0xA458C0` does — and for a line of ours, times its percent, so
 * the price the window shows (and paints red when it is too much) is the one
 * the script will charge.
 */
static int *__fastcall line_cost_hook(void *line, void *edx, int *out) {
  (void)edx;
  int creature = *(int *)((BYTE *)line + LINE_CREATURE);
  if (our_screen_on_top() && source_entry_of(creature)) {
    hire_cost(creature, 1, out);
    return out;
  }
  BYTE *record = creature_record(creature);
  for (int i = 0; i < COST_RESOURCES; i++) out[i] = record ? *(int *)(record + RECORD_COST + i * 4) : 0;
  return out;
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
static int open_hire_screen(const int *creature, const int *count, const int *percent, int offers) {
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
  int shown = source_fill(creature, count, percent, offers);
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
 * `H5EHireScreen(creature, count, price, creature, count, price, …)` — the hire
 * screen over that list, on the town screen that is up.
 *
 * THREE A LINE: the creature, how many are on offer, and its PRICE in percent
 * of the creature's own cost (all seven resources scaled alike, rounded down):
 * 100 the ordinary, 200 double, 50 half, 0 free. The price is the script's to
 * decide per line and per opening — a tier cheaper, a first tier free, free for
 * a hero with some skill (Senya, 2026-09-25) — and the screen shows it, paints
 * it red when the player cannot pay, and refuses the purchase as the engine's
 * own screen would. A last line without its price is at 100.
 *
 * The lines are read until they run out, so a list of one and a list of twenty
 * are the same call; the ORDER is the list's, the screen sorts nothing. A line
 * whose creature is zero is skipped, which is what a script's empty slot is.
 */
static void *__fastcall lua_hire_screen(void *ctx) {
  if (!hire_screen_ready()) return NULL;
  int creature[HIRE_MOST];
  int count[HIRE_MOST];
  int percent[HIRE_MOST];
  int offers = 0;
  for (int i = 0; i < HIRE_MOST; i++) {
    int id = 0;
    int many = 0;
    int price = 100;
    if (!lua_arg_int(ctx, 1 + i * 3, &id)) break;
    (void)lua_arg_int(ctx, 2 + i * 3, &many);
    (void)lua_arg_int(ctx, 3 + i * 3, &price);
    creature[offers] = id > 0 ? id : 0;
    count[offers] = many > 0 ? many : 0;
    percent[offers] = price > 0 ? price : 0;
    offers++;
  }
  if (!offers) {
    log_line("H5EHireScreen: takes lines of creature, count and price, and was given none");
    return NULL;
  }
  if (g_hireOpen && screen_up_of(HIRE_SCREEN_VTABLE_RVA)) {
    log_line("H5EHireScreen: a hire screen of ours is already up");
    return NULL;
  }
  g_hireOpen = 0;
  g_ourHireScreen = NULL;
  (void)open_hire_screen(creature, count, percent, offers);
  return NULL;
}

/** `H5EHireOpen()` — 1 while a hire screen of ours is the screen on screen. */
static void *__fastcall lua_hire_open(void *ctx) {
  if (g_hireOpen && !screen_up_of(HIRE_SCREEN_VTABLE_RVA)) g_hireOpen = 0;
  return (void *)(INT_PTR)lua_push_int(ctx, g_hireOpen);
}

/**
 * `H5EHireLeft(creature, count)` — how many of a creature the open screen has
 * left: what a script says after it sold (or did not). Called from
 * `H5EHireBought`, it lands before the window reads the list again, so the
 * screen shows the script's answer at once. A creature the list does not hold
 * is nothing.
 */
static void *__fastcall lua_hire_left(void *ctx) {
  int creature = 0;
  int left = 0;
  if (!lua_arg_int(ctx, 1, &creature) || !lua_arg_int(ctx, 2, &left)) {
    log_line("H5EHireLeft: takes a creature and how many are left");
    return NULL;
  }
  HireEntry *e = source_entry_of(creature);
  if (!e) { log_num("H5EHireLeft: the list does not hold creature ", creature); return NULL; }
  e->count = left < 0 ? 0 : left;
  log_num("H5EHireLeft: creature ", creature);
  log_num("             now left ", e->count);
  return NULL;
}

/**
 * `H5EHireCost(creature, count [, resource])` — what that many cost on the open
 * screen, in one resource (the Lua's WOOD … GOLD; gold without it): exactly the
 * number the screen showed and checked, so the script charges what the player
 * saw. Nothing for a creature the list does not hold.
 */
static void *__fastcall lua_hire_cost(void *ctx) {
  int creature = 0;
  int count = 0;
  int resource = COST_GOLD;
  if (!lua_arg_int(ctx, 1, &creature) || !lua_arg_int(ctx, 2, &count)) return NULL;
  (void)lua_arg_int(ctx, 3, &resource);
  if (resource < 0 || resource >= COST_RESOURCES) return NULL;
  int cost[COST_RESOURCES];
  if (!hire_cost(creature, count, cost)) return NULL;
  return (void *)(INT_PTR)lua_push_int(ctx, cost[resource]);
}

static void add_hire_screen_map_functions(void) {
  add_map_function("H5EHireScreen", (void *)&lua_hire_screen);
  add_map_function("H5EHireOpen", (void *)&lua_hire_open);
  add_map_function("H5EHireLeft", (void *)&lua_hire_left);
  add_map_function("H5EHireCost", (void *)&lua_hire_cost);
}

/** The purchase is only ours when the source is: the detours are installed once, at start-up. */
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
  log_line(g_hireWindowHire2 ? "hire screen: and the window's question is answered the engine's way"
                             : "hire screen: the window's question is NOT hooked, so its button is the engine's");
  /* The room question is called, never hooked; the price is replaced whole. */
  g_armyRoom = (ArmyRoomFn)code_at(ARMY_ROOM_RVA, ARMY_ROOM_HEAD, sizeof ARMY_ROOM_HEAD, "an army's room for a stack");
  if (!g_armyRoom) log_line("hire screen: a full army is not asked about, so a purchase can find no room");
  if (!detour(LINE_COST_RVA, LINE_COST_HEAD, LINE_COST_HEAD_LEN, (void *)&line_cost_hook, "a hire line's price")) {
    log_line("hire screen: the window shows the creature's own price, not the list's");
  }
}
