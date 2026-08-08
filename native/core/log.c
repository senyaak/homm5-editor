// Where we live, the log beside us, and what memory may be read.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// THE GATE LIVES AT THE BOTTOM OF THIS FILE. The five `log_*` names every other
// file calls are macros from here down, each one asking whether the CALLING
// FILE's logging was switched on at compile time. See "One switch per file".

#undef LOG_UNIT
#define LOG_UNIT core_log

// ---------------------------------------------------------------------------
// Where we live, and what sits beside us.

static WCHAR g_dir[MAX_PATH];

static void find_our_dir(HINSTANCE self) {
  DWORD n = GetModuleFileNameW(self, g_dir, MAX_PATH);
  while (n && g_dir[n - 1] != L'\\' && g_dir[n - 1] != L'/') n--;
  g_dir[n] = 0;
}

/** `<our folder>\name`, into `out`. */
static void beside_us(const WCHAR *name, WCHAR *out) {
  int i = 0;
  while (g_dir[i] && i < MAX_PATH - 1) { out[i] = g_dir[i]; i++; }
  int j = 0;
  while (name[j] && i < MAX_PATH - 1) out[i++] = name[j++];
  out[i] = 0;
}

/**
 * A whole file beside us, NUL-terminated, or null if there is none.
 *
 * WHOLE, and that is the point. Both configs used to be read into a buffer of a
 * size somebody guessed — 4 KB for the quality-of-life flags — and the file
 * grew: every flag now carries its description and its credit as comments, and
 * at 8 KB the last flags in it were past the end of the buffer. They were not
 * refused, they were never SEEN, so `payback-fix 1` sat in the file and the log
 * did not list it and nothing in the game changed. A guessed size fails
 * silently and fails later, which is the worst way to fail.
 *
 * `*size` comes back with the length. Free with `VirtualFree(p, 0, MEM_RELEASE)`.
 */
static char *read_beside_us(const WCHAR *name, DWORD *size) {
  WCHAR path[MAX_PATH];
  beside_us(name, path);
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return NULL;
  DWORD len = GetFileSize(h, NULL);
  if (len == INVALID_FILE_SIZE) { CloseHandle(h); return NULL; }
  char *buf = (char *)VirtualAlloc(NULL, len + 1, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!buf) { CloseHandle(h); return NULL; }
  DWORD got = 0;
  // One call is enough for a file on disk, and a short read is still a file we
  // can parse — it is the CAP that was the bug, not the loop.
  ReadFile(h, buf, len, &got, NULL);
  CloseHandle(h);
  buf[got] = 0;
  *size = got;
  return buf;
}

// ---------------------------------------------------------------------------
// A FILE PER RUN, named for when the run started.
//
// One file that every launch appends to cannot be read. Two launches to
// reproduce something and the interesting lines are somewhere in the middle,
// with nothing in the text saying where one run ended and the next began — and
// the natural fix, deleting the file before launching, is a step a person
// forgets exactly when it matters. So the name carries the moment:
//
//   homm5-editor-20260808-143012.log
//
// Sorted by name is sorted by time, which is what makes both the pruning below
// and "open the newest one" work without reading a single file.

/** How many runs' logs are kept. Older ones go at the start of a run. */
#define LOGS_KEPT 10
/** Room for the names found beside us — more than that and we prune what we saw. */
#define LOGS_SEEN_MAX 64

static WCHAR g_logName[40];

static void two_digits(WCHAR *out, int v) {
  out[0] = (WCHAR)(L'0' + (v / 10) % 10);
  out[1] = (WCHAR)(L'0' + v % 10);
}

