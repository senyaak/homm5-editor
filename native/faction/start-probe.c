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

#define PLAYER_KIND 0x90u
#define PLAYER_RACE 0x94u
#define PLAYER_LOG_LIST 0x624u
#define SCREEN_PLAYER 0x3Cu

typedef void *(__fastcall *PlayerCtorFn)(void *self, void *edx, void *a1, void *a2, void *a3,
                                         void *a4, void *a5, void *a6, void *a7, void *a8);
typedef void *(__fastcall *TownOfRaceFn)(int race);
typedef void *(__fastcall *HeroOfRaceFn)(void *pool, int race);
typedef int (__fastcall *ScreenCheckFn)(void *self, void *edx, void *a1, void *a2, void *a3);

static PlayerCtorFn g_probePlayerCtor = NULL;
static TownOfRaceFn g_probeTownOfRace = NULL;
static HeroOfRaceFn g_probeHeroOfRace = NULL;
static ScreenCheckFn g_probeScreenCheck = NULL;
static int g_probeScreenLogged = 0;

static void log_player(const char *what, void *player) {
  if (!readable(player, PLAYER_LOG_LIST + 4)) { log_text(what, "(unreadable)"); return; }
  log_hex(what, (DWORD)player);
  log_num("start probe:   kind ", *(int *)((BYTE *)player + PLAYER_KIND));
  log_num("start probe:   race ", *(int *)((BYTE *)player + PLAYER_RACE));
  log_hex("start probe:   log list ", *(DWORD *)((BYTE *)player + PLAYER_LOG_LIST));
}

static void *__fastcall player_ctor_hook(void *self, void *edx, void *a1, void *a2, void *a3,
                                         void *a4, void *a5, void *a6, void *a7, void *a8) {
  void *p = g_probePlayerCtor(self, edx, a1, a2, a3, a4, a5, a6, a7, a8);
  log_player("start probe: player made ", p);
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
    log_player("start probe: the screen's player ", *(void **)((BYTE *)self + SCREEN_PLAYER));
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
  return g_probePlayerCtor && g_probeTownOfRace && g_probeHeroOfRace && g_probeScreenCheck;
}
