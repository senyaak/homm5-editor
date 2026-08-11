// Which specialization a hero holds — the one question a script cannot ask.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_hero_specialization

// ---------------------------------------------------------------------------
// `H5EHeroSpecialization(heroName)`.
//
// WHY IT HAS TO EXIST. A specialization that GIVES something can be written two
// ways. The build can write the gift onto every hero holding it, which is data
// and needs no code — and is the wrong answer, because then the engine knows
// nothing about the specialization at all: a hero the mod did not build gets
// nothing, and the connection exists only in a folder on disk. The other way is
// this one: the specialization is asked about AT RUN TIME, and a script hands
// out what it promises. For that a script needs to be able to ask, and the
// engine's 306 registered functions have no way to.
//
// HOW THE HERO IS REACHED, copied whole from `GetHeroLevel` (0x5d06e0), which
// is the shortest engine function that takes a hero's name and does something
// with the hero:
//
//   1. a small block on the stack — a vtable, a zero, the call context, a flag —
//      handed to `0xa455e0`, which answers with the thing every one of these
//      functions passes to the service lookup
//   2. `0x94ab92(that, 0, A, B, 0)` — an IMPORT THUNK, and the adventure map
//      comes back
//   3. `map->+0x14(name)` — the object of that name, or nothing
//   4. the liveness test every one of them makes before touching what it found
//
// and then `hero+0xEC`, which is where a specialization lives
// (docs/ENGINE_INTERNALS.md).
//
// WHAT IS COPIED AND WHAT IS ASSUMED, said apart. Copied: the four steps above,
// their argument counts (each read off the caller's stack cleanup) and the two
// constants. Assumed: that the string object on the VALUE STACK is the same
// thing the parser hands to step 3 — the engine's own `0xa2e2f0` reads a char*
// out of it at offset zero, and step 3's error path prints `[arg]` as a char*,
// so the two agree on the one field either of them touches. If that assumption
// is wrong the lookup answers with nothing rather than misbehaving, and the log
// line below is what says so.

/** `mov eax,[ecx+8]; push 0; …` — the block goes in, the lookup's first argument
 *  comes out. Two addresses share these bytes and either would do; this is the
 *  one `GetHeroLevel` uses. */
#define MAKE_LOOKUP_RVA 0x6455e0u
#define MAKE_LOOKUP_HEAD_LEN 5
static const BYTE MAKE_LOOKUP_HEAD[MAKE_LOOKUP_HEAD_LEN] = { 0x8B, 0x41, 0x08, 0x6A, 0x00 };

/** `jmp [<import>]` — the adventure map arrives through the import table, so
 *  only the two bytes of the jump are ours to recognise; the address after them
 *  is the loader's. */
#define GET_ADV_MAP_RVA 0x54ab92u
#define GET_ADV_MAP_HEAD_LEN 2
static const BYTE GET_ADV_MAP_HEAD[GET_ADV_MAP_HEAD_LEN] = { 0xFF, 0x25 };

/** The four words of the block, and the two constants the lookup is given. */
#define REPORTER_VTABLE_RVA 0xb50b4cu
#define LOOKUP_ARG_A_RVA 0xca79f8u
#define LOOKUP_ARG_B_RVA 0xcaa138u

/** `IAdvMapWorld::FindObjectByName`, as every hero function of theirs calls it. */
#define VT_FIND_BY_NAME 0x14u
/**
 * Where a `CHero` keeps the value this whole file exists to read.
 *
 * MEASURED, not taken from the page that says `+0xEC`. That number is real and
 * belongs to `CCombatHero`, which is what the first aid tent reaches — a
 * different class, and applying its offset here read a heap pointer. This one
 * was found by dumping every word of the object and looking: two heroes the mod
 * authored carry 84 and 85 at +0x8C, which are exactly the two values it
 * assigned them, and the three shipped heroes beside them carry 41, 30 and 26.
 *
 * Two numbers we chose ourselves, landing where nothing else could have put
 * them, is the strongest evidence available without a symbol.
 */
#define HERO_SPECIALIZATION 0x8Cu
/** The most a specialization value can be: the enum ends at 83 and ours follow. */
#define HERO_SPECIALIZATION_MAX 200

