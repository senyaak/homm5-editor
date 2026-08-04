// The quality-of-life flags and their file. test-qol reads THIS file.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Quality of life — how somebody wants to PLAY, in a file of its own.
//
// A SECOND config rather than more rows in the first one, because the two have
// different owners. The effects file is content: it belongs to what the editor
// built and travels with it. These are a player's preference about his own
// install, and a map of his has no business carrying them.
//
//   # comment
//   borderless 1
//
// Every flag is OFF unless a line turns it on, and no file at all is the same
// as every flag off — so an install that never opened the panel behaves exactly
// as it did before, which is the whole promise of a quality of life mod.

typedef enum {
  QOL_BORDERLESS = 0,
  QOL_OWN_PROFILE = 1,
  QOL_QUICK_SPLIT = 2,
  QOL_STACK_HEALTH = 3,
  QOL_STACK_LOSSES = 4,
  QOL_COMBAT_AI_FIX = 5,
  QOL_ENCOURAGE_FIX = 6,
  QOL_BARBARIAN_LEARNING_FIX = 7,
  QOL_SNARE_CRASH_FIX = 8,
  QOL_PAYBACK_FIX = 9,
  QOL_COUNT = 10
} QolFlag;

static const char *const QOL_NAMES[QOL_COUNT] = {
  "borderless", "own-profile", "quick-split", "stack-health-bar", "stack-losses",
  "combat-ai-fix", "encourage-fix", "barbarian-learning-fix", "snare-crash-fix",
  "payback-fix"
};

static int g_qol[QOL_COUNT];

static void load_qol(void) {
  WCHAR path[MAX_PATH];
  beside_us(L"homm5-editor-qol.txt", path);
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;

  char buf[4096];
  DWORD got = 0;
  ReadFile(h, buf, sizeof(buf) - 1, &got, NULL);
  CloseHandle(h);
  buf[got] = 0;

  const char *p = buf, *end = buf + got;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    for (int i = 0; i < QOL_COUNT; i++) {
      const char *q = line;
      if (!take_word(&q, stop, QOL_NAMES[i])) continue;
      // The name on its own means on: a hand-written file to try something out
      // should not need to know that the number is what counts.
      int on = 1;
      read_int(&q, stop, &on);
      g_qol[i] = on != 0;
      break;
    }
  }
  for (int i = 0; i < QOL_COUNT; i++) {
    if (g_qol[i]) log_text("qol: ", QOL_NAMES[i]);
  }
}

