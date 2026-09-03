// Ordering a generation from the command line — see docs/RMG.md.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// WHY IT EXISTS. The port is measured against runs of the engine, and until now
// a run cost a person: open the editor, fill in the generator screen, press the
// button, once. So every order but the three references had no engine run to be
// compared against, and a phase that disagrees on a template nobody has ordered
// is a phase nobody can fix.
//
// WHAT THE EDITOR ALREADY HAS, AND WHAT IT DOES NOT. It has no switch that
// generates anything: `CEditorApp::InitInstance` reads `m_lpCmdLine` exactly
// once and both branches of what it does with the string go elsewhere — file
// association registration, or opening a document. What it does have is a
// CONSOLE COMMAND: `rmg`, aliased `generatemap`, which takes a template, and
// `-players`, `-size` and `-underground`, and calls `GenerateMap` itself. So
// the generator is orderable from outside the screen; the two things missing
// are a way to say a line to the console before a person is there to type it,
// and a seed, which the command has no parameter for.
//
// This is both. The DLL reads the process's own command line at load, and the
// argument the editor hands its "open this document" step at the END of
// InitInstance — the latest moment that is still not the message loop, by which
// time the data storage is up and a template can resolve — is where our orders
// run instead. Each order becomes one console line; the SEED comes from the
// hook the oracle already installs, one per order.
//
//   H5_MapEditor_H5E.exe --rmg
//
// and the orders are lines in `bin/homm5-editor-rmg-orders.txt`:
//
//   RMG/Templates/S1P2Z2M1.xdb -seed 1785351845 -size 1 -resource 1 -exp 1
//   RMG/Templates/S1P2Z2M1.xdb -seed 1785351845 -size 1 -monsters 2
//
// `-poke <offset> <value>` and `-pokeb` say any field of the request by DECIMAL
// offset — the instrument that turned each guess about a field into a launch
// instead of a rebuild, and the reason the list above is short and true.
//
// ONE LAUNCH IS ONE ORDER: a file holding several has its first one run and
// the rest reported untouched, because a launch's second generation does not
// repeat what its first would have made alone. `tools/rmg-batch.ts` orders
// several by relaunching the editor for each.
//
// The command line carries no orders and cannot: a SPACE in it takes the editor
// down before any of this runs (see the reading above `rmg_cli_take_orders`).
//
// AND IT SAVES. `rmg` writes the map itself — the same sixteen documents a
// `.h5m` holds, loose, in `data\RMGTemp\CurrentMap\` — so a batch is not only
// draw counts: every order leaves the engine's own map beside the readings, in
// `bin\rmg-runs\<n>\`, which is the byte comparison the port had for exactly
// one order before this.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT rmg_cli

// ---------------------------------------------------------------------------
// Three addresses, all of them the MAP EDITOR's.
//
// Nothing here applies to the game: the argument site is `CEditorApp`'s, and
// the other two are the same engine code at the editor's own addresses. The
// caller installs this only under `rmg_host_is_editor()`, and each address is
// checked against its bytes before it is used, so a build these do not fit
// costs the batch and costs the editor nothing.

/**
 * Where the editor decides what to do with its command line.
 *
 * `InitInstance` ends with: if the argument is not `-reg` and not empty, hand
 * it to this. Everything the editor does before it has been done — the data
 * storage, the document templates, the main frame — and the message loop has
 * not started, so it is the one moment that is both late enough to generate
 * and early enough that nothing else is happening.
 *
 * Seven bytes, two whole instructions (`push -1`, `push <scope table>`), and
 * the second one's operand is an absolute address the loader may rewrite.
 */
#define RMG_CLI_ARG_RVA 0x9ede00u
/**
 * `Execute(this = the wide string holding one line)` — the door.
 *
 * The engine uses it for `unbindall` while loading a profile, so it is a
 * command executor and not a guess. **Its return value means nothing to us**:
 * it answers -1 to everything put through it, `help` and a `setvar` that
 * demonstrably lands included, so a batch that read -1 as failure would be
 * reading the wrong thing. What it answers instead is the probe below.
 *
 * The cfg executor next door (`0xe345f0`, `this` = a narrow string naming a
 * file) was written and tried too, and it works — but only for `setvar`. A cfg
 * sets values; it does not invoke commands, which is what a batch needs.
 */
