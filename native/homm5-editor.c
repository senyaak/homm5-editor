// The editor's own extension, loaded into the game.
//
// WHAT IT IS FOR. An artifact record carries six hero stats and nothing else.
// Everything a shipped artifact does beyond that is compiled into the
// executable against a specific id, so a new id gets none of it — see
// docs/ENGINE_INTERNALS.md. This adds our own terms to the engine's own
// arithmetic: it calls the original calculation, appends what our config says,
// and returns the sum. Nothing shipped changes behaviour.
//
// HOW IT GETS LOADED. Not by taking another library's name: `H5_Game_H5E.exe`
// is our copy already, and it names this file in its import table. So no file
// of the game's is touched, and turning the mod off is what it always was —
// launch the game's own executable instead.
//
// WHAT IT HOOKS, for now. `CNecromancy::RaisePercent` — one function, called
// once, that sums base + skill + perk + amplifiers + grail + pendant + set. Its
// last term is "count worn pieces of set 5, if at least 4 add a number from
// data"; ours is the same shape with our set and our number.
//
// ONE ADDRESS, AND ONLY ONE. The hero arrives as `this`, and the engine asks
// how many pieces of a set are worn through the hero's OWN vtable (+0x328), so
// that call needs no address at all — we make it the way the engine makes it,
// two instructions above where we cut in. The single address we do need is
// verified against the bytes we expect before anything is written.
//
// NO C RUNTIME. Only kernel32: this is injected into a 2007 executable, and a
// runtime that has to initialise is one more thing that can fail in a process
// that is not ours. Parsing and formatting are done by hand below; there is not
// much of either.

#include <windows.h>

// ---------------------------------------------------------------------------
// The build we know, as landmarks rather than constants.

/** `CNecromancy::RaisePercent`, RVA in the 3.1 build. Verified before use. */
#define RAISE_PERCENT_RVA 0x877850u
/** Its first five bytes: sub esp,8 / push ebx / push ebp. A whole number of
 *  instructions, which is why the detour is exactly this long. */
static const BYTE RAISE_PERCENT_HEAD[5] = { 0x83, 0xEC, 0x08, 0x53, 0x55 };
/**
 * `CNecromancy::RaiseCost` — what one creature costs in dark energy.
 *
 * Hooked only to watch, for now. The percentage says how many the engine will
 * OFFER; this says what each one is paid for, and which of the two is doing the
 * limiting is not something to reason about from the outside. Its prologue is
 * five pushes, so the detour is again a whole number of instructions.
 */
#define RAISE_COST_RVA 0x877270u
static const BYTE RAISE_COST_HEAD[5] = { 0x51, 0x53, 0x55, 0x56, 0x57 };

/** Where a hero hands over the artifacts it is WEARING. */
#define VT_WORN_ARTIFACTS 0x74u
/** `CountEquipped(collection, artifactId)`, and the bytes that say it is. */
#define COUNT_EQUIPPED_RVA 0x74c270u
static const BYTE COUNT_EQUIPPED_HEAD[5] = { 0x53, 0x8B, 0x19, 0x56, 0x57 };

// ---------------------------------------------------------------------------
// Dark energy — the necromancer's pool, and the second thing we add to.
//
// It is a PLAYER's, not a hero's, and it works in two steps the engine keeps
// apart: a CEILING made of four numbers (base, necromancer heroes, Necromancy
// Amplifiers, the grail building), and the pool itself, which the engine fills
// to that ceiling every week. So a bonus here is a fifth term of the ceiling —
// and the engine then grants it on its own, at the moment it grants the rest.
//
// The four live in the player at +0x67c and are summed in exactly three places
// in the whole executable, which is why this needs three hooks and not one:
// the refill, the recalculation that clamps the pool to the ceiling, and the
// bar that draws it. Nothing else reads them; the accessor below is how the
// bar asks. See docs/ENGINE_INTERNALS.md.

/** `CPlayer::RefillNecroEnergy` — recompute the ceiling, then fill to it. */
#define REFILL_ENERGY_RVA 0x8066d0u
static const BYTE REFILL_ENERGY_HEAD[5] = { 0x56, 0x8B, 0xF1, 0x8B, 0x06 };
/** `CPlayer::RecalcEnergyCaps` — recompute, and clamp the pool DOWN to it. */
#define RECALC_ENERGY_RVA 0x806670u
static const BYTE RECALC_ENERGY_HEAD[5] = { 0x83, 0xEC, 0x14, 0x33, 0xC0 };
/**
 * The accessor that hands the four out: `lea eax,[ecx+67Ch]; ret`.
 *
 * Not detoured — REPLACED, by writing our function's address over the one
 * pointer in the image that names it. It is a virtual slot, so this changes no
 * code at all, and exactly one dword in the file holds it (checked with
 * tools/reverse). Only the bar calls it.
 */
