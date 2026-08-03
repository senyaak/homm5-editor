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
// data"; ours is the same shape with our set and our number. The dark energy
// ceiling is the same again, one object up. And the first aid tent, which is
// where a SPECIALIZATION of ours enters — the same bargain one rung down: an
// enum value the executable has never heard of, and a term added where the
// engine sums its own.
//
// WHAT ASKS FOR A TERM. Three subjects, one shape: an artifact (or a set of
// them) answered by `CountEquipped`, a specialization answered by
// `HasSpecialization`, and a SKILL answered by the hero's `GetSkillMastery`.
// Each is a value the executable was never built with, and each is asked about
// through a question it already knows how to answer — so adding a subject costs
// a config row and a virtual call, while adding a SUM still costs a detour.
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
/**
 * `GetSkillMastery(skillId)` — 0 when he does not have it, 1…4 when he does.
 *
 * The one slot every question about a hero's skills goes through: the Lua
 * `HasHeroSkill` calls it and tests the result against zero, and
 * `GetHeroSkillMastery` returns it as it is (0x5d1656 and 0x5d18b6, the same
 * three instructions apiece). On the hero's PRIMARY vtable, the one the worn
 * artifacts come from — no virtual base adjustment, unlike the tent's questions.
 */
#define VT_SKILL_MASTERY 0x174u
/** `CountEquipped(collection, artifactId)`, and the bytes that say it is. */
#define COUNT_EQUIPPED_RVA 0x74c270u
static const BYTE COUNT_EQUIPPED_HEAD[5] = { 0x53, 0x8B, 0x19, 0x56, 0x57 };

// ---------------------------------------------------------------------------
// The first aid tent — where a SPECIALIZATION of ours enters the arithmetic.
//
// WHAT THE TENT IS WORTH, and the only place it is decided:
//
//   amount = { 10, 20, 50, 100 }[war machines mastery]
//          + 5 * hero level, if his specialization is HERO_SPEC_EMPIRIC (36)
//
// Read off the code at 0x77fca0: a four-case jump table writing the constants,
// then `push 24h; call [vtable+294h]` — "does this hero hold specialization 36"
// — and inside that branch `lea eax,[eax+eax*4]`, which is the ×5.
//
// Two things about it are worth keeping, because each cost a run to learn. The
// number a mastery produces is an INDEX into that table and nothing more, so
// multiplying it walks off the end and the engine falls back to a constant —
// the tent BREAKS rather than strengthens. And the prediction the tooltip shows
// is computed by different code than the effect, so only the battle log says
// what happened.
//
// Both of the tent's spells come through this one number: `GetSpellPower` at
// 0x9c96d0 answers for machine type 3 with the owner's War Machines mastery for
// the heal (0xBD) and for the plague (0x160) alike — which is what the shipped
// Empiric text claims in words. So one term of ours reaches both, and the perk
// whose identifier reads `LAST_AID` and whose name in game is «Чумная палатка»
// needs nothing of its own.
//
// Signature, from the call site at 0xb82d16: two out-parameters in ecx and edx,
// then the unit and the mastery on the stack. Its first five bytes are two
// whole instructions, so an ordinary detour fits.
#define TENT_AMOUNT_RVA 0x77fca0u
static const BYTE TENT_AMOUNT_HEAD[5] = { 0x8B, 0x44, 0x24, 0x08, 0x56 };

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
// bar asks. See docs/engineInternals/NECROMANCY.md.

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

// ---------------------------------------------------------------------------
// Functions of our own, callable from a map's Lua.
//
// The engine hands Lua 306 functions out of seven `{name, function}` tables in
// .data. The tables are packed with no slack, so nothing can be appended in
// place — but each one is reached through a tiny accessor of its own,
// `mov eax,<table>; ret`, and the adventure map's is the only one we need. So
// the whole mechanism is: copy their table, add our rows, and rewrite the four
// bytes of that immediate. No detour, no trampoline, and the engine's own 99
// functions are the first 99 entries of the copy — untouched, in order.
//
// A registered function is `__fastcall(void *ctx)`: the call context arrives in
// ecx and the result is a handle returned in eax, or 0. Every shipped one
// returns 0 on a path it cannot serve (no adventure map, bad argument), so 0 is
// a value the caller is known to tolerate.

/**
 * `GetPlayerNecroEnergy`, the engine's own Lua function.
 *
 * We CALL it rather than reimplement it. It already parses the player argument
 * the way every other function does, complains in the same words when the
 * number is out of range, walks the world to the player and asks for the pool.
 * That last step goes through the player's vtable — the slot below — so a
 * replacement in that slot sees the player the lookup found, which is the one
 * thing we need and the one thing a Lua function cannot be handed.
 */
#define LUA_GET_NECRO_ENERGY_RVA 0x1e2ce0u
/** `mov eax,[ecx+638h]; ret` — the pool getter, vtable +0x1fc. */
#define ENERGY_GETTER_RVA 0x806c50u
static const BYTE ENERGY_GETTER_HEAD[7] = { 0x8B, 0x81, 0x38, 0x06, 0x00, 0x00, 0xC3 };
/** Where a player refills its own pool to the ceiling — the weekly grant. */
#define VT_PLAYER_REFILL 0x214u

/** `mov eax,<adventure-map table>; ret`, and the two bytes that say it is. */
#define LUA_TABLE_ACCESSOR_RVA 0x1ce710u
#define LUA_MOV_EAX_IMM 0xB8
#define LUA_RET 0xC3
/** How many of ours can be added. Room to grow; the table is ours to size. */
#define MAX_LUA_FUNCTIONS 8

/** One row of a registration table, exactly as the engine lays it out. */
typedef struct {
  const char *name;
  void *fn;
} LuaEntry;

typedef void *(__fastcall *LuaFn)(void *ctx);

/** The jump we write. The head we DISPLACE can be longer — see `detour`. */
#define DETOUR_LEN 5
/** As much of a head as a trampoline has room for, jump home included. */
#define MAX_HEAD_LEN 16
#define MAX_ROWS 64
/** Members of one set. The game's longest is eight (the Dragonish). */
#define MAX_MEMBERS 12

typedef void *(__thiscall *WornFn)(void *hero);
typedef void *(__thiscall *HeroesFn)(void *player);
typedef int(__thiscall *CountEquippedFn)(void *worn, int artifactId);
typedef int(__thiscall *SkillMasteryFn)(void *hero, int skillId);
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
//   necromancy skill 221 5           <- skill 221 held, +5% for each of its
//                                       four mastery levels
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
 * `tent_charges` is a hero's again, asked once when his first aid tent is built
 * for a battle.
 */
typedef enum { STAT_NECROMANCY = 0, STAT_ENERGY = 1, STAT_TENT_CHARGES = 2, STAT_COUNT = 3 } Stat;

static const char *const STAT_NAMES[STAT_COUNT] = { "necromancy", "energy", "tent_charges" };

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

/**
 * One term a SKILL of ours adds: this much for each level of mastery held.
 *
 * Not a Row with different words — nothing is worn and nothing is counted. The
 * subject is a value of the `HeroSkill` enum the executable was not built with,
 * and the question we ask about it is the hero's own `GetSkillMastery`, so no
 * id of ours has to be reachable from the code. It enters the same sums a Row
 * does because it is asked in the same place: `necromancy` for the one hero,
 * `energy` for every hero of the player.
 */
typedef struct {
  int stat;
  int skill;
  int amountPerMastery;
} SkillRow;

#define MAX_SKILL_ROWS 32
static SkillRow g_skillRows[MAX_SKILL_ROWS];
static int g_skillRowCount = 0;

/**
 * Which sum a SPECIALIZATION row belongs to. One so far, and one place in the
 * executable behind it: the first aid tent's amount.
 */
typedef enum { SPEC_STAT_TENT = 0, SPEC_STAT_COUNT = 1 } SpecStat;

static const char *const SPEC_STAT_NAMES[SPEC_STAT_COUNT] = { "tent" };

/**
 * One term a specialization adds: while a hero holds this value, add this many
 * percent of the engine's own number for every level he has.
 *
 * Nothing is worn and nothing is counted, which is why it is not a Row with
 * different words. The subject is a value of the `HeroSpecialization` enum —
 * a number the executable has never heard of, since every shipped one is
 * compiled against a literal — and the question we ask about it is the engine's
 * own `HasSpecialization`, so no id of ours has to be reachable from the code.
 */
typedef struct {
  int stat;
  int specialization;
  int percentPerLevel;
} SpecRow;

#define MAX_SPEC_ROWS 16
static SpecRow g_specRows[MAX_SPEC_ROWS];
static int g_specRowCount = 0;

static RaiseFn g_original = NULL;
static CostFn g_originalCost = NULL;
static PlayerFn g_originalRefill = NULL;
static PlayerFn g_originalRecalc = NULL;

/** Whether any row wants that sum — nothing is hooked for a stat with no rows. */
static int rows_for(int stat) {
  for (int i = 0; i < g_rowCount; i++) if (g_rows[i].stat == stat) return 1;
  for (int i = 0; i < g_skillRowCount; i++) if (g_skillRows[i].stat == stat) return 1;
  return 0;
}

/** Is this address inside the executable's code? A wrong slot is not called. */
static int points_at_code(void *fn);

// ---------------------------------------------------------------------------
// Small helpers, since there is no CRT.

/** Append text to the log beside the DLL. Silent if it cannot. */
static void log_line(const char *text);
/** Whether `n` bytes at `p` can be read without taking the process down. */
static int readable(const void *p, SIZE_T n);
/** Whether an address is inside the executable's code — a wrong slot is not called. */
static int points_at_code(void *fn);

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
    //   <stat> specialization <value> <percent per hero level>
    //
    // The specialization rows are tried FIRST and against their own stat names:
    // they share nothing with the artifact rows but the file, and a line that
    // belongs to neither grammar is skipped by both.
    {
      const char *q = line;
      SpecRow s;
      s.stat = -1;
      for (int i = 0; i < SPEC_STAT_COUNT; i++) {
        if (take_word(&q, stop, SPEC_STAT_NAMES[i])) { s.stat = i; break; }
      }
      if (s.stat >= 0) {
        if (!take_word(&q, stop, "specialization")) continue;
        if (!read_int(&q, stop, &s.specialization)) continue;
        if (!read_int(&q, stop, &s.percentPerLevel)) continue;
        if (s.specialization < 0 || !s.percentPerLevel) continue;
        if (g_specRowCount < MAX_SPEC_ROWS) g_specRows[g_specRowCount++] = s;
        continue;
      }
    }

    Row r;
    const char *q = line;
    r.stat = -1;
    for (int s = 0; s < STAT_COUNT; s++) {
      if (take_word(&q, stop, STAT_NAMES[s])) { r.stat = s; break; }
    }
    if (r.stat < 0) continue;

    // A skill row shares the stat names with the artifact rows — it enters the
    // same sums — so it is recognised here, after the stat and before the two
    // shapes that count something worn.
    if (take_word(&q, stop, "skill")) {
      SkillRow k;
      k.stat = r.stat;
      if (!read_int(&q, stop, &k.skill)) continue;
      if (!read_int(&q, stop, &k.amountPerMastery)) continue;
      if (k.skill < 0 || !k.amountPerMastery) continue;
      if (g_skillRowCount < MAX_SKILL_ROWS) g_skillRows[g_skillRowCount++] = k;
      continue;
    }

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
  log_num("skill rows: ", g_skillRowCount);
  log_num("specialization rows: ", g_specRowCount);
}

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
  QOL_COUNT = 5
} QolFlag;

