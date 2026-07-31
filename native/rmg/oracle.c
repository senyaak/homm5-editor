// The random map generator's oracle — see docs/RMG.md.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// WHY IT EXISTS. The generator is being ported to TypeScript, and a port can
// only be judged against a real run. Two things make one comparable, and the
// game's own interface offers neither: the SEED it grew from (the screen has no
// field for it) and the DRAW COUNT at each phase boundary (the engine computes
// it, formats it into "Rnd Counter(FillZones): %d." and hands the line to a log
// callback that goes nowhere we can read).
//
// Both are one function away in the code. The generator seeds itself from
// exactly one call site, and reads its draw counter through one tiny accessor —
// twelve times, all of them inside `GenerateMap`, one per phase boundary. So
// twelve numbers in order ARE the phase-by-phase counter reading, without
// parsing a single format string: the Nth call is the Nth boundary.
//
// A mismatch then says *which phase* the port misread, which a differing map
// never does.
//
// OFF UNLESS ASKED. Both hooks are installed only when the config file exists —
// this is a workbench instrument, and a game that quietly writes a log every
// time somebody generates a map is not one.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT rmg_oracle

/**
 * `call dword ptr [time]` inside `GenerateMap` — where the seed is BORN.
 *
 * This is the one to force, and finding that out cost a run. The code is:
 *
 *     mov  eax,[edi+90h]        the seed the screen supplied — always 0,
 *     mov  [edi+0C4h],eax       there is no field for it
 *     test eax,eax
 *     jne  have_it
 *     call [time]               so: time(NULL)
 *     mov  [edi+0C4h],eax       <- and THIS is what the map records
 *   have_it:
 *     mov  ecx,eax
 *     call set_seed             <- while this is what the generator uses
 *
 * Forcing the second one alone makes a map whose recorded `RMGstartseed` is not
 * the seed it grew from — the map lies, and a port that trusts it compares
 * against the wrong run. Forcing `time` instead lands in both.
 *
 * Six bytes (`ff 15 <slot>`), so the patch is `call rel32` plus one `nop`.
 */
#define RMG_TIME_CALL_RVA 0xaab498u
/** `call <set seed>` — hooked to say what actually reached the generator. */
#define RMG_SEED_CALL_RVA 0xaab4a9u
/** The seed setter itself: `state = (int64)seed; counter = 0`. */
#define RMG_SET_SEED_RVA 0xab1330u
/** `mov eax,[draw counter]; ret` — the `mov` is five bytes, a whole instruction. */
#define RMG_COUNTER_RVA 0xab1550u
/** The counter it reads, so the head can be checked against this image's base. */
#define RMG_COUNTER_FIELD_RVA 0xe1bcf0u

typedef void(__fastcall *SetSeedFn)(int seed);
typedef int (*CounterFn)(void);
typedef long(__cdecl *TimeFn)(void *);

/** The seed to force, when the config named one. */
static int g_rmgSeed = 0;
static int g_rmgForceSeed = 0;
/** Whether the config file was there at all — the on switch for both hooks. */
static int g_rmgWanted = 0;
/** The trampoline through the counter accessor. */
static CounterFn g_rmgCounter = NULL;
/** The real `time`, kept so an unforced run still gets a clock. */
static TimeFn g_time = NULL;
/** Which boundary this is, within the current run. */
static int g_rmgReads = 0;

// ---------------------------------------------------------------------------
// Its own file, and why it is not the extension's log.
//
// Two readers, two files. `homm5-editor-<run>.log` is read by a PERSON asking
// whether the mod loaded; this one is read by a TOOL comparing a run against a
// port, and mixing them would make the second one a parsing exercise for no
// reason. It is also written ungated — `log_line` is switched on per file at
// build time (core/log.c), which is the right rule for chatter and the wrong
// one for an instrument's readings: a build that forgot `--log rmg/oracle`
// would produce a run with no numbers in it and no sign that anything was
// missing. What the ORACLE says about itself goes here too, for the same
// reason: the person who turned it on reads this file.

