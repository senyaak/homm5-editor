// The town screen's centre button, for a building of ours.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_town_button

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HAS. The left jog-dial of the town screen has one big button
// in its centre, `EnterSpecial`, and every shipped town uses it for its own
// special building: the Training Grounds, the Hall of Trial, the artifact
// merchant… Its skin is `ButtonStates[town ordinal]` — eight items, one per
// town, each with ITS OWN click commands (all eight send `enter_special`) —
// and its meaning is compiled twice over:
//
//   0x84B300  the screen's init: SetState(clamp(type - 3, 0..7, else 3)) on the
//             button, through IWindow -> IButton (0x84CC0E)
//   0x8541B0  after every change of town: a switch on the type picks WHICH
//             building the button stands for (TB_SPECIAL_n) and enables it by
//             `0x854030(name, building)` — SetEnabled(0x856500(building)),
//             the tooltip's `deny` value set when it is not built; a type past
//             the eight falls out of the switch and the button stays as the
//             disable-all pass (0x8534B0) left it: off
//   0x84D690  the `enter_special` handler: the same switch, one compiled
//             screen per town; a type past the eight returns 1 and does nothing
//
// The handlers are not compiled into a dispatch: `0x854570` registers each by
// NAME through `0x859960(name, memfn)`, which wraps the member function in a
// functor (vtable 0xF73A4C, slot 7 = Invoke(msg, screen)) and appends it to a
// vector of {name id, functor} on the screen. So a name of ours registers the
// same way, and the functor hands our function the same `this` the engine's
// own get — the CTownScreen, `dynamic_cast` from whatever the dispatcher holds.
//
// WHAT WE DO. The faction's data adds a NINTH ButtonStates item whose click
// sends `enter_own` (and a ninth skin, drawn), and the editor writes a row per
// faction here:
//
//   button <townType> <buildingType> <state> <luaFunction>
//
// After the engine has registered its handlers ours goes in for `enter_own`.
// After the engine has set the special button up for a town of ours (which is
// to say: not at all) the button gets the row's state and the row's building —
// enabled by the engine's own `0x854030`, so "not built" reads exactly as it
// does for a shipped town. The click reaches the map's Lua by name, the way a
// cast of ours does (lua/adv-cast.c): `<luaFunction>("<town name>")`.
//
// The town is what the screen holds — `+0x2F0` or `+0x344` by the byte at
// `+0x370`, its slot 1 the town object — and the town's type is its slot
// `+0xD4`; its script name is slot `+0x90` of the virtual base at `+0x334` of
// the whole object, an engine string {begin, end, cap} (see `town_name_of`).
//
// The tooltip's `<value=special>` is the building's name, read through the
// town's own map of building records (`set_special_tooltip`).

#define MAX_TOWN_BUTTONS 16
#define LUA_NAME_LEN 48

typedef struct {
  int town;
  int building;
  /** The ButtonStates item that draws it — the row of VisualStates the data added. */
  int state;
  /** The map function the click calls, with the town's script name. */
  char lua[LUA_NAME_LEN];
} TownButtonRow;

static TownButtonRow g_townButtons[MAX_TOWN_BUTTONS];
static int g_townButtonCount = 0;

static void load_town_buttons(void) {
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-buildings.txt", &got);
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
    if (!take_word(&q, stop, "button")) continue;
    TownButtonRow r;
    if (!read_int(&q, stop, &r.town) || !read_int(&q, stop, &r.building) || !read_int(&q, stop, &r.state)) continue;
    if (!race_word(&q, stop, r.lua, sizeof r.lua)) continue;
    if (g_townButtonCount < MAX_TOWN_BUTTONS) g_townButtons[g_townButtonCount++] = r;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("town buttons: rows: ", g_townButtonCount);
}

static const TownButtonRow *town_button_of(int town) {
  for (int i = 0; i < g_townButtonCount; i++) if (g_townButtons[i].town == town) return &g_townButtons[i];
  return NULL;
}