#define ENERGY_CAPS_ACCESSOR_RVA 0x806c60u
static const BYTE ENERGY_CAPS_ACCESSOR_HEAD[7] = { 0x8D, 0x81, 0x7C, 0x06, 0x00, 0x00, 0xC3 };

/** The pool itself, in the player. */
#define ENERGY_FIELD 0x638u
/** The four numbers the ceiling is made of, and the flag that follows them. */
#define ENERGY_CAPS_FIELD 0x67cu
#define ENERGY_CAP_TERMS 4
/** Where a player hands over its heroes: `{ begin, end }`, four bytes apiece. */
#define VT_PLAYER_HEROES 0xC0u

#define DETOUR_LEN 5
#define MAX_ROWS 64
/** Members of one set. The game's longest is eight (the Dragonish). */
#define MAX_MEMBERS 12

typedef void *(__thiscall *WornFn)(void *hero);
typedef void *(__thiscall *HeroesFn)(void *player);
typedef int(__thiscall *CountEquippedFn)(void *worn, int artifactId);
typedef int(__fastcall *RaiseFn)(void *hero);
typedef int(__fastcall *CostFn)(void *hero, void *what);
typedef void(__fastcall *PlayerFn)(void *player);
typedef void *(__fastcall *CapsFn)(void *player);

static CountEquippedFn g_countEquipped = NULL;

// ---------------------------------------------------------------------------
// Config: one row per term we add. Written by the editor, read here.
//
//   # comment
//   necromancy artifact 97 30        <- artifact 97 worn, +30% raised
//   energy set 2 150 97 98 99        <- any 2 of those three worn, +150 energy
//
// Deliberately a flat text file: it is generated by one program and read by
// another, and when something does not work the first question is what it
// actually says.

/**
 * Which sum a row belongs to. One place in the executable per entry.
 *
 * `necromancy` is a HERO's — the engine asks about one hero and the row is
 * answered for that hero. `energy` is a PLAYER's, so its rows are answered for
 * every hero of theirs and added up, the way another Amplifier would be.
 */
typedef enum { STAT_NECROMANCY = 0, STAT_ENERGY = 1, STAT_COUNT = 2 } Stat;

static const char *const STAT_NAMES[STAT_COUNT] = { "necromancy", "energy" };

/**
 * One term: while these artifacts are worn, add this much.
 *
 * A single artifact and a whole set are the same row with a different count.
 * The set is counted HERE rather than asked of the engine on purpose: the
 * hero's set accessor answers 0 for an effect of ours (the game draws the set
 * on the hero screen from data, which is a different reader), so a set that
 * only the executable can recognise would never combine. Counting our own
 * members through `CountEquipped` needs nothing of ours to be reachable, and
 * the threshold becomes our number instead of one compiled into an effect.
 */
typedef struct {
  int stat;
  int members[MAX_MEMBERS];
  int memberCount;
  int threshold; /**< pieces worn, at least this many */
  int amount;    /**< percentage points, or energy */
} Row;

static Row g_rows[MAX_ROWS];
static int g_rowCount = 0;

static RaiseFn g_original = NULL;
static CostFn g_originalCost = NULL;
static PlayerFn g_originalRefill = NULL;
static PlayerFn g_originalRecalc = NULL;