#define RMG_CLI_EXEC_LINE_RVA 0xa342b0u
/**
 * The RMG REQUEST's constructor — where an order's defaults come from.
 *
 * The console command fills three fields of the record this builds — the size
 * at `+0x10`, the underground at `+0x0D`, the players at `+0x18` (0x73cea0
 * builds it, 0x73cecc onward fills it; the slots named by `net-probe --frame`)
 * — and leaves everything else at what this constructor put there. Two of
 * those defaults are the multipliers, `+0x98` and `+0xA0`, both NORMAL: the
 * enum runs MISERABLE, LITTLE, NORMAL, LOTS, MUCH from zero, and NORMAL is 2.
 *
 * That is the whole difference between an order given here and the same order
 * given in the dialog, and it is not cosmetic — the reference run was ordered
 * LITTLE and lands 970 draws away from the same order given as a command. So
 * the batch has to be able to say them, and this is the only place they can be
 * said from: the record lives on the handler's stack and nothing outside can
 * reach it.
 *
 * Seven bytes, two whole instructions, the second one's operand relocated —
 * the same shape as the command-line site above.
 */
#define RMG_CLI_REQUEST_RVA 0x67e10u
/**
 * The fields of that record this batch can say.
 *
 * The record is EMBEDDED IN THE GENERATOR AT `+0x10`, which is what ties the
 * offsets down: the copy at the top of `GenerateMap` is `lea ecx,[esi+10h]`
 * before `0xCFB500`, so every offset here is a generator offset minus 0x10 —
 * and each one lands on something already known from the other side.
 * `+0x0D` is the underground, which the console handler writes and the
 * generator reads at `+0x1D`; `+0x10` is the size, read at `+0x20` to index
 * the size table at `0xFF291C`; `+0x50` is the monster strength.
 *
 * EVERY ONE OF THESE WAS PUT TO THE ENGINE, not just derived, with `-poke`
 * below: `+0x50` moved MonsterLevel to STRONG, `+0x94` turned the Minimap
 * off, `+0x95` turned RandomTowns on, `+0xA5` turned the Grail on, and the
 * two multipliers reproduced the reference exactly. The defaults agree with
 * what a command-ordered map records — MEDIUM, minimap on, no grail.
 *
 * WATER IS NOT HERE, and that is the finding rather than a gap in the
 * reading. Every other field of the map's `InitialParams` has its place in
 * this record; `WaterAmount` has none, and eleven offsets were poked one
 * launch at a time to be sure of it. The generator takes its water from
 * `GenerateMap`'s first stack ARGUMENT instead — `0xCF9B9E` reassigns `esi`
 * to `[ebp+8]` and only then reads `+0x58` as the amount, promoting 1 to 2
 * and setting the water bit at `+0xA6` that `LoadTemplate` branches on. That
 * object is not this one: poking this record at `+0x58` kills the editor,
 * because here `+0x54` is the players vector and `+0x58` is its `end`. So
 * ordering water needs that argument identified first, and until it is there
 * is no `-water` switch — a switch that silently does nothing is worse than
 * none.
 */
#define RMG_CLI_RESOURCE_OFF 0x98u
#define RMG_CLI_EXP_OFF 0xa0u
#define RMG_CLI_MONSTERS_OFF 0x50u

/** `wstring::wstring(begin, end)` — the only kind of string that door takes. */
#define RMG_CLI_WSTR_RVA 0x7d00u
/** `string::string(const char *)` — the narrow one, for asking after a name. */
#define RMG_CLI_STR_RVA 0x31d0u
/**
 * `find(name, &fallback)` — the engine's own named-value lookup, and the way
 * this file proves its door works before believing anything that came through
 * it. `setvar h5e_door = 7` said through the door and a 7 read back here is the
 * whole loop: both halves the engine's, neither of them ours to be wrong about.
 */
#define RMG_CLI_VAR_RVA 0xa33520u

/** The engine's string: three pointers, and the buffer is its own. */
typedef struct {
  char *begin;
  char *end;
  char *cap;
} EngineString;

/** The engine's wide string, laid out like the narrow one. */
typedef struct {
  WCHAR *begin;
  WCHAR *end;
  WCHAR *cap;
} EngineWString;

