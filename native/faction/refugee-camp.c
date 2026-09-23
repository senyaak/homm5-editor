// A refugee camp of ours: the game's hire screen over a source of ours.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_refugee_camp

// ---------------------------------------------------------------------------
// WHAT THIS IS. A building of a faction of ours that hires creatures the town's
// dwellings do not: a stock rolled by the map's Lua, sold through the game's
// own hire screen, into the town's garrison, at the creature's own price. The
// town's hire vector is never touched — the screen is shown a SOURCE OF OURS.
//
// THE SCREEN IS ONE SCREEN. `HIRE_CREATURES` serves towns, map dwellings and
// caravans alike, and what tells them apart is an interface each of them
// carries as a virtual base — five slots (docs/FACTION_PLAN.md §2b):
//
//   +0x00  vector<Entry>* Entries()          the raw entries, at `this-0x44`
//   +0x04  CopyEntries(vector<Entry>* out)   `ret 4`
//   +0x08  Take(creature, count)             `ret 8` — a purchase, subtracted
//   +0x0C  Available(creature)               `ret 4` — an entry's count
//   +0x10  Items(vector<Item>* out)          `ret 4` — the screen's lines
//
// where an Entry is sixteen bytes, `{count, vector<creature>}`. Three of the
// five read nothing but the vector at `this-0x44`, so the engine's own code
// answers them on an object of ours laid out the same way; `Take` is ours,
// because the engine's ends by telling a dwelling it changed, and there is no
// dwelling.
//
// WHAT THE ENGINE ASKS OF THE OBJECT BESIDES ITS SLOTS. Two things, both read
// off `[obj+4]`, the vbtable: the word at `vbtable[4]` is the displacement to
// a base whose `+8` is a liveness count (negative when dead) and whose `+0xC`
// is the reference count the screen and the purchase command raise and lower;
// the word at `vbtable[8]` is the displacement to the object base whose
// virtuals answer who owns it (the purchase compares that with the buyer's
// side). The first is ours, held out of reach of zero the way the count
// window's controller is held (native/ui/count-window.c); the second is THE
// TOWN'S OWN — a displacement is only a difference of two addresses, so the
// vbtable of ours points at the base the town already has, and every question
// about ownership is answered by the engine on the town.
//
// THE PURCHASE is the engine's `CHireCreaturesCmd`: it asks the source
// `Available(creature) >= count`, asks the army for room, pays the player,
// calls `Take`, and adds the stack. Its serializer writes its objects by world
// id, which ours has none of — so this is a single-player thing, which a map's
// Lua already is (docs/engineInternals: "Lua в мультиплеере выключен").
//
// THE STOCK IS NOT KEPT HERE. The script rolls it, hands it over, and hears
// about every purchase as it happens — see "what the DLL does NOT do" below.

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
/** The dwelling's three slots the engine answers on a vector at `this-0x44`. */
#define SOURCE_ENTRIES_RVA 0x90ffe0u
static const BYTE SOURCE_ENTRIES_HEAD[4] = { 0x8D, 0x41, 0xBC, 0xC3 };
#define SOURCE_COPY_RVA 0x90fff0u
static const BYTE SOURCE_COPY_HEAD[8] = { 0x51, 0x53, 0x8B, 0x5C, 0x24, 0x0C, 0x85, 0xDB };
#define SOURCE_ITEMS_RVA 0x9101b0u
static const BYTE SOURCE_ITEMS_HEAD[8] = { 0x83, 0xEC, 0x40, 0x53, 0x8B, 0x5C, 0x24, 0x48 };
/* A creature's record, or nothing for an id the table lacks: `CREATURE_RECORD_RVA`
   is anchored by native/qol/pandora-notify.c, which this file follows. */
/** How many creatures there are — `mov eax,imm32; ret`, the immediate being what the installer set. */
#define CREATURE_COUNT_RVA 0x69efa0u
#define CREATURE_COUNT_OPCODE 0xB8
#define CREATURE_COUNT_RET_AT 5
/** The creature record's fields, as its serializer names them (0xA85F80…). */
#define RECORD_TIER 0x8Cu
#define RECORD_TOWN 0x98u
#define RECORD_GROWTH 0xA8u

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
 * The chain the engine's own hire button walks to the army, reproduced rather
 * than guessed: the screen's object at `+0x220`, its `vt+0x90`, that thing's
 * `vt+0x04`, and THAT thing's `vt+0x2C` — the garrison. 0x84FB60 then replaces
 * it with the visiting hero's army; ours never does, because a camp of ours
 * sells into the town the way a dwelling on the map sells into whoever stands
 * on it, and the town is what the player came to.
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
typedef void *(__fastcall *CreatureRecordFn)(int creature);
typedef int (__cdecl *CreatureCountFn)(void);
/** Any slot of the engine's that takes nothing and answers with an object. */
typedef void *(__thiscall *ObjectSlotFn)(void *self);
typedef int (__thiscall *QueueTakeFn)(void *queue, void *request);

