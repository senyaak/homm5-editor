// Saying something to a battle's script: vocabulary and triggers.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_battle

// ---------------------------------------------------------------------------
// Saying something to a battle's script.
//
// The engine talks to a battle by running SOURCE rather than through Lua's C
// API: at `0x720b9d` it pushes the text `DoPrepare()` and hands it to a runner,
// and `UnitMove("%s")` is the same thing with a name substituted. An event of
// our own is therefore a string like any other — no stack of theirs to balance,
// no state of theirs to find — which is this file's rule everywhere else: make
// the call the way the engine makes it.
//
// WHAT A BATTLE MUST HAVE for any of it to work, and it is the same condition
// that decides whether a mod's `combat-startup.lua` runs at all.
// `CCombat::LoadScripts` (`0x652870`) opens by asking for the script host and
// returns having loaded nothing when the battle has none:
//
//     cmp [esi+4F0h],dl        ; has this battle a script host
//     cmovne edx,esi
//     test edx,edx / je out    ; no host -> no startup file, no tail, no us
//     cmp [edx+1D0h],0 / je out
//
// So the hook below is a PROBE before it is a trigger: it writes down what that
// flag says in a real, ordinary battle. Reading took this as far as it goes —
// the flag is set from somewhere else, and only a fight can say whether an
// unscripted one has a host.
#define COMBAT_LOAD_SCRIPTS_RVA 0x252870u
static const BYTE COMBAT_LOAD_SCRIPTS_HEAD[5] = { 0x83, 0xEC, 0x18, 0x33, 0xD2 };

/** The runner: the host as `this`, the source, and an optional `%s` for it. */
#define RUN_SOURCE_RVA 0x644cf0u
static const BYTE RUN_SOURCE_HEAD[6] = { 0x83, 0xEC, 0x18, 0x57, 0x8B, 0xF9 };

/** The script host is a base INSIDE the battle, not a pointer it holds. */
#define COMBAT_SCRIPT_HOST 0x1B4u
#define COMBAT_HAS_SCRIPT 0x4F0u
#define COMBAT_SCRIPT_STATE 0x1D0u

typedef void(__fastcall *LoadScriptsFn)(void *combat, void *edx);
typedef void(__fastcall *RunSourceFn)(void *host, void *edx, const char *source, const char *arg);

static LoadScriptsFn g_loadScripts = NULL;
static RunSourceFn g_runSource = NULL;
static int g_combatLogged = 0;

/**
 * Run one line of Lua inside a battle, guarded the way the engine guards it.
 *
 * Everything is checked before the call and nothing is assumed: no host, no
 * call. A battle that cannot hear us is not an error — it is the answer to the
 * question this was written to ask.
 */
static void combat_run(void *combat, const char *source, const char *arg) {
  if (!g_runSource || !combat) return;
  if (!readable((BYTE *)combat + COMBAT_HAS_SCRIPT, 1)) return;
  if (!*((BYTE *)combat + COMBAT_HAS_SCRIPT)) return;
  void *host = (BYTE *)combat + COMBAT_SCRIPT_HOST;
  // The runner reads `[this+0x1C]` first thing and does nothing without it.
  if (!readable(host, 0x20)) return;
  g_runSource(host, NULL, source, arg);
}

/**
 * A name is ASKED FOR rather than called: `if f ~= nil then f(); end;`.
 *
 * Ours is not a hook the engine declares, so nothing promises a script defines
 * it — and calling a nil is a Lua error in a context with no console to print
 * it to. The engine gets away with `DoPrepare()` because `combat-startup.lua`
 * declares every one of its hooks empty first.
 */
static void __fastcall load_scripts_hook(void *combat, void *edx) {
  g_loadScripts(combat, edx);

  if (g_combatLogged++ < 8) {
    log_line("battle scripts loaded:");
    log_num("  has a script host ",
            readable((BYTE *)combat + COMBAT_HAS_SCRIPT, 1) ? *((BYTE *)combat + COMBAT_HAS_SCRIPT) : -1);
    log_hex("  state             ",
            readable((BYTE *)combat + COMBAT_SCRIPT_STATE, 4)
              ? *(DWORD *)((BYTE *)combat + COMBAT_SCRIPT_STATE) : 0);
  }
  combat_run(combat, "if H5ECombatStarted ~= nil then H5ECombatStarted(); end; "
                     "if H5ECombatTest ~= nil then H5ECombatTest(); end;", NULL);
}