typedef void(__fastcall *StringFromZFn)(EngineString *self, void *edx, const char *sz);
typedef float *(__fastcall *VarLookupFn)(EngineString *name, float *fallback);
typedef void(__fastcall *WStringRangeFn)(EngineWString *self, void *edx, const WCHAR *begin,
                                         const WCHAR *end);
typedef int(__fastcall *ExecLineFn)(EngineWString *self);
typedef int(__fastcall *OpenArgFn)(void *self, void *edx, void *arg);

static StringFromZFn g_rmgCliString = NULL;
static VarLookupFn g_rmgCliVar = NULL;
static WStringRangeFn g_rmgCliWString = NULL;
static ExecLineFn g_rmgCliExecLine = NULL;
static void *g_rmgCliArgOrig = NULL;

/** The orders, copied off the command line at load. Empty means "not asked". */
static char g_rmgCliOrders[2048];
static int g_rmgCliWanted = 0;

// ---------------------------------------------------------------------------
// Reading the ask.

/** Is `word` at `p`, and does it end there? A prefix is not a word. */
static int rmg_cli_word_is(const char *p, const char *stop, const char *word) {
  int i = 0;
  while (word[i]) {
    if (p + i >= stop || p[i] != word[i]) return 0;
    i++;
  }
  return p + i == stop;
}

static const char *rmg_cli_spaces(const char *p, const char *end) {
  while (p < end && (*p == ' ' || *p == '\t')) p++;
  return p;
}

/**
 * THE COMMAND LINE MUST NOT CONTAIN A SPACE, and that is the editor's rule.
 *
 * `H5_MapEditor_H5E.exe foo` puts up "Can't load foo file" and carries on.
 * `H5_MapEditor_H5E.exe "foo bar"` takes the whole process down with an access
 * violation at `0x5f9d22`, long before the argument reaches the step this file
 * hooks — measured, with the detour deliberately not written, so it is the
 * editor's own and nothing of ours. A space is enough; the quotes, the dashes
 * and the content are not.
 *
 * Which is why the orders come in one of two spaceless shapes:
 *
 *   --rmg                 read them from `homm5-editor-rmg-orders.txt` beside
 *                         the DLL, one order to a line, `#` for a comment
 *   --rmg=<orders>        inline, with COMMAS standing in for spaces and
 *                         semicolons between orders
 *
 * The file is the one to use: it holds as many orders as anybody wants and it
 * reads like what it is. The inline form is for a single quick order.
 */
static void rmg_cli_add(const char *from, const char *to, int *at) {
  int room = (int)sizeof(g_rmgCliOrders) - 1;
  if (*at > 0 && *at < room) g_rmgCliOrders[(*at)++] = ';';
  while (from < to && *at < room) g_rmgCliOrders[(*at)++] = *from++;
}

/** The orders file, one order to a line, `#` for a comment. */
static int rmg_cli_read_file(void) {
  DWORD size = 0;
  char *buf = read_beside_us(L"homm5-editor-rmg-orders.txt", &size);
  if (!buf) return 0;
  const char *p = buf, *end = buf + size;
  int at = 0;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    while (stop > line && (stop[-1] == ' ' || stop[-1] == '\t' || stop[-1] == '\r')) stop--;
    if (line >= stop || *line == '#') continue;
    rmg_cli_add(line, stop, &at);
  }
  g_rmgCliOrders[at] = 0;
  VirtualFree(buf, 0, MEM_RELEASE);
  return at > 0;
}

/**
 * `--rmg` or `--rmg=<orders>` off the process's own command line, or nothing.
 *
 * Read here rather than out of the argument the hook is handed, because the
 * ANSWER is needed at load — the oracle has to be installed before the editor
 * runs, and a batch with no readings in it is a wasted launch. The hook then
 * only supplies the moment.
 */