static const char *const QOL_NAMES[QOL_COUNT] = {
  "borderless", "own-profile", "quick-split", "stack-health-bar", "stack-losses"
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
  // Every read guarded, every slot checked. The two older callers hand over a
  // hero the engine just gave them and could do without this; the tent charges
  // reach for one at a moment nothing promises there is one, and an unguarded
  // walk from there is what killed a battle before the log could say a word.
  if (!readable(hero, 4)) return 0;
  void **vtable = *(void ***)hero;
  if (!readable(vtable, VT_SKILL_MASTERY + 4)) return 0;
  int added = 0;

  if (g_countEquipped && points_at_code(vtable[VT_WORN_ARTIFACTS / 4])) {
    void *worn = ((WornFn)vtable[VT_WORN_ARTIFACTS / 4])(hero);
    if (worn) {
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
    }
  }

  // And what his SKILLS add to the same sum. The same slot the engine's own Lua
  // goes through, asked the same way — nothing is looked up by address, and a
  // slot that does not point at code is not called.
  if (g_skillRowCount) {
    void *masteryFn = vtable[VT_SKILL_MASTERY / 4];
    if (points_at_code(masteryFn)) {
      for (int i = 0; i < g_skillRowCount; i++) {
        if (g_skillRows[i].stat != stat) continue;
        int mastery = ((SkillMasteryFn)masteryFn)(hero, g_skillRows[i].skill);
        // Whatever the engine answers above the four levels it names is not
        // ours to interpret, and multiplying by it would be a bonus nobody
        // asked for; clamped rather than trusted.
        if (mastery < 0) mastery = 0;
        if (mastery > 4) mastery = 4;
        if (trace) {
          log_num("  skill ", g_skillRows[i].skill);
          log_num("    mastery ", mastery);
        }
        added += g_skillRows[i].amountPerMastery * mastery;
      }
    }
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
 * Overwrite the head of a function with a jump to us, and keep a trampoline
 * that runs the bytes we displaced and jumps back.
 *
 * `headLen` is how many bytes the trampoline takes, and it must be a WHOLE
 * number of instructions — five is only the size of the jump. A detour that
 * splits an instruction corrupts the function rather than replacing it, and the
 * crash lands somewhere else entirely, so the caller counts the boundary out of
 * a disassembly and the bytes are compared before anything is written.
 *
 * Only relocatable heads: nothing displaced may be a `call`/`jmp rel32`, whose
 * meaning is its distance from where it sits.
 */
static void *detour_relocated(DWORD rva, const BYTE *head, const BYTE *skip, int headLen,
                              void *hook, const char *what);

/** A detour where every byte of the head is the compiler's, not the loader's. */
static void *detour(DWORD rva, const BYTE *head, int headLen, void *hook, const char *what) {
  return detour_relocated(rva, head, NULL, headLen, hook, what);
}

/**
 * As `detour`, but with the bytes that the LOADER may have rewritten skipped.
 *
 * An instruction naming an absolute address carries that address in its
 * operand, and relocation rewrites the operand wherever the image did not get
 * its preferred base. Those bytes are still copied to the trampoline — the copy
 * takes what is actually there — but comparing them against what the
 * disassembly said would refuse a function that is perfectly correct. `skip`
 * marks them: non-zero means "this byte is the loader's business, not ours".
 */
static void *detour_relocated(DWORD rva, const BYTE *head, const BYTE *skip, int headLen,
                              void *hook, const char *what) {
  // The RVA, added to wherever the loader actually put the image — the game's
  // preferred base is 0x400000 but nothing guarantees it got that one.
  BYTE *target = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < headLen; i++) {
    if (skip && skip[i]) continue;
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

  if (headLen < DETOUR_LEN || headLen > MAX_HEAD_LEN) {
    log_line("the head to displace is not a length we can take - not hooking");
    return NULL;
  }

  BYTE *tramp = (BYTE *)VirtualAlloc(NULL, 32, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!tramp) { log_line("no memory for the trampoline"); return NULL; }
  for (int i = 0; i < headLen; i++) tramp[i] = target[i];
  tramp[headLen] = 0xE9;
  *(DWORD *)(tramp + headLen + 1) = (DWORD)(target + headLen) - (DWORD)(tramp + headLen + 5);

  DWORD old = 0;
  if (!VirtualProtect(target, headLen, PAGE_EXECUTE_READWRITE, &old)) {
    log_line("could not make the code writable");
    return NULL;
  }
  target[0] = 0xE9;
  *(DWORD *)(target + 1) = (DWORD)hook - ((DWORD)target + DETOUR_LEN);
  // What is left of the head is never reached — the jump leaves before it — but
  // a patched image that disassembles cleanly is worth five bytes of nothing.
  for (int i = DETOUR_LEN; i < headLen; i++) target[i] = 0x90;
  VirtualProtect(target, headLen, old, &old);
  FlushInstructionCache(GetCurrentProcess(), target, headLen);
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

typedef int(__thiscall *EnergyGetterFn)(void *player);
typedef void(__thiscall *RefillFn)(void *player);

static EnergyGetterFn g_energyGetter = NULL;
/** Set while the engine's lookup runs, so the getter knows to say who it read. */
static int g_capturing = 0;
static void *g_capturedPlayer = NULL;

/** The pool getter, replaced in the vtable: passes through, and reports. */
static int __fastcall energy_getter_hook(void *player) {
  if (g_capturing) g_capturedPlayer = player;
  return g_energyGetter(player);
}

/** The dark energy ceiling: two detours and one replaced slot. */
static int install_energy(void) {
  g_originalRefill = (PlayerFn)detour(REFILL_ENERGY_RVA, REFILL_ENERGY_HEAD, 5, &refill_energy_hook, "energy refill");
  if (!g_originalRefill) return 0;
  // Without this one the engine takes back what the refill gave, the next time
  // anything makes it recompute — so it is not optional.
  g_originalRecalc = (PlayerFn)detour(RECALC_ENERGY_RVA, RECALC_ENERGY_HEAD, 5, &recalc_energy_hook, "energy recalc");
  if (!g_originalRecalc) return 0;
  // The bar. A failure here leaves the pool right and the number under it
  // short, which is worth saying out loud but not worth refusing to run for.
  replace_vtable_entry(ENERGY_CAPS_ACCESSOR_RVA, ENERGY_CAPS_ACCESSOR_HEAD,
                       sizeof ENERGY_CAPS_ACCESSOR_HEAD, &energy_caps_hook, "energy bar shows our term");
  return 1;
}

/**
 * The pool getter, so `RestoreDarkEnergy` can see which player was found.
 *
 * Installed whether or not any row asks for energy: the Lua function is offered
 * to scripts regardless, and it is useless without this. A pass-through costs
 * one comparison on a getter that reads one field.
 */
static int install_energy_getter(void) {
  BYTE *original = (BYTE *)GetModuleHandleW(NULL) + ENERGY_GETTER_RVA;
  for (int i = 0; i < (int)sizeof ENERGY_GETTER_HEAD; i++) {
    if (original[i] != ENERGY_GETTER_HEAD[i]) {
      log_line("the energy getter is not the shape we know - RestoreDarkEnergy will not work");
      return 0;
    }
  }
  g_energyGetter = (EnergyGetterFn)original;
  return replace_vtable_entry(ENERGY_GETTER_RVA, ENERGY_GETTER_HEAD, sizeof ENERGY_GETTER_HEAD,
                              &energy_getter_hook, "energy getter reports which player was read");
}

// ---------------------------------------------------------------------------
// Registering our own Lua functions.

/**
 * The proof that this works at all: say so in the log, and nothing else.
 *
 * Kept after the thing it proved started working, because "the extension is
 * loaded" and "the game's Lua can reach it" are different claims and only the
 * second one explains why a script does nothing.
 */
static void *__fastcall lua_editor_test(void *ctx) {
  (void)ctx;
  log_line("lua: EditorTest() was called from a script");
  return NULL;
}

// --- RestoreDarkEnergy(player) ----------------------------------------------
//
// What Lua could never do: put dark energy back. There is no setter because the
// engine does not set the pool — it fills it to a ceiling — so "restore" here
// means asking the player to do its own weekly refill, out of turn. Our ceiling
// term rides along, because that refill is one of the calls we already extend.
//
// The player is found by CALLING the engine's own `GetPlayerNecroEnergy` and
// watching where it lands: its last step reads the pool through the player's
// vtable, and that slot is ours, so the player it found arrives as `this`. That
// is one address instead of the service locator, the world walk, the argument
// parser and its two heap strings — none of which we would be reimplementing,
// only copying badly.

static int g_restoreTraceLeft = 24;

static void *__fastcall lua_restore_dark_energy(void *ctx) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  g_capturedPlayer = NULL;
  g_capturing = 1;
  // Its own error reporting stands: a bad player number is refused in the words
  // every other function of the engine's uses, before we are ever involved.
  void *result = ((LuaFn)(base + LUA_GET_NECRO_ENERGY_RVA))(ctx);
  g_capturing = 0;

  void *player = g_capturedPlayer;
  if (!player) {
    log_line("RestoreDarkEnergy: no player was reached - nothing restored");
    return result;
  }
  int before = *(int *)((BYTE *)player + ENERGY_FIELD);
  void **vtable = *(void ***)player;
  ((RefillFn)vtable[VT_PLAYER_REFILL / 4])(player);
  if (g_restoreTraceLeft > 0) {
    g_restoreTraceLeft--;
    log_num("RestoreDarkEnergy: was ", before);
    log_num("                   now ", *(int *)((BYTE *)player + ENERGY_FIELD));
  }
  return result;
}

static LuaEntry g_ourFunctions[MAX_LUA_FUNCTIONS] = {
  { "EditorTest", &lua_editor_test },
  { "RestoreDarkEnergy", &lua_restore_dark_energy },
};
static int g_ourFunctionCount = 2;

/**
 * Give the engine a table of our own: theirs, plus ours, plus the terminator.
 *
 * The four bytes rewritten are the accessor's immediate, and the address that
 * was in them is where the engine's own table is — read rather than assumed, so
 * a build that loads at another base still finds it.
 */
static int install_lua_functions(void) {
  BYTE *accessor = (BYTE *)GetModuleHandleW(NULL) + LUA_TABLE_ACCESSOR_RVA;
  if (accessor[0] != LUA_MOV_EAX_IMM || accessor[5] != LUA_RET) {
    log_line("the lua table accessor is not the shape we know - not registering");
    return 0;
  }

  LuaEntry *theirs = *(LuaEntry **)(accessor + 1);
  int n = 0;
  while (theirs[n].name || theirs[n].fn) n++;

  LuaEntry *ours = (LuaEntry *)VirtualAlloc(
      NULL, (n + g_ourFunctionCount + 1) * sizeof(LuaEntry),
      MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!ours) { log_line("no memory for the lua table"); return 0; }

  for (int i = 0; i < n; i++) ours[i] = theirs[i];
  for (int i = 0; i < g_ourFunctionCount; i++) ours[n + i] = g_ourFunctions[i];
  ours[n + g_ourFunctionCount].name = NULL;
  ours[n + g_ourFunctionCount].fn = NULL;

  DWORD old = 0;
  if (!VirtualProtect(accessor + 1, sizeof(void *), PAGE_EXECUTE_READWRITE, &old)) {
    log_line("could not make the lua accessor writable");
    return 0;
  }
  *(LuaEntry **)(accessor + 1) = ours;
  VirtualProtect(accessor + 1, sizeof(void *), old, &old);
  FlushInstructionCache(GetCurrentProcess(), accessor, 6);

  log_num("lua: the engine's table had ", n);
  log_num("lua: functions of ours added: ", g_ourFunctionCount);
  return 1;
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

// ---------------------------------------------------------------------------
// The first aid tent: the term a specialization of ours adds.

/**
 * The tent's amount, and what we add to it.
 *
 * The two out-parameters are filled by the engine first, so `*amount` on the
 * way back is ITS number — the mastery's table entry, plus five per level if
 * the hero happens to hold Empiric. Ours is a percentage OF that, per level:
 * five percent is Heroes III's Gem, and at expert mastery it comes to exactly
 * what the engine's own specialization gives, because five per level is five
 * percent of a hundred.
 *
 * A percentage of the engine's number rather than of a table of our own, for
 * the same reason every other term here is written that way: the engine does
 * its arithmetic untouched and ours follows, so nothing has to be kept in step
 * with it.
 *
 * IT ALSO LOGS, bounded. Reading numbers off the battle screen and repeating
 * them is how three runs went, and it is where the "5" that really meant
 * "nothing left to heal" cost an evening — so the terms are written down here,
 * where they are known, rather than inferred from what the tent appeared to do.
 */
/** The tent's charges, raised once when it first acts — defined below. */
static void tent_charges_term(void *unit, void *hero);

typedef void(__fastcall *TentAmountFn)(int *amount, int *second, void *unit, int mastery);
static TentAmountFn g_tentAmount = NULL;
static int g_amountLogged = 0;

/** How a combat unit hands over the hero behind it, as the engine asks at 0xb7fcee. */
#define VT_UNIT_OWNER 0x18u
#define VT_OWNER_HERO 0x0Cu
/** `HasSpecialization(id)` — the question the tent asks about Empiric. */
#define VT_HAS_SPECIALIZATION 0x294u
/** The hero's level, as the tent reads it inside that branch. */
#define VT_HERO_LEVEL 0x23Cu

typedef void *(__thiscall *GetterFn)(void *self);
typedef int(__fastcall *HasSpecFn)(void *hero, void *unused, int spec);
typedef int(__thiscall *LevelFn)(void *hero);

/** The hero a combat unit belongs to, reached the way the engine reaches him. */
static void *unit_hero(void *unit) {
  if (!readable(unit, 4)) return NULL;
  void **vt = *(void ***)unit;
  if (!readable(vt, VT_UNIT_OWNER + 4) || !points_at_code(vt[VT_UNIT_OWNER / 4])) return NULL;
  void *owner = ((GetterFn)vt[VT_UNIT_OWNER / 4])(unit);
  if (!readable(owner, 4)) return NULL;
  void **ovt = *(void ***)owner;
  if (!readable(ovt, VT_OWNER_HERO + 4) || !points_at_code(ovt[VT_OWNER_HERO / 4])) return NULL;
  return ((GetterFn)ovt[VT_OWNER_HERO / 4])(owner);
}

/**
 * The hero's OTHER `this` — the one his level and specialization answer on.
 *
 * Both questions the tent asks go through a virtual base rather than the hero's
 * primary vtable, and the engine spells the adjustment out at 0xb7fd00:
 *
 *     ecx = hero + 4 + *(int *)(*(void **)(hero + 4) + 8)
 *
 * Calling those slots on the plain pointer is what crashed the battle: the
 * vtable read there belongs to something else entirely. The rule from
 * docs/ENGINE_INTERNALS.md holds here too — make the call the way the engine
 * makes it, and no address has to be guessed.
 */
static void *hero_virtual_base(void *hero) {
  BYTE *h = (BYTE *)hero;
  void *table = *(void **)(h + 4);
  if (!table) return NULL;
  return h + 4 + *(int *)((BYTE *)table + 8);
}

static int points_at_code(void *fn) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_SECTION_HEADER *s = IMAGE_FIRST_SECTION(nt);
  DWORD rva = (DWORD)((BYTE *)fn - base);
  for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, s++) {
    if (!(s->Characteristics & IMAGE_SCN_MEM_EXECUTE)) continue;
    if (rva >= s->VirtualAddress && rva < s->VirtualAddress + s->Misc.VirtualSize) return 1;
  }
  return 0;
}

static void __fastcall tent_amount_hook(int *amount, int *second, void *unit, int mastery) {
  g_tentAmount(amount, second, unit, mastery);
  int engine = *amount;

  // Whose tent it is, and what he holds. Both questions answer on the virtual
  // base rather than on the hero pointer, and a slot that does not point at
  // code is not called — the two rules that keep this out of the battle's way.
  //
  // A number of zero or less is still LOGGED and only not added to: "the engine
  // said nothing" is one of the answers worth seeing, and a hook that goes
  // quiet in exactly that case is a hook that looks uninstalled.
  // `engine > 0` GUARDS THE WALK, and that is not a shortcut. This function has
  // two call sites, and asking the other one's unit for its owner ends the
  // battle — measured, by removing the test on the grounds that resolving a
  // hero could not hurt. A tent whose amount is nothing is not a tent acting.
  void *hero = engine > 0 ? unit_hero(unit) : NULL;
  tent_charges_term(unit, hero);
  void *self = hero ? hero_virtual_base(hero) : NULL;
  int level = -1, add = 0, matched = -1;
  if (self) {
    void **vt = *(void ***)self;
    void *levelFn = vt[VT_HERO_LEVEL / 4];
    void *specFn = vt[VT_HAS_SPECIALIZATION / 4];
    if (points_at_code(levelFn) && points_at_code(specFn)) {
      level = ((LevelFn)levelFn)(self);
      for (int i = 0; i < g_specRowCount; i++) {
        if (g_specRows[i].stat != SPEC_STAT_TENT) continue;
        if (!((HasSpecFn)specFn)(self, NULL, g_specRows[i].specialization)) continue;
        matched = g_specRows[i].specialization;
        // Truncated, deliberately: the engine's number is an integer and so is
        // what it hands the healing. A first level hero with a basic tent gains
        // nothing, which is what "five percent of ten" comes to.
        add += engine * g_specRows[i].percentPerLevel * level / 100;
      }
    }
  }
  if (add > 0) *amount = engine + add;

  if (g_amountLogged++ >= 24) return;
  log_line("tent:");
  log_num("      mastery       ", mastery);
  log_num("      engine said   ", engine);
  log_num("      hero level    ", level);
  log_num("      our spec      ", matched);
  log_num("      we add        ", add);
  log_num("      amount        ", *amount);
  log_num("      second        ", *second);
  // The two pointers the war machine probe is looking for. This walk is the one
  // that WORKS, so whichever number the constructor also printed is the route
  // from a freshly built machine to its hero.
  log_object("      unit        ", unit);
  log_object("      hero        ", hero);
}

static void install_tent_term(void) {
  // Two reasons want this one hook — a specialization's percentage and a
  // skill's charges — so it is installed once and asked twice.
  if (g_tentAmount) return;
  g_tentAmount = (TentAmountFn)detour(TENT_AMOUNT_RVA, TENT_AMOUNT_HEAD, DETOUR_LEN,
                                      &tent_amount_hook, "first aid tent");
  if (g_tentAmount) log_line("first aid tent hook installed");
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

// ---------------------------------------------------------------------------
// A PROBE, and nothing else: where the first aid tent's charges come from.
//
// The tent spends a counter at CCombatWarMachine +0xB0, filled once by its
// constructor from `CWarMachine::GetShots` — the record's `<Shots>`, three for
// the tent. Three gates read that field DIRECTLY (0xdc9dc8, 0xdc9f06 and the
// spend at 0xdc9f59), so the only hook worth having is the one that fills it,
// and the constructor is where the object exists. See docs/HERO_CLASSES.md.
//
// THE HERO IS AT +0xCC, and that was measured rather than reasoned. The object
// the constructor returns is not the pointer `unit_hero` knows how to walk —
// this class has several bases and each has its own vtable — so the probe that
// came before this printed both pointers into the log and let them meet there:
// one battle, machine 389628672 out of the constructor and unit 389628876 into
// the tent's amount hook. Two hundred and four bytes apart, which is the same
// 0xCC the disassembly writes as `lea ecx,[esi-0CCh]`.
//
// Everything else here is guarded rather than trusted: the reads go through
// `readable`, the virtual calls through `points_at_code`, and a hero we cannot
// reach means no bonus rather than a battle that ends early.
#define MACHINE_CTOR_RVA 0x9c9730u
static const BYTE MACHINE_CTOR_HEAD[5] = { 0x83, 0x7C, 0x24, 0x18, 0x00 };

/** Where the constructor puts the world machine, and the charges it filled. */
#define MACHINE_WORLD 0xA8u
#define MACHINE_CHARGES 0xB0u
/** And the base the engine's own walk to the owner starts from. */
#define MACHINE_AS_UNIT 0xCCu
/** The world machine's type: 3 is the first aid tent. */
#define WORLD_MACHINE_TYPE 0x1Cu
#define MACHINE_TYPE_TENT 3

/**
 * `this` in ecx, the ignored edx of a thiscall, then its SIX stack arguments.
 *
 * Six because the function says so: it ends `ret 18h`, and twenty-four bytes is
 * six dwords. Counting the pushes at the one call site gave five, and being one
 * short cost two crashed battles — the hook cleaned four bytes less than the
 * caller had put there, and the stack was wrong from the first war machine
 * built. Read the arity off the RETURN, never off the call site.
 */
typedef void *(__fastcall *MachineCtorFn)(void *self, void *edx, void *a1, void *a2, void *a3,
                                          void *a4, unsigned a5, void *a6);
static MachineCtorFn g_machineCtor = NULL;
static int g_machineLogged = 0;

/**
 * Tents built and not yet topped up.
 *
 * WHY A LIST INSTEAD OF DOING IT THERE AND THEN. The charges have to be raised
 * per HERO, and the constructor is a place where no hero can be safely asked
 * for: the object is a moment old, nothing promises it has been given an owner,
 * and calling `GetOwner` on it killed the battle before a single line reached
 * the log. Guards do not help — the slot holds a real function, and the fault is
 * inside it.
 *
 * So the constructor only writes down a pointer, which cannot fail, and the
 * raise happens the first time that tent ACTS — in the amount hook below, where
 * the engine hands over a live unit and the hero has been reachable all along.
 * The arithmetic comes out the same either way: the gate has already let the
 * tent act, so three charges plus ours is the same number of uses whether the
 * bonus lands before the first spend or just after it.
 *
 * Eight is far more than a battle needs — one tent a side — and the oldest is
 * dropped rather than growing the list, because a tent that never acted is a
 * tent that never needed the charges.
 */
#define PENDING_TENTS 8
static void *g_pendingTents[PENDING_TENTS];
static int g_pendingAt = 0;

static void *__fastcall machine_ctor_hook(void *self, void *edx, void *a1, void *a2, void *a3,
                                          void *a4, unsigned a5, void *a6) {
  void *m = g_machineCtor(self, edx, a1, a2, a3, a4, a5, a6);
  if (!m || !readable((BYTE *)m + MACHINE_WORLD, 4)) return m;

  void *world = *(void **)((BYTE *)m + MACHINE_WORLD);
  if (!readable((BYTE *)world + WORLD_MACHINE_TYPE, 4)) return m;
  if (*(int *)((BYTE *)world + WORLD_MACHINE_TYPE) != MACHINE_TYPE_TENT) return m;
  if (!readable((BYTE *)m + MACHINE_CHARGES, 4)) return m;

  g_pendingTents[g_pendingAt++ & (PENDING_TENTS - 1)] = m;
  if (g_machineLogged++ >= 8) return m;
  log_line("tent built:");
  log_num("  the engine filled ", *(int *)((BYTE *)m + MACHINE_CHARGES));
  return m;
}

/**
 * The raise, done once, at the first moment this tent is known to be whole.
 *
 * `unit` is the tent's combat object 0xCC bytes along — measured, by printing
 * the constructor's pointer and this one into the same log in the same battle
 * and subtracting. Being on the list is what makes it once: the constructor puts
 * each tent there exactly one time.
 */
/**
 * The object a combat hero's SKILLS answer on — one virtual call further along.
 *
 * `unit_hero` stops where the engine's own code stops when it wants the hero
 * himself, and that pointer is right for everything the tent already asks. It is
 * NOT the one skills answer on: at 0xdc9705 the engine gets the hero exactly the
 * way we do and then makes one more call, slot 0, before asking `[+0x174]` for a
 * mastery. Skipping that step is calling a real function on the wrong object —
 * `points_at_code` is happy, the slot holds code, and the battle ends.
 *
 * Which is why this is the third crash of the same family and the last: make the
 * call the way the engine makes it, all of it, not most of it.
 */
static void *hero_for_skills(void *hero) {
  if (!readable(hero, 4)) return NULL;
  void **vt = *(void ***)hero;
  if (!readable(vt, 4) || !points_at_code(vt[0])) return NULL;
  return ((GetterFn)vt[0])(hero);
}

static void tent_charges_term(void *unit, void *hero) {
  if (!unit || !hero) return;
  void *m = (BYTE *)unit - MACHINE_AS_UNIT;
  int found = 0;
  for (int i = 0; i < PENDING_TENTS; i++) {
    if (g_pendingTents[i] != m) continue;
    g_pendingTents[i] = NULL;
    found = 1;
    break;
  }
  if (!found || !readable((BYTE *)m + MACHINE_CHARGES, 4)) return;

  int *charges = (int *)((BYTE *)m + MACHINE_CHARGES);
  int add = hero_term(hero_for_skills(hero), STAT_TENT_CHARGES, 0);
  // Only upwards. A row worth less than nothing would take away uses the hero
  // paid for, and a tent that cannot act at all is a bug that looks like ours.
  if (add <= 0) return;
  *charges += add;
  if (g_machineLogged <= 8) {
    log_line("tent charges:");
    log_num("  we add   ", add);
    log_num("  charges  ", *charges);
  }
}

/** Installed only when something asks for the sum it adds to. */
static int install_machine_charges(void) {
  g_machineCtor = (MachineCtorFn)detour(MACHINE_CTOR_RVA, MACHINE_CTOR_HEAD, DETOUR_LEN,
                                        &machine_ctor_hook, "war machine ctor");
  return g_machineCtor != NULL;
}

/** The hooks the specialization rows ask for — none, when there are none. */
static int install_specialization_hooks(void) {
  int installed = 0;
  for (int i = 0; i < g_specRowCount; i++) {
    if (g_specRows[i].stat != SPEC_STAT_TENT) continue;
    install_tent_term();
    installed++;
    break;
  }
  return installed;
}

// ---------------------------------------------------------------------------
// Borderless — the game's own window, without its frame.
//
// The game asks USER32 for one window and never revisits its style, so the
// whole of the feature is answering that one call differently: take the frame
// off, put the window at the corner of the screen and make it the size of it.
//
// IN THE IMPORT TABLE, not in the code. `CreateWindowExA` is imported by name,
// beside `RegisterClassExA` and `DefWindowProcA` — the ordinary message loop —
// so the call can be met where the loader wrote its address. One pointer is
// replaced, no instruction is touched, and no address of the game's own is
// needed at all: this is the one hook here that a different build cannot break.
//
// WHAT IT CANNOT DO ALONE. Exclusive fullscreen belongs to Direct3D, not to the
// window: with `gfx_fullscreen = 1` the device takes the display and the frame
// is beside the point. So the other half of borderless is that variable, which
// is the editor's to write — the game keeps it in `profiles/*/user_a2.cfg`.

typedef HWND(WINAPI *CreateWindowExAFn)(DWORD, LPCSTR, LPCSTR, DWORD, int, int, int, int,
                                        HWND, HMENU, HINSTANCE, LPVOID);
typedef BOOL(WINAPI *SetWindowPosFn)(HWND, HWND, int, int, int, int, UINT);
typedef LONG(WINAPI *SetWindowLongAFn)(HWND, int, LONG);
typedef int(WINAPI *MetricFn)(int);

static CreateWindowExAFn g_createWindowExA = NULL;
static SetWindowPosFn g_setWindowPos = NULL;
static SetWindowLongAFn g_setWindowLongA = NULL;

/**
 * The window we took, so the two calls that could undo it know which it is.
 *
 * The game asks for its window with CW_USEDEFAULT and sizes it afterwards, once
 * the device exists — so creation is where the FRAME is decided and something
 * later decides the geometry. Both have to agree, or the window ends up without
 * a border at whatever size the engine had in mind.
 */
static HWND g_mainWindow = NULL;
static int g_screenW = 0;
static int g_screenH = 0;

/** The screen, asked for once and remembered. Zero if USER32 would not say. */
static void screen_size(void) {
  if (g_screenW && g_screenH) return;
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  MetricFn metric = user32 ? (MetricFn)GetProcAddress(user32, "GetSystemMetrics") : NULL;
  if (!metric) return;
  g_screenW = metric(SM_CXSCREEN);
  g_screenH = metric(SM_CYSCREEN);
}

/** What a framed window is made of, and what we take off it. */
#define WINDOW_FRAME (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)

/**
 * The slot in the import address table that holds `want`.
 *
 * The table is a list of pointers the loader filled in, so writing one here
 * changes no code. A name can also be an ordinal, in which case there is no
 * name to compare and the entry is skipped rather than guessed at.
 */
static void **find_import_slot(const char *want) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_DATA_DIRECTORY *dir = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (!dir->VirtualAddress) return NULL;

  IMAGE_IMPORT_DESCRIPTOR *imp = (IMAGE_IMPORT_DESCRIPTOR *)(base + dir->VirtualAddress);
  for (; imp->Name; imp++) {
    // The names live in one array and the addresses in another, at the same
    // index. A descriptor with no separate name array names them in place.
    DWORD nameRva = imp->OriginalFirstThunk ? imp->OriginalFirstThunk : imp->FirstThunk;
    DWORD *names = (DWORD *)(base + nameRva);
    DWORD *slots = (DWORD *)(base + imp->FirstThunk);
    for (int i = 0; names[i]; i++) {
      if (names[i] & IMAGE_ORDINAL_FLAG32) continue;
      const char *name = (const char *)(base + names[i] + 2); // past the hint
      int j = 0;
      while (want[j] && name[j] == want[j]) j++;
      if (want[j] || name[j]) continue;
      return (void **)&slots[i];
    }
  }
  return NULL;
}

/**
 * How many windows still say what they were asked for.
 *
 * The game makes one window that matters and several that do not, and which is
 * which is a claim to CHECK rather than assume — so the first few are written
 * down with the style and size they asked for, whether or not we changed them.
 */
static int g_windowsLogged = 0;
static int g_borderlessDone = 0;

static HWND WINAPI create_window_hook(DWORD exStyle, LPCSTR cls, LPCSTR title, DWORD style,
                                      int x, int y, int w, int h, HWND parent, HMENU menu,
                                      HINSTANCE inst, LPVOID param) {
  // A class name can be an atom rather than a string — the low word of the
  // pointer, with nothing to read at it — which is worth a check, since this
  // runs for every window the process makes.
  const char *clsText = (ULONG_PTR)cls > 0xFFFF ? cls : "(atom)";

  // Top-level and framed is what the game's own window is. A child, a tooltip
  // or a message box is neither, and none of them should be moved to the corner
  // of the screen and made the size of it.
  int top = !parent && !(style & WS_CHILD);
  int framed = (style & WS_CAPTION) == WS_CAPTION;
  int take = g_qol[QOL_BORDERLESS] && top && framed && !g_borderlessDone;

  if (g_windowsLogged < 8) {
    g_windowsLogged++;
    log_text("window: class ", clsText);
    log_text("        title ", (ULONG_PTR)title > 0xFFFF ? title : "(none)");
    log_hex("        style ", style);
    log_num("        width ", w);
    log_num("        height ", h);
    log_num("        top-level ", top);
    log_num("        we take it ", take);
  }

  if (take) {
    // The screen is asked for here rather than at load time: USER32 is mapped
    // by then but its own initialisation may not have run, and this call is
    // already inside the game's message loop, where everything is up.
    screen_size();
    if (g_screenW > 0 && g_screenH > 0) {
      style = (style & ~(DWORD)WINDOW_FRAME) | WS_POPUP;
      exStyle &= ~(DWORD)(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME);
      x = 0;
      y = 0;
      w = g_screenW;
      h = g_screenH;
      g_borderlessDone = 1;
      log_num("borderless: the window is now this wide ", g_screenW);
      log_num("            and this tall ", g_screenH);
    } else {
      log_line("borderless: the screen size could not be asked for - leaving the window alone");
      take = 0;
    }
  }

  HWND made = g_createWindowExA(exStyle, cls, title, style, x, y, w, h, parent, menu, inst, param);
  if (take && made) g_mainWindow = made;
  return made;
}

/**
 * Every move the game makes on its own window, and ours holding.
 *
 * It sizes the window after the device exists, so without this the frame comes
 * off and the geometry goes back to whatever the engine had in mind — which is
 * a frameless window in the corner of the screen rather than a borderless one.
 *
 * ONLY OUR WINDOW. Every other window of the process is passed through
 * untouched: this hook sees them all, and the one thing worse than a border is
 * a dialog dragged to the corner and stretched over the screen.
 */
static int g_posLogged = 0;

static BOOL WINAPI set_window_pos_hook(HWND hwnd, HWND after, int x, int y, int cx, int cy, UINT flags) {
  int ours = g_qol[QOL_BORDERLESS] && hwnd && hwnd == g_mainWindow;
  if (ours && g_posLogged < 8) {
    g_posLogged++;
    log_num("setpos: x ", x);
    log_num("        y ", y);
    log_num("        cx ", cx);
    log_num("        cy ", cy);
    log_hex("        flags ", flags);
  }
  if (ours && g_screenW > 0 && g_screenH > 0) {
    x = 0;
    y = 0;
    cx = g_screenW;
    cy = g_screenH;
    flags &= ~(UINT)(SWP_NOMOVE | SWP_NOSIZE);
  }
  return g_setWindowPos(hwnd, after, x, y, cx, cy, flags);
}

/**
 * The style, if the game ever sets it again.
 *
 * Imported, so it is called somewhere; whether it is called on the window we
 * took is what the log answers. Written to hold rather than to watch, because a
 * frame that comes back halfway through a session is the same bug as one that
 * never came off.
 */
static int g_styleLogged = 0;

static LONG WINAPI set_window_long_hook(HWND hwnd, int index, LONG value) {
  if (g_qol[QOL_BORDERLESS] && hwnd && hwnd == g_mainWindow && index == GWL_STYLE) {
    if (g_styleLogged < 8) {
      g_styleLogged++;
      log_hex("setstyle: the game asked for ", (DWORD)value);
    }
    value = (LONG)(((DWORD)value & ~(DWORD)WINDOW_FRAME) | WS_POPUP);
  }
  return g_setWindowLongA(hwnd, index, value);
}

/**
 * Meet one imported function with one of ours.
 *
 * What is verified before writing is that the slot still holds what the loader
 * put there — `GetProcAddress` of the same name out of the same library — which
 * is at once a check that this is the right slot and a check that nobody got
 * here first. Returns the original, or null when it refused, so a caller can
 * install nothing rather than install half of something.
 *
 * The library is asked for by handle rather than loaded: everything hooked here
 * is a static import of the executable, so it is mapped before any of this
 * runs, and calling `LoadLibrary` from `DllMain` is a way to deadlock the
 * loader for no gain.
 */
static void *hook_import(const WCHAR *library, const char *name, void *ours) {
  void **slot = find_import_slot(name);
  if (!slot) {
    log_text("hook: not imported by name - skipping ", name);
    return NULL;
  }
  HMODULE lib = GetModuleHandleW(library);
  void *real = lib ? (void *)GetProcAddress(lib, name) : NULL;
  if (!real || *slot != real) {
    log_text("hook: the import slot is not the library's own - skipping ", name);
    return NULL;
  }
  DWORD old = 0;
  if (!VirtualProtect(slot, sizeof(void *), PAGE_READWRITE, &old)) {
    log_text("hook: could not make the import table writable for ", name);
    return NULL;
  }
  *slot = ours;
  VirtualProtect(slot, sizeof(void *), old, &old);
  log_text("hook: installed ", name);
  return real;
}

static void install_borderless(void) {
  // The frame is decided at creation, so this one is the feature; without it
  // there is nothing to hold and the other two are not worth installing.
  g_createWindowExA = (CreateWindowExAFn)hook_import(L"user32.dll", "CreateWindowExA", &create_window_hook);
  if (!g_createWindowExA) return;
  // These two are what keeps it: the game sizes its window after the device
  // exists, and it imports the call that would put a style back.
  g_setWindowPos = (SetWindowPosFn)hook_import(L"user32.dll", "SetWindowPos", &set_window_pos_hook);
  g_setWindowLongA = (SetWindowLongAFn)hook_import(L"user32.dll", "SetWindowLongA", &set_window_long_hook);
}

// ---------------------------------------------------------------------------
// A user folder of our own — profiles, settings and saves beside the mod
// instead of in Documents.
//
// WHAT THE GAME DOES. It asks Windows where Documents is and builds
//
//   <Documents>\My Games\<PRODUCT_NAME>\Profiles\<profile>\user_a2.cfg
//
// out of strings that sit together in .rdata. `SHGetFolderPathA` is a single
// named import from SHELL32, so the whole redirection is one pointer in the
// import table and none of the game's own path building is touched.
//
// WHY NOT REWRITE THE STRINGS, which is how the mod folder was moved: a string
// patched in place must FIT where the shipped one was, and every replacement in
// src/game/mod-paths.ts had to be shorter than what it replaced. An answer
// given at runtime has no such bargain.
//
// WHY AT ALL. Our copy of the executable already reads and writes its own mod
// folder, so a map or a mod of ours cannot disturb a plain install. Settings
// and SAVES were the exception — shared through Documents by every install on
// the machine, which is how an afternoon of testing came to rewrite the video
// settings of the game somebody actually plays.
//
// NOTHING IS SEEDED. The folder starts empty: no profile, no saves, no hall of
// fame. Copying the existing tree in would be one command and several ways to
// go wrong, and whoever wants their campaign here can copy it themselves —
// knowing, as we do not, which of their saves they mean.

/** Documents. The flags above the low byte ask for creation and for defaults. */
#define CSIDL_PERSONAL 0x0005
#define CSIDL_MASK 0xFF

typedef HRESULT(WINAPI *SHGetFolderPathAFn)(HWND, int, HANDLE, DWORD, LPSTR);

static SHGetFolderPathAFn g_shGetFolderPath = NULL;

/** `<install>\H5E\user`, in ANSI because that is what the call answers in. */
static char g_userDir[MAX_PATH];

/**
 * Where our user folder is, worked out from where WE are.
 *
 * The DLL sits in `bin/` beside the executable, so the install is one level up
 * and `H5E/` is the folder our build already calls its own. Derived rather than
 * configured: an install that was moved or copied keeps working, and there is
 * no second place for the answer to be wrong in.
 */
static void find_user_dir(HINSTANCE self) {
  char path[MAX_PATH];
  DWORD n = GetModuleFileNameA(self, path, MAX_PATH);
  if (!n || n >= MAX_PATH) return;
  // Off the file name, then off `bin\` — what is left ends with a separator.
  while (n && path[n - 1] != '\\' && path[n - 1] != '/') n--;
  if (n) n--;
  while (n && path[n - 1] != '\\' && path[n - 1] != '/') n--;
  if (!n) return;

  const char *tail = "H5E\\user";
  DWORD i = 0;
  while (tail[i] && n + i < MAX_PATH - 1) { path[n + i] = tail[i]; i++; }
  path[n + i] = 0;
  for (DWORD j = 0; j <= n + i; j++) g_userDir[j] = path[j];
}

/** Make every level of the path that is not there yet. Failures are ignored:
 *  a level that already exists fails the same way as one that cannot be made,
 *  and the call that follows is what actually needs the folder. */
static void make_dirs(const char *path) {
  char work[MAX_PATH];
  int i = 0;
  while (path[i] && i < MAX_PATH - 1) { work[i] = path[i]; i++; }
  work[i] = 0;
  // From past `C:\`, so the root itself is never handed to CreateDirectory.
  for (int j = 3; work[j]; j++) {
    if (work[j] != '\\' && work[j] != '/') continue;
    work[j] = 0;
    CreateDirectoryA(work, NULL);
    work[j] = '\\';
  }
  CreateDirectoryA(work, NULL);
}

/**
 * Where Documents is, as far as the game is concerned.
 *
 * ONLY Documents. Every other folder the game asks for is passed through — this
 * call serves several, and answering all of them with one path would put the
 * game's idea of AppData wherever its idea of Documents went. Which ones are
 * actually asked for is written down for the first few calls, because that is a
 * claim about this executable rather than about Windows.
 */
static int g_folderLogged = 0;

static HRESULT WINAPI sh_folder_hook(HWND owner, int csidl, HANDLE token, DWORD flags, LPSTR out) {
  int which = csidl & CSIDL_MASK;
  int ours = g_qol[QOL_OWN_PROFILE] && which == CSIDL_PERSONAL && out && g_userDir[0];
  if (g_folderLogged < 8) {
    g_folderLogged++;
    log_num("folder: the game asked for csidl ", which);
    log_num("        answered by us ", ours);
  }
  if (!ours) return g_shGetFolderPath(owner, csidl, token, flags, out);

  // The caller is about to build a path under this and open files in it, so it
  // has to exist — the real call creates it when asked, and so must ours.
  make_dirs(g_userDir);
  int i = 0;
  while (g_userDir[i] && i < MAX_PATH - 1) { out[i] = g_userDir[i]; i++; }
  out[i] = 0;
  return 0; // S_OK
}

static void install_own_profile(HINSTANCE self) {
  find_user_dir(self);
  if (!g_userDir[0]) {
    log_line("own profile: could not work out where we are - not redirecting");
    return;
  }
  g_shGetFolderPath = (SHGetFolderPathAFn)hook_import(L"shell32.dll", "SHGetFolderPathA", &sh_folder_hook);
  if (g_shGetFolderPath) log_text("own profile: our user folder is ", g_userDir);
}

// ---------------------------------------------------------------------------
// Quick split — a held key and a click, instead of the slider.
//
// THE SLIDER WINDOW IS NOT TOUCHED. Nothing here hooks it, or the drop, or the
// drag: there is ONE hook, on the click, and everything a gesture does it does
// through a controller it builds itself. That is the whole difference between
// this and the four attempts before it — the logic is ours and the engine is
// only asked to carry it out, so what a gesture decides can be read here rather
// than guessed at from what the screen did afterwards.
//
// WHERE A CLICK IS. Dragging in this interface is a three-state machine —
// Ready, Prepare, Drag. Pressing over a stack leaves Ready and remembers what
// was under the cursor; Prepare then becomes Drag either because the mouse
// moved or because the button was RELEASED. The slot hooked below is the
// release, so a gesture is a click and dragging stays the player's.
//
// WHAT A GESTURE NEEDS TO KNOW, and where each answer comes from — all of it
// read out of the screen's own fields, every one measured from the code that
// builds a split by hand (`CHeroScreen::Split`, and the controller's `Init`):
//
//   which slot was clicked  the screen keeps an array of slot widgets per army
//                           on screen; the clicked widget is in one of them and
//                           its position IS the slot number
//   what is in every slot   army -> owner -> a vector of stacks, one entry per
//                           slot, null where the slot is empty
//   how many, and of what   the stack itself: +0x20 the count, +0x1C the
//                           creature
//   how to move them        a controller of our own — below
//
// See docs/UI_INTERNALS.md.

#define SLOT_COUNT 7

// --- the screen ------------------------------------------------------------

/** The drag client is a subobject; the screen proper starts this far back. */
#define PART_FROM_CLIENT 0x174u
/** One array of slot widgets per army on screen, and the army each belongs to. */
#define PART_SLOTS_A 0x53Cu
#define PART_SLOTS_B 0x654u
#define PART_ARMY_A 0x1B0u
#define PART_ARMY_B 0x1B4u
/** Whether there is a second army at all. The screen keeps the answer in one of
 *  two bytes and a flag says which — a hero standing at a town has one, a hero
 *  alone in the field does not, and reading the wrong byte invents an army. */
#define PART_SECOND_FLAG 0x4B8u
#define PART_SECOND_WHEN_SET 0x338u
#define PART_SECOND_WHEN_CLEAR 0x1B8u
/** The three fields of a controller's block that belong to the screen itself. */
#define PART_BLOCK_FIRST 0x1A8u
#define PART_BLOCK_SECOND 0x1A4u
#define PART_BLOCK_LAST 0x758u

/** Slot entries are three words apart, and each begins with the object. */
#define SLOT_ENTRY_STRIDE 0xCu

/** The army's "what holds my stacks", and the owner's vector of them. */
#define ARMY_OWNER 0x48u
#define OWNER_STACKS 0x08u

/** A stack of creatures: which creature, and how many of it. */
#define STACK_TYPE 0x1Cu
#define STACK_COUNT 0x20u

// --- the controller --------------------------------------------------------

/**
 * `CHeroDragStackController`'s constructor: one argument, a block of nine
 * words, and out comes the thing that moves creatures.
 *
 * The block is not a mystery to be captured from a real split any more — the
 * screen builds one out of its own fields, and so do we:
 *
 *   0  screen +0x1A8            5  target army's owner
 *   1  screen +0x1A4            6  target slot
 *   2  source army's owner      7  target army
 *   3  source slot              8  screen +0x758
 *   4  source army
 *
 * Which is why no drag, no window and no held key are anywhere near a gesture:
 * two slot numbers are the entire difference between one split and another.
 */
#define MAKE_CONTROLLER_RVA 0x412190u
#define MAKE_CONTROLLER_HEAD_LEN 6
static const BYTE MAKE_CONTROLLER_HEAD[MAKE_CONTROLLER_HEAD_LEN] = {
  0x56, 0x57, 0x6A, 0x40, 0x8B, 0xF9
};

typedef void *(__fastcall *MakeControllerFn)(void *block, void *edx);
static MakeControllerFn g_makeController = NULL;

/** Ask, and then do — the two the split window's OK button is made of. */
#define CONTROLLER_VALIDATE 0x10u
#define CONTROLLER_EXECUTE 0x14u
/**
 * WHAT THE NUMBER MEANS: how many the TARGET ends up with, not how many cross.
 *
 * `Validate(n)` refuses unless both `total - n` and `n` clear a minimum, and
 * `total` — this field — is the two stacks ADDED TOGETHER whenever they hold
 * the same creature. So the slider in the window sets the target's share of the
 * pair. That is why every split into an EMPTY slot looked right, the two
 * numbers being equal there, and why every move into an OCCUPIED one silently
 * did nothing: "hand over two more" was read as "leave the target with the two
 * it already has", which is the whole of the 4-6-2 that no amount of arithmetic
 * above it could ever have fixed.
 *
 * It is also the same-creature test, free: a pair holding different creatures
 * is left at zero.
 */
#define CONTROLLER_TOTAL 0x28u

typedef int(__fastcall *ControllerAskFn)(void *self, void *edx, int howMany);
typedef void *(__fastcall *NoArgFn)(void *self, void *edx);

/**
 * `CHeroScreen::Split` — and it is only half named that.
 *
 * GIVING A STACK AWAY WHOLE IS NOT A SPLIT, and the engine knows it: this
 * function looks at one byte first and takes an entirely different branch when
 * splitting is not on. That branch compares the two creatures and builds a
 * MERGE — a different, smaller command than the split one, and the only one the
 * army panel knows how to draw the result of.
 *
 * A split command told to hand over everything leaves the source at nothing,
 * which the panel never has to cope with otherwise, and it goes on drawing the
 * slot: six stacks on screen where the army has five, until the screen is
 * reopened. So a merge of ours goes through here, and only a real division of a
 * stack goes through a controller of our own.
 *
 * The byte is the engine's Shift binding — held, it turns a drop into an offer
 * to split. Ours is cleared for the call and put back after, so a gesture means
 * the same thing whatever the player is leaning on.
 */
#define SCREEN_SPLIT_RVA 0x359360u
#define SCREEN_SPLIT_HEAD_LEN 7
static const BYTE SCREEN_SPLIT_HEAD[SCREEN_SPLIT_HEAD_LEN] = {
  0x83, 0xEC, 0x58, 0x53, 0x55, 0x8B, 0xE9
};
#define SCREEN_SPLIT_ALLOWED 0x1A0u

typedef int(__fastcall *ScreenSplitFn)(void *self, void *edx, void *fromWidget, void *fromStack,
                                       void *toWidget, void *toStack);
static ScreenSplitFn g_screenSplit = NULL;

/** The drag's own map from a widget to the handle a drop deals in — which is
 *  not the stack itself, and is what that call wants. */
#define DND_HELPER_MAP 0x10u
#define SLOT_CONTENTS 0x28u
typedef void *(__fastcall *InSlotFn)(void *self, void *edx, void *widget);

// --- the click -------------------------------------------------------------

/**
 * `CDNDStatePrepare` on the button being RELEASED — a click and nothing else.
 *
 * A click and the start of a drag both end up in the state's move handler,
 * which is why hooking that took the player's Shift-drag away along with the
 * click. This slot is reached only when the button comes back up without the
 * mouse having gone anywhere.
 */
#define DND_PICK_RVA 0x3d1ba0u
#define DND_PICK_HEAD_LEN 7
static const BYTE DND_PICK_HEAD[DND_PICK_HEAD_LEN] = {
  0x8B, 0x01, 0x8B, 0x40, 0x1C, 0xFF, 0xE0
};

/** The helper the state works through, what it picked, and whose screen it is. */
#define DND_STATE_HELPER 0x0Cu
#define DND_HELPER_PICKED 0x1Cu
#define DND_HELPER_WIDGET 0x0Cu
#define DND_HELPER_CLIENT 0x08u
/** The state's own way back to Ready — how a click is called off. */
#define DND_STATE_GIVE_UP 0x2Cu
/** What the helper has to BE for its fields to mean what we read them as: the
 *  same drag carries artifacts, and a town screen lays its own out differently. */
#define DND_HELPER_VTABLE_RVA 0xb6db14u

typedef int(__fastcall *DndPickFn)(void *state, void *edx, void *arg);
typedef void(__fastcall *GiveUpFn)(void *state, void *edx);
typedef SHORT(WINAPI *KeyStateFn)(int);

static DndPickFn g_dndPick = NULL;
static KeyStateFn g_keyState = NULL;
static int g_clicksLogged = 0;

/** Is this key down NOW — at the click, which is when the answer is wanted. */
static int held(int vk) { return g_keyState && (g_keyState(vk) & 0x8000) != 0; }

/** USER32's answer to that, got once. Two features want it and either may be
 *  turned on without the other, so neither installer may own it. */
static int have_key_state(void) {
  if (!g_keyState) {
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    g_keyState = user32 ? (KeyStateFn)GetProcAddress(user32, "GetAsyncKeyState") : NULL;
  }
  return g_keyState != NULL;
}


/** The engine's own test that one of its refcounted pointers still points. */
static int pointer_alive(void *p) {
  if (readable_bytes(p, 8) < 8) return 0;
  BYTE *block = *(BYTE **)((BYTE *)p + 4);
  if (readable_bytes(block, 8) < 8) return 0;
  DWORD at = *(DWORD *)(block + 4);
  if (readable_bytes((BYTE *)p + at, 12) < 12) return 0;
  return *(int *)((BYTE *)p + at + 8) >= 0;
}

/** Is this the type we measured — and so are its fields where we think? */
static int is_a(void *obj, DWORD vtableRva) {
  if (readable_bytes(obj, 4) < 4) return 0;
  return *(DWORD *)obj == (DWORD)(BYTE *)GetModuleHandleW(NULL) + vtableRva;
}

/** An address we mean to CALL rather than hook — checked against the bytes it
 *  was measured by, because calling the wrong function is a crash with no
 *  explanation, and the byte check is the explanation. */
static void *code_at(DWORD rva, const BYTE *head, int headLen, const char *what) {
  BYTE *at = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < headLen; i++) {
    if (at[i] == head[i]) continue;
    log_text("this is not the function measured: ", what);
    return NULL;
  }
  return at;
}