static CreateHireScreenFn g_createHireScreen = NULL;
static PushScreenRequestFn g_pushScreenRequest = NULL;
static TownSoundBuilderFn g_townSoundBuilder = NULL;
static CreatureRecordFn g_creatureRecord = NULL;
static CreatureCountFn g_creatureCount = NULL;
static void *g_sourceEntries = NULL;
static void *g_sourceCopy = NULL;
static void *g_sourceItems = NULL;

// --- what the DLL does NOT do: keep the stock -----------------------------------
//
// THE LOGIC IS THE MAP'S LUA, all of it. This file opens a screen and reports
// what happened in it; a week, a stock, a price, what is left after a purchase
// — none of that is here, and nothing here writes a game variable. The first
// version did keep the numbers and write them, and it was the wrong shape: the
// camp is a feature somebody AUTHORS, and an authored feature that needs a new
// DLL to change its mind is not authored at all.
//
// A PURCHASE IS AN EVENT, said to the map the way the town screen's own button
// says a click (native/faction/town-button.c): the line is run and the
// scheduler ticked once, so it happens WHILE the screen is up rather than
// whenever the world next gets a turn — which under a town screen is never.
// The script defines the handler; a map without one is not an error, which is
// what the `~= nil` guard is for.
//
//     H5ECampBought("<town>", <creature>, <count>)

#define CAMP_OFFERS 3
#define CAMP_NAME_ROOM 64

/* Ours rather than the runtime's: the DLL imports the C library because Zig
   serves `windows.h` as part of it, and calls none of it (src/mods/extension.ts). */
static int same_name(const char *a, const char *b) {
  for (; *a && *a == *b; a++, b++) { }
  return *a == *b;
}

static void append_text(char *out, int *at, int room, const char *text) {
  while (*text && *at < room - 1) out[(*at)++] = *text++;
  out[*at] = 0;
}

static void append_num(char *out, int *at, int room, int value) {
  char text[12];
  int len = 0;
  num_to_dec(value, text, &len);
  text[len] = 0;
  append_text(out, at, room, text);
}

/** The town whose stock is on screen, so a purchase can name it to the script. */
static char g_shownTown[CAMP_NAME_ROOM];

/** One purchase, told to the map's Lua. */
static void camp_say_bought(const char *town, int creature, int count) {
  char line[256];
  int at = 0;
  line[0] = 0;
  append_text(line, &at, sizeof line, "if H5ECampBought ~= nil then H5ECampBought(\"");
  append_text(line, &at, sizeof line, town);
  append_text(line, &at, sizeof line, "\", ");
  append_num(line, &at, sizeof line, creature);
  append_text(line, &at, sizeof line, ", ");
  append_num(line, &at, sizeof line, count);
  append_text(line, &at, sizeof line, "); end;");
  if (!say_to_the_map(line)) {
    log_line("refugee camp: the purchase could not be told to the map — no script of ours has fetched it yet");
    return;
  }
  log_text("refugee camp: said to the map: ", line);
  if (!tick_the_map_scripts()) log_line("refugee camp:   but the scheduler could not be ticked, so it runs later");
}

// --- the source -----------------------------------------------------------------
//
// Bytes rather than a struct, on purpose: the engine says exactly where its
// words are and C says nothing about where it would put a member. The vector
// the engine's three slots read sits 0x44 bytes BEFORE the object, so the
// block starts there.

/** An entry as the engine keeps one: a count and a vector of creature ids. */
typedef struct { int count; int *begin; int *end; int *cap; } HireEntry;
/** A vector of them: three words. */
typedef struct { HireEntry *begin; HireEntry *end; HireEntry *cap; } HireVector;