/** Whether any row wants that sum — nothing is hooked for a stat with no rows. */
static int rows_for(int stat) {
  for (int i = 0; i < g_rowCount; i++) if (g_rows[i].stat == stat) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Small helpers, since there is no CRT.

/** Append text to the log beside the DLL. Silent if it cannot. */
static void log_line(const char *text);

static void num_to_dec(int v, char *out, int *len) {
  char tmp[12];
  int n = 0, neg = v < 0;
  unsigned u = neg ? (unsigned)(-v) : (unsigned)v;
  if (!u) tmp[n++] = '0';
  while (u) { tmp[n++] = (char)('0' + u % 10); u /= 10; }
  int i = 0;
  if (neg) out[i++] = '-';
  while (n) out[i++] = tmp[--n];
  *len = i;
}

/**
 * Match `word` at `p` and step past it and its spaces. Returns 0 if it is not
 * there, leaving `p` where it was — so a line can be tried against several.
 */
static int take_word(const char **p, const char *end, const char *word) {
  const char *s = *p;
  while (s < end && (*s == ' ' || *s == '\t')) s++;
  int i = 0;
  while (word[i]) {
    if (s + i >= end || s[i] != word[i]) return 0;
    i++;
  }
  // A prefix is not a word: `energy` must not match `energykeeper`.
  if (s + i < end && s[i] != ' ' && s[i] != '\t' && s[i] != '\r') return 0;
  *p = s + i;
  return 1;
}

/** Read one decimal from `p`, advancing it. Returns 0 when there was none. */
static int read_int(const char **p, const char *end, int *out) {
  const char *s = *p;
  while (s < end && (*s == ' ' || *s == '\t')) s++;
  int neg = 0;
  if (s < end && (*s == '-' || *s == '+')) { neg = *s == '-'; s++; }
  if (s >= end || *s < '0' || *s > '9') return 0;
  int v = 0;
  while (s < end && *s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
  *out = neg ? -v : v;
  *p = s;
  return 1;
}

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

static void log_line(const char *text) {
  WCHAR path[MAX_PATH];
  beside_us(L"homm5-editor.log", path);
  HANDLE h = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  int len = 0;
  while (text[len]) len++;
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

// ---------------------------------------------------------------------------
// Reading the config.

static void load_config(void) {
  WCHAR path[MAX_PATH];
  beside_us(L"homm5-editor-effects.txt", path);
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) { log_line("no config beside the dll - nothing to add"); return; }

  char buf[8192];
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

    //   <stat> artifact <id> <amount>
    //   <stat> set <worn> <amount> <id> <id> …
    Row r;
    const char *q = line;
    r.stat = -1;
    for (int s = 0; s < STAT_COUNT; s++) {
      if (take_word(&q, stop, STAT_NAMES[s])) { r.stat = s; break; }
    }
    if (r.stat < 0) continue;

    r.memberCount = 0;
    if (take_word(&q, stop, "artifact")) {
      r.threshold = 1;
      if (!read_int(&q, stop, &r.members[0])) continue;
      if (!read_int(&q, stop, &r.amount)) continue;
      r.memberCount = 1;
    } else if (take_word(&q, stop, "set")) {
      if (!read_int(&q, stop, &r.threshold)) continue;
      if (!read_int(&q, stop, &r.amount)) continue;
      // Members to the end of the line. The trailing `# name` stops this by
      // simply not being a number, which is why the writer puts it last.
      while (r.memberCount < MAX_MEMBERS && read_int(&q, stop, &r.members[r.memberCount])) {
        r.memberCount++;
      }
    } else {
      continue;
    }
    // A row with nothing to count, or one that needs more pieces than it names,
    // can never fire; dropping it here keeps the log honest about what is live.
    if (!r.memberCount || r.threshold > r.memberCount) continue;
    if (r.threshold < 1) r.threshold = 1;
    if (g_rowCount < MAX_ROWS) g_rows[g_rowCount++] = r;
  }
  log_num("config rows: ", g_rowCount);
}

// ---------------------------------------------------------------------------
// The added term.

/**
 * How many calls still say what they saw.
 *
 * Bounded because this runs whenever the game wants the percentage and a log
 * that grows without end is its own problem — but the first few are worth
 * having: "the hook is installed" and "the hook adds something" are different
 * claims, and only the second one explains a number on screen.
 */
static int g_traceLeft = 24;

/**
 * What one hero adds to one sum.
 *
 * The collection of what the hero is WEARING comes from its own vtable, the way
 * the engine fetches it in the necromancy sum for the Necromancer's Pendant —
 * so a piece in the backpack does not count, which is the whole meaning of
 * "worn" and costs us no check of our own.
 */
static int hero_term(void *hero, int stat, int trace) {
  if (!hero || !g_countEquipped) return 0;
  void **vtable = *(void ***)hero;
  void *worn = ((WornFn)vtable[VT_WORN_ARTIFACTS / 4])(hero);
  if (!worn) return 0;
  int added = 0;
  for (int i = 0; i < g_rowCount; i++) {
    if (g_rows[i].stat != stat) continue;
    int have = 0;
    for (int m = 0; m < g_rows[i].memberCount; m++) have += g_countEquipped(worn, g_rows[i].members[m]);
    if (trace) {
      log_num("  row of ", g_rows[i].memberCount);
      log_num("    worn ", have);
    }
    if (have >= g_rows[i].threshold) added += g_rows[i].amount;
  }
  return added;
}

/**
 * Whether an object in one of the engine's collections is still there.
 *
 * The four instructions the engine itself runs before touching a hero out of
 * the player's list: a slot can hold a stale handle, and the check is a field
 * read through the object's virtual base rather than a null test.
 */
static int object_alive(void *o) {
  BYTE *p = (BYTE *)o;
  void *table = *(void **)(p + 4);
  if (!table) return 0;
  DWORD adjust = *(DWORD *)((BYTE *)table + 4);
  return *(int *)(p + adjust + 8) >= 0;
}

/**
 * What the whole player adds to the dark energy ceiling.
 *
 * Every hero of theirs, counted and summed — the engine's own hero term two
 * frames up does the same walk for necromancer levels, and an Amplifier adds
 * per building the same way. Pure: it reads and stores nothing, so there is
 * no state to keep in step with a hero dying or an artifact changing hands.
 */
static int player_energy_term(void *player, int trace) {
  if (!player) return 0;
  void **vtable = *(void ***)player;
  void *vec = ((HeroesFn)vtable[VT_PLAYER_HEROES / 4])(player);
  if (!vec) return 0;
  void **begin = ((void ***)vec)[0];
  void **end = ((void ***)vec)[1];
  if (!begin || !end || end < begin) return 0;
  int total = 0;
  for (void **it = begin; it < end; it++) {
    void *hero = *it;
    if (!hero || !object_alive(hero)) continue;
    total += hero_term(hero, STAT_ENERGY, trace);
  }
  return total;
}

/** The ceiling the engine itself arrived at: the four numbers, added up. */
static int engine_energy_cap(void *player) {
  int *caps = (int *)((BYTE *)player + ENERGY_CAPS_FIELD);
  int sum = 0;
  for (int i = 0; i < ENERGY_CAP_TERMS; i++) sum += caps[i];
  return sum;
}

static int g_energyTraceLeft = 24;

/**
 * The weekly refill: the engine fills the pool to its ceiling, we add ours.
 *
 * Adding after it rather than to the ceiling itself is the same shape as the
 * necromancy term — the engine's arithmetic happens untouched and ours follows.
 */
static void __fastcall refill_energy_hook(void *player) {
  g_originalRefill(player);
  if (!player) return;
  int add = player_energy_term(player, g_energyTraceLeft > 0);
  int *energy = (int *)((BYTE *)player + ENERGY_FIELD);
  if (g_energyTraceLeft > 0) {
    g_energyTraceLeft--;
    log_num("refill: engine filled to ", *energy);
    log_num("        we add ", add);
  }
  if (!add) return;
  *energy += add;
  if (*energy < 0) *energy = 0;
}

/**
 * The recalculation, which also clamps the pool DOWN to the engine's ceiling.
 *
 * Here we take nothing away — we stop something being taken away. The engine
 * cuts the pool to a ceiling made of its own four numbers, which is lower than
 * the one the player actually has, so energy WE granted would evaporate at the
 * next hero bought or building raised. Anything above the true ceiling is still
 * cut, because that is the engine's rule and it is right.
 */
static void __fastcall recalc_energy_hook(void *player) {
  if (!player) { g_originalRecalc(player); return; }
  int *energy = (int *)((BYTE *)player + ENERGY_FIELD);
  int before = *energy;
  g_originalRecalc(player);
  if (*energy >= before) return;
  int cap = engine_energy_cap(player) + player_energy_term(player, 0);
  int want = before < cap ? before : cap;
  if (want > *energy) *energy = want;
}

/**
 * What the dark energy bar is handed instead of the player's own four numbers.
 *
 * A COPY, with our term in it. The bar adds the four up and draws the total, so
 * this is the only way a fifth term can appear there — and doing it on a copy
 * means the player's own numbers stay exactly what the engine computed. It also
 * makes the bar answer at once: it recomputes from this on every update, so a
 * piece put on shows up without waiting for the engine's next recalculation.
 *
 * The copies rotate rather than sharing one buffer: the caller uses the pointer
 * immediately, but nothing promises only one is alive at a time.
 */
static int g_capsCopy[8][ENERGY_CAP_TERMS + 1];
static int g_capsAt = 0;

static void *__fastcall energy_caps_hook(void *player) {
  int *real = (int *)((BYTE *)player + ENERGY_CAPS_FIELD);
  int *copy = g_capsCopy[g_capsAt++ & 7];
  for (int i = 0; i <= ENERGY_CAP_TERMS; i++) copy[i] = real[i];
  copy[0] += player_energy_term(player, 0);
  return copy;
}

static int __fastcall raise_percent_hook(void *hero) {
  int total = g_original(hero);
  int added = hero_term(hero, STAT_NECROMANCY, g_traceLeft > 0);
  if (g_traceLeft > 0) {
    g_traceLeft--;
    log_num("raise: engine said ", total);
    log_num("       we add ", added);
  }
  return total + added;
}

/**
 * Dark energy for a raise. Watched, not changed.
 *
 * It is called several times per battle and answers two different questions,
 * which the numbers make obvious once they are beside each other: a `2` is what
 * ONE skeleton costs, and the large value is the WHOLE offered raise. Divide
 * and you have the count — and against the percentage we add, that count came
 * out as `floor(0.75 x percent)` across four battles, which is a percentage
 * behaving like one.
 *
 * The second argument is a pointer, not a number: it reads as ~0x1a40_0000,
 * which is a heap address rather than any creature's power. Named `what`
 * because what it points AT is not established, and a wrong name in a log is
 * worse than no name.
 */
static int g_costTraceLeft = 24;

static int __fastcall raise_cost_hook(void *hero, void *what) {
  int cost = g_originalCost(hero, what);
  if (g_costTraceLeft > 0) {
    g_costTraceLeft--;
    log_num("cost: dark energy ", cost);
  }
  return cost;
}

// ---------------------------------------------------------------------------
// Installing it.

/**
 * Overwrite the first five bytes with a jump to us, and keep a trampoline that
 * runs those bytes and jumps back.
 *
 * The five are a whole number of instructions in this build, which is checked
 * before anything is written: a detour that splits an instruction corrupts the
 * function rather than replacing it, and the crash lands somewhere else
 * entirely.
 */
static void *detour(DWORD rva, const BYTE *head, void *hook, const char *what) {
  // The RVA, added to wherever the loader actually put the image — the game's
  // preferred base is 0x400000 but nothing guarantees it got that one.
  BYTE *target = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < DETOUR_LEN; i++) {
    if (target[i] != head[i]) {
      char msg[96];
      int n = 0;
      while (what[n] && n < 60) { msg[n] = what[n]; n++; }
      const char *tail = ": the bytes are not the ones we know - not hooking";
      int j = 0;
      while (tail[j]) msg[n + j] = tail[j], j++;
      msg[n + j] = 0;
      log_line(msg);
      return NULL;
    }
  }

  BYTE *tramp = (BYTE *)VirtualAlloc(NULL, 32, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!tramp) { log_line("no memory for the trampoline"); return NULL; }
  for (int i = 0; i < DETOUR_LEN; i++) tramp[i] = target[i];
  tramp[DETOUR_LEN] = 0xE9;
  *(DWORD *)(tramp + DETOUR_LEN + 1) =
      (DWORD)(target + DETOUR_LEN) - (DWORD)(tramp + DETOUR_LEN + 5);

  DWORD old = 0;
  if (!VirtualProtect(target, DETOUR_LEN, PAGE_EXECUTE_READWRITE, &old)) {
    log_line("could not make the code writable");
    return NULL;
  }
  target[0] = 0xE9;
  *(DWORD *)(target + 1) = (DWORD)hook - ((DWORD)target + 5);
  VirtualProtect(target, DETOUR_LEN, old, &old);
  FlushInstructionCache(GetCurrentProcess(), target, DETOUR_LEN);
  return tramp;
}

