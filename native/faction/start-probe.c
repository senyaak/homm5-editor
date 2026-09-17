// What a race gets at the start of a game — a probe, only in a build that asks.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_start_probe

// ---------------------------------------------------------------------------
// WHY. A twelfth TownType reaches the picker, and the game then dies on the
// adventure screen at 0xBF9684 — the screen asks a player for a log list that
// only a human's CPlayer::Init makes, and gets NULL. Reading said the human
// had lost his start (no hero of the race) and the screen came up for an AI;
// a non-scenario hero of the race did not change the crash. So reading stops
// and the three doors of a race's start are watched instead:
//
//   CPlayer's constructor (0xC02BA0)     kind (+0x90: 0 = human), race (+0x94)
//                                        and whether the log list (+0x624) exists
//   TownSharedOfRace (0xAC0CB0)          race in, the TOWN_ANY member out
//   HeroOfRace (0xB911E0)                race in, the HEROES_ANY member out
//   the screen's per-frame check (0x6DA580)   which player it holds
//
// Reported, never changed. `--log faction/start-probe`.

/** `sub esp,0Ch / cmp dword ptr [esp+2Ch],0` — eight stack args, `ret 20h`. */
#define PLAYER_CTOR_RVA 0x802ba0u
static const BYTE PLAYER_CTOR_HEAD[8] = { 0x83, 0xEC, 0x0C, 0x83, 0x7C, 0x24, 0x2C, 0x00 };
/** `sub esp,10h / push ebx / push ebp` — the race in ecx, the shared back. */
#define TOWN_OF_RACE_RVA 0x6c0cb0u
static const BYTE TOWN_OF_RACE_HEAD[5] = { 0x83, 0xEC, 0x10, 0x53, 0x55 };
/** `sub esp,20h / push ebp / push edi` — the pool in ecx, the race in edx. */
#define HERO_OF_RACE_RVA 0x7911e0u
static const BYTE HERO_OF_RACE_HEAD[5] = { 0x83, 0xEC, 0x20, 0x55, 0x57 };
/** `push ebx / mov ebx,ecx / cmp dword ptr [ebx+44h],7` — one stack arg, `ret 0Ch`. */
#define SCREEN_CHECK_RVA 0x2da580u
static const BYTE SCREEN_CHECK_HEAD[7] = { 0x53, 0x8B, 0xD9, 0x83, 0x7B, 0x44, 0x07 };

/**
 * The setup's hero lists, one per race: `sub esp,34h / push ebp / push esi`,
 * the map descriptor in ecx and the players state in edx, no stack args. It
 * rebuilds the global vector of vectors at 0x1207BE0 — RaceCount() lists of
 * hero shareds, indexed by TownType - 3 — out of HEROES_ANY, the map's roster
 * and the players' picks. The wait screen's hero arrows walk those lists.
 */
#define HERO_LISTS_RVA 0x78d360u
static const BYTE HERO_LISTS_HEAD[5] = { 0x83, 0xEC, 0x34, 0x55, 0x56 };
#define HERO_LISTS_GLOBAL_RVA 0xe07be0u
/** A hero shared's TownType and ScenarioHero, as the builder reads them. */
#define HERO_TOWN_TYPE 0x164u
#define HERO_SCENARIO 0x1FCu

/** IPlayer's SetState (slot +0x48 of the vtable at +0x1C): `mov eax,[esp+4] /
 *  cmp [ecx+634h],eax` — the state at +0x650 of the whole object, one stack
 *  arg, `ret 4`. Every transition is a line, with the player's number. */
#define PLAYER_SET_STATE_RVA 0x8069e0u
static const BYTE PLAYER_SET_STATE_HEAD[10] = { 0x8B, 0x44, 0x24, 0x04, 0x39, 0x81, 0x34, 0x06, 0x00, 0x00 };

#define PLAYER_KIND 0x90u
/** The constructor's second argument — the player's NUMBER, not his race. */
#define PLAYER_INDEX 0x94u
/** The fourth: the race chosen in the setup. */
#define PLAYER_RACE 0x198u
#define PLAYER_LOG_LIST 0x624u
/** The whole object, 0x6BC bytes by its allocation. */
#define PLAYER_SIZE 0x6BCu
/** The screen holds the IPlayer subobject, whose vtable the constructor puts at +0x1C. */
#define PLAYER_INTERFACE 0x1Cu
#define SCREEN_PLAYER 0x3Cu