// ---------------------------------------------------------------------------
// The engine's pieces, each checked by its bytes before it is called.

/** An engine string: {begin, end, capacity end}, NUL after `end`. */
typedef struct { const char *begin; const char *end; const char *cap; } NameString;

/** `CTownScreen::RegisterHandlers` — `push ebp / mov ebp,esp / and esp,-8 / sub esp,1Ch`; no args, plain `ret`. */
#define REGISTER_HANDLERS_RVA 0x454570u
static const BYTE REGISTER_HANDLERS_HEAD[9] = { 0x55, 0x8B, 0xEC, 0x83, 0xE4, 0xF8, 0x83, 0xEC, 0x1C };
/** `CTownScreen::UpdateSpecialButton` — `sub esp,40h / push ebp / push esi / mov esi,ecx`; no args, plain `ret`. */
#define UPDATE_SPECIAL_RVA 0x4541b0u
static const BYTE UPDATE_SPECIAL_HEAD[7] = { 0x83, 0xEC, 0x40, 0x55, 0x56, 0x8B, 0xF1 };
/** The registrar: `push esi / push edi / push 20h / mov edi,ecx` — (name*, memfn by value: fn, adj, vindex), `ret 10h`. */
#define REGISTRAR_RVA 0x459960u
static const BYTE REGISTRAR_HEAD[6] = { 0x56, 0x57, 0x6A, 0x20, 0x8B, 0xF9 };
/** `SetButtonForBuilding(name*, building)`: `sub esp,34h / push ebx / push esi / push edi` — enables by presence, `ret 8`. */
#define ENABLE_BY_BUILDING_RVA 0x454030u
static const BYTE ENABLE_BY_BUILDING_HEAD[6] = { 0x83, 0xEC, 0x34, 0x53, 0x56, 0x57 };
/** `HasBuilding(building)`: `push ebx / mov ebx,ecx / mov eax,344h` — the town is the player's and the level is above 0, `ret 4`. */
#define HAS_BUILDING_RVA 0x456500u
static const BYTE HAS_BUILDING_HEAD[8] = { 0x53, 0x8B, 0xD9, 0xB8, 0x44, 0x03, 0x00, 0x00 };
/** `__RTDynamicCast` — `jmp [<import>]`; the address after the two bytes is the loader's. */
#define RT_DYNAMIC_CAST_RVA 0x54ab92u
static const BYTE RT_DYNAMIC_CAST_HEAD[2] = { 0xFF, 0x25 };
/** The type descriptors the engine's own cast names: `.?AUIWindow@@` and `.?AUIButton@@`. */
#define IWINDOW_TYPE_RVA 0xcaaf54u
#define IBUTTON_TYPE_RVA 0xcab610u
/** The town's building map's lookup by key: `push ecx / push ebx / mov ebx,[esp+10h]` — (iterator* out, key*), `ret 8`. */
#define MAP_FIND_RVA 0x0eb510u
static const BYTE MAP_FIND_HEAD[6] = { 0x51, 0x53, 0x8B, 0x5C, 0x24, 0x10 };
/** A building record's name for its level: `movzx eax,byte ptr [esp+4] / push esi / push edi` — (levels back), `ret 4`. */
#define LEVEL_NAME_RVA 0x6c0760u
static const BYTE LEVEL_NAME_HEAD[7] = { 0x0F, 0xB6, 0x44, 0x24, 0x04, 0x56, 0x57 };