/**
 * Point the ONE dword that names `fn` at `to` instead — a virtual slot.
 *
 * No code is written: a vtable is a table of pointers, and replacing an entry
 * is how the engine itself would swap an implementation. It is only done when
 * the image holds exactly one such pointer and the function it names begins
 * with the bytes we expect; two candidates mean this is not the slot we mapped
 * and the safe thing is to leave the game alone.
 */
static int replace_vtable_entry(DWORD rva, const BYTE *head, int headLen, void *to, const char *what) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *target = base + rva;
  for (int i = 0; i < headLen; i++) {
    if (target[i] != head[i]) {
      log_line("the accessor bytes are not the ones we know - not replacing");
      return 0;
    }
  }

  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_SECTION_HEADER *section = IMAGE_FIRST_SECTION(nt);
  void **found = NULL;
  int hits = 0;
  for (WORD s = 0; s < nt->FileHeader.NumberOfSections; s++, section++) {
    // Data only. A vtable lives in read-only data, and scanning code would
    // find an immediate that merely looks like this pointer.
    if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE) continue;
    if (!(section->Characteristics & IMAGE_SCN_MEM_READ)) continue;
    BYTE *from = base + section->VirtualAddress;
    DWORD size = section->Misc.VirtualSize;
    for (DWORD off = 0; off + 4 <= size; off += 4) {
      void **slot = (void **)(from + off);
      if (*slot == (void *)target) { found = slot; hits++; }
    }
  }
  if (hits != 1) {
    log_num("the accessor is named by this many pointers, expected 1: ", hits);
    return 0;
  }

  DWORD old = 0;
  if (!VirtualProtect(found, sizeof(void *), PAGE_READWRITE, &old)) {
    log_line("could not make the vtable writable");
    return 0;
  }
  *found = to;
  VirtualProtect(found, sizeof(void *), old, &old);
  log_line(what);
  return 1;
}