/** `homm5-editor-YYYYMMDD-HHMMSS.log`, into `g_logName`. */
static void name_this_run(void) {
  SYSTEMTIME t;
  GetLocalTime(&t);
  const WCHAR *head = L"homm5-editor-";
  int at = 0;
  while (head[at]) { g_logName[at] = head[at]; at++; }
  two_digits(g_logName + at, t.wYear / 100); at += 2;
  two_digits(g_logName + at, t.wYear); at += 2;
  two_digits(g_logName + at, t.wMonth); at += 2;
  two_digits(g_logName + at, t.wDay); at += 2;
  g_logName[at++] = L'-';
  two_digits(g_logName + at, t.wHour); at += 2;
  two_digits(g_logName + at, t.wMinute); at += 2;
  two_digits(g_logName + at, t.wSecond); at += 2;
  const WCHAR *tail = L".log";
  for (int i = 0; tail[i]; i++) g_logName[at++] = tail[i];
  g_logName[at] = 0;
}

/** Less than, by name — which for these names is earlier than. */
static int name_before(const WCHAR *a, const WCHAR *b) {
  int i = 0;
  while (a[i] && a[i] == b[i]) i++;
  return a[i] < b[i];
}

/**
 * Keep the last few runs, delete the rest.
 *
 * BY NAME, never by the file system's idea of age: a timestamp in the name is
 * decided by the run that wrote it, and a modified time is decided by whatever
 * touched the file afterwards — a backup, a copy, an editor left open on it.
 */
static void prune_old_logs(void) {
  WCHAR pattern[MAX_PATH];
  beside_us(L"homm5-editor-*.log", pattern);
  WIN32_FIND_DATAW found;
  HANDLE h = FindFirstFileW(pattern, &found);
  if (h == INVALID_HANDLE_VALUE) return;

  static WCHAR seen[LOGS_SEEN_MAX][40];
  int count = 0;
  do {
    int n = 0;
    while (found.cFileName[n]) n++;
    if (n >= (int)(sizeof seen[0] / sizeof seen[0][0])) continue;
    if (count >= LOGS_SEEN_MAX) break;
    for (int i = 0; i <= n; i++) seen[count][i] = found.cFileName[i];
    count++;
  } while (FindNextFileW(h, &found));
  FindClose(h);

  // One short of the limit, because this run is about to add its own.
  int drop = count - (LOGS_KEPT - 1);
  for (; drop > 0; drop--) {
    int oldest = -1;
    for (int i = 0; i < count; i++) {
      if (!seen[i][0]) continue;
      if (oldest < 0 || name_before(seen[i], seen[oldest])) oldest = i;
    }
    if (oldest < 0) return;
    WCHAR path[MAX_PATH];
    beside_us(seen[oldest], path);
    DeleteFileW(path);
    seen[oldest][0] = 0;
  }
}

/** Called once, before anything logs: this run's file, and room for it. */
static void start_this_run_log(void) {
  name_this_run();
  prune_old_logs();
}

/** Say it in the game's own console too, while a battle can be spoken to. */
static void console_line(const char *text);

/**
 * WHO WROTE THE LINE, AND WHEN — on every line, because without it the order of
 * a log file is not evidence of anything.
 *
 * Two readings of the same run disagreed about whether a rule ran inside the
 * call that asked for it or after it, and both readings were of line order in
 * this file. Line order is call order only while there is one thread; the
 * moment there are two, a file says which line was written first and nothing
 * about which call happened first. The thread id settles that, and the counter
 * settles a second thing — that no line was lost between two others.
 */
static LONG g_logSeq = 0;

static void log_line_now(const char *text) {
  console_line(text);
  WCHAR path[MAX_PATH];
  beside_us(g_logName, path);
  HANDLE h = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  char stamp[48];
  int at = 0, n = 0;
  stamp[at++] = '[';
  stamp[at++] = 't';
  num_to_dec((int)GetCurrentThreadId(), stamp + at, &n); at += n;
  stamp[at++] = ' ';
  stamp[at++] = '#';
  num_to_dec((int)InterlockedIncrement(&g_logSeq), stamp + at, &n); at += n;
  stamp[at++] = ']';
  stamp[at++] = ' ';
  int len = 0;
  while (text[len]) len++;
  WriteFile(h, stamp, (DWORD)at, &written, NULL);
  WriteFile(h, text, (DWORD)len, &written, NULL);
  WriteFile(h, "\r\n", 2, &written, NULL);
  CloseHandle(h);
}