/** The screen's two town holders, the byte that picks between them, and its root widget. */
#define SCREEN_TOWN_A 0x2F0u
#define SCREEN_TOWN_B 0x344u
#define SCREEN_TOWN_PICK 0x370u
#define SCREEN_ROOT 0xA0u
/** The holder's slot that answers with the town. */
#define VT_HOLDER_TOWN 0x04u
/** The town's slots: its type (on the base the holder gives), and its script name (on the base at +0x334). */
#define VT_TOWN_TYPE 0xD4u
#define VT_TOWN_NAME 0x90u
/** The root widget's lookup of a child by name, on its IWindow base: (name*, 1). */
#define VT_WINDOW_FIND 0x94u
/** IButton's SetState(int), `ret 4` (0xE41550 — the state modulo the ButtonStates count). */
#define VT_BUTTON_SET_STATE 0x0Cu
/** The town's slot that copies a building's record key out of its map: (String* out, building), `ret 8`. */
#define VT_TOWN_BUILDING_KEY 0x5Cu
/** The map itself — what the town's slot +0x30 answers with (`lea eax,[ecx+68h]`). */
#define TOWN_BUILDING_MAP 0x68u
/** A map node's value: the record, its type at +0, its level at +4, its level names at +8/+0xC. */
#define NODE_RECORD 0x10u
/** IWindow's tooltip substitution: (key*, text) fills `<value=key>`. */
#define VT_WINDOW_SET_VALUE 0x80u
/** Where the special button's compiled switch starts and stops. */
#define FIRST_TOWN_OF_OURS 11

typedef void (__fastcall *ScreenVoidFn)(void *screen);
typedef void (__thiscall *RegistrarFn)(void *screen, const NameString *name, void *fn, DWORD adj, DWORD vindex);
typedef int (__thiscall *EnableByBuildingFn)(void *screen, const NameString *name, int building);
typedef int (__thiscall *HasBuildingFn)(void *screen, int building);
typedef void *(__cdecl *RtDynamicCastFn)(void *p, int zero, void *from, void *to, int isReference);
typedef void *(__thiscall *HolderTownFn)(void *holder);
typedef int (__thiscall *TownTypeFn)(void *town);
typedef NameString *(__thiscall *TownScriptNameFn)(void *town);
typedef void *(__thiscall *WindowFindFn)(void *window, const NameString *name, int flag);
typedef void (__thiscall *SetStateFn)(void *button, int state);
typedef NameString *(__thiscall *BuildingKeyFn)(void *town, NameString *out, int building);
typedef struct { void *node; void *map; } MapIterator;
typedef MapIterator *(__thiscall *MapFindFn)(void *map, MapIterator *out, const NameString *key);
typedef void *(__thiscall *LevelNameFn)(void *record, int back);
typedef void (__thiscall *SetValueFn)(void *window, const NameString *key, void *text);

static ScreenVoidFn g_registerHandlers = NULL;
static ScreenVoidFn g_updateSpecial = NULL;
static RegistrarFn g_registrar = NULL;
static EnableByBuildingFn g_enableByBuilding = NULL;
static HasBuildingFn g_hasBuilding = NULL;
static RtDynamicCastFn g_rtDynamicCast = NULL;
static MapFindFn g_mapFind = NULL;
static LevelNameFn g_levelName = NULL;
static EngineFreeFn g_nameFree = NULL;

/** The message the ninth state's click sends — the data's `Own.(ARSendGameMessage).xdb`. */
static const char OWN_MESSAGE[] = "enter_own";
static const NameString OWN_MESSAGE_NAME = { OWN_MESSAGE, OWN_MESSAGE + sizeof OWN_MESSAGE - 1, OWN_MESSAGE + sizeof OWN_MESSAGE };
static const char SPECIAL_WIDGET[] = "EnterSpecial";
static const NameString SPECIAL_WIDGET_NAME = { SPECIAL_WIDGET, SPECIAL_WIDGET + sizeof SPECIAL_WIDGET - 1, SPECIAL_WIDGET + sizeof SPECIAL_WIDGET };

/** The engine's own liveness test before it touches a town: `[[obj+4]+4]` is
 *  a displacement to a virtual base whose `+8` is a count, negative when dead. */
static int town_alive(void *obj) {
  BYTE *o = (BYTE *)obj;
  if (!readable(o, 8)) return 0;
  BYTE *vb = *(BYTE **)(o + 4);
  if (!readable(vb, 8)) return 0;
  int disp = *(int *)(vb + 4);
  if (!readable(o + disp + 8, 4)) return 0;
  return *(int *)(o + disp + 8) >= 0;
}