typedef void *(__fastcall *MakeLookupFn)(void *block, void *edx);
typedef void *(__cdecl *GetAdvMapFn)(void *lookup, int zero, void *a, void *b, int alsoZero);
typedef void *(__fastcall *FindByNameFn)(void *map, void *edx, void *name);
/** The hero's own question about himself — `VT_HAS_SPECIALIZATION`, the tent's. */
typedef int(__fastcall *HasSpecializationFn)(void *self, void *edx, int id);

static MakeLookupFn g_makeLookup = NULL;
static GetAdvMapFn g_getAdvMap = NULL;

static int hero_lookup_ready(void) {
  if (g_getAdvMap) return 1;
  g_makeLookup = (MakeLookupFn)code_at(MAKE_LOOKUP_RVA, MAKE_LOOKUP_HEAD, MAKE_LOOKUP_HEAD_LEN,
                                       "the service lookup");
  GetAdvMapFn map = (GetAdvMapFn)code_at(GET_ADV_MAP_RVA, GET_ADV_MAP_HEAD, GET_ADV_MAP_HEAD_LEN,
                                         "the adventure map import");
  if (!g_makeLookup || !map) return 0;
  g_getAdvMap = map;
  return 1;
}

/** Argument N as the engine's own string object — NOT as a char pointer, which
 *  is what `0xa2e2f0` would answer with and is one dereference too far. */
static void *lua_arg_string(void *ctx, int n) {
  BYTE *script = lua_script_of(ctx);
  if (!script) return NULL;
  int at = *(int *)(script + SCRIPT_BASE) + n - 1;
  if (at < 0 || at >= *(int *)(script + SCRIPT_TOP)) return NULL;
  BYTE *slots = *(BYTE **)(script + SCRIPT_SLOTS);
  if (!readable(slots, (SIZE_T)(at + 1) * SLOT_STRIDE)) return NULL;
  BYTE *slot = slots + (SIZE_T)at * SLOT_STRIDE;
  if (*(int *)slot != LUA_TYPE_STRING) return NULL;
  void *object = *(void **)(slot + SLOT_VALUE);
  return readable(object, 4) ? object : NULL;
}

/**
 * The characters inside one of the engine's string objects, into the log.
 *
 * A log that says a hero was not recognised, without saying WHICH hero, sends
 * whoever reads it back to the game to find out — and the name is right there:
 * the engine's string keeps its first character where its first word points, so
 * the same reading `Hero "%s" doesn't exist` does is all this needs.
 */
static void log_hero_name(const char *what, void *name) {
  for (int word = 0; word < 2; word++) {
    if (!readable((BYTE *)name + word * 4, 4)) break;
    const char *text = *(const char **)((BYTE *)name + word * 4);
    if (!readable(text, 2)) continue;
    int n = 0;
    while (n < 60 && text[n] >= 0x20 && text[n] < 0x7f) n++;
    if (n < 1 || text[n] != 0) continue;
    log_text(what, text);
    return;
  }
  log_text(what, "(a name that does not read as one)");
}

/** The map last handed out, for code that has no Lua context to ask with. */
static void *g_lastMap = NULL;

/** The adventure map, built the way every hero function of theirs builds it. */
static void *adventure_map(void *ctx) {
  if (!hero_lookup_ready()) return NULL;
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  // The block is theirs, four words wide, and the flag byte at +0xC is what
  // says an error was reported. We do not raise it — a script asking about a
  // hero who is not there gets nothing back and can say so itself.
  void *block[4];
  block[0] = base + REPORTER_VTABLE_RVA;
  block[1] = NULL;
  block[2] = ctx;
  block[3] = NULL;
  void *lookup = g_makeLookup(block, NULL);
  void *map = g_getAdvMap(lookup, 0, base + LOOKUP_ARG_A_RVA, base + LOOKUP_ARG_B_RVA, 0);
  // KEPT, because the lookup above needs a Lua context and not everything that
  // wants the map has one: a detour on a cast is called by the engine, not by a
  // script, and handing this NULL crashes inside the lookup — measured, at
  // 0xa455f1. A map fetched by any script of ours is the same map.
  if (map) g_lastMap = map;
  return map;
}

/** The map last fetched by a script of ours, for callers with no context. */
static void *map_without_context(void) {
  return readable(g_lastMap, 4) ? g_lastMap : NULL;
}

