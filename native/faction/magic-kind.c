// A class without magic: its heroes learn no spell.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_magic_kind

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HAS. Whether a hero may learn a spell is `CanLearnSpell`
// (0xC200F0, called by the hero's own 0xC24480), and its rule is written in
// terms of one skill — HERO_SKILL_DEMONIC_RAGE, 172, Blood Rage, the
// barbarian's racial, read through the hero's mastery virtual (slot +0x174):
//
//   IsWarcry(spell)  →  Mastery(172) > 0
//   anything else    →  Mastery(172) <= 0
//
// A barbarian holds his racial from his first day, so the skill is a proxy
// for the class: a barbarian learns warcries and no spell, everyone else
// spells and no warcry. A class of OURS has a racial of its own, and Blood
// Rage is bound to class 8 — so its heroes learn spells, whatever their
// faction meant. The other seven askers of 172 are the rage mechanic itself
// (the rage points of the Horde's creatures) and stay the engine's.
//
// Warcries themselves were tried first (2026-09-18, launches 35–38: the
// nineteen `GetClass()==BARBARIAN` sites, the thirteen `type==STRONGHOLD`
// sites, a hall of Stronghold's records) and worked — and were rolled back:
// every warcry is a charge of rage, and rage is Blood Rage plus the Horde's
// creatures; without both a warcry is a word. What a faction without magic
// wants is the OTHER half of the rule, and that is this file: a class the
// editor marks `none` answers "holds Blood Rage" at the two gates and learns
// no spell, with an ordinary, empty book. The reading is in
// docs/engineInternals/FACTIONS.md, "Warcries: where the engine asks".
//
// WHAT WE DO. The editor writes `bin/homm5-editor-magic.txt`:
//
//   class <ordinal> none       a class of ours whose heroes learn no spell
//
// and each of the two gates — `push 0ACh / call dword ptr [reg+174h]`, the
// hero in ecx — has its six-byte call overwritten with a five-byte call to a
// thunk of ours and a nop. The thunk asks the hero his class the way the
// engine does (slot +0x258) and answers basic mastery for a class in the
// list, the engine's own mastery for everyone else. Both gates or neither.
// The town's side is data alone: a guild that is five stubs and no cell
// (src/mods/town-files.ts, `TownSpec.magic`). With no file the game is as it
// was.

#define MAX_MAGIC_ROWS 32

static int g_noMagicClasses[MAX_MAGIC_ROWS];
static int g_noMagicClassCount = 0;

static void load_magic_kinds(void) {
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-magic.txt", &got);
  if (!buf) return;
  const char *p = buf, *end = buf + got;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    const char *q = line;
    if (!take_word(&q, stop, "class")) continue;
    int id;
    if (!read_int(&q, stop, &id) || id <= 0) continue;
    if (!take_word(&q, stop, "none")) continue;
    if (g_noMagicClassCount < MAX_MAGIC_ROWS) g_noMagicClasses[g_noMagicClassCount++] = id;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("magic: classes without magic: ", g_noMagicClassCount);
}

static int is_no_magic_class(int c) {
  for (int i = 0; i < g_noMagicClassCount; i++) if (g_noMagicClasses[i] == c) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The thunk. `__fastcall` takes ecx and edx, which is what a site has loaded
// — the hero in ecx, the vtable in edx or eax — and its one stack argument,
// the site's `push 0ACh`, is popped here as the thiscall would pop it. The
// vtable is read off the object again rather than trusted from a register.

typedef int(__thiscall *IntOfObjectFn)(void *self);
typedef int(__thiscall *IntOfObjectIntFn)(void *self, int arg);

#define VT_HERO_CLASS 0x258u
#define VT_HERO_MASTERY 0x174u
#define HERO_SKILL_DEMONIC_RAGE 172
#define MASTERY_BASIC 1

static int __fastcall rage_mastery_as_asked(void *hero, void *edx_unused, int skill) {
  (void)edx_unused;
  void **vt = *(void ***)hero;
  if (skill == HERO_SKILL_DEMONIC_RAGE && is_no_magic_class(((IntOfObjectFn)vt[VT_HERO_CLASS / 4])(hero))) return MASTERY_BASIC;
  return ((IntOfObjectIntFn)vt[VT_HERO_MASTERY / 4])(hero, skill);
}

// ---------------------------------------------------------------------------
// The two gates. Six bytes each, `call dword ptr [reg+174h]`; the tail says
// which register held the vtable: 0x90 is eax, 0x92 is edx.

#define NO_MAGIC_SITE_01_RVA 0x820147u
static const BYTE NO_MAGIC_SITE_01_MARK[6] = { 0xFF, 0x92, 0x74, 0x01, 0x00, 0x00 };  // CanLearnSpell: the rule itself
#define NO_MAGIC_SITE_02_RVA 0x82452au
static const BYTE NO_MAGIC_SITE_02_MARK[6] = { 0xFF, 0x90, 0x74, 0x01, 0x00, 0x00 };  // the hero's copy: the warcry branch

typedef struct {
  DWORD rva;
  const BYTE *mark;
} MagicSite;

static const MagicSite NO_MAGIC_SITES[] = {
  { NO_MAGIC_SITE_01_RVA, NO_MAGIC_SITE_01_MARK }, { NO_MAGIC_SITE_02_RVA, NO_MAGIC_SITE_02_MARK },
};

/**
 * Every site of a list, or none: a build where one of them is not the bytes
 * we know is a build none of this was read on, and half the answer would be
 * worse than the engine's own. So the marks are all checked first, and only
 * then is anything written.
 */
static int install_magic_sites(const MagicSite *sites, int count, void *thunk, const char *what) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  for (int i = 0; i < count; i++) {
    const BYTE *at = base + sites[i].rva;
    for (int b = 0; b < 6; b++) {
      if (at[b] == sites[i].mark[b]) continue;
      log_text("not the bytes we know, none of these go in: ", what);
      return 0;
    }
  }
  for (int i = 0; i < count; i++) {
    BYTE *at = base + sites[i].rva;
    BYTE after[6] = { 0xE8, 0, 0, 0, 0, 0x90 };
    *(DWORD *)(after + 1) = (DWORD)thunk - ((DWORD)at + 5);
    if (!overwrite_code(sites[i].rva, sites[i].mark, after, 6, what)) return 0;
  }
  return 1;
}

static int install_magic_kinds(void) {
  if (!g_noMagicClassCount) return 0;
  return install_magic_sites(NO_MAGIC_SITES, (int)(sizeof NO_MAGIC_SITES / sizeof *NO_MAGIC_SITES),
                             (void *)rage_mastery_as_asked, "a class without magic");
}
