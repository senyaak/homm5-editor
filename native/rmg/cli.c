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
// hook the oracle already installs, set per order rather than once per file.
//
//   H5_MapEditor_H5E.exe --rmg S1P2Z2M1 -seed 1785351845
//   H5_MapEditor_H5E.exe --rmg "S1P2Z2M1 -seed 42; S1P2Z2M1 -seed 43 -size 3"
//
// One launch, as many orders as fit on a line, and the readings land in
// `bin/homm5-editor-rmg.log` the way an ordered screen run's do — which is what
// makes the log a batch rather than a session.
//
// WHAT IT STILL CANNOT DO: save. `rmg` generates, names the map and prints the
// name; nothing in the engine's 79 console commands writes a `.h5m`. So this
// buys the DRAW COUNTS for any order — which is what a diverging phase needs —
// and not the byte comparison, which still wants a map saved by hand.

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
/** `Execute(this = the wide string holding the line)` — the console's own door. */
#define RMG_CLI_EXEC_RVA 0xa342b0u
/** `wstring::wstring(begin, end)` — the only kind of string that door takes. */
#define RMG_CLI_WSTR_RVA 0x7d00u

/** The engine's wide string: three pointers, and the buffer is its own. */
typedef struct {
  WCHAR *begin;
  WCHAR *end;
  WCHAR *cap;
} EngineWString;

typedef void(__fastcall *WStringRangeFn)(EngineWString *self, void *edx, const WCHAR *begin,
                                         const WCHAR *end);
typedef int(__fastcall *ExecLineFn)(EngineWString *self);
typedef int(__fastcall *OpenArgFn)(void *self, void *edx, void *arg);

static WStringRangeFn g_rmgCliWString = NULL;
static ExecLineFn g_rmgCliExec = NULL;
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
 * `--rmg <orders>` off the process's own command line, or nothing.
 *
 * Read here rather than out of the argument the hook is handed, because the
 * ANSWER is needed at load — the oracle has to be installed before the editor
 * runs, and a batch with no readings in it is a wasted launch. The hook then
 * only supplies the moment.
 *
 * The tail is taken whole: everything after `--rmg` is orders, separated by
 * semicolons. A pair of quotes around the lot is stripped, because a command
 * line with a semicolon in it usually arrives quoted and the editor's own
 * argument handling strips exactly the same pair.
 */
static int rmg_cli_take_orders(void) {
  const char *cmd = GetCommandLineA();
  const char *p = cmd;
  const char *tail = NULL;
  if (!cmd) return 0;
  while (*p) {
    if (p[0] == '-' && p[1] == '-' && p[2] == 'r' && p[3] == 'm' && p[4] == 'g'
        && (p == cmd || p[-1] == ' ' || p[-1] == '\t')
        && (p[5] == 0 || p[5] == ' ' || p[5] == '\t')) {
      tail = p + 5;
      break;
    }
    p++;
  }
  if (!tail) return 0;

  while (*tail == ' ' || *tail == '\t') tail++;
  int len = 0;
  while (tail[len]) len++;
  while (len > 0 && (tail[len - 1] == ' ' || tail[len - 1] == '\t')) len--;
  if (len >= 2 && tail[0] == '"' && tail[len - 1] == '"') { tail++; len -= 2; }
  if (len <= 0) return 0;
  if (len > (int)sizeof(g_rmgCliOrders) - 1) len = (int)sizeof(g_rmgCliOrders) - 1;
  for (int i = 0; i < len; i++) g_rmgCliOrders[i] = tail[i];
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
  WCHAR line[512];
  int n = 0;

  line[n++] = 'r';
  line[n++] = 'm';
  line[n++] = 'g';

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
        g_rmgSeed = seed;
        g_rmgForceSeed = 1;
        p = q;
      } else {
        rmg_log("cli: -seed with no number after it - the engine will pick one");
      }
      continue;
    }
    if (n + 1 + (int)(p - word) >= (int)(sizeof(line) / sizeof(line[0])) - 1) break;
    line[n++] = ' ';
    for (const char *q = word; q < p; q++) line[n++] = (WCHAR)(unsigned char)*q;
  }
  line[n] = 0;

  rmg_cli_log_text("cli: ", from, to);
  // The string is the engine's own — its allocator, its layout, built by its
  // own constructor — because the console is entitled to do anything with it
  // that it does with a line a person typed. It is NOT freed afterwards: the
  // deleter is behind an import thunk whose operand the loader rewrites, so
  // recognising it costs more certainty than the buffer is worth in a process
  // that is about to exit. One line's worth of memory per order, and said out
  // loud rather than hidden.
  EngineWString text;
  text.begin = NULL;
  text.end = NULL;
  text.cap = NULL;
  g_rmgCliWString(&text, NULL, line, line + n);
  if (!text.begin) { rmg_log("cli: the line could not be built"); return; }
  // The console's own answer, written down because it is the only one there
  // is: what the command says about a template it could not find goes to the
  // engine's console window, which a batch has nobody watching. -1 is what an
  // empty line returns, so a -1 here means the line never became a command.
  rmg_log_pair("cli: console said ", g_rmgCliExec(&text), 0);
}