// --- saying everything, once ------------------------------------------------
//
// ONE RUN, NOT TEN. Three runs went on appending an offset to a pointer nobody
// had asked the name of, and each cost a launch to learn one number. The whole
// neighbourhood costs the same launch: what this object IS, and what every
// object it points at is, with the engine's own answer beside each.
//
// The name comes from RTTI, read here rather than offline: the dword before a
// vtable is the complete-object locator, its `+0x0C` is the type descriptor, and
// the descriptor carries the decorated name from `+8`. That is how
// tools/reverse/vtable.ts finds them in the file; the same walk works in memory
// and answers in the run that asked.

/** The decorated class name of an object, or nothing when it is not one. */
static const char *class_name_of(void *obj) {
  if (readable_bytes(obj, 4) < 4) return NULL;
  void *vtable = *(void **)obj;
  if (readable_bytes((BYTE *)vtable - 4, 4) < 4) return NULL;
  void *locator = *(void **)((BYTE *)vtable - 4);
  if (readable_bytes(locator, 0x10) < 0x10) return NULL;
  void *descriptor = *(void **)((BYTE *)locator + 0x0C);
  if (readable_bytes(descriptor, 0x20) < 0x20) return NULL;
  const char *name = (const char *)descriptor + 8;
  return name[0] == '.' && name[1] == '?' ? name : NULL;
}

/**
 * The WHOLE object a pointer names, when the pointer names a base of it.
 *
 * A class with several bases has several vtables, and a pointer handed out as
 * one of those bases is not the address of the object — it is that base's place
 * inside it. RTTI writes that distance down: the complete-object locator's
 * `+0x04` is how far the subobject sits from the start, so subtracting it is the
 * whole conversion. (This is what `dynamic_cast` to `void*` does.)
 *
 * Learned from the count window: "the screen on screen" comes back as a base,
 * the name read off it is right, and every field read at its documented offset
 * is somebody else's. Cf. `vtable-slot-needs-its-vtable-start` — the same shape
 * of mistake one level down.
 */
static void *whole_object_of(void *obj) {
  if (readable_bytes(obj, 4) < 4) return obj;
  void *vtable = *(void **)obj;
  if (readable_bytes((BYTE *)vtable - 4, 4) < 4) return obj;
  BYTE *locator = *(BYTE **)((BYTE *)vtable - 4);
  if (readable_bytes(locator, 0x10) < 0x10) return obj;
  DWORD from_start = *(DWORD *)(locator + 4);
  /* An offset that would take us out of any plausible object is not one. */
  return from_start < 0x10000u ? (BYTE *)obj - from_start : obj;
}

/**
 * Everything within reach of one object, named.
 *
 * Every whole word in its first `HERO_SCAN_BYTES` that points at something with
 * an RTTI name is printed with the offset it sits at. That is the map the next
 * step needs — which field of this thing is the hero the tent already knows how
 * to ask — and it is one launch rather than one launch per guess.
 */
#define HERO_SCAN_BYTES 0x400u

/** How many slots a vtable has, counted until it stops pointing at code. */
static int vtable_length(void *obj) {
  if (readable_bytes(obj, 4) < 4) return -1;
  BYTE *vt = *(BYTE **)obj;
  int n = 0;
  while (n < 512) {
    if (readable_bytes(vt + n * 4, 4) < 4) break;
    if (!points_at_code(*(void **)(vt + n * 4))) break;
    n++;
  }
  return n;
}

/**
 * Every whole word of the object, with its offset. Unfiltered, deliberately.
 *
 * A specialization is a NUMBER the hero holds, so if it is in here at all it is
 * visible by eye — and the combat side already knows which number to look for,
 * because there the engine can be asked. That turns "where does this live" from
 * a series of guesses into one comparison of two dumps.
 *
 * This is the half that every earlier sweep left out. Pointers were logged and
 * named, subobjects were not, and the plain numbers were never printed at all —
 * so the one thing being hunted was the one thing not on the page.
 */
static void log_object_words(void *obj, DWORD bytes) {
  for (DWORD at = 0; at + 4 <= bytes; at += 4) {
    BYTE *word = (BYTE *)obj + at;
    if (readable_bytes(word, 4) < 4) return;
    int value = *(int *)word;
    // Everything, but the interesting range is called out so the eye finds it:
    // a specialization is 0…90 and ours are the two above 83.
    if (value >= 0 && value <= 90) log_num(value >= 84 ? "      OURS? +" : "      small +", (int)at);
    log_num("        = ", value);
  }
}