/** A virtual call this code makes by hand, and whether it is safe to make. */
static void *vtable_entry(void *obj, DWORD offset) {
  if (readable_bytes(obj, 4) < 4) return NULL;
  void *vtable = *(void **)obj;
  if (readable_bytes(vtable, offset + 4) < offset + 4) return NULL;
  void *fn = *(void **)((BYTE *)vtable + offset);
  return points_at_code(fn) ? fn : NULL;
}

// --- reading an army -------------------------------------------------------

/** The widget a slot entry stands for: the object, adjusted onto the subobject
 *  the drag deals in — the same three instructions the screen uses. */
static void *entry_widget(void *array, int slot) {
  if (readable_bytes(array, (DWORD)slot * SLOT_ENTRY_STRIDE + 4) < (DWORD)slot * SLOT_ENTRY_STRIDE + 4)
    return NULL;
  BYTE *obj = *(BYTE **)((BYTE *)array + (DWORD)slot * SLOT_ENTRY_STRIDE);
  if (readable_bytes(obj, 8) < 8) return NULL;
  BYTE *block = *(BYTE **)(obj + 4);
  if (readable_bytes(block, 12) < 12) return NULL;
  return obj + *(DWORD *)(block + 8) + 4;
}

/** Is there a second army on this screen to move things between? */
static int two_armies(void *part) {
  BYTE *flag = (BYTE *)part + PART_SECOND_FLAG;
  if (!readable_bytes(flag, 1)) return 0;
  BYTE *say = (BYTE *)part + (*flag ? PART_SECOND_WHEN_SET : PART_SECOND_WHEN_CLEAR);
  return readable_bytes(say, 1) && *say;
}