static void log_num_now(const char *prefix, int value) {
  char line[128];
  int i = 0;
  while (prefix[i] && i < 100) { line[i] = prefix[i]; i++; }
  int n = 0;
  num_to_dec(value, line + i, &n);
  line[i + n] = 0;
  log_line_now(line);
}

/** The same, with a word instead of a number. Truncates rather than overruns. */
static void log_text_now(const char *prefix, const char *text) {
  char line[192];
  int i = 0;
  while (prefix[i] && i < 100) { line[i] = prefix[i]; i++; }
  int j = 0;
  while (text[j] && i < 190) line[i++] = text[j++];
  line[i] = 0;
  log_line_now(line);
}

static void log_hex_now(const char *prefix, DWORD value) {
  static const char DIGITS[] = "0123456789abcdef";
  char text[11];
  text[0] = '0';
  text[1] = 'x';
  for (int i = 0; i < 8; i++) text[2 + i] = DIGITS[(value >> (28 - i * 4)) & 0xF];
  text[10] = 0;
  log_text_now(prefix, text);
}

/**
 * How much of what `p` points at may be read — its committed pages, capped.
 *
 * NOTHING IS DEREFERENCED WITHOUT ASKING THE KERNEL FIRST. The first version of
 * this probe walked the owner chain from a constructor's object and killed the
 * battle; `points_at_code` cannot save a walk like that, since it filters the
 * pointer it is HANDED and the fault was in fetching that pointer from a vtable
 * that is not one.
 *
 * WITH A MEMORY OF WHERE IT HAS BEEN. Asking Windows about a page is a system
 * call, and a gesture that reads an army asks about a great many pointers;
 * uncached, the game visibly stops while we look around. The answers are
 * per-region and the regions repeat, so a handful remembered turns nearly all of
 * them into a comparison.
 */
#define REGIONS_REMEMBERED 16
static struct { BYTE *begin, *end; int usable; } g_region[REGIONS_REMEMBERED];
static int g_regionsKnown = 0;
static int g_regionNext = 0;

static DWORD readable_bytes(const void *p, DWORD want) {
  if (!p || (DWORD)p < 0x10000) return 0;
  BYTE *at = (BYTE *)(void *)p;
  for (int i = 0; i < g_regionsKnown; i++) {
    if (at < g_region[i].begin || at >= g_region[i].end) continue;
    if (!g_region[i].usable) return 0;
    DWORD left = (DWORD)(g_region[i].end - at);
    return left < want ? left : want;
  }

  MEMORY_BASIC_INFORMATION region;
  if (VirtualQuery(p, &region, sizeof(region)) != sizeof(region)) return 0;
  int usable = region.State == MEM_COMMIT && !(region.Protect & (PAGE_NOACCESS | PAGE_GUARD));
  int slot = g_regionsKnown < REGIONS_REMEMBERED ? g_regionsKnown++ : g_regionNext;
  if (g_regionsKnown == REGIONS_REMEMBERED) g_regionNext = (g_regionNext + 1) % REGIONS_REMEMBERED;
  g_region[slot].begin = (BYTE *)region.BaseAddress;
  g_region[slot].end = (BYTE *)region.BaseAddress + region.RegionSize;
  g_region[slot].usable = usable;
  if (!usable) return 0;
  DWORD left = (DWORD)(g_region[slot].end - at);
  return left < want ? left : want;
}

/**
 * The same question asked as yes or no, and asked of the kernel every time.
 *
 * NOT the cached one above, deliberately. A remembered answer is a claim that a
 * region has not been freed and re-mapped since, which is fine for a gesture
 * that reads an army in one go and would be a new and untested risk for the
 * probes that run inside a battle. The two callers want different bargains, so
 * they get different functions.
 */
