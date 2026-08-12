// The game's own online log, mirrored into ours.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY. Everything the online code does it also NARRATES, in the engine's own log
// stream: "join lobby succeeded(GroupID=…)", "join lobby failed,reason=", "IRC
// join channel failed", "request NAT address sent, waiting reply". Written down
// like that, a stalled lobby says what it is waiting for. Without it the only
// evidence is our server's side of the wire plus an error code that is the same
// for every step (docs/NETWORK.md), and the last three failures each cost a
// launch to locate. This is the eyes.
//
// HOW. The stream is UTF-16 and its pieces all funnel through one append —
// 0xDFB270, `stream << wide-string` — whether the caller appended a literal, a
// converted `const char *` or a number. One detour there catches every fragment;
// the newline the "endl" manipulator appends is what ends a line.
//
// THE LEVEL GATE, AND WHY IT IS LEFT ALONE. Two globals hold a threshold that a
// line's own level is compared against (`cmp [threshold], [level]; jg skip` in
// 0xDFB650 and 0xDFB770). Measured on a real run: both are already **0**, so
// nothing is being filtered out and the append below sees everything. Lowering
// them anyway — which this file did for exactly one launch — opens the branches
// the engine means to skip, and the game died at once inside its own
// string-append (0x4E7550, `mov [esi+2],ax` with esi = 0: a string object nobody
// initialised, because that path was never supposed to run). So: read them, write
// them down, change nothing.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_ubi_log

/** `CLogStream::operator<<(const wide_string&)`, where every fragment lands. */
#define UBI_LOG_APPEND_RVA 0x9FB270u
static const BYTE UBI_LOG_APPEND_HEAD[DETOUR_LEN] = { 0x55, 0x8B, 0xEC, 0x6A, 0xFF };

/** The two thresholds a line's level is measured against. */
#define UBI_LOG_LEVEL_A_RVA 0xE1A8F0u
#define UBI_LOG_LEVEL_B_RVA 0xE1A908u

typedef void *(__fastcall *UbiLogAppendFn)(void *stream, void *edx, void *wide);
static UbiLogAppendFn g_ubiLogAppend = NULL;

/** The line being assembled, and how much of it is real. */
static char g_ubiLine[1024];
static int g_ubiLineLen = 0;
/** A bound on the mirror, not on what it says: a run that logs for ever stops. */
static int g_ubiLines = 0;
#define UBI_LOG_MAX_LINES 200000

static void ubi_log_flush(void) {
  if (g_ubiLineLen <= 0) return;
  g_ubiLine[g_ubiLineLen] = 0;
  g_ubiLineLen = 0;
  if (g_ubiLines++ < UBI_LOG_MAX_LINES) log_line_now(g_ubiLine);
}

/**
 * One fragment of a log line: append its characters, and end the line on a
 * newline. Wide characters are narrowed by dropping the high byte, which is
 * lossless for everything this log actually contains — the online code writes
 * ASCII.
 */
static void ubi_log_take(const unsigned short *from, const unsigned short *to) {
  for (const unsigned short *at = from; at < to; at++) {
    unsigned short wide = *at;
    if (wide == '\r') continue;
    if (wide == '\n') {
      ubi_log_flush();
      continue;
    }
    if (g_ubiLineLen < (int)sizeof(g_ubiLine) - 1) {
      g_ubiLine[g_ubiLineLen++] = wide > 0x7e ? '?' : (char)wide;
    } else {
      // A line longer than the buffer is written in pieces rather than lost.
      ubi_log_flush();
    }
  }
}

static void *__fastcall ubi_log_append_hook(void *stream, void *edx, void *wide) {
  // The pair is {begin, end}; the engine's own code computes the length the same
  // way. Anything unreadable is skipped rather than guessed at — this runs on
  // every log line in the game and must never be the reason one crashes.
  if (readable(wide, 8)) {
    const unsigned short *begin = *(const unsigned short **)wide;
    const unsigned short *end = *(const unsigned short **)((BYTE *)wide + 4);
    if (end > begin && (SIZE_T)((BYTE *)end - (BYTE *)begin) < 0x10000 && readable(begin, (BYTE *)end - (BYTE *)begin)) {
      ubi_log_take(begin, end);
    }
  }
  return g_ubiLogAppend(stream, edx, wide);
}

/** Mirror the engine's log into ours, and stop it filtering itself. */
static int install_ubi_log(void) {
  g_ubiLogAppend = (UbiLogAppendFn)detour(UBI_LOG_APPEND_RVA, UBI_LOG_APPEND_HEAD, DETOUR_LEN,
                                          &ubi_log_append_hook, "engine log append");
  if (!g_ubiLogAppend) return 0;

  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  int *levelA = (int *)(base + UBI_LOG_LEVEL_A_RVA);
  int *levelB = (int *)(base + UBI_LOG_LEVEL_B_RVA);
  // Reported, not touched — see the note above about what happened when they were.
  if (readable(levelA, 4) && readable(levelB, 4)) {
    log_num("engine log threshold A is ", *levelA);
    log_num("engine log threshold B is ", *levelB);
  }
  return 1;
}