static void *army_of(void *part, int side) {
  BYTE *at = (BYTE *)part + (side ? PART_ARMY_B : PART_ARMY_A);
  return readable_bytes(at, 4) >= 4 ? *(void **)at : NULL;
}

static void *slots_of(void *part, int side) {
  BYTE *at = (BYTE *)part + (side ? PART_SLOTS_B : PART_SLOTS_A);
  return readable_bytes(at, 4) >= 4 ? *(void **)at : NULL;
}

/** Which army, and which of its seven slots, this widget is. */
static int find_slot(void *part, void *widget, int *side, int *slot) {
  for (int s = 0; s < 2; s++) {
    if (s == 1 && !two_armies(part)) break;
    void *array = slots_of(part, s);
    if (!array) continue;
    for (int i = 0; i < SLOT_COUNT; i++) {
      if (entry_widget(array, i) != widget) continue;
      *side = s;
      *slot = i;
      return 1;
    }
  }
  return 0;
}

/** What holds an army's stacks. Asked of the army, as the engine asks it. */
static void *army_owner(void *army) {
  NoArgFn get = (NoArgFn)vtable_entry(army, ARMY_OWNER);
  return get ? get(army, NULL) : NULL;
}

/** The stack in a slot, or nothing when the slot is empty. */
static void *stack_in(void *owner, int slot) {
  NoArgFn get = (NoArgFn)vtable_entry(owner, OWNER_STACKS);
  if (!get) return NULL;
  void *list = get(owner, NULL);
  if (readable_bytes(list, 8) < 8) return NULL;
  BYTE **begin = *(BYTE ***)list;
  BYTE **end = *(BYTE ***)((BYTE *)list + 4);
  if (readable_bytes(begin, 4) < 4 || end < begin) return NULL;
  if (slot < 0 || slot >= (int)(end - begin)) return NULL;
  if (readable_bytes(begin + slot, 4) < 4) return NULL;
  return begin[slot];
}