static void log_neighbourhood(void *obj, const char *what) {
  const char *name = class_name_of(obj);
  log_text(what, name ? name : "(no rtti)");
  log_num("      vtable slots: ", vtable_length(obj));
  if (readable_bytes(obj, HERO_SCAN_BYTES) < HERO_SCAN_BYTES) {
    log_line("      (shorter than the scan — stopping at what is readable)");
  }
  for (DWORD at = 0; at + 4 <= HERO_SCAN_BYTES; at += 4) {
    BYTE *field = (BYTE *)obj + at;
    if (readable_bytes(field, 4) < 4) break;
    void *value = *(void **)field;
    const char *of = class_name_of(value);
    if (!of) continue;
    log_num("      +", (int)at);
    log_text("        points at ", of);
  }
  // AND THE SUBOBJECTS, which the loop above cannot see. A base class is not a
  // pointer field — it lives INSIDE the object, with a vtable of its own at some
  // offset — so a scan for outgoing pointers is blind to exactly the thing a
  // slot number belongs to. That blindness is why the first sweep of this
  // function was called complete and was not: the tent asks its question on a
  // subobject 124 bytes into a CCombatHero, and no pointer anywhere named it.
  for (DWORD at = 4; at + 4 <= HERO_SCAN_BYTES; at += 4) {
    BYTE *inner = (BYTE *)obj + at;
    if (readable_bytes(inner, 4) < 4) break;
    const char *of = class_name_of(inner);
    if (!of) continue;
    log_num("      +", (int)at);
    log_text("        IS a ", of);
    log_num("           its vtable slots: ", vtable_length(inner));
  }
  log_line("      --- every word, unfiltered ---");
  log_object_words(obj, HERO_SCAN_BYTES);
}

static int g_specTraceLeft = 16;

/**
 * `H5EHeroSpecialization(heroName)` — the value, or nothing.
 *
 * Nothing, rather than zero, on every path it cannot serve: zero is
 * `HERO_SPEC_NONE`, a real answer, and a script that cannot tell "no
 * specialization" from "I could not find him" would hand abilities to the wrong
 * heroes on the run where the lookup broke.
 *
 * ASKED, NOT READ — and that is the correction three launches paid for. The
 * question a script needs is "is it this one", the engine answers exactly that
 * through a virtual the tent already uses, and a virtual needs no field offset
 * at all. Three runs went into finding where the number lives; the number never
 * had to be found.
 *
 * What made the wrong road look reasonable for so long was a check that could
 * only ever confirm: it asked "do you have specialization <whatever I just
 * read>", so a garbage read produced a truthful "no" and no hint that the
 * QUESTION was the broken half. A check that cannot fail in the direction of
 * the bug is not a check.
 *
 * The object the lookup gives is `CHero@NWorld` — read out of its own RTTI in
 * the run that asked, not guessed. It is the hero proper, which is why the slot
 * the tent uses is on it and no adjustment is wanted here.
 */
static void *__fastcall lua_hero_has_specialization(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  if (!name) {
    log_line("H5EHeroHasSpecialization: the first argument has to be a hero's script name");
    return NULL;
  }
  void *map = adventure_map(ctx);
  if (!map) {
    log_line("H5EHeroHasSpecialization: no adventure map to ask");
    return NULL;
  }
  void *find = vtable_entry(map, VT_FIND_BY_NAME);
  if (!find) {
    log_line("H5EHeroHasSpecialization: the map has no lookup where we measured one");
    return NULL;
  }
  int wanted = 0;
  if (!lua_arg_int(ctx, 2, &wanted)) {
    log_line("H5EHeroHasSpecialization: the second argument has to be a specialization value");
    return NULL;
  }
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero)) {
    if (g_specTraceLeft > 0) {
      g_specTraceLeft--;
      log_line("H5EHeroHasSpecialization: no living hero of that name");
    }
    return NULL;
  }

  if (!readable((BYTE *)hero + HERO_SPECIALIZATION, 4)) return NULL;
  int held = *(int *)((BYTE *)hero + HERO_SPECIALIZATION);
  // A field read off the wrong object is a POINTER, and that is what every
  // wrong reading of it looked like — 330438328 and its neighbours. A value
  // outside the enum's range is therefore refused rather than compared: the
  // script gives abilities away by this answer, and "I read something" is not
  // the same as "I read the specialization".
  if (held < 0 || held > HERO_SPECIALIZATION_MAX) {
    if (g_specTraceLeft > 0) {
      g_specTraceLeft--;
      log_num("H5EHeroHasSpecialization: that is not a specialization: ", held);
    }
    return NULL;
  }
  if (g_specTraceLeft > 0) {
    g_specTraceLeft--;
    log_num("H5EHeroHasSpecialization: asked about ", wanted);
    log_num("                          he holds ", held);
  }
  return held == wanted ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