#define SOURCE_VECTOR_BACK 0x44u
#define SOURCE_VB_REFS 0x10u
#define SOURCE_ALIVE_AT (SOURCE_VB_REFS + 8)
#define SOURCE_HELD_AT (SOURCE_VB_REFS + 12)
#define SOURCE_BYTES (SOURCE_HELD_AT + 4)
#define SOURCE_SLOTS 16
#define SOURCE_HELD 0x40000000

static BYTE g_sourceBlock[SOURCE_VECTOR_BACK + SOURCE_BYTES];
#define SOURCE_OBJECT (g_sourceBlock + SOURCE_VECTOR_BACK)
/** A NULL where a complete-object locator would be, so a reader of `[vtable-4]` finds nothing rather than something. */
static void *g_sourceVtableWithLocator[1 + SOURCE_SLOTS];
#define g_sourceVtable (g_sourceVtableWithLocator + 1)
/** `[0]` the vbptr's offset within the object, `[4]` our reference words, `[8]` the town's object base. */
static int g_sourceVbtable[4];

/** The screen of ours that is up, or nothing — for `H5ECampOpen`. */
static int g_campOpen = 0;

static HireVector *source_vector(void) { return (HireVector *)g_sourceBlock; }

static void source_free_entries(void) {
  HireVector *v = source_vector();
  if (!v->begin) return;
  for (HireEntry *e = v->begin; e < v->end; e++) if (e->begin) g_engineFree(e->begin);
  g_engineFree(v->begin);
  v->begin = v->end = v->cap = NULL;
}

/**
 * The entries, out of the stock — allocated with the engine's own allocator,
 * because the engine copies them with its own vector code and frees what it
 * copied with its own free, and a static of ours handed to that is a crash.
 */
static int source_fill(const int *creature, const int *count) {
  source_free_entries();
  int n = 0;
  for (int i = 0; i < CAMP_OFFERS; i++) if (creature[i] > 0) n++;
  if (!n) return 0;
  HireEntry *entries = (HireEntry *)g_allocate(sizeof(HireEntry) * (SIZE_T)n);
  if (!entries) return 0;
  int at = 0;
  for (int i = 0; i < CAMP_OFFERS; i++) {
    if (creature[i] <= 0) continue;
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
  v->end = entries + n;
  v->cap = entries + n;
  return n;
}

/** The entry that lists a creature, or nothing. */
static HireEntry *source_entry_of(int creature) {
  HireVector *v = source_vector();
  for (HireEntry *e = v->begin; e < v->end; e++) {
    for (int *c = e->begin; c < e->end; c++) if (*c == creature) return e;
  }
  return NULL;
}

/**
 * Slot +0x08: a purchase. The engine's own subtracts and floors at zero; ours
 * also writes the number into the map's variables THERE AND THEN, so a save
 * taken without leaving the town screen has it.
 */
static void __fastcall source_take(void *self, void *edx, int creature, int count) {
  (void)self; (void)edx;
  HireEntry *e = source_entry_of(creature);
  if (!e) { log_num("refugee camp: a purchase of a creature the stock lacks, ", creature); return; }
  e->count -= count;
  if (e->count < 0) e->count = 0;
  log_num("refugee camp: bought ", count);
  log_num("              of creature ", creature);
  log_num("              left ", e->count);
  if (g_shownTown[0]) camp_say_bought(g_shownTown, creature, count);
}

/** Slot +0x0C: what is left of a creature. */
static int __fastcall source_available(void *self, void *edx, int creature) {
  (void)self; (void)edx;
  HireEntry *e = source_entry_of(creature);
  return e ? e->count : 0;
}

/** A slot the engine asked that was not measured — named, so the run says which. */
#define SOURCE_STUB(n) \
  static int __fastcall source_stub_##n(void *self, void *edx) { \
    (void)self; (void)edx; \
    log_hex("refugee camp: the screen asked the source an unmeasured slot +", (n) * 4); \
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
  g_sourceVtable[0x10 / 4] = g_sourceItems;
  g_sourceVtableWithLocator[0] = NULL;

  BYTE *self = SOURCE_OBJECT;
  g_sourceVbtable[0] = -4;
  g_sourceVbtable[1] = (int)SOURCE_VB_REFS;
  g_sourceVbtable[2] = (int)(townBase - (self + 4));
  g_sourceVbtable[3] = 0;
  *(void ***)(self + 0) = g_sourceVtable;
  *(int **)(self + 4) = g_sourceVbtable;
  *(int *)(self + SOURCE_ALIVE_AT) = 0;
  *(int *)(self + SOURCE_HELD_AT) = SOURCE_HELD;
  return 1;
}