/** The town the screen shows, the way its own handlers reach it. */
static void *screen_town(void *screen) {
  BYTE *s = (BYTE *)screen;
  if (!readable(s + SCREEN_TOWN_PICK, 1) || !readable(s + SCREEN_TOWN_A, 4) || !readable(s + SCREEN_TOWN_B, 4)) return NULL;
  void *holder = *(void **)(s + (s[SCREEN_TOWN_PICK] ? SCREEN_TOWN_B : SCREEN_TOWN_A));
  if (!holder) return NULL;
  HolderTownFn town_of = (HolderTownFn)vtable_entry(holder, VT_HOLDER_TOWN);
  if (!town_of) return NULL;
  void *town = town_of(holder);
  return town && town_alive(town) ? town : NULL;
}

static int town_type_of(void *town) {
  TownTypeFn type = (TownTypeFn)vtable_entry(town, VT_TOWN_TYPE);
  return type ? type(town) : -1;
}

/** The printable head of an engine string at `s`, or nothing. */
static int name_string_into(const NameString *s, char *out, int room) {
  out[0] = 0;
  if (!readable(s, sizeof *s) || !readable(s->begin, 1) || s->end < s->begin || s->end - s->begin > 200) return 0;
  int n = 0;
  for (const char *c = s->begin; c < s->end && n < room - 1; c++) {
    if (*c < 0x20 || *c >= 0x7f || *c == '"' || *c == '\\') return 0;
    out[n++] = *c;
  }
  out[n] = 0;
  return n > 0;
}

/**
 * The town's script name into `out`, or an empty string.
 *
 * MEASURED, launches 22–23. The holder hands out the base at `+0xF8` of the
 * `CAdvMapTown` (vtable `0xFB624C`), and THAT base's slot `+0x90` is not the
 * name — it answers `whole+0x120`, another base. The name is the slot `+0x90`
 * of the virtual base at `+0x334` (vtable `0xFB6408`, a thunk to `0xC7B950`:
 * `lea eax,[ecx-84h]` on the implementer's `this`), an engine string —
 * `0-8-83-AdvMapTown-12113` for a random town, what `GetObjectNamesByType`
 * lists and what every Lua function takes. The whole object comes from RTTI
 * (the locator's offset), the base from it; nothing is derived from the
 * pointer the holder gave.
 */
#define TOWN_NAME_BASE 0x334u
static void town_name_of(void *town, char *out, int room) {
  out[0] = 0;
  BYTE *sub = (BYTE *)whole_object_of(town) + TOWN_NAME_BASE;
  TownScriptNameFn name = (TownScriptNameFn)vtable_entry(sub, VT_TOWN_NAME);
  if (!name) { log_line("town button: the town has no name slot where we measured one"); return; }
  if (!name_string_into(name(sub), out, room)) log_line("town button: the town's name does not read as one");
}

/**
 * RUN WHAT WAS SAID, NOW. `DoString` only queues a thread for the scheduler
 * (lua/adv-cast.c), and the scheduler is the world's per-frame tick — which
 * does not run while the town screen is up: in launch 23 the box came up the
 * moment the screen closed. The engine's own map start does exactly this
 * after handing over `advmap-startup.lua` (0x6D7B1A): the script system's
 * slot 2, no arguments, resumes every thread that is due. One tick, here,
 * is the same call.
 */