typedef struct {
  /** Which creature, or -1 for an empty slot. */
  int type;
  int count;
} SlotState;

/** How many entries the army's own vector had, for the log: if it is shorter
 *  than the slots on screen, an emptied slot is REMOVED from it and a slot
 *  number is not an index into it. */
static int g_stacksSeen = 0;
/**
 * Whether a slot has a stack OBJECT in it, whatever that object says.
 *
 * Which is not the same question as whether it holds creatures, and the
 * difference is what is being measured. A merge of ours is a split command told
 * to hand over everything, so the source ends at nothing — and a split was never
 * meant to empty its source. If the engine leaves the emptied stack in place at
 * zero where its own merge would have removed it, that leftover is what the
 * panel has been drawing.
 */
static int g_hasEntry[SLOT_COUNT];

static void read_army(void *army, SlotState *out) {
  void *owner = army_owner(army);
  g_stacksSeen = 0;
  {
    NoArgFn get = (NoArgFn)vtable_entry(owner, OWNER_STACKS);
    void *list = get ? get(owner, NULL) : NULL;
    if (readable_bytes(list, 8) >= 8) {
      BYTE **begin = *(BYTE ***)list, **end = *(BYTE ***)((BYTE *)list + 4);
      if (end >= begin) g_stacksSeen = (int)(end - begin);
    }
  }
  for (int i = 0; i < SLOT_COUNT; i++) {
    void *s = owner ? stack_in(owner, i) : NULL;
    int room = (int)readable_bytes(s, STACK_COUNT + 4);
    g_hasEntry[i] = s != NULL;
    out[i].type = room >= (int)(STACK_COUNT + 4) ? *(int *)((BYTE *)s + STACK_TYPE) : -1;
    out[i].count = room >= (int)(STACK_COUNT + 4) ? *(int *)((BYTE *)s + STACK_COUNT) : 0;
    if (out[i].count <= 0) { out[i].type = -1; out[i].count = 0; }
  }
}