// --- opening the screen ----------------------------------------------------------

static int refugee_camp_ready(void) {
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
  g_creatureRecord = (CreatureRecordFn)code_at(CREATURE_RECORD_RVA, CREATURE_RECORD_HEAD,
                                               sizeof CREATURE_RECORD_HEAD, "a creature's record");
  BYTE *count = (BYTE *)GetModuleHandleW(NULL) + CREATURE_COUNT_RVA;
  if (count[0] == CREATURE_COUNT_OPCODE && count[CREATURE_COUNT_RET_AT] == 0xC3) g_creatureCount = (CreatureCountFn)count;
  else log_line("refugee camp: the creature count is not where it was measured");
  if (!g_engineFree || !g_objectRelease || !create || !g_pushScreenRequest || !g_townSoundBuilder || !g_sourceEntries
      || !g_sourceCopy || !g_sourceItems || !g_creatureRecord || !g_creatureCount) return 0;
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
 * The screen, the way the town screen's own hire button asks for it (0x84FB60):
 * the request built out of the town screen's fields, with a source of ours
 * where the town would stand and the garrison for the army whether or not a
 * hero is in; handed to the queue when there is one, to the interface stack
 * otherwise; the town screen told a child is up.
 */
static int open_camp_screen(const char *townName, const int *creature, const int *count) {
  BYTE *screen = screen_up_of(TOWN_SCREEN_VTABLE_RVA);
  if (!screen) { log_line("H5ECampScreen: the town screen is not the screen on screen"); return 0; }
  if (!readable(screen + TOWN_SCREEN_CHILD_UP, 1) || !readable(screen + TOWN_SCREEN_QUEUE, 4)) return 0;
  if (screen[TOWN_SCREEN_CHILD_UP]) { log_line("H5ECampScreen: the town screen already has a child up"); return 0; }
  BYTE *town = (BYTE *)screen_town(screen);
  if (!town) { log_line("H5ECampScreen: the town screen shows no town"); return 0; }
  char name[CAMP_NAME_ROOM];
  town_name_of(town, name, sizeof name);
  if (!same_name(name, townName)) {
    log_text("H5ECampScreen: the screen shows another town: ", name);
    return 0;
  }
  void *p0 = *(void **)(screen + TOWN_SCREEN_P0);
  void *p1 = *(void **)(screen + TOWN_SCREEN_P1);
  void *object = *(void **)(screen + TOWN_SCREEN_OBJECT);
  /* THE ADDRESS of the field, not its contents: the call site is `lea
     eax,[screen+0x19C]; push eax`, and the constructor refcounts what is AT
     that address — an object embedded in the screen. */
  void *p6 = screen + TOWN_SCREEN_P6;
  if (!p0 || !p1 || !object) { log_line("H5ECampScreen: the town screen is not shaped as measured"); return 0; }

  /* The army, down the engine's own chain — each step named, so one launch
     says which of them is not what it was read to be. */
  ObjectSlotFn holder_of = (ObjectSlotFn)vtable_entry(object, VT_OBJECT_HOLDER);
  void *holder = holder_of ? holder_of(object) : NULL;
  if (!holder || !town_alive(holder)) { log_line("H5ECampScreen: the screen's object holds nothing"); return 0; }
  ObjectSlotFn owner_of = (ObjectSlotFn)vtable_entry(holder, VT_HOLDER_OWNER);
  void *owner = owner_of ? owner_of(holder) : NULL;
  if (!owner || !town_alive(owner)) { log_line("H5ECampScreen: the holder answers with nothing"); return 0; }
  ObjectSlotFn garrison_of = (ObjectSlotFn)vtable_entry(owner, VT_TOWN_GARRISON);
  void *army = garrison_of ? garrison_of(owner) : NULL;
  if (!army || !town_alive(army)) { log_line("H5ECampScreen: the town has no garrison to sell into"); return 0; }
  if (!source_build(town)) { log_line("H5ECampScreen: the town's object base is out of reach"); return 0; }
  if (!source_fill(creature, count)) { log_line("H5ECampScreen: the stock is empty, nothing to show"); return 0; }
  int at = 0;
  while (townName[at] && at < CAMP_NAME_ROOM - 1) { g_shownTown[at] = townName[at]; at++; }
  g_shownTown[at] = 0;

  void *sound = g_townSoundBuilder(town_type_of(town));
  int number = 0;
  void *request = g_createHireScreen(p0, p1, SOURCE_OBJECT, object, army, &number, sound, p6, 1, 1, 1);
  if (!request) { log_line("H5ECampScreen: the request would not be built"); return 0; }
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
  g_campOpen = 1;
  log_text("H5ECampScreen: the hire screen goes up for ", name);
  return 1;
}

// --- and what a script sees ----------------------------------------------------------

/**
 * `H5ECreatures([minTier, maxTier])` — every creature id the game has, the
 * mod's own included (the table is read to its ceiling, not a list), within the
 * tiers asked; every one of them a result, so `{ H5ECreatures(3, 6) }` is the
 * table a script rolls from.
 */
static void *__fastcall lua_creatures(void *ctx) {
  if (!refugee_camp_ready()) return NULL;
  int lo = 0, hi = 99;
  (void)lua_arg_int(ctx, 1, &lo);
  (void)lua_arg_int(ctx, 2, &hi);
  int n = g_creatureCount();
  int pushed = 0;
  for (int id = 1; id < n; id++) {
    BYTE *record = (BYTE *)g_creatureRecord(id);
    if (!record || !readable(record + RECORD_TIER, 4)) continue;
    int tier = *(int *)(record + RECORD_TIER);
    if (tier < lo || tier > hi) continue;
    if (!lua_push_int(ctx, id)) break;
    pushed++;
  }
  return (void *)(INT_PTR)pushed;
}

/** `H5ECreatureGrowth(creature)` — what a week of it is, the number the shipped camp stocks. */
static void *__fastcall lua_creature_growth(void *ctx) {
  if (!refugee_camp_ready()) return NULL;
  int creature = 0;
  if (!lua_arg_int(ctx, 1, &creature) || creature <= 0) return NULL;
  BYTE *record = (BYTE *)g_creatureRecord(creature);
  if (!record || !readable(record + RECORD_GROWTH, 4)) return NULL;
  return (void *)(INT_PTR)lua_push_int(ctx, *(int *)(record + RECORD_GROWTH));
}

/**
 * `H5ECampScreen(town, creature1, count1, creature2, count2, creature3, count3)`
 * — the hire screen over that stock, on the town screen that is up.
 *
 * Every number is the script's: what is offered, how many there are, and what
 * to do about a purchase (`H5ECampBought`). Nothing of it is remembered here
 * past the screen.
 */
static void *__fastcall lua_camp_screen(void *ctx) {
  if (!refugee_camp_ready()) return NULL;
  void *nameObject = lua_arg_string(ctx, 1);
  char town[CAMP_NAME_ROOM];
  if (!nameObject || !name_string_into((const NameString *)nameObject, town, sizeof town)) {
    log_line("H5ECampScreen: takes the town's name first");
    return NULL;
  }
  int creature[CAMP_OFFERS];
  int count[CAMP_OFFERS];
  for (int i = 0; i < CAMP_OFFERS; i++) {
    creature[i] = 0;
    count[i] = 0;
    (void)lua_arg_int(ctx, 2 + i * 2, &creature[i]);
    (void)lua_arg_int(ctx, 3 + i * 2, &count[i]);
    if (creature[i] < 0) creature[i] = 0;
    if (count[i] < 0) count[i] = 0;
  }
  if (g_campOpen && screen_up_of(HIRE_SCREEN_VTABLE_RVA)) {
    log_line("H5ECampScreen: a hire screen of ours is already up");
    return NULL;
  }
  g_campOpen = 0;
  (void)open_camp_screen(town, creature, count);
  return NULL;
}

/** `H5ECampOpen()` — 1 while the hire screen of ours is the screen on screen. */
static void *__fastcall lua_camp_open(void *ctx) {
  if (g_campOpen && !screen_up_of(HIRE_SCREEN_VTABLE_RVA)) g_campOpen = 0;
  return (void *)(INT_PTR)lua_push_int(ctx, g_campOpen);
}

static void add_refugee_camp_map_functions(void) {
  add_map_function("H5ECreatures", (void *)&lua_creatures);
  add_map_function("H5ECreatureGrowth", (void *)&lua_creature_growth);
  add_map_function("H5ECampScreen", (void *)&lua_camp_screen);
  add_map_function("H5ECampOpen", (void *)&lua_camp_open);
}
