// The race picker's order — ours, out of a file the editor writes.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_race_order

// ---------------------------------------------------------------------------
// WHAT THIS IS. The scenario setup's race picker does not walk `TownType`. It
// walks a second, smaller ledger — the eight shipped races in the order the
// arrows show them — and every piece of that ledger is compiled:
//
//   0x1090E0C   int[8] = {3, 8, 7, 4, 6, 5, 9, 10}      the order itself
//   0xB4E700    RaceCount()        { return 8; }
//   0xB4E760    TownOfIndex(i)     i < 8 ? table[i] : TOWN_NO_TYPE
//   0xB4E740    IndexOfTown(t)     the table scanned, -1 when absent
//   0xB4E7D0    a {kind, index} selector: kind 3 reads the table, anything
//               else is index + TOWN_HEAVEN
//
// The players-state builder (0xB8DA60) walks `0 … RaceCount()-1`, tests the
// player's allowed-race bit — set by `IndexOfTown` from the races of the map's
// reserve heroes — and `push_back`s `TownOfIndex(i)` into the vector the arrows
// step through. A ninth `TownType` exists to the engine (the table it is
// registered in is data, and moves like any other) but is invisible to the
// player until this ledger is nine wide. See docs/engineInternals/FACTIONS.md.
//
// WHAT WE DO. The table is OURS: `bin/homm5-editor-races.txt`, one `race` line
// per entry in picker order, shipped ones first. The four accessors are
// detoured onto readers of that table and never fall through to the engine's —
// the engine's copy is eight wide and stays where it is, unread. Nothing in the
// executable is extended in place: a compiled width is not a thing to grow,
// and a table that lives here has no width at all.
//
// THE ICON is the one part of the ledger that is not a number. `CMPWaitItem`'s
// constructor builds `map<TownType, texture>` name by name — `race_haven` …
// `race_stronghold`, and the misspelt `rece_necropolis`/`rece_fortress` that
// `UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb` faithfully
// repeats. A race the constructor never heard of draws nothing, so the
// constructor is detoured too: the engine's runs first, then every row that
// names a texture is looked up through the item's own related-textures widget
// and put into the same map the same way the constructor does it.

/** `race <townType> [pickerTexture]` — one per line, in picker order. */
#define MAX_RACES 32
#define RACE_TEXTURE_LEN 48

typedef struct {
  int town;
  /** The name in the related-textures list; empty for a race the engine draws itself. */
  char texture[RACE_TEXTURE_LEN];
} RaceRow;

static RaceRow g_races[MAX_RACES];
static int g_raceCount = 0;

/** What the engine answers for an index off the end of its table. */
#define TOWN_NO_TYPE 2
/** The first real town: the selector's "not kind 3" branch is `index + 3`. */
#define TOWN_HEAVEN 3

static void load_races(void) {
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-races.txt", &got);
  if (!buf) return;

  const char *p = buf, *end = buf + got;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    const char *q = line;
    if (!take_word(&q, stop, "race")) continue;
    RaceRow r;
    if (!read_int(&q, stop, &r.town) || r.town < TOWN_HEAVEN) continue;
    while (q < stop && (*q == ' ' || *q == '\t')) q++;
    int n = 0;
    while (q < stop && *q != ' ' && *q != '\t' && *q != '\r' && *q != '#'
           && n < RACE_TEXTURE_LEN - 1) {
      r.texture[n++] = *q++;
    }
    r.texture[n] = 0;
    if (g_raceCount < MAX_RACES) g_races[g_raceCount++] = r;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("races: rows: ", g_raceCount);
}

// ---------------------------------------------------------------------------
// The four accessors, ours.

/** `RaceCount` — `mov eax,8 / ret`. The head is the one instruction. */
#define RACE_COUNT_RVA 0x74e700u
static const BYTE RACE_COUNT_HEAD[5] = { 0xB8, 0x08, 0x00, 0x00, 0x00 };

/** `TownOfIndex` — `test ecx,ecx / js +0D / cmp ecx,8`. Three whole instructions. */
#define TOWN_OF_INDEX_RVA 0x74e760u
static const BYTE TOWN_OF_INDEX_HEAD[7] = { 0x85, 0xC9, 0x78, 0x0D, 0x83, 0xF9, 0x08 };

/** `IndexOfTown` — `xor eax,eax / cmp [eax*4+table],ecx`. The table's address
 *  is the loader's to rewrite, so those four bytes are skipped, not compared. */