#define SCRIPTS_TICK 0x08u
typedef void (__thiscall *ScriptsTickFn)(void *scripts);
static int tick_the_map_scripts(void) {
  void *map = map_without_context();
  if (!map || !readable((BYTE *)map + WORLD_SCRIPTS, 4)) return 0;
  void *scripts = *(void **)((BYTE *)map + WORLD_SCRIPTS);
  ScriptsTickFn tick = (ScriptsTickFn)vtable_entry(scripts, SCRIPTS_TICK);
  /* The slot is OURS since the map watch took it (lua/hero-specialization.c),
     and `vtable_entry` answers only with code inside the executable — so it
     answered nothing, and launch 57 said every click to the map with no tick
     to run it. The engine's own tick is kept; call that. */
  if (!tick && g_engineTick && readable(scripts, 4)
      && *(BYTE **)scripts == (BYTE *)GetModuleHandleW(NULL) + SCRIPT_ENGINE_VTABLE_RVA) {
    tick = (ScriptsTickFn)(void *)g_engineTick;
  }
  if (!tick) return 0;
  tick(scripts);
  return 1;
}

// ---------------------------------------------------------------------------
// The click.

static int __thiscall own_button_handler(void *screen, void *msg) {
  (void)msg;
  void *town = screen_town(screen);
  if (!town) { log_line("town button: clicked, but the screen holds no town"); return 1; }
  int type = town_type_of(town);
  const TownButtonRow *row = town_button_of(type);
  if (!row) { log_num("town button: clicked for a town with no row, type ", type); return 1; }
  if (!g_hasBuilding(screen, row->building)) {
    log_num("town button: clicked, but the building is not there: ", row->building);
    return 1;
  }
  char name[64];
  town_name_of(town, name, sizeof name);
  if (!name[0]) {
    const char *of = class_name_of(town);
    log_text("town button: the town has no readable name; it is a ", of ? of : "(no rtti)");
  }
  char line[200];
  int at = 0;
  const char *head = "if ";
  while (*head) line[at++] = *head++;
  for (const char *c = row->lua; *c; c++) line[at++] = *c;
  const char *mid = " ~= nil then ";
  while (*mid) line[at++] = *mid++;
  for (const char *c = row->lua; *c; c++) line[at++] = *c;
  line[at++] = '(';
  line[at++] = '"';
  for (const char *c = name; *c; c++) line[at++] = *c;
  line[at++] = '"';
  const char *tail = "); else H5ENoSuchFunction(); end;";
  while (*tail) line[at++] = *tail++;
  line[at] = 0;
  if (!say_to_the_map(line)) {
    log_line("town button: the map has no script system to say it to — no script of ours has fetched the map yet");
    return 1;
  }
  log_text("town button: said to the map: ", line);
  log_line(tick_the_map_scripts() ? "town button:   and the scheduler was ticked once, so it ran now" : "town button:   but the scheduler could not be ticked");
  return 1;
}

static void __fastcall register_handlers_hook(void *screen) {
  g_registerHandlers(screen);
  g_registrar(screen, &OWN_MESSAGE_NAME, (void *)&own_button_handler, 0, 0);
  log_line("town button: enter_own registered on the town screen");
}

// ---------------------------------------------------------------------------
// The tooltip's `<value=special>`: the building's name for its level, read the
// way 0x8541B0 reads it for a shipped town — the town copies the building's
// record key out of its map (slot +0x5C), the map finds the node (0x4EB510),
// the node's record answers with the name of its current level, or the first
// when it is not built yet (0xAC0760, a cached text), and the button's IWindow
// base takes it for the key `special` (slot +0x80).

static const char SPECIAL_VALUE[] = "special";
static const NameString SPECIAL_VALUE_NAME = { SPECIAL_VALUE, SPECIAL_VALUE + sizeof SPECIAL_VALUE - 1, SPECIAL_VALUE + sizeof SPECIAL_VALUE };