/** Every player the constructor made, for the dump at screen time. */
#define MAX_PROBE_PLAYERS 12
static void *g_probePlayers[MAX_PROBE_PLAYERS];
static int g_probePlayerCount = 0;

typedef void *(__fastcall *PlayerCtorFn)(void *self, void *edx, void *a1, void *a2, void *a3,
                                         void *a4, void *a5, void *a6, void *a7, void *a8);
typedef void *(__fastcall *TownOfRaceFn)(int race);
typedef void *(__fastcall *HeroOfRaceFn)(void *pool, int race);
typedef int (__fastcall *ScreenCheckFn)(void *self, void *edx, void *a1, void *a2, void *a3);
typedef void (__fastcall *HeroListsFn)(void *mapDesc, void *players);
typedef void (__fastcall *PlayerSetStateFn)(void *iplayer, void *edx, int state);

static PlayerCtorFn g_probePlayerCtor = NULL;
static TownOfRaceFn g_probeTownOfRace = NULL;
static HeroOfRaceFn g_probeHeroOfRace = NULL;
static ScreenCheckFn g_probeScreenCheck = NULL;
static HeroListsFn g_probeHeroLists = NULL;
static PlayerSetStateFn g_probeSetState = NULL;

static void __fastcall player_set_state_hook(void *iplayer, void *edx, int state) {
  BYTE *player = (BYTE *)iplayer - PLAYER_INTERFACE;
  if (readable(player, PLAYER_RACE + 4)) {
    log_num("start probe: state of player ", *(int *)(player + PLAYER_INDEX));
    log_num("start probe:   race ", *(int *)(player + PLAYER_RACE));
    log_num("start probe:   was ", *(int *)(player + 0x650));
    log_num("start probe:   becomes ", state);
  }
  g_probeSetState(iplayer, edx, state);
}

typedef struct { BYTE **begin; BYTE **end; BYTE **cap; } HeroList;

static void __fastcall hero_lists_hook(void *mapDesc, void *players) {
  g_probeHeroLists(mapDesc, players);
  HeroList **global = (HeroList **)((BYTE *)GetModuleHandleW(NULL) + HERO_LISTS_GLOBAL_RVA);
  HeroList *begin = global[0], *end = global[1];
  if (!readable(begin, 4) || end < begin) { log_line("start probe: hero lists unreadable"); return; }
  int races = (int)(end - begin);
  log_num("start probe: hero lists, one per race: ", races);
  for (int i = 0; i < races; i++) {
    int n = (int)(begin[i].end - begin[i].begin);
    log_num("start probe:   list index ", i);
    log_num("start probe:     heroes ", n);
    // The last list in full: it is the one the twelfth town gets.
    if (i != races - 1) continue;
    for (int h = 0; h < n; h++) {
      BYTE *hero = begin[i].begin[h];
      log_hex("start probe:     hero ", (DWORD)hero);
      if (readable(hero, HERO_SCENARIO + 1)) {
        log_num("start probe:       town type ", *(int *)(hero + HERO_TOWN_TYPE));
        log_num("start probe:       scenario ", hero[HERO_SCENARIO]);
      }
    }
  }
}
static int g_probeScreenLogged = 0;

static void log_player(const char *what, void *player) {
  if (!readable(player, PLAYER_LOG_LIST + 4)) { log_text(what, "(unreadable)"); return; }
  log_hex(what, (DWORD)player);
  log_num("start probe:   kind ", *(int *)((BYTE *)player + PLAYER_KIND));
  log_num("start probe:   number ", *(int *)((BYTE *)player + PLAYER_INDEX));
  log_num("start probe:   race ", *(int *)((BYTE *)player + PLAYER_RACE));
  log_hex("start probe:   log list ", *(DWORD *)((BYTE *)player + PLAYER_LOG_LIST));
}