#define INDEX_OF_TOWN_RVA 0x74e740u
static const BYTE INDEX_OF_TOWN_HEAD[9] = {
  0x33, 0xC0, 0x39, 0x0C, 0x85, 0x0C, 0x0E, 0x09, 0x01
};
static const BYTE INDEX_OF_TOWN_SKIP[9] = { 0, 0, 0, 0, 0, 1, 1, 1, 1 };

/** The selector — `cmp dword ptr [ecx],3 / mov eax,[ecx+4]`. */
#define TOWN_SELECTOR_RVA 0x74e7d0u
static const BYTE TOWN_SELECTOR_HEAD[6] = { 0x83, 0x39, 0x03, 0x8B, 0x41, 0x04 };

// None of the four ever returns into its trampoline: each is the whole
// function, so the displaced heads are copied and then left alone. The
// short jumps inside two of them would be wrong to run from a trampoline,
// and nothing runs them.

static int __fastcall race_count_hook(void) {
  return g_raceCount;
}

static int __fastcall town_of_index_hook(int index) {
  if (index < 0 || index >= g_raceCount) return TOWN_NO_TYPE;
  return g_races[index].town;
}

static int __fastcall index_of_town_hook(int town) {
  for (int i = 0; i < g_raceCount; i++) {
    if (g_races[i].town == town) return i;
  }
  return -1;
}

static int __fastcall town_selector_hook(const int *selector) {
  if (selector[0] == 3) return town_of_index_hook(selector[1]);
  return selector[1] + TOWN_HEAVEN;
}

// ---------------------------------------------------------------------------
// The picker's icons.

/**
 * `CMPWaitItem::CMPWaitItem` — `sub esp,18h / cmp dword ptr [esp+24h],0`,
 * eight bytes and two instructions. Three stack arguments, `ret 0Ch`, returns
 * `this`.
 */
#define WAIT_ITEM_CTOR_RVA 0x4f7900u
static const BYTE WAIT_ITEM_CTOR_HEAD[8] = {
  0x83, 0xEC, 0x18, 0x83, 0x7C, 0x24, 0x24, 0x00
};
/** `map<TownType, texture>::operator[]` — `push ecx / mov eax,[esp+8]`. Takes
 *  `&key`, hands back the value slot: `{texture *, byte}`. */
#define TEXTURE_MAP_SLOT_RVA 0x4fae20u
static const BYTE TEXTURE_MAP_SLOT_HEAD[5] = { 0x51, 0x8B, 0x44, 0x24, 0x08 };
/** The engine's string from a C string — `push ebx / push ebp / push esi`. */
#define STRING_CTOR_RVA 0x0dc940u
static const BYTE STRING_CTOR_HEAD[5] = { 0x53, 0x55, 0x56, 0x8B, 0x74 };
/** `free` — `push ebp / mov ebp,esp`. What the constructor calls on a string's
 *  first pointer once the lookup is done. */
#define ENGINE_FREE_RVA 0x0dd510u
static const BYTE ENGINE_FREE_HEAD[5] = { 0x55, 0x8B, 0xEC, 0x8B, 0x15 };
/** A refcounted object's last release — `push ecx / cmp dword ptr [ecx+8],0`. */
#define OBJECT_RELEASE_RVA 0x0e42e0u
static const BYTE OBJECT_RELEASE_HEAD[5] = { 0x51, 0x83, 0x79, 0x08, 0x00 };

/** The item's map of icons by town, and the widget the names are looked up in. */
#define ITEM_TEXTURE_MAP 0x50u
#define ITEM_TEXTURE_WIDGET 0xA0u
/** The widget's slot that answers a name with a texture. */
#define VT_TEXTURE_BY_NAME 0x110u

/** The engine's string: begin, end, end of storage. The same three pointers
 *  rmg/cli.c declares as `EngineString` — that file is spliced in for the map
 *  editor only, after this one, so the shape is spelt again here. */
typedef struct { char *begin; char *end; char *cap; } EngineName;

typedef void *(__fastcall *WaitItemCtorFn)(void *self, void *edx, void *a, void *b, void *c);
typedef BYTE *(__fastcall *TextureMapSlotFn)(void *map, void *edx, const int *key);
typedef void (__fastcall *StringCtorFn)(EngineName *s, void *edx, const char *text);
typedef void (__cdecl *EngineFreeFn)(void *p);
typedef void *(__fastcall *TextureByNameFn)(void *widget, void *edx, const EngineName *name);
typedef void (__fastcall *ObjectReleaseFn)(void *obj);

