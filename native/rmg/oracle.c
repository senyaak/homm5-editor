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

// ---------------------------------------------------------------------------
// The same five places in the MAP EDITOR, which is the better oracle: its
// generator screen has a seed field, so a specific map can be ORDERED rather
// than observed (docs/RMG.md). The code around them is the game's own down to
// the pattern — seed from [esi+90h], time() when the screen left it zero, the
// setter called with the survivor — only the setter writes the counter last
// instead of first. Every address below was read out of the editor executable
// the way the game's were, and each is verified against its bytes before
// anything is written, so a build these do not fit refuses rather than patches.

/** `call dword ptr [time]` in the editor's GenerateMap — six bytes, `ff 15`. */
#define RMG_ED_TIME_CALL_RVA 0x8f9962u
#define RMG_ED_SEED_CALL_RVA 0x8f9977u
/** `state = (int64)seed; counter = 0` — same job, its own instruction order. */
#define RMG_ED_SET_SEED_RVA 0x8fd1f0u
#define RMG_ED_COUNTER_RVA 0x8fd3a0u
#define RMG_ED_COUNTER_FIELD_RVA 0xfd8f38u

// ---------------------------------------------------------------------------
// The finer instrument: FillZones, sweep by sweep.
//
// The twelve boundaries said which phase diverged; this says WHERE INSIDE it.
// Every tenth sweep the editor's FillZones formats "filling zones, %d" — one
// call site, one destination — and detouring that call reads the draw counter
// on the way past: `sweep <n> <draws>` lands next to the phase lines, and the
// first decade whose number disagrees with the port's is where the reading
// went wrong. The hook forwards to the real formatter, so the engine's own
// logging is exactly what it was.

/** `call <formatter>` under the `counter % 10` test in the editor's FillZones. */
#define RMG_ED_SWEEP_CALL_RVA 0x8f333eu
/** The formatter it reaches — checked, like every call this file bends. */
#define RMG_ED_SWEEP_TARGET_RVA 0xa8b510u

typedef char *(__cdecl *SweepFmtFn)(const char *fmt, int sweep);
static SweepFmtFn g_rmgSweepFmt = NULL;

// ---------------------------------------------------------------------------
// The step boundaries — where every phase, and every one of MainObjects'
// fourteen steps, says it is finished.
//
// The twelve counter readings stop at the door of MainObjects: the eleventh and
// the twelfth are nineteen bytes apart, both taken before it draws anything, so
// the phase lines have nothing to say about the largest phase in the generator.
// What the code offers instead is narration — every step formats "at %g <what
// it just did>" through the SAME formatter the sweep line uses, and reading the
// draw counter on the way past turns each of those into a boundary.
//
// So a run stops being "18491, then a wall" and becomes fourteen numbered steps
// per zone. That is what makes MainObjects portable at all: a step whose count
// disagrees names itself, exactly the way a phase does.
//
// The addresses are generated — `node tools/reverse/rmg-log-sites.ts --exe
// <the editor> --c` prints this table, arity included, and the arity is read
// out of the `add esp,N` the caller cleans with rather than guessed from what
// the format string looks like. Every one is verified against its target
// before anything is written, so a build these do not fit refuses.

/** One narration site: the `call`, and how many argument slots it carries. */
typedef struct {
  DWORD rva;
  int slots;
} RmgStepSite;

// Generated by tools/reverse/rmg-log-sites.ts — addresses are RVAs.
static const RmgStepSite g_rmgStepSites[] = {
    {0x8f0114u, 3}, // at %g editor db created
    {0x8f10a4u, 4}, // at %g treasures in zone %d set
    {0x8f11beu, 4}, // at %g chests in zone %d set
    {0x8f136eu, 4}, // at %g big statics in zone %d set
    {0x8f13fau, 4}, // at %g one tile statics in zone %d set
    {0x8f244au, 4}, // at %g mines in zone %d set
    {0x8f25acu, 4}, // at %g hero in zone %d set
    {0x8f2664u, 4}, // at %g dwellings in zone %d set
    {0x8f27f5u, 4}, // at %g upgrade buildings in zone %d set
    {0x8f289fu, 4}, // at %g prisons in zone %d set
    {0x8f294du, 4}, // at %g cartographer in zone %d set
    {0x8f29fdu, 4}, // at %g shrines in zone %d set
    {0x8f2aadu, 4}, // at %g resource buildings in zone %d set
    {0x8f2b5du, 4}, // at %g treasury buildings in zone %d set
    {0x8f2c19u, 4}, // at %g luck/morale objects in zone %d set
    {0x8f2cd6u, 4}, // at %g shops in zone %d set
    {0x8f2dccu, 4}, // at %g road created in zone %d
    {0x8f9c3eu, 3}, // at %g map created
    {0x8f9d2du, 3}, // at %g template loaded
    {0x8f9dc9u, 3}, // at %g start points set
    {0x8f9e65u, 3}, // at %g zones filled in
    {0x8f9f01u, 3}, // at %g distance-to-border table filled in
    {0x8f9fb5u, 3}, // at %g terrain processed
    {0x8fa051u, 3}, // at %g towns placed
    {0x8fa0fdu, 3}, // at %g dist to towns table filled in
    {0x8fa199u, 3}, // at %g connections created
    {0x8fa253u, 3}, // at %g main objects set
    {0x8fa2dcu, 3}, // at %g roads created
    {0x8fa365u, 3}, // at %g statics set
    {0x8fa3eeu, 3}, // at %g additional objects set
    {0x8fa477u, 3}, // at %g treasure blocks set
    {0x8fa500u, 3}, // at %g finished creating map
    {0x8fa589u, 3}, // at %g map saved
    {0x8fa613u, 3}, // at %g temp db destroyed
};