// --- moving creatures ------------------------------------------------------

/**
 * A GESTURE IS DECIDED BEFORE ANY OF IT IS DONE.
 *
 * What a slot holds does not change while a gesture runs. `Execute` hands the
 * engine a command carrying two slot numbers and a number, and it is carried
 * out later — until then the army reads exactly as it did. So a gesture that
 * looked at the slots between its own moves saw the state it started from and
 * worked the next move out as if the last had not happened: that is how Alt
 * gathered one stack and stopped, and how an even split of 4, 4, 4 became
 * 8, 0, 4.
 *
 * Hence a plan. The arithmetic is done here, on a copy of the army that we keep
 * ourselves, and what comes out is a list of moves that are right in the order
 * they are sent. Commands carry no counts, so they mean the same thing whenever
 * the engine gets round to them.
 */
#define MAX_MOVES 16

typedef struct {
  int from, to;
  /** What the target is to end up holding — see CONTROLLER_TOTAL. */
  int want;
  /** The source is left with nothing, so this is a merge and goes to the
   *  engine's own — see SCREEN_SPLIT_RVA. */
  int whole;
} Move;

typedef struct {
  SlotState slot[SLOT_COUNT];
  Move move[MAX_MOVES];
  int moves;
} Plan;

/** Hand this many creatures over — on paper, where the arithmetic is ours. */
static void plan_move(Plan *p, int from, int to, int howMany) {
  if (p->moves >= MAX_MOVES || howMany <= 0 || howMany > p->slot[from].count) return;
  p->move[p->moves].from = from;
  p->move[p->moves].to = to;
  p->move[p->moves].want = p->slot[to].count + howMany;
  p->move[p->moves].whole = howMany == p->slot[from].count;
  p->moves++;
  p->slot[to].type = p->slot[from].type;
  p->slot[to].count += howMany;
  p->slot[from].count -= howMany;
  if (!p->slot[from].count) p->slot[from].type = -1;
}