/** Append one line to the oracle's own file. Silent if it cannot. */
static void rmg_log(const char *text) {
  WCHAR path[MAX_PATH];
  beside_us(L"homm5-editor-rmg.log", path);
  HANDLE h = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;
  SetFilePointer(h, 0, NULL, FILE_END);
  DWORD written = 0;
  int len = 0;
  while (text[len]) len++;
  WriteFile(h, text, len, &written, NULL);
  WriteFile(h, "\r\n", 2, &written, NULL);
  CloseHandle(h);
}

/** `<prefix> <a> <b>` on one line — the whole format the log file needs. */
static void rmg_log_pair(const char *prefix, int a, int b) {
  char line[128];
  int i = 0;
  while (prefix[i] && i < 60) { line[i] = prefix[i]; i++; }
  int n = 0;
  num_to_dec(a, line + i, &n);
  i += n;
  line[i++] = ' ';
  num_to_dec(b, line + i, &n);
  line[i + n] = 0;
  rmg_log(line);
}

/**
 * The oracle's config — its presence is the on switch.
 *
 *   # anything
 *   seed 1785351845     force this seed; omit the line to log whichever
 *                       one the game picked
 *
 * Deliberately a second file rather than more lines in the quality-of-life one:
 * that file is written by the editor whenever a mod changes, and an instrument
 * a person turns on for an afternoon has no business being rewritten by that.
 * The seed also is not a flag — `qol/config.c` reads switches, and a number
 * would be the one row in it that is something else.
 */
static void load_rmg_config(void) {
  DWORD size = 0;
  char *buf = read_beside_us(L"homm5-editor-rmg.txt", &size);
  if (!buf) return;
  g_rmgWanted = 1;

  const char *p = buf, *end = buf + size;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    const char *q = line;
    if (take_word(&q, stop, "seed") && read_int(&q, stop, &g_rmgSeed)) g_rmgForceSeed = 1;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
}

// ---------------------------------------------------------------------------
// The two hooks.

/**
 * Where the seed is born: the engine asking the clock what time it is.
 *
 * Answering with a number of our own is what makes a specific map askable for,
 * and — because the engine stores this answer and later writes it into the map
 * as `RMGstartseed` — it is also what keeps the map honest about which seed it
 * grew from. Forcing further down the line does not: see RMG_TIME_CALL_RVA.
 *
 * Unforced, it passes the real clock through, so a normal run is a normal run.
 */
static long __cdecl rmg_time_hook(void *arg) {
  long real = g_time ? g_time(arg) : 0;
  return g_rmgForceSeed ? (long)g_rmgSeed : real;
}

/**
 * The seed, on its way into the generator's state.
 *
 * Left hooked even though the forcing moved earlier, because it answers a
 * different question: not "what did we ask for" but "what did the generator
 * actually get". The two agreeing is the check that the forcing landed in both
 * places — and their disagreeing is exactly the bug this pair was built after.
 *
 * Called once per run, before anything is drawn, so it is also where a run
 * begins as far as the log is concerned and where the boundary count restarts.
 */
static void __fastcall rmg_seed_hook(int seed) {
  g_rmgReads = 0;
  rmg_log_pair("run seed ", seed, g_rmgForceSeed);
  ((SetSeedFn)((BYTE *)GetModuleHandleW(NULL) + RMG_SET_SEED_RVA))(seed);
}

/**
 * A phase boundary: the engine is about to print how many numbers it has drawn.
 *
 * The value is taken from the trampoline rather than read out of the global
 * directly — same answer, but it stays right if the accessor is ever something
 * more than a load, and it keeps the hook honest about being a pass-through.
 */
static int rmg_counter_hook(void) {
  int value = g_rmgCounter ? g_rmgCounter() : 0;
  rmg_log_pair("phase ", ++g_rmgReads, value);
  return value;
}