static int rmg_cli_take_orders(void) {
  const char *cmd = GetCommandLineA();
  const char *p = cmd;
  const char *tail = NULL;
  if (!cmd) return 0;
  while (*p) {
    if (p[0] == '-' && p[1] == '-' && p[2] == 'r' && p[3] == 'm' && p[4] == 'g'
        && (p == cmd || p[-1] == ' ' || p[-1] == '\t')
        && (p[5] == 0 || p[5] == '=' || p[5] == ' ' || p[5] == '\t')) {
      tail = p + 5;
      break;
    }
    p++;
  }
  if (!tail) return 0;

  if (*tail != '=') {
    g_rmgCliWanted = rmg_cli_read_file();
    return g_rmgCliWanted;
  }
  tail++;
  int len = 0;
  while (tail[len] && tail[len] != ' ' && tail[len] != '\t') len++;
  if (len <= 0) return 0;
  if (len > (int)sizeof(g_rmgCliOrders) - 1) len = (int)sizeof(g_rmgCliOrders) - 1;
  // A comma is a space: the shell may pass one, the editor may not survive it.
  for (int i = 0; i < len; i++) g_rmgCliOrders[i] = tail[i] == ',' ? ' ' : tail[i];
  g_rmgCliOrders[len] = 0;
  g_rmgCliWanted = 1;
  return 1;
}

// ---------------------------------------------------------------------------
// Running one.

/** `<prefix><text>` on one line of the oracle's own file. */
static void rmg_cli_log_text(const char *prefix, const char *text, const char *stop) {
  char line[320];
  int i = 0;
  while (prefix[i] && i < 80) { line[i] = prefix[i]; i++; }
  while (text < stop && i < (int)sizeof(line) - 1) line[i++] = *text++;
  line[i] = 0;
  rmg_log(line);
}

/** Say one line to the console: one wide string, executed where it is said. */
static int rmg_cli_say_line(const char *line, int len) {
  WCHAR wide[512];
  int n = 0;
  while (n < len && n < (int)(sizeof(wide) / sizeof(wide[0])) - 1) {
    wide[n] = (WCHAR)(unsigned char)line[n];
    n++;
  }
  wide[n] = 0;
  EngineWString text;
  text.begin = NULL;
  text.end = NULL;
  text.cap = NULL;
  g_rmgCliWString(&text, NULL, wide, wide + n);
  if (!text.begin) return -9;
  return g_rmgCliExecLine(&text);
}

/**
 * Keep what the order just made, before the next one writes over it.
 *
 * The command SAVES — "map saved" is the engine's own narration — and it saves
 * to one place: `data\RMGTemp\CurrentMap\`, the same sixteen documents a `.h5m`
 * holds, loose. One place means the second order destroys the first, so a batch
 * has to take a copy between them, and that is all this does: every file in
 * that folder into `bin\rmg-runs\<n>\`, where the diffing tool can find them.
 *
 * Copied rather than moved, because the folder is the editor's and a batch has
 * no business changing what the editor finds there.
 */
static void rmg_cli_keep(int which) {
  WCHAR from[MAX_PATH], into[MAX_PATH], pattern[MAX_PATH];
  WCHAR tail[16];
  char digits[16];
  int n = 0, i = 0, kept = 0;

  beside_us(L"..\\data\\RMGTemp\\CurrentMap\\", from);
  beside_us(L"rmg-runs\\", into);
  CreateDirectoryW(into, NULL);
  num_to_dec(which, digits, &n);
  for (i = 0; i < n; i++) tail[i] = (WCHAR)digits[i];
  tail[n] = L'\\';
  tail[n + 1] = 0;
  int at = 0;
  while (into[at]) at++;
  for (i = 0; i <= n; i++) into[at + i] = tail[i];
  into[at + n + 1] = 0;
  CreateDirectoryW(into, NULL);

  at = 0;
  while (from[at]) { pattern[at] = from[at]; at++; }
  pattern[at++] = L'*';
  pattern[at] = 0;

  WIN32_FIND_DATAW found;
  HANDLE h = FindFirstFileW(pattern, &found);
  if (h == INVALID_HANDLE_VALUE) { rmg_log("cli: nothing was saved to keep"); return; }
  do {
    if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    WCHAR src[MAX_PATH], dst[MAX_PATH];
    int a = 0, b = 0;
    while (from[a]) { src[a] = from[a]; a++; }
    for (i = 0; found.cFileName[i] && a < MAX_PATH - 1; i++) src[a++] = found.cFileName[i];
    src[a] = 0;
    while (into[b]) { dst[b] = into[b]; b++; }
    for (i = 0; found.cFileName[i] && b < MAX_PATH - 1; i++) dst[b++] = found.cFileName[i];
    dst[b] = 0;
    if (CopyFileW(src, dst, FALSE)) kept++;
  } while (FindNextFileW(h, &found));
  FindClose(h);
  rmg_log_pair("cli: kept ", kept, which);
}