static void set_special_tooltip(void *town, BYTE *button, int building) {
  BuildingKeyFn key_of = (BuildingKeyFn)vtable_entry(town, VT_TOWN_BUILDING_KEY);
  if (!key_of) return;
  NameString key = { NULL, NULL, NULL };
  key_of(town, &key, building);
  MapIterator it = { NULL, NULL };
  if (key.begin && key.end > key.begin) g_mapFind((BYTE *)town + TOWN_BUILDING_MAP, &it, &key);
  if (key.begin) g_nameFree(key.begin);
  if (!it.node) { log_num("town button: no record in the town's map for building ", building); return; }
  void *text = g_levelName((BYTE *)it.node + NODE_RECORD, 1);
  // The button's IWindow base, as the engine reaches it: `[button+4]` is its vbtable, `+8` in it the displacement.
  BYTE *vb = *(BYTE **)(button + 4);
  if (!readable(vb, 12)) return;
  BYTE *window = button + 4 + *(int *)(vb + 8);
  SetValueFn set_value = (SetValueFn)vtable_entry(window, VT_WINDOW_SET_VALUE);
  if (!set_value) return;
  set_value(window, &SPECIAL_VALUE_NAME, text);
}

// ---------------------------------------------------------------------------
// The button, after the engine has given up on it.

static void __fastcall update_special_hook(void *screen) {
  g_updateSpecial(screen);
  void *town = screen_town(screen);
  if (!town) return;
  int type = town_type_of(town);
  if (type < FIRST_TOWN_OF_OURS) return;
  const TownButtonRow *row = town_button_of(type);
  if (!row) { log_num("town button: a town of ours with no row, type ", type); return; }

  BYTE *s = (BYTE *)screen;
  if (!readable(s + SCREEN_ROOT, 4)) return;
  BYTE *root = *(BYTE **)(s + SCREEN_ROOT);
  if (!readable(root, 8)) return;
  // The root's IWindow base: `[root+4]` is its vbtable, `+8` in it the displacement.
  BYTE *vb = *(BYTE **)(root + 4);
  if (!readable(vb, 12)) return;
  BYTE *window = root + 4 + *(int *)(vb + 8);
  WindowFindFn find = (WindowFindFn)vtable_entry(window, VT_WINDOW_FIND);
  if (!find) { log_line("town button: the root has no lookup where we measured one"); return; }
  void *widget = find(window, &SPECIAL_WIDGET_NAME, 1);
  if (!widget) { log_line("town button: no EnterSpecial widget on this screen"); return; }
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  void *button = g_rtDynamicCast(widget, 0, base + IWINDOW_TYPE_RVA, base + IBUTTON_TYPE_RVA, 0);
  if (!button) { log_line("town button: EnterSpecial is not an IButton"); return; }
  SetStateFn set_state = (SetStateFn)vtable_entry(button, VT_BUTTON_SET_STATE);
  if (!set_state) return;
  set_state(button, row->state);
  set_special_tooltip(town, (BYTE *)button, row->building);
  int built = g_enableByBuilding(screen, &SPECIAL_WIDGET_NAME, row->building);
  log_num("town button: state ", row->state);
  log_num("town button:   building ", row->building);
  log_num("town button:   built ", built & 0xFF);
}

static int install_town_buttons(void) {
  g_registrar = (RegistrarFn)code_at(REGISTRAR_RVA, REGISTRAR_HEAD, sizeof REGISTRAR_HEAD, "the handler registrar");
  g_enableByBuilding = (EnableByBuildingFn)code_at(ENABLE_BY_BUILDING_RVA, ENABLE_BY_BUILDING_HEAD,
                                                   sizeof ENABLE_BY_BUILDING_HEAD, "enable by building");
  g_hasBuilding = (HasBuildingFn)code_at(HAS_BUILDING_RVA, HAS_BUILDING_HEAD, sizeof HAS_BUILDING_HEAD, "has building");
  g_rtDynamicCast = (RtDynamicCastFn)code_at(RT_DYNAMIC_CAST_RVA, RT_DYNAMIC_CAST_HEAD, sizeof RT_DYNAMIC_CAST_HEAD,
                                             "the dynamic cast");
  g_mapFind = (MapFindFn)code_at(MAP_FIND_RVA, MAP_FIND_HEAD, sizeof MAP_FIND_HEAD, "the building map's lookup");
  g_levelName = (LevelNameFn)code_at(LEVEL_NAME_RVA, LEVEL_NAME_HEAD, sizeof LEVEL_NAME_HEAD, "the building's level name");
  g_nameFree = (EngineFreeFn)code_at(ENGINE_FREE_RVA, ENGINE_FREE_HEAD, sizeof ENGINE_FREE_HEAD, "the allocator's free");
  if (!g_registrar || !g_enableByBuilding || !g_hasBuilding || !g_rtDynamicCast) return 0;
  if (!g_mapFind || !g_levelName || !g_nameFree) return 0;
  g_registerHandlers = (ScreenVoidFn)detour(REGISTER_HANDLERS_RVA, REGISTER_HANDLERS_HEAD, sizeof REGISTER_HANDLERS_HEAD,
                                            &register_handlers_hook, "town screen handlers");
  g_updateSpecial = (ScreenVoidFn)detour(UPDATE_SPECIAL_RVA, UPDATE_SPECIAL_HEAD, sizeof UPDATE_SPECIAL_HEAD,
                                         &update_special_hook, "town screen special button");
  return g_registerHandlers && g_updateSpecial;
}