/**
 * The last line of a run — `at %g temp db destroyed`, and nothing after it.
 *
 * This is what ends the draw trace now. It used to end at the twelfth counter
 * reading, which was the only boundary there was and which is why no MainObjects
 * draw was ever written. The reason for ending it SOMEWHERE has not changed:
 * the editor draws for its own reasons between generations, and a trace with no
 * end writes those too — a growing file of nobody's business, one file open per
 * line. This is the engine saying it is done, which is the right place to stop.
 */
#define RMG_ED_STEP_END_RVA 0x8fa613u

typedef char *(__cdecl *StepZoneFn)(const char *fmt, double secs, int zone);
typedef char *(__cdecl *StepPlainFn)(const char *fmt, double secs);
/** The formatter itself — the sweep line's target, reached by more callers. */
static void *g_rmgStepFmt = NULL;
/** Whether the end site landed; the twelfth boundary is the fallback if not. */
static int g_rmgStepEnds = 0;

// ---------------------------------------------------------------------------
// The finest instrument: every draw, on request.
//
// The decade trace narrowed the FillZones divergence to ten sweeps; this one
// removes the narrowing entirely. With `trace` in the config, the editor's
// four drawing entries are detoured and each draw writes one line — its kind,
// the counter after it, the value drawn — from the seed being set to the
// twelfth boundary. ~19k lines for the reference map, and the whole run
// becomes diffable against the port draw by draw: the first line that
// disagrees IS the misreading, whatever phase it hides in. Capture
// everything, filter offline.
//
// `between` is not hooked: it draws through `below`, so its draw already
// appears — hooking both would write two lines for one step. The addresses
// mirror the game's cluster; only the editor's are wired up, because the
// editor is where ordered runs come from.

#define RMG_ED_NEXT_RVA 0x8fd220u
#define RMG_ED_NEXT63_RVA 0x8fd260u
#define RMG_ED_BELOW_RVA 0x8fd2a0u
#define RMG_ED_BETWEEN_FLOAT_RVA 0x8fd330u
/** The state's high dword — its address sits inside three of the four heads. */
#define RMG_ED_STATE_HI_RVA 0xfd8f44u

typedef int (*RmgNextFn)(void);
typedef unsigned long long (*RmgNext63Fn)(void);
typedef int(__fastcall *RmgBelowFn)(int n);
// `ret 8` — the callee cleans its two floats, so the hook must be stdcall.
// The first build said cdecl and the editor returned INTO the 2*pi argument:
// EIP 0x40C90FDB, the float's own bits. Arity and convention come from the
// `ret`, never from what the signature plausibly looks like.
typedef float(__stdcall *RmgBetweenFloatFn)(float a, float b);

static int g_rmgTrace = 0;
static int g_rmgRunActive = 0;
static RmgNextFn g_rmgNextOrig = NULL;
static RmgNext63Fn g_rmgNext63Orig = NULL;
static RmgBelowFn g_rmgBelowOrig = NULL;
static RmgBetweenFloatFn g_rmgBetweenFloatOrig = NULL;

/**
 * `CRandomMap::GetZone(out, index)` — 0xCEF810 in the editor, `ret 8`,
 * thiscall. FillZones asks it twice per jitter candidate — own, then best —
 * BEFORE the ratio test, so a log of its arguments is the engine's own
 * candidate list, rejected candidates included. That is the reading the draw
 * trace cannot give: WHICH tiles the engine considered, in order.
 */