/**
 * The other end of the same question: where a battle's script host is BUILT.
 *
 * The first probe hooked `CCombat::LoadScripts` and never fired, which was an
 * answer of its own — three of the four battle kinds do not call it, they carry
 * the same code inlined. `0x65af0b` is one of those, and it is the interesting
 * one: `mov byte ptr [ebp+4F0h],1` sets the flag outright and then loads
 * `combat-startup.lua` in place, so a battle down that path always has a host.
 *
 * `0xa44bc0` is the host's own init and that path's only caller, and it is
 * where the Lua state (`[host+0x1C]`, the very field the runner tests) is
 * filled. So this hook sees the host at the earliest moment it can be spoken
 * to — before the startup file, which is why what it says is worth having:
 *
 *   - whether an ordinary battle gets here AT ALL;
 *   - the address behind the host's vtable slot 0, which is the one funnel every
 *     line of Lua a battle ever runs goes through, inlined paths included. With
 *     it the trigger stops depending on which of the four kinds of battle it is.
 */
#define COMBAT_HOST_INIT_RVA 0x644bc0u
static const BYTE COMBAT_HOST_INIT_HEAD[6] = { 0x56, 0x8B, 0xF1, 0x57, 0x85, 0xF6 };

typedef void *(__fastcall *HostInitFn)(void *host, void *edx);
static HostInitFn g_hostInit = NULL;
static int g_hostLogged = 0;

/**
 * Every line a battle ever runs goes through the host's vtable slot 0.
 *
 * Taken from the LIVE vtable rather than from an address of ours: the game's
 * image is relocatable (`DYNAMIC_BASE` is set in its header), so the pointer the
 * probe printed was a runtime one and meant nothing on disk. Reading the slot
 * where the engine reads it needs no address at all, and swapping it is how the
 * engine itself would replace an implementation — the same move as the dark
 * energy bar's accessor.
 *
 * ONE SWAP SERVES EVERY BATTLE: the vtable belongs to the class, not to the
 * fight, so the four kinds of battle — the one that calls `LoadScripts` and the
 * three that carry it inlined — all arrive here.
 */
typedef void *(__fastcall *RunLineFn)(void *host, void *edx, const char *source);
static RunLineFn g_runLine = NULL;
static int g_lineLogged = 0;

/**
 * The engine's own line we ride on — and it is NOT the one that looks right.
 *
 * `createCombatAliases();` comes straight after the startup file and reads like
 * the moment everything is in place. It is not: a `doFile` inside a chunk is
 * QUEUED, not run where it stands, so at that instant our own file has not
 * executed yet and every name in it is still nil. Measured — the extension asked
 * for `H5EFire` there and the console said "Value was NIL when getting global".
 *
 * `DoStart()` is the engine's own "the battle begins", it runs after everything
 * queued before it, and it is the honest name for the event besides.
 */
static const char START_LINE[] = "DoStart()";

/** Whether `text` holds `word` anywhere in its first `limit` bytes. */
static int contains(const char *text, const char *word, int limit) {
  for (int i = 0; i < limit && text[i]; i++) {
    int j = 0;
    while (word[j] && text[i + j] == word[j]) j++;
    if (!word[j]) return 1;
  }
  return 0;
}

/** Whether `text` begins with `word` — no CRT, and none needed. */
static int begins_with(const char *text, const char *word) {
  while (*word) { if (*text != *word) return 0; text++; word++; }
  return 1;
}

/**
 * The battle we are in, so an event that has no host in its hands can find one.
 *
 * The mana command knows the caster and nothing about the fight he is in; the
 * host it needs is the one built for that fight, and a battle builds exactly
 * one. Every use is guarded — a stale pointer answers "no live Lua state" and
 * the event is dropped rather than fired at a dead battle.
 */
static void *g_battleHost = NULL;
static int g_firedLogged = 0;

/** Trigger kinds, mirrored in the Lua the mod carries (src/mods/skill-scripts.ts). */
#define TRIGGER_COMBAT_STARTED 1
#define TRIGGER_HERO_MANA_CHANGED 2