/** The dark energy ceiling: two detours and one replaced slot. */
static int install_energy(void) {
  g_originalRefill = (PlayerFn)detour(REFILL_ENERGY_RVA, REFILL_ENERGY_HEAD, &refill_energy_hook, "energy refill");
  if (!g_originalRefill) return 0;
  // Without this one the engine takes back what the refill gave, the next time
  // anything makes it recompute — so it is not optional.
  g_originalRecalc = (PlayerFn)detour(RECALC_ENERGY_RVA, RECALC_ENERGY_HEAD, &recalc_energy_hook, "energy recalc");
  if (!g_originalRecalc) return 0;
  // The bar. A failure here leaves the pool right and the number under it
  // short, which is worth saying out loud but not worth refusing to run for.
  replace_vtable_entry(ENERGY_CAPS_ACCESSOR_RVA, ENERGY_CAPS_ACCESSOR_HEAD,
                       sizeof ENERGY_CAPS_ACCESSOR_HEAD, &energy_caps_hook, "energy bar shows our term");
  return 1;
}

/** The necromancy percentage: one detour, plus the cost we only watch. */
static int install_necromancy(void) {
  g_original = (RaiseFn)detour(RAISE_PERCENT_RVA, RAISE_PERCENT_HEAD, &raise_percent_hook, "raise percent");
  if (!g_original) return 0;
  // Watching only, and a failure here is not fatal: the percentage is the part
  // that has to work.
  g_originalCost = (CostFn)detour(RAISE_COST_RVA, RAISE_COST_HEAD, &raise_cost_hook, "raise cost");
  return 1;
}