#define RMG_ED_GET_ZONE_RVA 0x8ef810u

typedef void *(__fastcall *RmgGetZoneFn)(void *self, void *edx, void **out, int index);
static RmgGetZoneFn g_rmgGetZoneOrig = NULL;

/** The five places the oracle needs, whichever executable this is. */
static DWORD g_rmgTimeCallRva = RMG_TIME_CALL_RVA;
static DWORD g_rmgSeedCallRva = RMG_SEED_CALL_RVA;
static DWORD g_rmgSetSeedRva = RMG_SET_SEED_RVA;
static DWORD g_rmgCounterRva = RMG_COUNTER_RVA;
static DWORD g_rmgCounterFieldRva = RMG_COUNTER_FIELD_RVA;

/**
 * Is this DLL living inside the map editor?
 *
 * Answered from the image, not the file name: the editor's counter accessor is
 * `mov eax,[counter]; ret`, five bytes plus one, at an RVA where the game
 * carries unrelated code — and the embedded address is computed from THIS
 * image's base, so a relocated load still answers and a coincidence still has
 * to match all six bytes. The rest of DllMain hangs on this answer: every
 * other hook the extension owns is built against the game's image, and the
 * editor gets the oracle alone.
 */
static int rmg_host_is_editor(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  const BYTE *p = base + RMG_ED_COUNTER_RVA;
  return p[0] == 0xA1 && *(const DWORD *)(p + 1) == (DWORD)(base + RMG_ED_COUNTER_FIELD_RVA)
      && p[5] == 0xC3;
}

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
 * `step <draws> <zone> <what just finished>` — one narration line, as a reading.
 *
 * The engine's own words are kept, minus the two things that are not readings:
 * the `at %g ` and the seconds it stands for (a stopwatch differs every run and
 * a diff should not), and the ` in zone %d set` tail, whose number is already
 * the second column. A step with no zone of its own writes -1 there.
 */
static void rmg_log_step(int zone, const char *fmt) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  char line[160];
  int i = 0, n = 0;
  const char *p = "step ";
  while (*p) line[i++] = *p++;
  num_to_dec(*(int *)(base + g_rmgCounterFieldRva), line + i, &n);
  i += n;
  line[i++] = ' ';
  num_to_dec(zone, line + i, &n);
  i += n;
  line[i++] = ' ';
  // "at %g " is six characters, and skipping it blind would quietly mangle a
  // line that turned out to start otherwise — so it is checked first.
  const char *what = fmt;
  if (what[0] == 'a' && what[1] == 't' && what[2] == ' ' && what[3] == '%' && what[4] == 'g' && what[5] == ' ') {
    what += 6;
  }
  while (*what && *what != '\r' && *what != '\n' && i < (int)sizeof(line) - 2) {
    if (what[0] == ' ' && what[1] == 'i' && what[2] == 'n' && what[3] == ' ' && what[4] == 'z' && what[5] == 'o' &&
        what[6] == 'n' && what[7] == 'e') {
      break;
    }
    line[i++] = *what++;
  }
  line[i] = 0;
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
    if (take_word(&q, stop, "trace")) g_rmgTrace = 1;
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
  // The draw trace runs from here to the twelfth boundary — the editor draws
  // for other reasons between generations, and those are nobody's business.
  if (g_rmgTrace) g_rmgRunActive = 1;
  rmg_log_pair("run seed ", seed, g_rmgForceSeed);
  ((SetSeedFn)((BYTE *)GetModuleHandleW(NULL) + g_rmgSetSeedRva))(seed);
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
  // The twelfth boundary is the door of MainObjects, not the end of the run —
  // stopping there is what kept every MainObjects draw out of the log. The
  // narration site that says `temp db destroyed` ends it now; this stays as the
  // fallback for the build where that site did not take, so a trace still ends
  // somewhere rather than following the editor around all afternoon.
  if (!g_rmgStepEnds && g_rmgReads >= 12) g_rmgRunActive = 0;
  return value;
}

/** One draw's line: kind prefix, the counter after it, the value drawn. */
static void rmg_trace_draw(const char *prefix, int value) {
  if (!g_rmgRunActive) return;
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  rmg_log_pair(prefix, *(int *)(base + g_rmgCounterFieldRva), value);
}

static int rmg_next_trace(void) {
  int v = g_rmgNextOrig();
  rmg_trace_draw("tn ", v);
  return v;
}