/**
 * Fire one of ours, with up to three numbers.
 *
 * ARGUMENTS ARE FREE IN THIS DIRECTION and that is the whole trick: the engine
 * runs source, so an argument is text. Its own `UnitMove("%s")` is the same
 * thing with a name pasted in. Reading an argument BACK out of Lua is the
 * expensive direction — it goes through the engine's own parser — and nothing
 * here needs it: the vocabulary a script registers with is ordinary Lua, in the
 * tail of `combat-startup.lua`.
 */
static void fire_trigger(int kind, int argc, int a, int b, int c) {
  if (!g_runLine || !g_battleHost) return;
  if (!readable((BYTE *)g_battleHost + 0x1C, 4) || !*(DWORD *)((BYTE *)g_battleHost + 0x1C)) return;

  char line[200];
  int at = 0;
  // The `else` is a PROBE, and it earns its place: the log line below is written
  // before the source runs, so on its own it cannot tell "the script has our
  // runtime and ran it" from "H5EFire was nil and nothing happened". This makes
  // the two different lines in the log.
  const char *head = "if H5EFire ~= nil then H5EFire(";
  while (*head) line[at++] = *head++;
  const int args[3] = { a, b, c };
  for (int i = 0; i < argc + 1; i++) {
    if (i) line[at++] = ',';
    int len = 0;
    num_to_dec(i ? args[i - 1] : kind, line + at, &len);
    at += len;
  }
  const char *tail = "); end;";
  while (*tail) line[at++] = *tail++;
  line[at] = 0;
  // NOT RATIONED, for the reason spell-cast.c gives at length: a session holds
  // several battles and the allowance was always spent before the cast being
  // watched. The counter stays only so the line can say which firing this is.
  g_firedLogged++;
  log_num("battle fires #", g_firedLogged);
  log_text("   ", line);
  g_runLine(g_battleHost, NULL, line);
}

/**
 * The moment a perk can be written against.
 *
 * `combat-startup.lua` is loaded first and our tail is the end of it, so by the
 * time the engine runs `createCombatAliases();` everything a mod defined is
 * defined. That is where our own event goes — and it is asked for by name,
 * because nothing declares it and calling a nil is an error into a context with
 * no console.
 */
static void *__fastcall run_line_hook(void *host, void *edx, const char *source) {
  void *result = g_runLine(host, edx, source);
  // EVERY line a battle runs, the first few of them, because the question left
  // over from the last run is which combat-startup.lua the game actually read —
  // ours, with the trigger runtime in its tail, or the shipped one. The loader
  // composes a `doFile("…")` out of the path, so the answer is in this stream.
  if (g_lineLogged < 12 && source && readable(source, 8)) {
    g_lineLogged++;
    log_text("battle runs: ", source);
    // THE TAIL, not the head. A whole file arrives here as one string, and the
    // two copies of `combat-startup.lua` — the game's and ours — begin with the
    // same 7894 bytes; what tells them apart is only at the end. Reading the
    // head answered nothing for two runs.
    // Readability asked ONCE for the whole span, not per byte: `readable` calls
    // VirtualQuery, and eight thousand of those before every battle is the pause
    // that showed up on the loading screen. Measured by the person playing, which
    // is the only place a hook's cost is ever visible.
    int len = 0;
    int span = readable(source, 16384) ? 16384 : readable(source, 1024) ? 1024 : 64;
    while (len < span && source[len]) len++;
    if (len > 400) {
      log_num("     source length ", len);
      log_text("     source ends:  ", source + len - 120);
    }
  }
  // The host that ran this line is the host of the battle now being built, and
  // it is worth remembering before the moment we actually fire on.
  g_battleHost = host;
  if (!source || !readable(source, 160)) return result;
  if (!contains(source, START_LINE, 150)) return result;
  log_line("battle: it has begun, and everything queued before it has run");
  fire_trigger(TRIGGER_COMBAT_STARTED, 0, 0, 0, 0);
  return result;
}

/**
 * The same lines, in the game's own console — Senya's ask, and a good one.
 *
 * The log file answers questions after the fact; the console answers them while
 * the battle is on screen, which is the difference between "run it again and
 * I'll look" and "I saw it". It goes out as `print`, the one Lua call that
 * reaches the console, through the same slot every battle line goes through.
 *
 * Only while a battle is up — outside one there is no host to speak to, and the
 * file keeps its record either way. The guard against re-entry is not optional:
 * `run_line_hook` logs what it sees, and logging through it would be a loop.
 */