/** Every word of a player, for reading offline against another player's. */
static void dump_player(void *player) {
  if (!readable(player, PLAYER_SIZE)) return;
  log_hex("start probe: dump of ", (DWORD)player);
  for (DWORD at = 0; at < PLAYER_SIZE; at += 16) {
    char line[80];
    int n = 0;
    const char *hex = "0123456789abcdef";
    line[n++] = '+';
    for (int s = 8; s >= 0; s -= 4) line[n++] = hex[(at >> s) & 15];
    for (int w = 0; w < 4; w++) {
      DWORD v = *(DWORD *)((BYTE *)player + at + w * 4);
      line[n++] = ' ';
      for (int s = 28; s >= 0; s -= 4) line[n++] = hex[(v >> s) & 15];
    }
    line[n] = 0;
    log_line(line);
  }
}

static void *__fastcall player_ctor_hook(void *self, void *edx, void *a1, void *a2, void *a3,
                                         void *a4, void *a5, void *a6, void *a7, void *a8) {
  void *p = g_probePlayerCtor(self, edx, a1, a2, a3, a4, a5, a6, a7, a8);
  log_player("start probe: player made ", p);
  if (p && g_probePlayerCount < MAX_PROBE_PLAYERS) g_probePlayers[g_probePlayerCount++] = p;
  return p;
}

static void *__fastcall town_of_race_hook(int race) {
  void *shared = g_probeTownOfRace(race);
  log_num("start probe: town of race ", race);
  log_hex("start probe:   shared ", (DWORD)shared);
  return shared;
}

static void *__fastcall hero_of_race_hook(void *pool, int race) {
  void *hero = g_probeHeroOfRace(pool, race);
  log_num("start probe: hero of race ", race);
  log_hex("start probe:   hero ", (DWORD)hero);
  return hero;
}

static int __fastcall screen_check_hook(void *self, void *edx, void *a1, void *a2, void *a3) {
  if (!g_probeScreenLogged++ && readable(self, SCREEN_PLAYER + 4)) {
    BYTE *held = *(BYTE **)((BYTE *)self + SCREEN_PLAYER);
    log_hex("start probe: the screen holds ", (DWORD)held);
    if (held) log_player("start probe: the screen's player ", held - PLAYER_INTERFACE);
    for (int i = 0; i < g_probePlayerCount; i++) log_player("start probe: player now ", g_probePlayers[i]);
    (void)dump_player;
  }
  return g_probeScreenCheck(self, edx, a1, a2, a3);
}

static int install_start_probe(void) {
  if (!LOG_ON) return 0;
  g_probePlayerCtor = (PlayerCtorFn)detour(PLAYER_CTOR_RVA, PLAYER_CTOR_HEAD, sizeof PLAYER_CTOR_HEAD,
                                           &player_ctor_hook, "player constructor");
  g_probeTownOfRace = (TownOfRaceFn)detour(TOWN_OF_RACE_RVA, TOWN_OF_RACE_HEAD, sizeof TOWN_OF_RACE_HEAD,
                                           &town_of_race_hook, "town of race");
  g_probeHeroOfRace = (HeroOfRaceFn)detour(HERO_OF_RACE_RVA, HERO_OF_RACE_HEAD, sizeof HERO_OF_RACE_HEAD,
                                           &hero_of_race_hook, "hero of race");
  g_probeScreenCheck = (ScreenCheckFn)detour(SCREEN_CHECK_RVA, SCREEN_CHECK_HEAD, sizeof SCREEN_CHECK_HEAD,
                                             &screen_check_hook, "screen check");
  g_probeHeroLists = (HeroListsFn)detour(HERO_LISTS_RVA, HERO_LISTS_HEAD, sizeof HERO_LISTS_HEAD,
                                         &hero_lists_hook, "setup hero lists");
  g_probeSetState = (PlayerSetStateFn)detour(PLAYER_SET_STATE_RVA, PLAYER_SET_STATE_HEAD,
                                             sizeof PLAYER_SET_STATE_HEAD, &player_set_state_hook,
                                             "player set state");
  return g_probePlayerCtor && g_probeTownOfRace && g_probeHeroOfRace && g_probeScreenCheck
         && g_probeHeroLists && g_probeSetState;
}