static unsigned long long rmg_next63_trace(void) {
  unsigned long long v = g_rmgNext63Orig();
  rmg_trace_draw("t6 ", (int)(v & 0x7FFFFFFF));
  return v;
}

static int __fastcall rmg_below_trace(int n) {
  // below(0) draws NOTHING — the engine returns before the counter moves, and
  // a line for it would be one the port rightly does not have. The counter
  // says whether this call was a draw.
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  int before = *(int *)(base + g_rmgCounterFieldRva);
  int v = g_rmgBelowOrig(n);
  if (*(int *)(base + g_rmgCounterFieldRva) != before) rmg_trace_draw("tb ", v);
  return v;
}

static void *__fastcall rmg_get_zone_trace(void *self, void *edx, void **out, int index) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  if (g_rmgRunActive) rmg_log_pair("gz ", *(int *)(base + g_rmgCounterFieldRva), index);
  return g_rmgGetZoneOrig(self, edx, out, index);
}

static float __stdcall rmg_between_float_trace(float a, float b) {
  float v = g_rmgBetweenFloatOrig(a, b);
  union { float f; int i; } bits;
  bits.f = v;
  rmg_trace_draw("tf ", bits.i);
  return v;
}

/**
 * Every tenth FillZones sweep, on its way to being logged (editor only).
 *
 * The counter value read here is cumulative draws BEFORE the named sweep's
 * own coins — the engine tests `counter % 10` first and draws after — so the
 * port's number to match is the one recorded at the same point.
 */
static char *__cdecl rmg_sweep_hook(const char *fmt, int sweep) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  rmg_log_pair("sweep ", sweep, *(int *)(base + RMG_ED_COUNTER_FIELD_RVA));
  return g_rmgSweepFmt ? g_rmgSweepFmt(fmt, sweep) : NULL;
}

/**
 * A step, finished — the three ways the generator says so.
 *
 * The reading is taken BEFORE forwarding, which is after the step itself did
 * its work: the engine formats this line once the step is over, so the counter
 * at this instant is that step's total. The call is forwarded whatever happens,
 * because the caller uses what it returns (`mov ecx,eax` right after every one
 * of these calls), and the arity is the one the site's `add esp,N` states —
 * three slots for a step with no zone, four for a step inside one.
 */
static char *__cdecl rmg_step_zone(const char *fmt, double secs, int zone) {
  rmg_log_step(zone, fmt);
  return g_rmgStepFmt ? ((StepZoneFn)g_rmgStepFmt)(fmt, secs, zone) : NULL;
}

static char *__cdecl rmg_step_plain(const char *fmt, double secs) {
  rmg_log_step(-1, fmt);
  return g_rmgStepFmt ? ((StepPlainFn)g_rmgStepFmt)(fmt, secs) : NULL;
}