static int g_inConsole = 0;

static void console_line(const char *text) {
  if (g_inConsole || !g_battleHost || !g_runLine) return;
  g_inConsole = 1;
  char line[240];
  int at = 0;
  const char *head = "print(\"h5e: ";
  while (*head) line[at++] = *head++;
  // A quote of ours inside would end the string early and leave the console
  // reading our line as Lua; there are none today, and this keeps it that way.
  for (int i = 0; text[i] && at < (int)sizeof line - 8; i++) {
    line[at++] = text[i] == '"' ? '\'' : text[i];
  }
  line[at++] = '"';
  line[at++] = ')';
  line[at++] = ';';
  line[at] = 0;
  g_runLine(g_battleHost, NULL, line);
  g_inConsole = 0;
}

/** Put ours in the slot, once, and keep theirs to call. */
static void take_over_run_line(void *host) {
  if (g_runLine || !readable(host, 4)) return;
  void **vt = *(void ***)host;
  if (!readable(vt, 4) || !points_at_code(vt[0])) return;
  DWORD old = 0;
  if (!VirtualProtect(vt, sizeof(void *), PAGE_READWRITE, &old)) {
    log_line("could not make the battle host's vtable writable");
    return;
  }
  g_runLine = (RunLineFn)vt[0];
  vt[0] = &run_line_hook;
  VirtualProtect(vt, sizeof(void *), old, &old);
  log_hex("battle: every line now comes past us; theirs is at rva ",
          (DWORD)((BYTE *)g_runLine - (BYTE *)GetModuleHandleW(NULL)));
}

static void *__fastcall host_init_hook(void *host, void *edx) {
  void *result = g_hostInit(host, edx);
  if (g_hostLogged++ < 8) {
    log_line("battle script host built:");
    log_object("  host        ", host);
    if (readable(host, 4)) {
      void **vt = *(void ***)host;
      if (readable(vt, 4)) log_hex("  runs source ", (DWORD)vt[0]);
    }
    log_hex("  lua state   ", readable((BYTE *)host + 0x1C, 4) ? *(DWORD *)((BYTE *)host + 0x1C) : 0);
  }
  // And the reason this hook stays now that it has answered: the host is the
  // only thing that names the function every line of Lua goes through, and it
  // has just been built.
  take_over_run_line(host);
  return result;
}

/** The battle's side of the extension: one detour, one address only read. */
static int install_combat_scripts(void) {
  BYTE *runner = (BYTE *)GetModuleHandleW(NULL) + RUN_SOURCE_RVA;
  for (int i = 0; i < (int)sizeof RUN_SOURCE_HEAD; i++) {
    if (runner[i] != RUN_SOURCE_HEAD[i]) {
      log_line("the script runner is not the shape we know - a battle will not be spoken to");
      return 0;
    }
  }
  g_runSource = (RunSourceFn)runner;
  // Both ends, because one battle in four goes through the first and the rest
  // carry it inlined. Neither is required for the other to be useful.
  g_loadScripts = (LoadScriptsFn)detour(COMBAT_LOAD_SCRIPTS_RVA, COMBAT_LOAD_SCRIPTS_HEAD,
                                        sizeof COMBAT_LOAD_SCRIPTS_HEAD, &load_scripts_hook,
                                        "battle script loader");
  g_hostInit = (HostInitFn)detour(COMBAT_HOST_INIT_RVA, COMBAT_HOST_INIT_HEAD,
                                  sizeof COMBAT_HOST_INIT_HEAD, &host_init_hook,
                                  "battle script host");
  return g_loadScripts != NULL || g_hostInit != NULL;
}

/** The necromancy percentage: one detour, plus the cost we only watch. */
static int install_necromancy(void) {
  g_original = (RaiseFn)detour(RAISE_PERCENT_RVA, RAISE_PERCENT_HEAD, 5, &raise_percent_hook, "raise percent");
  if (!g_original) return 0;
  // Watching only, and a failure here is not fatal: the percentage is the part
  // that has to work.
  g_originalCost = (CostFn)detour(RAISE_COST_RVA, RAISE_COST_HEAD, 5, &raise_cost_hook, "raise cost");
  return 1;
}

