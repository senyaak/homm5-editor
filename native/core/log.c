// Where we live, the log beside us, and what memory may be read.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

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

static void log_line(const char *text) {
  console_line(text);
  WCHAR path[MAX_PATH];
  beside_us(L"homm5-editor.log", path);
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

static void log_num(const char *prefix, int value) {
  char line[128];
  int i = 0;
  while (prefix[i] && i < 100) { line[i] = prefix[i]; i++; }
  int n = 0;
  num_to_dec(value, line + i, &n);
  line[i + n] = 0;
  log_line(line);
}

/** The same, with a word instead of a number. Truncates rather than overruns. */
static void log_text(const char *prefix, const char *text) {
  char line[192];
  int i = 0;
  while (prefix[i] && i < 100) { line[i] = prefix[i]; i++; }
  int j = 0;
  while (text[j] && i < 190) line[i++] = text[j++];
  line[i] = 0;
  log_line(line);
}

static void log_hex(const char *prefix, DWORD value) {
  static const char DIGITS[] = "0123456789abcdef";
  char text[11];
  text[0] = '0';
  text[1] = 'x';
  for (int i = 0; i < 8; i++) text[2 + i] = DIGITS[(value >> (28 - i * 4)) & 0xF];
  text[10] = 0;
  log_text(prefix, text);
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
static void log_object(const char *what, void *p) {
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
  log_line(line);
}


