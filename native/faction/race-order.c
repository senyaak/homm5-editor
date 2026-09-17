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
//   0xB4E710    IsRealTown(t)      (unsigned)(t - 3) <= 7 — seventeen callers,
//               the wait screen's hero picker among them (0xB8D798): a race
//               that fails it has no heroes to show, and no start.
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
// THE ICON AND ITS TOOLTIP are the parts of the ledger that are not numbers. `CMPWaitItem`'s
// constructor builds `map<TownType, texture>` name by name — `race_haven` …
// `race_stronghold`, and the misspelt `rece_necropolis`/`rece_fortress` that
// `UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb` faithfully
// repeats. A race the constructor never heard of draws nothing, so the
// constructor is detoured too: the engine's runs first, then every row that
// names a texture is looked up through the item's own related-textures widget
// and put into the same map the same way the constructor does it. The tooltip
// is the same again one map over: the constructor's helper (0x8F6B00, and the
// constructor is its only caller) fills `map<TownType, String>` at the item's
// shared tooltip object (+0x108, the map at +0x30) from the related-TEXTS
// list, `race_tooltip_haven` … `race_tooltip_stronghold`; a row's third word
// goes in beside them.

/** `race <townType> <name> [pickerTexture [tooltipText]]` — one per line, in picker order. */
#define MAX_RACES 32
#define RACE_TEXTURE_LEN 48

typedef struct {
  int town;
  /** The enum's own name, `TOWN_*`: what the type stringifies as. */
  char name[RACE_TEXTURE_LEN];
  /** The name in the related-textures list; empty for a race the engine draws itself. */
  char texture[RACE_TEXTURE_LEN];
  /** The name in the related-texts list — what the arrow's tooltip says. */
  char tooltip[RACE_TEXTURE_LEN];
} RaceRow;

/** One word: up to a space, the line's end or a comment. */
static int race_word(const char **p, const char *stop, char *out, int room) {
  const char *q = *p;
  while (q < stop && (*q == ' ' || *q == '\t')) q++;
  int n = 0;
  while (q < stop && *q != ' ' && *q != '\t' && *q != '\r' && *q != '#' && n < room - 1) {
    out[n++] = *q++;
  }
  out[n] = 0;
  *p = q;
  return n;
}

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
    race_word(&q, stop, r.name, sizeof r.name);
    race_word(&q, stop, r.texture, sizeof r.texture);
    race_word(&q, stop, r.tooltip, sizeof r.tooltip);
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

/** `IsRealTown` — `lea eax,[ecx-3] / cmp eax,7`. */
#define IS_REAL_TOWN_RVA 0x74e710u
static const BYTE IS_REAL_TOWN_HEAD[6] = { 0x8D, 0x41, 0xFD, 0x83, 0xF8, 0x07 };

/** The selector — `cmp dword ptr [ecx],3 / mov eax,[ecx+4]`. */
#define TOWN_SELECTOR_RVA 0x74e7d0u
static const BYTE TOWN_SELECTOR_HEAD[6] = { 0x83, 0x39, 0x03, 0x8B, 0x41, 0x04 };

// None of the five ever returns into its trampoline: each is the whole
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

static int __fastcall is_real_town_hook(int town) {
  return index_of_town_hook(town) >= 0;
}

static int __fastcall town_selector_hook(const int *selector) {
  if (selector[0] == 3) return town_of_index_hook(selector[1]);
  return selector[1] + TOWN_HEAVEN;
}

// ---------------------------------------------------------------------------
// The type's name.
//
// `String &NameOfTownType(String &out, TownType t)` (0xA96240) is a compiled
// switch over the eleven shipped values — `cmp edx,0Ah / ja default /
// jmp [table+edx*4]` — that constructs `out` from the enum's own spelling,
// "TOWN_HEAVEN" and the rest. Everything that turns a type into text goes
// through it: the town window's race line, saves, the siege set-up. A twelfth
// value is past the compare and answers the default, which is not a name.
//
// The first probe grew the table in the executable instead — a twelfth slot
// over the padding after it, as a raw dword. That works exactly when the
// image loads at its preferred base: the loader relocates the eleven slots it
// knows about (they are in .reloc) and leaves ours, and under ASLR ours then
// points into whatever the padding became — an int3, three sieges in a row
// (2026-09-17). The name of a type the executable never compiled is ours to
// answer, from the row that declares it; the shipped eleven stay the engine's.