/**
 * Point one `call` somewhere else.
 *
 * A fourth way in, beside the three in core/detour.c, and the narrowest: the
 * five bytes of a `call rel32` are exactly one instruction, so this replaces
 * the DESTINATION of a single call and touches nothing around it. Detouring the
 * seed setter instead would redirect every caller; there happens to be one, but
 * "the generator's call" and "that function" are different claims and only the
 * first is the one being made.
 *
 * It is checked by where the call currently GOES rather than by the bytes it is
 * made of — the displacement is relative and the target is an address, so "this
 * call reaches the seed setter" survives a different load base and comparing
 * raw bytes would not.
 *
 * Local to this file on purpose: one caller, and core/detour.c is where it
 * belongs the day there is a second.
 */
static int patch_call(DWORD siteRva, DWORD targetRva, void *to, const char *what) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *site = base + siteRva;
  if (site[0] != 0xE8 || site + 5 + *(int *)(site + 1) != base + targetRva) {
    rmg_log("that call does not go where we think - not patching");
    rmg_log(what);
    return 0;
  }
  DWORD old = 0;
  if (!VirtualProtect(site, 5, PAGE_EXECUTE_READWRITE, &old)) return 0;
  *(int *)(site + 1) = (int)((BYTE *)to - (site + 5));
  VirtualProtect(site, 5, old, &old);
  FlushInstructionCache(GetCurrentProcess(), site, 5);
  return 1;
}

/**
 * Point an INDIRECT call (`call dword ptr [slot]`) at us instead.
 *
 * Six bytes, one instruction, so it becomes `call rel32` plus a `nop` and
 * nothing around it moves. The import slot is read out of the instruction
 * rather than written down here — that is where the real function's address
 * lives, and taking it from the bytes means no second address to keep true.
 *
 * ONE CALL SITE, not the import slot itself: `hook_import` in qol/borderless.c
 * would meet every `time` the game makes, and what is wanted is the generator's
 * — the clock the rest of the process reads is none of this instrument's
 * business.
 *
 * Returns the original, so an unforced run still reaches the real one.
 */
static void *patch_indirect_call(DWORD siteRva, void *hook, const char *what) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *site = base + siteRva;
  if (site[0] != 0xFF || site[1] != 0x15) {
    rmg_log("that is not an indirect call - not patching");
    rmg_log(what);
    return NULL;
  }
  void **slot = *(void ***)(site + 2);
  void *original = *slot;

  DWORD old = 0;
  if (!VirtualProtect(site, 6, PAGE_EXECUTE_READWRITE, &old)) return NULL;
  site[0] = 0xE8;
  *(int *)(site + 1) = (int)((BYTE *)hook - (site + 5));
  site[5] = 0x90; // the sixth byte of what was there
  VirtualProtect(site, 6, old, &old);
  FlushInstructionCache(GetCurrentProcess(), site, 6);
  return original;
}

/**
 * Both hooks, or neither.
 *
 * The counter accessor's five bytes embed the address of the counter itself, so
 * the head is built from THIS image's base rather than written down — an
 * executable loaded anywhere else still matches, and a byte that differs for
 * any other reason still stops us. (`detour_relocated`'s `skip` says the same
 * thing by ignoring those four bytes; computing them checks them instead.)
 */
static int install_rmg_oracle(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE head[5];
  head[0] = 0xA1; // mov eax, [imm32]
  *(DWORD *)(head + 1) = (DWORD)(base + RMG_COUNTER_FIELD_RVA);

  g_rmgCounter = (CounterFn)detour(RMG_COUNTER_RVA, head, 5, &rmg_counter_hook, "rmg draw counter");
  if (!g_rmgCounter) return 0;
  if (!patch_call(RMG_SEED_CALL_RVA, RMG_SET_SEED_RVA, &rmg_seed_hook, "rmg seed")) return 0;
  // Only needed to FORCE a seed; a run that just wants the counters logged is
  // complete without it, so this one is allowed to fail on its own.
  g_time = (TimeFn)patch_indirect_call(RMG_TIME_CALL_RVA, &rmg_time_hook, "rmg seed source");
  if (g_rmgForceSeed && !g_time) rmg_log("the seed cannot be forced - it will be the clock's");
  rmg_log(g_rmgForceSeed && g_time ? "oracle ready, with a seed of ours" : "oracle ready");
  return 1;
}