/** Every order on the line, in the order written, separated by semicolons. */
static void rmg_cli_run_all(void) {
  const char *p = g_rmgCliOrders;
  int count = 0;
  while (*p) {
    const char *stop = p;
    while (*stop && *stop != ';') stop++;
    const char *from = rmg_cli_spaces(p, stop);
    const char *to = stop;
    while (to > from && (to[-1] == ' ' || to[-1] == '\t')) to--;
    if (to > from) { rmg_cli_run_order(from, to); count++; }
    p = *stop ? stop + 1 : stop;
  }
  rmg_log_pair("cli: orders done ", count, 0);
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
  if (!g_rmgCliWanted) return ((OpenArgFn)g_rmgCliArgOrig)(self, edx, arg);
  log_line("[rmg cli] the editor is up; running the orders");
  rmg_log("cli: the editor is up");
  rmg_cli_run_all();
  log_line("[rmg cli] done - leaving");
  ExitProcess(0);
  return 0;
}

/**
 * Install it — the two engine functions recognised, the one site hooked.
 *
 * The executor's head carries an absolute address in its second instruction,
 * so it is recognised in two pieces: the three bytes before that operand, and
 * the twenty-three after it. Neither is relocated, and together they are far
 * more than a coincidence.
 */
static int install_rmg_cli(void) {
  static const BYTE argHead[] = { 0x6a, 0xff, 0x68, 0x7a, 0x8d, 0x05, 0x01 };
  /** Non-zero where the loader, not the compiler, decides the byte. */
  static const BYTE argSkip[] = { 0, 0, 0, 1, 1, 1, 1 };
  static const BYTE execHead[] = { 0x6a, 0xff, 0x68 };
  static const BYTE execBody[] = {
      0x64, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x50, 0x64, 0x89, 0x25, 0x00, 0x00,
      0x00, 0x00, 0x83, 0xec, 0x38, 0x53, 0x55, 0x56, 0x57, 0x8b, 0xf9,
  };
  static const BYTE wstrHead[] = {
      0x53, 0x55, 0x8b, 0x6c, 0x24, 0x10, 0x56, 0x57, 0x8b, 0x7c, 0x24, 0x14,
  };

  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  if (!engine_code(RMG_CLI_EXEC_RVA, execHead, sizeof(execHead), "the console's line executor")) return 0;
  if (!engine_code(RMG_CLI_EXEC_RVA + 7, execBody, sizeof(execBody), "the console's line executor")) return 0;
  if (!engine_code(RMG_CLI_WSTR_RVA, wstrHead, sizeof(wstrHead), "the wide string's constructor")) return 0;
  g_rmgCliExec = (ExecLineFn)(base + RMG_CLI_EXEC_RVA);
  g_rmgCliWString = (WStringRangeFn)(base + RMG_CLI_WSTR_RVA);

  g_rmgCliArgOrig = detour_relocated(RMG_CLI_ARG_RVA, argHead, argSkip, sizeof(argHead),
                                     (void *)rmg_cli_arg_hook, "the editor's command line");
  return g_rmgCliArgOrig != NULL;
}