/**
 * What the next order wants the two multipliers to be, or -1 for the default.
 *
 * Set while an order is parsed and read by the hook below, which runs inside
 * the command's own handler a moment later — the same hand-off the seed queue
 * makes, and safe for the same reason: one order runs at a time.
 */
static int g_rmgResource = -1;
static int g_rmgExp = -1;
static int g_rmgMonsters = -1;

/**
 * `-poke <offset> <value>` / `-pokeb` — one field of the request, said outright.
 *
 * A named switch is a claim about which offset holds what, and a claim is worth
 * one experiment. `-monsters` was right the first time and `-water` was not,
 * both of them derived the same way from the same copy — so rather than guess
 * again and rebuild for each guess, this says any offset and lets a launch
 * answer. What it finds becomes a named switch; it stays because the next field
 * will need it too.
 */
#define RMG_POKE_MAX 8
static struct { unsigned off; int value; int wide; } g_rmgPoke[RMG_POKE_MAX];
static int g_rmgPokes = 0;

typedef void *(__fastcall *RmgRequestCtorFn)(void *self, void *edx);
static RmgRequestCtorFn g_rmgRequestCtor;

/** The request, built as the engine builds it, then told what we were told. */
static void *__fastcall rmg_request_ctor_hook(void *self, void *edx) {
  void *made = g_rmgRequestCtor(self, edx);
  if (g_rmgResource >= 0) *(int *)((BYTE *)self + RMG_CLI_RESOURCE_OFF) = g_rmgResource;
  if (g_rmgExp >= 0) *(int *)((BYTE *)self + RMG_CLI_EXP_OFF) = g_rmgExp;
  if (g_rmgMonsters >= 0) *(int *)((BYTE *)self + RMG_CLI_MONSTERS_OFF) = g_rmgMonsters;
  for (int i = 0; i < g_rmgPokes; i++) {
    BYTE *at = (BYTE *)self + g_rmgPoke[i].off;
    if (g_rmgPoke[i].wide) *(int *)at = g_rmgPoke[i].value;
    else *at = (BYTE)g_rmgPoke[i].value;
  }
  return made;
}

/**
 * One order: our own `-seed` taken out of it, everything else handed to `rmg`.
 *
 * The engine's parser takes what is left after its own switches as the
 * template's name, so a switch it has never heard of would be read as part of
 * that name and the order would fail on "Couldn't find template". Which is why
 * `-seed` is removed here rather than merely ignored.
 *
 * A seed the order does not carry leaves whatever `homm5-editor-rmg.txt` said
 * standing — including nothing, in which case the engine picks one and the
 * oracle writes down which.
 */