// ---------------------------------------------------------------------------
// THE MAP HAS TO INTRODUCE ITSELF. A click is the engine's: the handler runs
// with no Lua context, and the map is reached from a context (the service
// lookup at 0xA455E0 dereferences it — lua/hero-specialization.c). What
// `say_to_the_map` uses is the map the last script of ours fetched, so a map
// with a button on it calls this once at its start — any function of ours
// that fetches the map would do; this one is named for what it is for.

/** `H5ETownButtons()` — how many buttons the file lists; fetches the map as a side effect. */
static void *__fastcall lua_town_buttons(void *ctx) {
  void *map = adventure_map(ctx);
  log_line(map ? "town button: the map introduced itself" : "town button: H5ETownButtons could not fetch the map");
  return (void *)(INT_PTR)lua_push_int(ctx, g_townButtonCount);
}

// ---------------------------------------------------------------------------
// A BOX ON THE SCREEN THAT IS UP. Launch 24: the click's Lua ran at once, and
// its `MessageBox` still came up only after the town screen closed — the
// engine's `MessageBox` (0x5F04E0) does not show anything, it queues a
// `CScriptDialogEntry_MessageBox` on the world, and the ADVENTURE screen's
// update is what pops the queue (0x6B0E20 → 0x7666E0 → 0x6D2FA0), which the
// town screen does not run. The screen's own boxes — the grail's, 0x855B4F —
// go straight to 0x6D2FA0/0x6D2D60, which asks the interface stack for the
// screen on top (0x5BA730), builds a 0x16C-byte box, and shows it there
// (0x6CF590, the same ShowWindow the count window uses). So a box on the
// screen that is up is that call with the text the engine's own reader
// makes of the Lua argument — 0x5CD330, what `MessageBox` itself runs.
//
//     H5EMessageBox(text [, header])
//
// `text` and `header` are what `MessageBox` takes: a text file's path, or a
// table with the path and its `<value=…>` parameters. Unlike `MessageBox`
// the thread is not held while the box is open.

/** The engine's wide string: {begin, end, capacity end} of WCHAR. */
typedef struct { WCHAR *begin; WCHAR *end; WCHAR *cap; } WideString;

/** `sub esp,64h / push ebx / mov ebx,ecx` — (out, the four-word block, the argument's index), `ret 8`; true when a text was made. */
#define MESSAGE_TEXT_RVA 0x1cd330u
static const BYTE MESSAGE_TEXT_HEAD[6] = { 0x83, 0xEC, 0x64, 0x53, 0x8B, 0xD9 };
/** `push ebx / push ebp / push esi / mov ebx,edx / mov ebp,ecx` — the picture-less box, `ret 14h`:
 *  (owner in ecx, edx, flag, texture, header, text, flag). The adventure screen's own
 *  MessageBox case passes (0, 0, 0, 0, &header, &text, 1). */
#define SHOW_BOX_RVA 0x2d2d60u
static const BYTE SHOW_BOX_HEAD[7] = { 0x53, 0x55, 0x56, 0x8B, 0xDA, 0x8B, 0xE9 };