/**
 * Leave the target slot holding exactly `want`, and the source the rest.
 *
 * The one thing this feature does to the game. Everything above it is
 * arithmetic on numbers we have read; this is the engine's own command, built
 * the way the OK button builds it, so the screen, the network and the save all
 * learn about it the way they always did.
 *
 * `judge` asks the engine whether it would allow this. Only the FIRST move of a
 * gesture may be asked: after that the controller is answering about a state
 * the engine has not caught up with, and its answer is no about the wrong
 * question.
 */
static int set_target(void *part, int fromSide, int fromSlot, int toSide, int toSlot, int want,
                      int judge) {
  if (!g_makeController || want < 0) return 0;
  void *fromArmy = army_of(part, fromSide), *toArmy = army_of(part, toSide);
  if (!fromArmy || !toArmy) return 0;
  if (readable_bytes((BYTE *)part + PART_BLOCK_LAST, 4) < 4) return 0;

  void *block[9];
  block[0] = *(void **)((BYTE *)part + PART_BLOCK_FIRST);
  block[1] = *(void **)((BYTE *)part + PART_BLOCK_SECOND);
  block[2] = army_owner(fromArmy);
  block[3] = (void *)(DWORD)fromSlot;
  block[4] = fromArmy;
  block[5] = army_owner(toArmy);
  block[6] = (void *)(DWORD)toSlot;
  block[7] = toArmy;
  block[8] = *(void **)((BYTE *)part + PART_BLOCK_LAST);
  if (!block[2] || !block[5]) return 0;

  void *c = g_makeController(block, NULL);
  if (readable_bytes(c, CONTROLLER_TOTAL + 4) < CONTROLLER_TOTAL + 4) return 0;
  ControllerAskFn allowed = (ControllerAskFn)vtable_entry(c, CONTROLLER_VALIDATE);
  ControllerAskFn apply = (ControllerAskFn)vtable_entry(c, CONTROLLER_EXECUTE);
  if (!allowed || !apply) return 0;
  if (judge) {
    // Zero total means the pair was refused: an empty source, or two different
    // creatures. Both are questions answered by our own reading of the army,
    // but this is the engine agreeing with it before anything is sent.
    if (*(int *)((BYTE *)c + CONTROLLER_TOTAL) < want) return 0;
    if (!allowed(c, NULL, want)) return 0;
  }
  apply(c, NULL, want);
  return 1;
}

/**
 * Give a stack away whole, the way the engine does it — a merge, not a split.
 *
 * Everything the call needs it looks up itself from the two widgets; what it
 * cannot look up is the handle behind them, which is the drag's business and
 * comes from the drag's own map.
 */
static int merge_whole(void *part, void *map, void *array, int from, int to) {
  if (!g_screenSplit) return 0;
  void *fromWidget = entry_widget(array, from), *toWidget = entry_widget(array, to);
  InSlotFn in_slot = (InSlotFn)vtable_entry(map, SLOT_CONTENTS);
  if (!fromWidget || !toWidget || !in_slot) return 0;
  void *fromStack = in_slot(map, NULL, fromWidget);
  if (!fromStack) return 0;
  void *toStack = in_slot(map, NULL, toWidget);

  BYTE *allowed = readable_bytes((BYTE *)part + SCREEN_SPLIT_ALLOWED, 4) >= 4
    ? *(BYTE **)((BYTE *)part + SCREEN_SPLIT_ALLOWED) : NULL;
  int poke = readable_bytes(allowed, 1) != 0;
  BYTE was = poke ? *allowed : 0;
  if (poke) *allowed = 0;
  g_screenSplit(part, NULL, fromWidget, fromStack, toWidget, toStack);
  if (poke) *allowed = was;
  return 1;
}

/** Send a plan, in order. */
static int carry_out(void *part, int side, void *map, const Plan *p) {
  void *array = slots_of(part, side);
  int did = 0;
  for (int i = 0; i < p->moves; i++) {
    const Move *m = &p->move[i];
    int done = m->whole
      ? merge_whole(part, map, array, m->from, m->to)
      : set_target(part, side, m->from, side, m->to, m->want, i == 0);
    if (!done) break;
    did++;
  }
  return did;
}

// --- the gestures ----------------------------------------------------------

/** Ctrl on a stack of more than one: a single creature into the first free slot. */
static void put_one_out(Plan *p, int from, int everyFreeSlot) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (p->slot[i].type >= 0 || p->slot[from].count < 2) continue;
    plan_move(p, from, i, 1);
    if (!everyFreeSlot) return;
  }
}

/**
 * Ctrl on a stack of ONE: back where it came from.
 *
 * The gesture reads the same either way — "this single creature is in the wrong
 * place" — and which way it goes is a question the stack itself answers.
 */
static void put_one_back(Plan *p, int from) {
  int home = -1;
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (i == from || p->slot[i].type != p->slot[from].type) continue;
    if (home < 0 || p->slot[i].count > p->slot[home].count) home = i;
  }
  if (home >= 0) plan_move(p, from, home, 1);
}

/** Alt: every stack of this creature into the clicked one. */
static void gather(Plan *p, int into) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (i == into || p->slot[i].type != p->slot[into].type) continue;
    plan_move(p, i, into, p->slot[i].count);
  }
}

/**
 * Shift: the "smart" split the HD mod for Heroes 3 has.
 *
 * Every stack of this creature ends up the same size give or take one, and each
 * click makes one more of them — 12 becomes 6 and 6, then 4, 4 and 4. Stacks of
 * a single creature are left out of it entirely, deliberately: they are scouts
 * and gate-blockers, and the player put them there.
 *
 * Two things happen depending on what is already on screen. Stacks that are NOT
 * level yet are levelled, keeping their number — 12 and 5 becomes 9 and 8. Once
 * they are level, the next click adds a stack — 9 and 8 becomes 6, 6 and 5.
 *
 * The moving is gather-then-deal: everything into the clicked slot, then dealt
 * back out. Dealing is always into an EMPTY slot, which is the one case where
 * "how many the target ends up with" and "how many cross" are the same number,
 * so nothing here has to reason about the pair.
 */
static void spread(Plan *p, int from) {
  int member[SLOT_COUNT], members = 0, total = 0, most = 0, least = 0;
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (p->slot[i].type != p->slot[from].type || p->slot[i].count < 2) continue;
    if (!members || p->slot[i].count > most) most = p->slot[i].count;
    if (!members || p->slot[i].count < least) least = p->slot[i].count;
    total += p->slot[i].count;
    member[members++] = i;
  }
  if (!members) return;

  // Where a stack may go: the ones this creature already has, and the free ones.
  int target[SLOT_COUNT], targets = 0;
  for (int i = 0; i < members; i++) if (member[i] != from) target[targets++] = member[i];
  for (int i = 0; i < SLOT_COUNT; i++) if (p->slot[i].type < 0) target[targets++] = i;

  // Level first, then grow: one more stack only once the ones there are even.
  int level = most - least <= 1;
  int parts = level ? members + 1 : members;
  if (parts > targets + 1) parts = targets + 1;
  if (parts > total) parts = total;
  // Nothing at all rather than a move that changes nothing: even stacks with no
  // free slot to grow into, or a lone creature that cannot be halved.
  if (parts < 2 || (level && parts == members)) return;

  for (int i = 0; i < members; i++)
    if (member[i] != from) plan_move(p, member[i], from, p->slot[member[i]].count);

  int base = total / parts, over = total % parts;
  for (int i = 1; i < parts; i++) plan_move(p, from, target[i - 1], base + (i < over ? 1 : 0));
}

static int __fastcall dnd_pick_hook(void *state, void *edx, void *arg) {
  (void)edx;
  int ctrl = held(VK_CONTROL);
  int shift = held(VK_SHIFT);
  int alt = held(VK_MENU);
  if (!ctrl && !shift && !alt) return g_dndPick(state, NULL, arg);

  void *helper = readable_bytes((BYTE *)state + DND_STATE_HELPER, 4) >= 4
    ? *(void **)((BYTE *)state + DND_STATE_HELPER) : NULL;
  helper = readable_bytes(helper, DND_HELPER_PICKED + 4) >= DND_HELPER_PICKED + 4
    ? *(void **)((BYTE *)helper + DND_HELPER_PICKED) : NULL;
  if (!is_a(helper, DND_HELPER_VTABLE_RVA) || !pointer_alive(helper))
    return g_dndPick(state, NULL, arg);

  void *widget = *(void **)((BYTE *)helper + DND_HELPER_WIDGET);
  void *client = *(void **)((BYTE *)helper + DND_HELPER_CLIENT);
  if (readable_bytes(client, 4) < 4) return g_dndPick(state, NULL, arg);
  // The screen, from the drag client sitting inside it. Nothing is read out of
  // it until the clicked widget has been found in its own slot list, which is
  // what says this is the screen we think it is.
  void *part = (BYTE *)client - PART_FROM_CLIENT;
  int side = 0, from = -1;
  if (!find_slot(part, widget, &side, &from)) return g_dndPick(state, NULL, arg);

  Plan plan;
  plan.moves = 0;
  read_army(army_of(part, side), plan.slot);
  SlotState before[SLOT_COUNT];
  for (int i = 0; i < SLOT_COUNT; i++) before[i] = plan.slot[i];
  if (plan.slot[from].type < 0) {
    // The picture says there is a stack here and the army says there is not.
    // Worth a line of its own: it is the one shape of failure that says the
    // slot numbers on screen are not the ones the army is keeping.
    if (g_clicksLogged < 40) {
      g_clicksLogged++;
      log_num("click: nothing in slot ", from + 1);
      log_num("       stacks in the army's own list ", g_stacksSeen);
      if (g_hasEntry[from]) log_line("       though a stack still stands there, holding nothing");
    }
    return g_dndPick(state, NULL, arg);
  }
  int held_here = plan.slot[from].count;

  if (alt) gather(&plan, from);
  else if (shift && !ctrl) spread(&plan, from);
  else if (held_here > 1) put_one_out(&plan, from, ctrl && shift);
  else if (ctrl && !shift) put_one_back(&plan, from);

  void *map = readable_bytes((BYTE *)helper + DND_HELPER_MAP, 4) >= 4
    ? *(void **)((BYTE *)helper + DND_HELPER_MAP) : NULL;
  int did = carry_out(part, side, map, &plan);

  if (g_clicksLogged < 40) {
    g_clicksLogged++;
    log_line("click: with a key held");
    log_num("       ctrl ", ctrl);
    log_num("       shift ", shift);
    log_num("       alt ", alt);
    log_num("       army ", side + 1);
    log_num("       clicked slot ", from + 1);
    log_num("       holding ", held_here);
    log_num("       stacks in the army's own list ", g_stacksSeen);
    for (int i = 0; i < SLOT_COUNT; i++) {
      if (before[i].type < 0 && !g_hasEntry[i]) continue;
      log_num("       in slot ", i + 1);
      if (before[i].type < 0) {
        log_line("            a stack still stands here, holding nothing");
        continue;
      }
      log_num("            of creature ", before[i].type);
      log_num("            there are ", before[i].count);
    }
    for (int i = 0; i < plan.moves; i++) {
      log_num("       move out of slot ", plan.move[i].from + 1);
      log_num("               into slot ", plan.move[i].to + 1);
      if (plan.move[i].whole) log_line("               all of it, as a merge");
      else log_num("               leaving it with ", plan.move[i].want);
    }
    log_num("       moves made ", did);
  }

  // Called off whatever came of it: the key says this click was a gesture, and
  // a gesture that had nothing to do should still not leave a stack hanging on
  // the cursor. Picking one up is what a click with NO key held is for.
  GiveUpFn give_up = (GiveUpFn)vtable_entry(state, DND_STATE_GIVE_UP);
  if (give_up) give_up(state, NULL);
  return 1;
}