static void rmg_cli_run_order(const char *from, const char *to) {
  char line[512];
  int n = 0;

  rmg_cli_log_text("cli: ", from, to);

  // An order beginning with `!` is a console line VERBATIM — the console has
  // seventy-nine commands and only one of them generates a map, so the way to
  // say any of the others is to say it. It is also how a batch that answers
  // nothing is asked whether the door works at all.
  if (from < to && *from == '!') {
    for (const char *q = from + 1; q < to && n < (int)sizeof(line) - 1; q++) line[n++] = *q;
    line[n] = 0;
    rmg_log_pair("cli: said ", rmg_cli_say_line(line, n), n);
    return;
  }

  line[n++] = 'r';
  line[n++] = 'm';
  line[n++] = 'g';

  // The seed goes into the queue rather than into the oracle's single slot: an
  // order is QUEUED here and generated later, so a seed set now would be the
  // seed of whichever order was parsed last (native/rmg/oracle.c).
  int wanted = 0;
  // Each order says its own; one that says nothing gets the engine's default
  // rather than the previous order's.
  g_rmgResource = -1;
  g_rmgExp = -1;
  g_rmgMonsters = -1;
  g_rmgPokes = 0;
  const char *p = from;
  while (p < to) {
    p = rmg_cli_spaces(p, to);
    if (p >= to) break;
    const char *word = p;
    while (p < to && *p != ' ' && *p != '\t') p++;
    if (rmg_cli_word_is(word, p, "-seed")) {
      const char *q = rmg_cli_spaces(p, to);
      int seed = 0;
      if (read_int(&q, to, &seed)) {
        wanted = seed;
        p = q;
      } else {
        rmg_log("cli: -seed with no number after it - the engine will pick one");
      }
      continue;
    }
    // Ours as well, and taken out of the line for the same reason as the seed:
    // the engine's parser would read an unknown switch as the template's name.
    if (rmg_cli_word_is(word, p, "-poke") || rmg_cli_word_is(word, p, "-pokeb")) {
      int wide = rmg_cli_word_is(word, p, "-poke");
      const char *q = rmg_cli_spaces(p, to);
      int off = 0, value = 0;
      if (read_int(&q, to, &off)) {
        q = rmg_cli_spaces(q, to);
        if (read_int(&q, to, &value) && g_rmgPokes < RMG_POKE_MAX) {
          g_rmgPoke[g_rmgPokes].off = (unsigned)off;
          g_rmgPoke[g_rmgPokes].value = value;
          g_rmgPoke[g_rmgPokes].wide = wide;
          g_rmgPokes++;
          rmg_log_pair("cli: poke ", off, value);
        }
        p = q;
      }
      continue;
    }
    int *ours = NULL;
    if (rmg_cli_word_is(word, p, "-resource")) ours = &g_rmgResource;
    else if (rmg_cli_word_is(word, p, "-exp")) ours = &g_rmgExp;
    else if (rmg_cli_word_is(word, p, "-monsters")) ours = &g_rmgMonsters;
    if (ours) {
      const char *q = rmg_cli_spaces(p, to);
      int value = 0;
      if (read_int(&q, to, &value)) {
        *ours = value;
        p = q;
      } else {
        rmg_log("cli: a switch of ours with no number after it - leaving the default");
      }
      continue;
    }
    if (n + 1 + (int)(p - word) >= (int)sizeof(line) - 1) break;
    line[n++] = ' ';
    for (const char *q = word; q < p; q++) line[n++] = *q;
  }
  line[n] = 0;

  if (g_rmgSeedQueued < RMG_SEED_QUEUE) g_rmgSeedQueue[g_rmgSeedQueued++] = wanted;
  int before = g_rmgSeedTaken;
  rmg_log_pair("cli: seed ", wanted, rmg_cli_say_line(line, n));
  // Only when something was actually generated: an order the command refused
  // took no seed, and keeping the PREVIOUS order's files under this one's
  // number is the kind of tidy-looking lie a batch must not tell.
  if (g_rmgSeedTaken > before) rmg_cli_keep(g_rmgSeedTaken);
  else rmg_log("cli: nothing was generated for that order");
}

/**
 * The engine's registry entry for `name`, or null when it has none.
 *
 * ONE registry for both: the command registration at `0xe335e0` and the value
 * lookup at `0xe33520` reach the same map through the same `0xe32f40`, so
 * asking after a COMMAND by name works exactly as asking after a value does —
 * and "is `rmg` in this process at all" stops being a guess.
 */
static float *rmg_cli_entry(const char *name, float *fallback) {
  EngineString key;
  key.begin = NULL;
  key.end = NULL;
  key.cap = NULL;
  g_rmgCliString(&key, NULL, name);
  if (!key.begin) return NULL;
  return g_rmgCliVar(&key, fallback);
}

/** What the engine has stored under `name`, or -1 when it has nothing. */
static int rmg_cli_var_value(const char *name) {
  float missing = -1.0f;
  float *found = rmg_cli_entry(name, &missing);
  return found ? (int)*found : -3;
}

/** `known <name> <0|1>` — whether the registry has heard of it at all. */
static void rmg_cli_report_known(const char *name) {
  char line[96];
  float missing = -1.0f;
  int known = rmg_cli_entry(name, &missing) != &missing;
  int i = 0;
  const char *head = "cli: known ";
  while (*head) line[i++] = *head++;
  while (*name && i < (int)sizeof(line) - 4) line[i++] = *name++;
  line[i++] = ' ';
  line[i++] = known ? '1' : '0';
  line[i] = 0;
  rmg_log(line);
}