typedef int (__thiscall *MessageTextFn)(WideString *out, void *block, int arg);
typedef void (__fastcall *ShowBoxFn)(void *owner, void *edx, int a, void *texture, WideString *header, WideString *text, int b);
typedef void (__cdecl *BoxFreeFn)(void *p);

static MessageTextFn g_messageText = NULL;
static ShowBoxFn g_showBox = NULL;
static BoxFreeFn g_boxFree = NULL;
static AllocateFn g_boxAllocate = NULL;

/**
 * An empty wide string the reader can write into. NOT three nulls: the reader
 * truncates what it is given (`*begin = 0` unless begin == end) and its
 * assign grows from the capacity it finds, and with nothing behind the
 * pointers it wrote the terminator at address 2 (launch 26, 0x4E75F9). The
 * engine's `MessageBox` hands it sixteen bytes from the allocator, terminated,
 * and so does this.
 */
#define EMPTY_WIDE_BYTES 16
static int empty_wide(WideString *s) {
  WCHAR *buf = (WCHAR *)g_boxAllocate(EMPTY_WIDE_BYTES);
  if (!buf) return 0;
  buf[0] = 0;
  s->begin = s->end = buf;
  s->cap = (WCHAR *)((BYTE *)buf + EMPTY_WIDE_BYTES);
  return 1;
}

static void *__fastcall lua_message_box(void *ctx) {
  if (!g_messageText || !g_showBox || !g_boxFree || !g_boxAllocate) { log_line("H5EMessageBox: the engine's box is not where we measured it"); return NULL; }
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  // The block every one of theirs hands to the text reader: a reporter, a
  // zero, the call context, a flag (lua/hero-specialization.c).
  void *block[4] = { base + REPORTER_VTABLE_RVA, NULL, ctx, NULL };
  WideString text, header;
  if (!empty_wide(&text) || !empty_wide(&header)) { log_line("H5EMessageBox: no memory for the text"); return NULL; }
  if (!(g_messageText(&text, block, 1) & 0xFF) || text.begin == text.end) {
    log_line("H5EMessageBox: takes a text (a path, or a table with a path and its values)");
    g_boxFree(text.begin);
    g_boxFree(header.begin);
    return NULL;
  }
  int withHeader = (g_messageText(&header, block, 2) & 0xFF) && header.begin != header.end;
  if (!withHeader) { header.end = header.begin; header.begin[0] = 0; }
  // Header before text: the adventure screen passes the entry's `+0x14` third
  // and the formatted body fourth, and launch 27 drew ours the other way round.
  g_showBox(NULL, NULL, 0, NULL, &header, &text, 1);
  log_line(withHeader ? "H5EMessageBox: shown on the screen that is up, with a header" : "H5EMessageBox: shown on the screen that is up");
  g_boxFree(text.begin);
  g_boxFree(header.begin);
  return NULL;
}

/** Added where the others are — BEFORE the table is handed to the engine. */
static void add_town_button_map_functions(void) {
  add_map_function("H5ETownButtons", (void *)&lua_town_buttons);
  g_messageText = (MessageTextFn)code_at(MESSAGE_TEXT_RVA, MESSAGE_TEXT_HEAD, sizeof MESSAGE_TEXT_HEAD, "the message text reader");
  g_showBox = (ShowBoxFn)code_at(SHOW_BOX_RVA, SHOW_BOX_HEAD, sizeof SHOW_BOX_HEAD, "the screen's message box");
  g_boxFree = (BoxFreeFn)code_at(ENGINE_FREE_RVA, ENGINE_FREE_HEAD, sizeof ENGINE_FREE_HEAD, "the allocator's free");
  g_boxAllocate = (AllocateFn)code_at(ALLOCATE_RVA, ALLOCATE_HEAD, ALLOCATE_HEAD_LEN, "the allocator");
  add_map_function("H5EMessageBox", (void *)&lua_message_box);
}