/** Every hook the config asks for. A stat with no rows is not hooked at all. */
static int install_hooks(void) {
  // Read by address, never written — but a wrong one would be CALLED with a
  // live object, so it is checked the same way as the ones we overwrite. Every
  // stat goes through it, so nothing is installed if it is not what we expect.
  BYTE *counter = (BYTE *)GetModuleHandleW(NULL) + COUNT_EQUIPPED_RVA;
  for (int i = 0; i < 5; i++) {
    if (counter[i] != COUNT_EQUIPPED_HEAD[i]) {
      log_line("the bytes at CountEquipped are not the ones we know - not hooking");
      return 0;
    }
  }
  g_countEquipped = (CountEquippedFn)counter;

  int installed = 0;
  if (rows_for(STAT_NECROMANCY) && install_necromancy()) {
    log_line("necromancy hook installed");
    installed++;
  }
  if (rows_for(STAT_ENERGY) && install_energy()) {
    log_line("dark energy hooks installed");
    installed++;
  }
  return installed;
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(self);
  find_our_dir(self);
  log_line("--- homm5-editor extension loaded");
  load_config();
  if (g_rowCount) install_hooks();
  return TRUE;
}

/** So the import that loads us has something to name. */
__declspec(dllexport) int homm5_editor_present(void) { return 1; }