static void install_quick_split(void) {
  if (!have_key_state()) {
    log_line("quick split: USER32 will not say which keys are down - not hooking");
    return;
  }
  g_makeController = (MakeControllerFn)code_at(MAKE_CONTROLLER_RVA, MAKE_CONTROLLER_HEAD,
                                               MAKE_CONTROLLER_HEAD_LEN, "the split controller");
  if (!g_makeController) return;
  g_screenSplit = (ScreenSplitFn)code_at(SCREEN_SPLIT_RVA, SCREEN_SPLIT_HEAD, SCREEN_SPLIT_HEAD_LEN,
                                         "the screen's own split");
  g_dndPick = (DndPickFn)detour(DND_PICK_RVA, DND_PICK_HEAD, DND_PICK_HEAD_LEN,
                                &dnd_pick_hook, "drag and drop pick");
  if (g_dndPick) log_line("quick split: watching clicks made with a key held");
}

// ---------------------------------------------------------------------------
// The plate over a stack in a battle.
//
// WHAT THE PLATE IS. The number over a creature's head is `ID_STACKINFO_WINDOW`
// in UI/UIGameRoot.(UIGameRoot).xdb — a four-state button declared by
// UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb, with exactly one
// child, `Text`, and its four backgrounds in UI/AdventureScreen/StackInfo. So
// the widget is DATA: a health bar beside the number is a child window added in
// an archive of ours, and only its WIDTH would have to come from here.
//
// HOW THE NUMBER GETS THERE. Three functions, and the reconnaissance that found
// them is written up in docs/engineInternals/COMBAT.md:
//
//   0x739c40   place ONE plate: `this` is the window, and the second stack
//              argument is the number it will show.
//   0x7c0ed0   that number as the player reads it — the text key
//              CREATURES_NUMBER with `count` put in, and "2K" above a thousand.
//              ONE caller in the whole image, and it is the line above.
//   0x4dc940   a string of the engine's own taking a C string.
//
// So the text on a plate, and nothing else in the game, is ours to write. That
// one caller is what makes this cheap: no test of "is this a plate", no state
// to keep about which screen is up.
//
// WHAT IS STILL MISSING, and it is the health bar's half: which combat creature
// a plate stands for. The placement call carries the window and the number and
// nothing else, and the `CCreature` the screen's own walk carries is the stack
// on the map — its whole object was printed, and a wound is not in it. So the
// losses are done here and the bar is not: see the docs for where that goes
// next.

/** Place one plate. `sub esp,1Ch / push ebx / push ebp / mov ebp,ecx`. */
#define PLATE_SHOW_RVA 0x339c40u
#define PLATE_SHOW_HEAD_LEN 7
static const BYTE PLATE_SHOW_HEAD[PLATE_SHOW_HEAD_LEN] = {
  0x83, 0xEC, 0x1C, 0x53, 0x55, 0x8B, 0xE9
};
/** `mov eax,fs:[2Ch]` and `sub esp,0Ch`. The absolute in the first is a segment
 *  offset rather than an address in the image, so nothing here is relocated. */
#define COUNT_TEXT_RVA 0x3c0ed0u
#define COUNT_TEXT_HEAD_LEN 9
static const BYTE COUNT_TEXT_HEAD[COUNT_TEXT_HEAD_LEN] = {
  0x64, 0xA1, 0x2C, 0x00, 0x00, 0x00, 0x83, 0xEC, 0x0C
};
/** `CFinishCombat`'s apply — the one door a battle leaves by. Seven bytes,
 *  stopping before the short jump, whose meaning is where it sits. */
#define FINISH_COMBAT_RVA 0x773230u
#define FINISH_COMBAT_HEAD_LEN 7
static const BYTE FINISH_COMBAT_HEAD[FINISH_COMBAT_HEAD_LEN] = {
  0x8B, 0xD1, 0x8B, 0x4A, 0x10, 0x85, 0xC9
};

typedef void(__fastcall *PlateShowFn)(void *window, int shown, int first, int number,
                                      int x, int y);
typedef void *(__fastcall *CountTextFn)(int number, int thousands);
typedef int(__fastcall *FinishCombatFn)(void *command, void *edx);

static PlateShowFn g_plateShow = NULL;
static CountTextFn g_countText = NULL;
static FinishCombatFn g_finishCombat = NULL;

/**
 * What each plate held when we first saw it, which is what it walked in with.
 *
 * KEYED ON THE WINDOW, because that is all the placement call carries. Within
 * one battle a window belongs to one stack — the screen makes them once, by
 * row, and keeps them — so the key holds for exactly as long as the answer is
 * wanted. Across battles it would not, which is what the finish hook is for.
 */
#define PLATES_REMEMBERED 32
static struct { void *window; int start; } g_plateWalkedIn[PLATES_REMEMBERED];
static int g_platesKnown = 0;

/** The plate being drawn right now, for the text hook, which is called from
 *  inside the placement and has no other way to know whose number it is. */
static int g_plateStart = 0;
static int g_platesLogged = 0;
static int g_textLogged = 0;

/** Is Shift down — asked at most once a tick rather than once per plate per
 *  frame, which at fourteen stacks and sixty frames is eight hundred times a
 *  second for an answer that cannot change that often. */
static DWORD g_shiftAskedAt = 0;
static int g_shiftDown = 0;

static int shift_now(void) {
  DWORD tick = GetTickCount();
  if (tick != g_shiftAskedAt) {
    g_shiftAskedAt = tick;
    g_shiftDown = held(VK_SHIFT);
  }
  return g_shiftDown;
}

static int walked_in_with(void *window, int number) {
  for (int i = 0; i < g_platesKnown; i++)
    if (g_plateWalkedIn[i].window == window) return g_plateWalkedIn[i].start;
  if (g_platesKnown < PLATES_REMEMBERED) {
    g_plateWalkedIn[g_platesKnown].window = window;
    g_plateWalkedIn[g_platesKnown].start = number;
    g_platesKnown++;
  }
  return number;
}

/**
 * The number on the plate, with what the stack started the battle with beside
 * it while Shift is held.
 *
 * The engine's own text is built first and then replaced rather than skipped:
 * what comes back is a static string of the game's, and letting it be filled
 * the usual way is what keeps the object in the state the rest of the frame
 * expects. Its buffer is freed before ours goes in, because the assignment
 * does not free — the engine only ever assigns to a string that is empty.
 */
static void *__fastcall count_text_hook(int number, int thousands) {
  void *text = g_countText(number, thousands);
  if (!g_qol[QOL_STACK_LOSSES] || !g_plateStart || !shift_now()) return text;
  if (!readable(text, 12)) return text;
  // A few, and only for the key being held: the first battle with this on is
  // the one that says whether a plate's baseline is the stack's own.
  int say = g_textLogged < 8 ? ++g_textLogged : 0;
  if (say) {
    log_num("shift: the plate shows ", number);
    log_num("       it walked in with ", g_plateStart);
  }

  char both[32];
  int at = 0, digits = 0;
  num_to_dec(number, both, &digits);
  at += digits;
  both[at++] = '/';
  num_to_dec(g_plateStart, both + at, &digits);
  at += digits;
  both[at] = 0;
  if (say) log_text("       ours reads ", both);

  // THE STRING IS WIDE, and two crashes were that and nothing else. The text is
  // built by a `%d` that lives in the image as `25 00 64 00` — UTF-16 — so a
  // narrow assignment into it, and narrow bytes written into its buffer, both
  // left the window holding something that is not a string, and the game died
  // in the drawing rather than here. The tell was in the log the whole time:
  // one character `6` measured TWO bytes long.
  //
  // WRITTEN WHERE IT ALREADY IS. No allocation, no free: the first attempt did
  // both through the engine's own allocator and changed its state under a
  // frame that was still running, and the room was never wanted anyway — a
  // one-digit count sits in thirty bytes. What comes out is the object the
  // engine built, holding what it held, only longer.
  //
  // `end` EXCLUDES the terminator: the engine's own string constructor copies
  // the characters, stops before the zero, and leaves end at begin + length.
  void **string = (void **)text;
  WCHAR *begin = (WCHAR *)string[0];
  int room = begin ? (int)((char *)string[2] - (char *)begin) : 0;
  if (!begin || room < (at + 1) * 2) {
    if (say) log_num("       no room in it, bytes ", room);
    return text;
  }
  // Digits and a slash, so widening each is the whole of the conversion.
  for (int i = 0; i <= at; i++) begin[i] = (WCHAR)(BYTE)both[i];
  string[1] = (char *)begin + at * 2;
  return text;
}

static void __fastcall plate_show_hook(void *window, int shown, int first, int number,
                                       int x, int y) {
  int known = g_platesKnown;
  g_plateStart = walked_in_with(window, number);
  if (known != g_platesKnown && g_platesLogged < 8) {
    g_platesLogged++;
    log_hex("plate: a new one at ", (DWORD)window);
    log_num("       walked in with ", g_plateStart);
  }
  g_plateShow(window, shown, first, number, x, y);
  // Only while the engine is inside that call is the answer this plate's.
  g_plateStart = 0;
}

static int __fastcall finish_combat_hook(void *command, void *edx) {
  // A battle is over, so these windows are about to stand for other stacks —
  // and this command is the only way out of a battle there is. See
  // docs/engineInternals/COMBAT.md.
  g_platesKnown = 0;
  return g_finishCombat(command, edx);
}

static void install_stack_plates(void) {
  if (!have_key_state()) {
    log_line("stack plates: USER32 will not say which keys are down - not hooking");
    return;
  }
  g_countText = (CountTextFn)detour(COUNT_TEXT_RVA, COUNT_TEXT_HEAD, COUNT_TEXT_HEAD_LEN,
                                    &count_text_hook, "the count as text");
  g_plateShow = (PlateShowFn)detour(PLATE_SHOW_RVA, PLATE_SHOW_HEAD, PLATE_SHOW_HEAD_LEN,
                                    &plate_show_hook, "one plate");
  g_finishCombat = (FinishCombatFn)detour(FINISH_COMBAT_RVA, FINISH_COMBAT_HEAD,
                                          FINISH_COMBAT_HEAD_LEN, &finish_combat_hook,
                                          "the end of a battle");
  if (g_countText && g_plateShow) log_line("stack plates: losses shown while Shift is held");
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(self);
  find_our_dir(self);
  log_line("--- homm5-editor extension loaded");
  load_config();
  if (g_rowCount || g_skillRowCount) install_hooks();
  // Independent of the config: the functions are ours to offer whether or not
  // any artifact asks for a bonus, and a script that calls one is a different
  // user from an artifact that carries one.
  install_lua_functions();
  install_energy_getter();
  if (g_specRowCount) install_specialization_hooks();
  if (rows_for(STAT_TENT_CHARGES)) {
    // Both halves, or neither: the constructor notes the tent down and the
    // amount hook is where the note is redeemed.
    install_tent_term();
    if (install_machine_charges()) log_line("first aid tent charges hook installed");
  }
  // A player's own settings, read from their own file. The window has to be met
  // before the game makes it, and the game makes it from its entry point — which
  // is why this happens here and not on the first frame.
  load_qol();
  if (g_qol[QOL_BORDERLESS]) install_borderless();
  // Before the game asks, which it does early: the profile it loads decides
  // what the main menu already shows.
  if (g_qol[QOL_OWN_PROFILE]) install_own_profile(self);
  // Code of the game's own, so unlike the two above it can only be written once
  // the image is there to write on — which at DLL_PROCESS_ATTACH it is.
  if (g_qol[QOL_QUICK_SPLIT]) install_quick_split();
  if (g_qol[QOL_STACK_HEALTH] || g_qol[QOL_STACK_LOSSES]) install_stack_plates();
  return TRUE;
}

/** So the import that loads us has something to name. */
__declspec(dllexport) int homm5_editor_present(void) { return 1; }