/** The same, and the end of the run: nothing after this is the generator's. */
static char *__cdecl rmg_step_end(const char *fmt, double secs) {
  rmg_log_step(-1, fmt);
  g_rmgRunActive = 0;
  return g_rmgStepFmt ? ((StepPlainFn)g_rmgStepFmt)(fmt, secs) : NULL;
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
  // Which executable this is decides which five addresses apply. The check
  // repeats what every patch below verifies anyway; deciding here keeps the
  // failure mode "wrong build refuses" instead of "editor patched with the
  // game's numbers".
  if (rmg_host_is_editor()) {
    g_rmgTimeCallRva = RMG_ED_TIME_CALL_RVA;
    g_rmgSeedCallRva = RMG_ED_SEED_CALL_RVA;
    g_rmgSetSeedRva = RMG_ED_SET_SEED_RVA;
    g_rmgCounterRva = RMG_ED_COUNTER_RVA;
    g_rmgCounterFieldRva = RMG_ED_COUNTER_FIELD_RVA;
    rmg_log("host: the map editor");
    // The per-sweep reading, editor only. Allowed to fail on its own — the
    // phase boundaries are complete without it.
    if (patch_call(RMG_ED_SWEEP_CALL_RVA, RMG_ED_SWEEP_TARGET_RVA, &rmg_sweep_hook, "rmg sweeps")) {
      g_rmgSweepFmt = (SweepFmtFn)((BYTE *)GetModuleHandleW(NULL) + RMG_ED_SWEEP_TARGET_RVA);
      rmg_log("FillZones sweeps will be read");
    }
    // The step boundaries — the same formatter, reached from thirty-four more
    // places. Each site is patched on its own and each refusal names itself:
    // one that does not fit this build costs that one boundary, not the run.
    g_rmgStepFmt = (void *)(base + RMG_ED_SWEEP_TARGET_RVA);
    int steps = 0;
    for (int i = 0; i < (int)(sizeof(g_rmgStepSites) / sizeof(g_rmgStepSites[0])); i++) {
      const RmgStepSite *site = &g_rmgStepSites[i];
      void *hook = site->rva == RMG_ED_STEP_END_RVA ? (void *)&rmg_step_end
                   : site->slots == 4              ? (void *)&rmg_step_zone
                                                   : (void *)&rmg_step_plain;
      if (!patch_call(site->rva, RMG_ED_SWEEP_TARGET_RVA, hook, "rmg step boundary")) continue;
      steps++;
      if (site->rva == RMG_ED_STEP_END_RVA) g_rmgStepEnds = 1;
    }
    rmg_log_pair("step boundaries ", steps, (int)(sizeof(g_rmgStepSites) / sizeof(g_rmgStepSites[0])));
    if (!g_rmgStepEnds) rmg_log("the run's last line did not take - the trace ends at the twelfth boundary");
    // The draw trace, only when the config says `trace`: four detours whose
    // heads carry the state's own address, so each head is computed against
    // this image's base the way the counter accessor's is. Three of the four
    // in, or none worth trusting — but each refusal names itself.
    if (g_rmgTrace) {
      BYTE stateHead[5];
      stateHead[0] = 0xA1; // mov eax, [state hi]
      *(DWORD *)(stateHead + 1) = (DWORD)(base + RMG_ED_STATE_HI_RVA);
      g_rmgNextOrig = (RmgNextFn)detour(RMG_ED_NEXT_RVA, stateHead, 5, &rmg_next_trace, "rmg trace next");
      g_rmgNext63Orig = (RmgNext63Fn)detour(RMG_ED_NEXT63_RVA, stateHead, 5, &rmg_next63_trace, "rmg trace next63");
      static const BYTE belowHead[6] = { 0x83, 0xEC, 0x08, 0x56, 0x8B, 0xF1 };
      g_rmgBelowOrig = (RmgBelowFn)detour(RMG_ED_BELOW_RVA, belowHead, 6, &rmg_below_trace, "rmg trace below");
      BYTE floatHead[6];
      floatHead[0] = 0x51; // push ecx
      floatHead[1] = 0xA1;
      *(DWORD *)(floatHead + 2) = (DWORD)(base + RMG_ED_STATE_HI_RVA);
      g_rmgBetweenFloatOrig = (RmgBetweenFloatFn)detour(RMG_ED_BETWEEN_FLOAT_RVA, floatHead, 6,
                                                        &rmg_between_float_trace, "rmg trace betweenFloat");
      // The candidate reading: GetZone's first two instructions are seven
      // relocation-free bytes, a whole number of instructions.
      static const BYTE getZoneHead[7] = { 0x8B, 0x44, 0x24, 0x08, 0x83, 0xEC, 0x08 };
      g_rmgGetZoneOrig = (RmgGetZoneFn)detour(RMG_ED_GET_ZONE_RVA, getZoneHead, 7,
                                              &rmg_get_zone_trace, "rmg trace GetZone");
      rmg_log(g_rmgNextOrig && g_rmgNext63Orig && g_rmgBelowOrig && g_rmgBetweenFloatOrig && g_rmgGetZoneOrig
                  ? "draw trace on - every draw and every GetZone will be written"
                  : "draw trace INCOMPLETE - see the refusals above");
    }
  }

  BYTE head[5];
  head[0] = 0xA1; // mov eax, [imm32]
  *(DWORD *)(head + 1) = (DWORD)(base + g_rmgCounterFieldRva);

  g_rmgCounter = (CounterFn)detour(g_rmgCounterRva, head, 5, &rmg_counter_hook, "rmg draw counter");
  if (!g_rmgCounter) return 0;
  if (!patch_call(g_rmgSeedCallRva, g_rmgSetSeedRva, &rmg_seed_hook, "rmg seed")) return 0;
  // Only needed to FORCE a seed; a run that just wants the counters logged is
  // complete without it, so this one is allowed to fail on its own. In the
  // editor a seed is usually TYPED into the screen instead, which makes the
  // forcing moot — the screen's number wins before time() is ever asked.
  g_time = (TimeFn)patch_indirect_call(g_rmgTimeCallRva, &rmg_time_hook, "rmg seed source");
  if (g_rmgForceSeed && !g_time) rmg_log("the seed cannot be forced - it will be the clock's");
  rmg_log(g_rmgForceSeed && g_time ? "oracle ready, with a seed of ours" : "oracle ready");
  return 1;
}