/** `push esi / mov esi,ecx / cmp edx,0Ah` — six bytes, three instructions. */
#define TOWN_NAME_RVA 0x696240u
static const BYTE TOWN_NAME_HEAD[6] = { 0x56, 0x8B, 0xF1, 0x83, 0xFA, 0x0A };
/** How many values the switch was compiled for: TOWN_NO_TYPE … TOWN_STRONGHOLD. */
#define SHIPPED_TOWN_TYPES 11

/** The engine's string: begin, end, end of storage. The same three pointers
 *  rmg/cli.c declares as `EngineString` — that file is spliced in for the map
 *  editor only, after this one, so the shape is spelt again here. */
typedef struct { char *begin; char *end; char *cap; } EngineName;
/** `String::String(const char *)` — thiscall, the text on the stack. */
typedef void (__fastcall *StringCtorFn)(EngineName *s, void *edx, const char *text);

typedef EngineName *(__fastcall *TownNameFn)(EngineName *out, int type);
static TownNameFn g_townName = NULL;
static StringCtorFn g_stringCtor = NULL;

static EngineName *__fastcall town_name_hook(EngineName *out, int type) {
  if (type >= SHIPPED_TOWN_TYPES) {
    for (int i = 0; i < g_raceCount; i++) {
      if (g_races[i].town != type || !g_races[i].name[0]) continue;
      g_stringCtor(out, NULL, g_races[i].name);
      return out;
    }
  }
  return g_townName(out, type);
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
/** The widget's slot that answers a name with a texture, and the one that
 *  answers with a text. */
#define VT_TEXTURE_BY_NAME 0x110u
#define VT_TEXT_BY_NAME 0x10Cu
/** The item's shared tooltip object, and its map of race tooltips by town. */
#define ITEM_TOOLTIPS 0x108u
#define TOOLTIPS_RACE_MAP 0x30u
/** `map<TownType, String>::operator[]` — `sub esp,20h / push ebx / mov ebx,ecx`. */
#define TEXT_MAP_SLOT_RVA 0x4faed0u
static const BYTE TEXT_MAP_SLOT_HEAD[6] = { 0x83, 0xEC, 0x20, 0x53, 0x8B, 0xD9 };
/** `String::operator=(const String &)`, what the helper does with the text it
 *  looked up — `push esi / mov esi,[esp+8]`. */
#define STRING_ASSIGN_RVA 0x0e8310u
static const BYTE STRING_ASSIGN_HEAD[5] = { 0x56, 0x8B, 0x74, 0x24, 0x08 };

typedef void *(__fastcall *WaitItemCtorFn)(void *self, void *edx, void *a, void *b, void *c);
typedef BYTE *(__fastcall *TextureMapSlotFn)(void *map, void *edx, const int *key);

typedef void (__cdecl *EngineFreeFn)(void *p);
typedef void *(__fastcall *TextureByNameFn)(void *widget, void *edx, const EngineName *name);
typedef void (__fastcall *ObjectReleaseFn)(void *obj);
typedef void *(__fastcall *TextByNameFn)(void *widget, void *edx, const EngineName *name);
typedef void *(__fastcall *TextMapSlotFn)(void *map, void *edx, const int *key);
typedef void (__fastcall *StringAssignFn)(void *dst, void *edx, const void *src);

static WaitItemCtorFn g_waitItemCtor = NULL;
static TextureMapSlotFn g_textureMapSlot = NULL;
static EngineFreeFn g_engineFree = NULL;
static ObjectReleaseFn g_objectRelease = NULL;
static TextMapSlotFn g_textMapSlot = NULL;
static StringAssignFn g_stringAssign = NULL;

/** The tooltip beside the icon, the way the constructor's helper puts its own in. */
static void put_picker_tooltip(void *item, const RaceRow *row) {
  void *widget = *(void **)((BYTE *)item + ITEM_TEXTURE_WIDGET);
  void *tooltips = *(void **)((BYTE *)item + ITEM_TOOLTIPS);
  if (!widget || !tooltips) return;
  TextByNameFn byName = (TextByNameFn)vtable_entry(widget, VT_TEXT_BY_NAME);
  if (!byName) return;

  EngineName name;
  g_stringCtor(&name, NULL, row->tooltip);
  void *text = byName(widget, NULL, &name);
  g_engineFree(name.begin);
  if (!text) {
    log_text("races: no picker text named ", row->tooltip);
    return;
  }
  void *slot = g_textMapSlot((BYTE *)tooltips + TOOLTIPS_RACE_MAP, NULL, &row->town);
  g_stringAssign(slot, NULL, text);
  log_text("races: picker tooltip ", row->tooltip);
}

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
    if (g_races[i].tooltip[0] && g_textMapSlot) put_picker_tooltip(item, &g_races[i]);
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
  detour(IS_REAL_TOWN_RVA, IS_REAL_TOWN_HEAD, sizeof IS_REAL_TOWN_HEAD,
         &is_real_town_hook, "is real town");
  log_num("races: the picker is this wide now: ", g_raceCount);

  g_stringCtor = (StringCtorFn)code_at(STRING_CTOR_RVA, STRING_CTOR_HEAD,
                                       sizeof STRING_CTOR_HEAD, "string constructor");
  if (!g_stringCtor) return;

  // The name of a type past the compiled eleven, when a row declares one.
  int ours = 0;
  for (int i = 0; i < g_raceCount; i++) ours += g_races[i].town >= SHIPPED_TOWN_TYPES && g_races[i].name[0];
  if (ours) {
    g_townName = (TownNameFn)detour(TOWN_NAME_RVA, TOWN_NAME_HEAD, sizeof TOWN_NAME_HEAD,
                                    &town_name_hook, "name of town type");
    if (g_townName) log_num("races: names of ours: ", ours);
  }

  int named = 0;
  for (int i = 0; i < g_raceCount; i++) named += g_races[i].texture[0] != 0;
  if (!named) return;

  g_textureMapSlot = (TextureMapSlotFn)code_at(TEXTURE_MAP_SLOT_RVA, TEXTURE_MAP_SLOT_HEAD,
                                               sizeof TEXTURE_MAP_SLOT_HEAD, "texture map slot");
  g_engineFree = (EngineFreeFn)code_at(ENGINE_FREE_RVA, ENGINE_FREE_HEAD,
                                       sizeof ENGINE_FREE_HEAD, "engine free");
  g_objectRelease = (ObjectReleaseFn)code_at(OBJECT_RELEASE_RVA, OBJECT_RELEASE_HEAD,
                                             sizeof OBJECT_RELEASE_HEAD, "object release");
  if (!g_textureMapSlot || !g_engineFree || !g_objectRelease) return;
  // The tooltip's two are optional: without them the icon still goes in.
  g_textMapSlot = (TextMapSlotFn)code_at(TEXT_MAP_SLOT_RVA, TEXT_MAP_SLOT_HEAD,
                                         sizeof TEXT_MAP_SLOT_HEAD, "text map slot");
  g_stringAssign = (StringAssignFn)code_at(STRING_ASSIGN_RVA, STRING_ASSIGN_HEAD,
                                           sizeof STRING_ASSIGN_HEAD, "string assign");
  if (!g_textMapSlot || !g_stringAssign) g_textMapSlot = NULL;
  g_waitItemCtor = (WaitItemCtorFn)detour(WAIT_ITEM_CTOR_RVA, WAIT_ITEM_CTOR_HEAD,
                                          sizeof WAIT_ITEM_CTOR_HEAD, &wait_item_ctor_hook,
                                          "wait item constructor");
  if (g_waitItemCtor) log_num("races: picker icons of ours: ", named);
}