// --- how full an army is ----------------------------------------------------
//
// A SCRIPT CANNOT COUNT SLOTS, and that is not an oversight to work around — it
// is the one thing about an army the engine keeps to itself. `GetHeroCreatures`
// sums a kind over the whole army; `GetHeroCreaturesTypes`, the only window on
// its shape, throws duplicates away before answering. So a hero carrying two
// stacks of archers and five other kinds reads as six things in seven slots,
// his army looks roomy, and the creature a script adds has nowhere to go —
// which is the game stopping to ask the player what to throw away.
//
// The engine counts them in exactly one place: `0xb43820` walks the slots and
// counts the ones holding anything. We call that rather than walk the vector
// ourselves — the same walk written twice is the same walk wrong twice, and its
// two neighbours (slots of one kind, heads of one kind) share its first eight
// bytes, so only this one can be recognised at all.

#define ARMY_USED_RVA 0x743820u
#define ARMY_USED_HEAD_LEN 7
static const BYTE ARMY_USED_HEAD[ARMY_USED_HEAD_LEN] = {
  0x85, 0xC9, 0x75, 0x03, 0x33, 0xC0, 0xC3
};
/** A hero's army, the slot every army function of theirs calls on him. */
#define VT_ARMY_OF 0x48u

typedef void *(__fastcall *ArmyOfFn)(void *hero, void *edx);
typedef int(__fastcall *ArmyUsedFn)(void *army, void *edx);
static ArmyUsedFn g_armyUsed = NULL;

/**
 * `H5EArmySlots(heroName)` — how many slots of his army are taken, or nil.
 *
 * Nil rather than a guess when anything is missing: a rule that reads "no
 * answer" as "plenty of room" is the bug this exists to end, so the script has
 * to see the difference.
 */
static void *__fastcall lua_army_slots(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  if (!name) {
    log_line("H5EArmySlots: the argument has to be a hero's script name");
    return NULL;
  }
  if (!g_armyUsed) {
    g_armyUsed = (ArmyUsedFn)code_at(ARMY_USED_RVA, ARMY_USED_HEAD, ARMY_USED_HEAD_LEN,
                                     "the army's count of taken slots");
    if (!g_armyUsed) return NULL;
  }
  void *map = adventure_map(ctx);
  if (!map) { log_line("H5EArmySlots: no adventure map to ask"); return NULL; }
  void *find = vtable_entry(map, VT_FIND_BY_NAME);
  if (!find) { log_line("H5EArmySlots: the map has no lookup where we measured one"); return NULL; }
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero)) {
    log_hero_name("H5EArmySlots: no living hero called ", name);
    return NULL;
  }
  void *armyOf = vtable_entry(hero, VT_ARMY_OF);
  if (!armyOf) { log_line("H5EArmySlots: that hero has no army accessor"); return NULL; }
  void *army = ((ArmyOfFn)armyOf)(hero, NULL);
  if (!readable(army, 4)) {
    log_hero_name("H5EArmySlots: no army at all on ", name);
    return NULL;
  }
  int used = g_armyUsed(army, NULL);
  // ON CHANGE ONLY. A rule that keeps itself current asks this every tick, and
  // a log that repeats the same two lines a hundred times a second is not a
  // record of anything — the moment an army changes size is.
  static void *lastHero = NULL;
  static int lastUsed = -1;
  if (hero != lastHero || used != lastUsed) {
    lastHero = hero;
    lastUsed = used;
    log_hero_name("H5EArmySlots: ", name);
    log_num("              slots taken: ", used);
  }
  return (void *)(INT_PTR)lua_push_int(ctx, used);
}

/** Offered always, like every other function of ours. */
static void install_hero_specialization(void) {
  add_map_function("H5EHeroHasSpecialization", (void *)&lua_hero_has_specialization);
  add_map_function("H5EArmySlots", (void *)&lua_army_slots);
}
