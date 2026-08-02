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

#define DETOUR_LEN 5
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

/**
 * Whether `n` bytes at `p` can be read without taking the process down.
 *
 * The first version of this probe walked the owner chain from the constructor's
 * object and killed the battle. `points_at_code` cannot save a walk like that:
 * it filters the pointer it is HANDED, and the fault was in fetching that
 * pointer from a vtable that is not one. So nothing is dereferenced now without
 * asking the kernel first, and — the real fix — nothing is CALLED at all.
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
  g_original = (RaiseFn)detour(RAISE_PERCENT_RVA, RAISE_PERCENT_HEAD, &raise_percent_hook, "raise percent");
  if (!g_original) return 0;
  // Watching only, and a failure here is not fatal: the percentage is the part
  // that has to work.
  g_originalCost = (CostFn)detour(RAISE_COST_RVA, RAISE_COST_HEAD, &raise_cost_hook, "raise cost");
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
  g_tentAmount = (TentAmountFn)detour(TENT_AMOUNT_RVA, TENT_AMOUNT_HEAD,
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
  g_machineCtor = (MachineCtorFn)detour(MACHINE_CTOR_RVA, MACHINE_CTOR_HEAD,
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
  return TRUE;
}

/** So the import that loads us has something to name. */
__declspec(dllexport) int homm5_editor_present(void) { return 1; }