/**
 * Does a line put through this door actually reach the engine?
 *
 * Asked before the orders and answered by the engine on both sides: a cfg of
 * ours sets a value, and the engine's own lookup reads it back. `door 7` in the
 * log means an order that does nothing did nothing for its own reasons; any
 * other number means nothing after it is worth reading, and the batch says so
 * instead of quietly producing a log with no runs in it.
 *
 * A `setvar` is the right probe precisely because it is the ONE thing a cfg
 * does on the spot. Everything else a cfg says is a COMMAND, and commands are
 * queued — which is what the first batch got wrong, and what `known` below was
 * asked to rule out: `rmg`, `exit` and `mainmenu` are all in the registry, so a
 * queued line naming one of them is not a line naming nothing.
 */
static void rmg_cli_check_the_door(void) {
  const char *probe = "setvar h5e_door = 7";
  int len = 0;
  while (probe[len]) len++;
  int said = rmg_cli_say_line(probe, len);
  rmg_log_pair("cli: door ", rmg_cli_var_value("h5e_door"), said);
  rmg_cli_report_known("rmg");
}

/**
 * Every order, said in the order written, each one finished before the next.
 *
 * The line door runs a command where it is said — proven, not assumed: the
 * probe's `setvar` is readable back through the engine's own lookup on the very
 * next instruction. So a generation happens inside this loop, the oracle writes
 * its readings between one line and the next, and the seeds line up with them
 * without anything having to be predicted.
 */
/**
 * ONE ORDER, THEN OUT — and the refusal is the feature.
 *
 * This used to run every line of the file in the one process, which is faster
 * and wrong: a launch's SECOND generation does not repeat what its first would
 * have produced alone. Two identical orders in one process came out with
 * different statics while their draw counters still agreed at the border
 * table, so something survives between generations inside the executable, and
 * a number measured after the first one is plausible, stable and false. It
 * already cost two rows of the `-size` table, both of them re-measured.
 *
 * So a launch runs the FIRST order and reports how many it left. Looping is
 * `tools/rmg-batch.ts`, which relaunches the editor for each — the same
 * convenience with a fresh process under every map. A file holding one line,
 * which is what that tool writes, never meets this at all.
 */
static void rmg_cli_run_all(void) {
  const char *p = g_rmgCliOrders;
  int count = 0, left = 0;
  rmg_cli_check_the_door();
  while (*p) {
    const char *stop = p;
    while (*stop && *stop != ';') stop++;
    const char *from = rmg_cli_spaces(p, stop);
    const char *to = stop;
    while (to > from && (to[-1] == ' ' || to[-1] == '\t')) to--;
    if (to > from) {
      if (count) left++;
      else { rmg_cli_run_order(from, to); count++; }
    }
    p = *stop ? stop + 1 : stop;
  }
  // Short on purpose: the log's line buffer clips, and a message that loses
  // its tail is a message that says something else.
  if (left) rmg_log_pair("cli: left for rmg-batch.ts ", left, 0);
  rmg_log_pair("cli: orders done ", count, g_rmgSeedTaken);
}

/**
 * The editor is about to open whatever its command line named. Ours instead.
 *
 * Not forwarded when the orders are ours: the argument IS `--rmg …`, and the
 * thing this replaces would look for a document by that name and put a box on
 * the screen about not finding one.
 *
 * And then the process ends, which is the whole point of a batch: the readings
 * are already on disk — the oracle's file is opened, appended and closed a line
 * at a time — and an editor left sitting on the screen would only have to be
 * closed by hand before the next launch.
 */
static int __fastcall rmg_cli_arg_hook(void *self, void *edx, void *arg) {
  // FIRST, and through the plain file writer rather than `log_line`: whether
  // this is entered at all is the one thing a failed batch has to be able to
  // say, and everything else in here — the extension's own log included — is
  // more machinery than that answer can afford to depend on.
  rmg_log("cli: the editor is up");
  if (!g_rmgCliWanted) return ((OpenArgFn)g_rmgCliArgOrig)(self, edx, arg);
  log_line("[rmg cli] the editor is up; running the orders");
  rmg_cli_run_all();
  log_line("[rmg cli] done - leaving");
  // Not forwarded: the argument was ours, so there is no document to open. And
  // then the process ends, which is the point of a batch — the readings are on
  // disk already, and an editor left on the screen holds the DLL open and
  // catches the NEXT launch's arguments through its own single-instance check.
  ExitProcess(0);
  return 0;
}