static WaitItemCtorFn g_waitItemCtor = NULL;
static TextureMapSlotFn g_textureMapSlot = NULL;
static StringCtorFn g_stringCtor = NULL;
static EngineFreeFn g_engineFree = NULL;
static ObjectReleaseFn g_objectRelease = NULL;

/**
 * One entry into the item's map, the way the constructor puts its own in:
 * look the name up, take the slot for the key, swap the texture in with its
 * count raised, let go of whatever was there.
 */
static void put_picker_texture(void *item, const RaceRow *row) {
  void *widget = *(void **)((BYTE *)item + ITEM_TEXTURE_WIDGET);
  if (!widget) return;
  TextureByNameFn byName = (TextureByNameFn)vtable_entry(widget, VT_TEXTURE_BY_NAME);
  if (!byName) return;

  EngineName name;
  g_stringCtor(&name, NULL, row->texture);
  void *texture = byName(widget, NULL, &name);
  g_engineFree(name.begin);
  if (!texture) {
    log_text("races: no picker texture named ", row->texture);
    return;
  }

  BYTE *slot = g_textureMapSlot((BYTE *)item + ITEM_TEXTURE_MAP, NULL, &row->town);
  void *was = *(void **)slot;
  *(void **)slot = texture;
  (*(int *)((BYTE *)texture + 8))++;
  if (was && --(*(int *)((BYTE *)was + 8)) == 0) g_objectRelease(was);
  slot[4] = 0;
  log_text("races: picker texture ", row->texture);
}

static void *__fastcall wait_item_ctor_hook(void *self, void *edx, void *a, void *b, void *c) {
  void *item = g_waitItemCtor(self, edx, a, b, c);
  if (!item) return item;
  for (int i = 0; i < g_raceCount; i++) {
    if (g_races[i].texture[0]) put_picker_texture(item, &g_races[i]);
  }
  return item;
}

// ---------------------------------------------------------------------------

static void install_race_order(void) {
  if (!detour(RACE_COUNT_RVA, RACE_COUNT_HEAD, sizeof RACE_COUNT_HEAD,
              &race_count_hook, "race count")) return;
  detour(TOWN_OF_INDEX_RVA, TOWN_OF_INDEX_HEAD, sizeof TOWN_OF_INDEX_HEAD,
         &town_of_index_hook, "town of index");
  detour_relocated(INDEX_OF_TOWN_RVA, INDEX_OF_TOWN_HEAD, INDEX_OF_TOWN_SKIP,
                   sizeof INDEX_OF_TOWN_HEAD, &index_of_town_hook, "index of town");
  detour(TOWN_SELECTOR_RVA, TOWN_SELECTOR_HEAD, sizeof TOWN_SELECTOR_HEAD,
         &town_selector_hook, "town selector");
  log_num("races: the picker is this wide now: ", g_raceCount);

  int named = 0;
  for (int i = 0; i < g_raceCount; i++) named += g_races[i].texture[0] != 0;
  if (!named) return;

  g_textureMapSlot = (TextureMapSlotFn)code_at(TEXTURE_MAP_SLOT_RVA, TEXTURE_MAP_SLOT_HEAD,
                                               sizeof TEXTURE_MAP_SLOT_HEAD, "texture map slot");
  g_stringCtor = (StringCtorFn)code_at(STRING_CTOR_RVA, STRING_CTOR_HEAD,
                                       sizeof STRING_CTOR_HEAD, "string constructor");
  g_engineFree = (EngineFreeFn)code_at(ENGINE_FREE_RVA, ENGINE_FREE_HEAD,
                                       sizeof ENGINE_FREE_HEAD, "engine free");
  g_objectRelease = (ObjectReleaseFn)code_at(OBJECT_RELEASE_RVA, OBJECT_RELEASE_HEAD,
                                             sizeof OBJECT_RELEASE_HEAD, "object release");
  if (!g_textureMapSlot || !g_stringCtor || !g_engineFree || !g_objectRelease) return;
  g_waitItemCtor = (WaitItemCtorFn)detour(WAIT_ITEM_CTOR_RVA, WAIT_ITEM_CTOR_HEAD,
                                          sizeof WAIT_ITEM_CTOR_HEAD, &wait_item_ctor_hook,
                                          "wait item constructor");
  if (g_waitItemCtor) log_num("races: picker icons of ours: ", named);
}