static int readable(const void *p, SIZE_T n) {
  MEMORY_BASIC_INFORMATION mbi;
  if (!p) return 0;
  if (!VirtualQuery(p, &mbi, sizeof mbi)) return 0;
  if (mbi.State != MEM_COMMIT) return 0;
  if (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return 0;
  SIZE_T left = (SIZE_T)((BYTE *)mbi.BaseAddress + mbi.RegionSize - (BYTE *)p);
  return left >= n;
}

/** A pointer and whatever it starts with — a vtable address, if it is an object. */
static void log_object_now(const char *what, void *p) {
  char line[160];
  int i = 0;
  while (what[i] && i < 60) { line[i] = what[i]; i++; }
  int n = 0;
  num_to_dec((int)(DWORD)p, line + i, &n);
  i += n;
  if (readable(p, 8)) {
    const char *sep = "  vt+0 ";
    for (int j = 0; sep[j]; j++) line[i++] = sep[j];
    num_to_dec((int)((DWORD *)p)[0], line + i, &n);
    i += n;
    const char *sep2 = "  vt+4 ";
    for (int j = 0; sep2[j]; j++) line[i++] = sep2[j];
    num_to_dec((int)((DWORD *)p)[1], line + i, &n);
    i += n;
  }
  line[i] = 0;
  log_line_now(line);
}

// ---------------------------------------------------------------------------
// ONE SWITCH PER FILE, and the file itself says its name.
//
// WHY THERE IS A SWITCH AT ALL. Nearly four hundred places log, and a run with
// all of them speaking writes hundreds of lines per spell cast — into a file
// and, in a battle, into the game's own console through `console_line`, which
// is the engine's Lua interpreter called from inside a detour. The volume alone
// makes a log unreadable; the volume plus that re-entry is what stops the game.
// What a person debugging actually wants is one subject speaking.
//
// WHY PER FILE, AND NOT PER SUBJECT. A subject is a judgement — somebody has to
// decide whether a line belongs to "spells" or to "combat", and the decision
// drifts as files move. A FILE is not a judgement: every line has exactly one,
// nobody has to choose, and a file added tomorrow arrives with its own switch
// already. Each file says which one it is in a single line near its top:
//
//   #define LOG_UNIT combat_spell_resolve
//
// and that name — its folder and its own name — is the whole of the vocabulary:
//
//   npm run build-native -- --log combat/spell-resolve,lua/battle
//
// WHY THE PREPROCESSOR AND NOT A FLAG IN A FILE. A switch read at run time
// leaves every string, every format and every call in the shipped DLL, and the
// point is that a build meant for playing carries NONE of it. `LOG_ON` is a
// constant the compiler folds, so a file that was not asked for contributes
// nothing to the binary — `tools/test-native-log.ts` checks exactly that by
// looking for the text of a log line in the built bytes.
//
// WHERE THE NAMES COME FROM. `src/mods/extension.ts` reads every `#define
// LOG_UNIT` out of these sources and defines `H5E_LOG_<unit>` as 1 or 0 for all
// of them. So the sources are the register of units and the build has no list
// of its own to fall out of step with.

#define H5E_PASTE_(a, b) a##b
#define H5E_PASTE(a, b) H5E_PASTE_(a, b)

/** Whether the file being compiled at this line was asked to speak. */
#define LOG_ON H5E_PASTE(H5E_LOG_, LOG_UNIT)

// From here down `log_line` and friends are these — every call site in every
// other file keeps its spelling and gains its file's gate. The functions above
// keep the `_now` names, and a caller that must speak whatever the build asked
// for (a crash, say) calls those directly and says why.
#define log_line(text)         do { if (LOG_ON) log_line_now(text); } while (0)
#define log_num(prefix, value) do { if (LOG_ON) log_num_now(prefix, value); } while (0)
#define log_text(prefix, text) do { if (LOG_ON) log_text_now(prefix, text); } while (0)
#define log_hex(prefix, value) do { if (LOG_ON) log_hex_now(prefix, value); } while (0)
#define log_object(what, p)    do { if (LOG_ON) log_object_now(what, p); } while (0)