/**
 * Install it — the two engine functions recognised, the one site hooked.
 *
 * All three heads carry an absolute address in the second instruction, so each
 * is recognised in two pieces: the three bytes before that operand and the run
 * after it. Neither piece is relocated, and together they are far more than a
 * coincidence.
 */
static int install_rmg_cli(void) {
  static const BYTE argHead[] = { 0x6a, 0xff, 0x68, 0x7a, 0x8d, 0x05, 0x01 };
  /** Non-zero where the loader, not the compiler, decides the byte. */
  static const BYTE argSkip[] = { 0, 0, 0, 1, 1, 1, 1 };
  static const BYTE sehHead[] = { 0x6a, 0xff, 0x68 };
  static const BYTE strBody[] = {
      0x64, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x50, 0x64, 0x89, 0x25, 0x00, 0x00, 0x00, 0x00,
      0x51, 0x56, 0x8b, 0xf1, 0x57,
  };
  static const BYTE varBody[] = {
      0x64, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x50, 0x64, 0x89, 0x25, 0x00, 0x00, 0x00, 0x00,
      0x51, 0x53, 0x56, 0x57, 0x8b, 0xda, 0x8b, 0xf9,
  };
  static const BYTE lineBody[] = {
      0x64, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x50, 0x64, 0x89, 0x25, 0x00, 0x00, 0x00, 0x00,
      0x83, 0xec, 0x38, 0x53, 0x55, 0x56, 0x57, 0x8b, 0xf9,
  };
  static const BYTE wstrHead[] = {
      0x53, 0x55, 0x8b, 0x6c, 0x24, 0x10, 0x56, 0x57, 0x8b, 0x7c, 0x24, 0x14,
  };

  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  if (!engine_code(RMG_CLI_STR_RVA, sehHead, sizeof(sehHead), "the string's constructor")) return 0;
  if (!engine_code(RMG_CLI_STR_RVA + 7, strBody, sizeof(strBody), "the string's constructor")) return 0;
  if (!engine_code(RMG_CLI_VAR_RVA, sehHead, sizeof(sehHead), "the value lookup")) return 0;
  if (!engine_code(RMG_CLI_VAR_RVA + 7, varBody, sizeof(varBody), "the value lookup")) return 0;
  if (!engine_code(RMG_CLI_EXEC_LINE_RVA, sehHead, sizeof(sehHead), "the line executor")) return 0;
  if (!engine_code(RMG_CLI_EXEC_LINE_RVA + 7, lineBody, sizeof(lineBody), "the line executor")) return 0;
  if (!engine_code(RMG_CLI_WSTR_RVA, wstrHead, sizeof(wstrHead), "the wide string's constructor")) return 0;
  g_rmgCliString = (StringFromZFn)(base + RMG_CLI_STR_RVA);
  g_rmgCliVar = (VarLookupFn)(base + RMG_CLI_VAR_RVA);
  g_rmgCliExecLine = (ExecLineFn)(base + RMG_CLI_EXEC_LINE_RVA);
  g_rmgCliWString = (WStringRangeFn)(base + RMG_CLI_WSTR_RVA);

  static const BYTE ctorHead[] = { 0x6a, 0xff, 0x68, 0x59, 0x87, 0x02, 0x01 };
  static const BYTE ctorSkip[] = { 0, 0, 0, 1, 1, 1, 1 };
  g_rmgRequestCtor = (RmgRequestCtorFn)detour_relocated(
      RMG_CLI_REQUEST_RVA, ctorHead, ctorSkip, sizeof(ctorHead),
      (void *)rmg_request_ctor_hook, "the rmg request");
  rmg_log(g_rmgRequestCtor ? "cli: the multipliers can be ordered"
                           : "cli: the multipliers cannot be ordered - defaults stand");

  g_rmgCliArgOrig = detour_relocated(RMG_CLI_ARG_RVA, argHead, argSkip, sizeof(argHead),
                                     (void *)rmg_cli_arg_hook, "the editor's command line");
  rmg_log(g_rmgCliArgOrig ? "cli: waiting for the editor to come up" : "cli: the door refused us");
  return g_rmgCliArgOrig != NULL;
}
