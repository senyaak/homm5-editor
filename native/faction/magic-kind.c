// A faction's magic: warcries for a class of ours, a hall for a town of ours.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_magic_kind

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HAS. The game ships one faction whose heroes shout instead
// of casting, and it never asks "does this hero use warcries" — it asks
// `IHero::GetClass() == HERO_CLASS_BARBARIAN` (vtable slot +0x258, answers
// compared to 1…8 and nothing else), at NINETEEN places:
//
//   0x70CC30 ×3  which book the spellbook button opens — CCreateOrcsSpellBook
//                for a barbarian, CCreateSpellBook for anyone else; the hero
//                found three ways (combat, adventure, hero screen)
//   0x8506F0 ×2  the town screen: a Stronghold with a barbarian in the
//                garrison or visiting teaches him its warcries (0x8C91F0)
//   0x859860 ×2  "does this town hold a barbarian" — the guild button's enable
//   0xACBC50     why a spell cannot be cast: answer 3 for a non-barbarian
//   0xB840B0     a barbarian casts no battle spell (earthquake among them)
//   0xBCBD20, 0xBCBE70  a perk's multiplier: a barbarian with skill 8 at
//                expert — inert without the skill
//   0xC1F8C0, 0xC2A400, 0xD16920  the AI: what a barbarian is worth casting
//   0xD35B20, 0xD47240  learning: TT_SPELL_LEARNED, the rune/warcry branch
//   0xD36380, 0xD366A0  may this hero cast this: a barbarian skips the school
//   0xD3BDC0     a spell's cost for a barbarian goes through 0xB42570
//
// And the town side asks `type == TOWN_STRONGHOLD` (the type virtual at slot
// +0xD4, compared to 10) at twelve places, nine of them about the guild:
//
//   0x8564A0     which building the guild button stands for: TB_SPECIAL_1
//                (17, the Hall of Trial) for a Stronghold, TB_MAGIC_GUILD (6)
//   0x851D20     the guild button's enable: a barbarian present (0x859860)
//                for a Stronghold, the guild's level for the rest
//   0x84D690 → 0x8506F0 ×2  entering the town: teach warcries, not spells
//   0x8BA6B0     the guild window's header: T_ORCS_HEADER
//   0xAC30D0, 0xACAF50  a record of kind TB_MAGIC_GUILD in a Stronghold is
//                not a building one can build — its five records are stubs
//   0xAC7B40, 0xAC7D80  build rules: what needs the guild's level elsewhere
//                needs nothing of the kind in a Stronghold
//
// The other three (0x850550, 0x856060, 0x856330) are Stronghold's own
// specials — the Slave Market, the Traveller's Shelter over the artifact
// merchant — and are left alone: a faction of ours has specials of its own.
//
// WHAT WE DO. The editor writes `bin/homm5-editor-magic.txt`:
//
//   class <ordinal> warcries       a class of ours that shouts
//   town <townType> warcries       a town of ours whose guild is a hall
//
// and every site above is the same six bytes — `call dword ptr [reg+slot]`,
// the object in ecx — overwritten with a five-byte call to a thunk of ours and
// a nop. The thunk calls the same virtual the site would have, and answers
// HERO_CLASS_BARBARIAN for a class in the first list, TOWN_STRONGHOLD for a
// town in the second, and what the engine said otherwise. Nothing else about
// the class or the town changes: the hero's level-ups still walk HIS class's
// row of the table, the town's specials are still its own, because those read
// the class and the type through other paths. The sites are only where the
// question is "does this one use warcries", and there the answer is ours.
//
// The hall itself is data: the faction's TB_SPECIAL_1, three levels, and the
// guild's five records the stubs Stronghold's are (src/mods/town-files.ts,
// `TownSpec.magic`). With no file the game is as it was.

#define MAX_MAGIC_ROWS 32

static int g_warcryClasses[MAX_MAGIC_ROWS];
static int g_warcryClassCount = 0;
static int g_hallTowns[MAX_MAGIC_ROWS];
static int g_hallTownCount = 0;

/** What the sites compare against. */
#define HERO_CLASS_BARBARIAN 8
#define TOWN_STRONGHOLD 10

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
    int *list, *count;
    if (take_word(&q, stop, "class")) { list = g_warcryClasses; count = &g_warcryClassCount; }
    else if (take_word(&q, stop, "town")) { list = g_hallTowns; count = &g_hallTownCount; }
    else continue;
    int id;
    if (!read_int(&q, stop, &id) || id <= 0) continue;
    if (!take_word(&q, stop, "warcries")) continue;
    if (*count < MAX_MAGIC_ROWS) list[(*count)++] = id;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("magic: classes of warcries: ", g_warcryClassCount);
  log_num("magic: towns with a hall: ", g_hallTownCount);
}

static int is_warcry_class(int c) {
  for (int i = 0; i < g_warcryClassCount; i++) if (g_warcryClasses[i] == c) return 1;
  return 0;
}

static int is_hall_town(int t) {
  for (int i = 0; i < g_hallTownCount; i++) if (g_hallTowns[i] == t) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The two thunks. `__fastcall` takes ecx and edx, which is what a site has
// loaded — the object in ecx, the vtable (or nothing) in edx — and pops
// nothing, like the thiscall it stands in for. The vtable is read off the
// object again rather than trusted from the register: eax or edx held it,
// depending on the site, and the object is the one thing every site agrees on.

typedef int(__thiscall *IntOfObjectFn)(void *self);

#define VT_HERO_CLASS 0x258u
#define VT_TOWN_TYPE 0xD4u

static int __fastcall hero_class_as_asked(void *hero, void *edx_unused) {
  (void)edx_unused;
  int c = ((IntOfObjectFn)(*(void ***)hero)[VT_HERO_CLASS / 4])(hero);
  return is_warcry_class(c) ? HERO_CLASS_BARBARIAN : c;
}

static int __fastcall town_type_as_asked(void *town, void *edx_unused) {
  (void)edx_unused;
  int t = ((IntOfObjectFn)(*(void ***)town)[VT_TOWN_TYPE / 4])(town);
  return is_hall_town(t) ? TOWN_STRONGHOLD : t;
}

// ---------------------------------------------------------------------------
// The sites. Each is the six bytes of `call dword ptr [reg+slot]`, and the
// tail says which register held the vtable: 0x90 is eax, 0x92 is edx.

#define CLASS_SITE_01_RVA 0x30cc7au
static const BYTE CLASS_SITE_01_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // which book: the combat's hero
#define CLASS_SITE_02_RVA 0x30ccc4u
static const BYTE CLASS_SITE_02_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // which book: the adventure's hero
#define CLASS_SITE_03_RVA 0x30ccefu
static const BYTE CLASS_SITE_03_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // which book: the hero screen's
#define CLASS_SITE_04_RVA 0x450793u
static const BYTE CLASS_SITE_04_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // town screen teaches: the garrison's hero
#define CLASS_SITE_05_RVA 0x4507ccu
static const BYTE CLASS_SITE_05_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // town screen teaches: the visitor
#define CLASS_SITE_06_RVA 0x459893u
static const BYTE CLASS_SITE_06_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // a barbarian in town: the garrison's
#define CLASS_SITE_07_RVA 0x4598beu
static const BYTE CLASS_SITE_07_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // a barbarian in town: the visitor
#define CLASS_SITE_08_RVA 0x6cbd02u
static const BYTE CLASS_SITE_08_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // why a cast is refused
#define CLASS_SITE_09_RVA 0x784414u
static const BYTE CLASS_SITE_09_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // no battle spell for a barbarian
#define CLASS_SITE_10_RVA 0x7cbd7au
static const BYTE CLASS_SITE_10_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // a perk's multiplier, with skill 8
#define CLASS_SITE_11_RVA 0x7cc863u
static const BYTE CLASS_SITE_11_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // the same perk, the other caller
#define CLASS_SITE_12_RVA 0x81f910u
static const BYTE CLASS_SITE_12_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // the AI: a barbarian's spells
#define CLASS_SITE_13_RVA 0x82a408u
static const BYTE CLASS_SITE_13_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // the AI: worth of a warcry
#define CLASS_SITE_14_RVA 0x916ce7u
static const BYTE CLASS_SITE_14_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // the AI: a hero's casting
#define CLASS_SITE_15_RVA 0x935b86u
static const BYTE CLASS_SITE_15_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // learning: the rune/warcry branch
#define CLASS_SITE_16_RVA 0x936576u
static const BYTE CLASS_SITE_16_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // may this hero cast this
#define CLASS_SITE_17_RVA 0x9366d1u
static const BYTE CLASS_SITE_17_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // a barbarian skips the school check
#define CLASS_SITE_18_RVA 0x93be09u
static const BYTE CLASS_SITE_18_MARK[6] = { 0xFF, 0x92, 0x58, 0x02, 0x00, 0x00 };  // a spell's cost for a barbarian
#define CLASS_SITE_19_RVA 0x947787u
static const BYTE CLASS_SITE_19_MARK[6] = { 0xFF, 0x90, 0x58, 0x02, 0x00, 0x00 };  // learning: TT_SPELL_LEARNED

#define TOWN_SITE_01_RVA 0x44d92cu
static const BYTE TOWN_SITE_01_MARK[6] = { 0xFF, 0x92, 0xD4, 0x00, 0x00, 0x00 };  // entering the town: teach warcries
#define TOWN_SITE_02_RVA 0x450589u
static const BYTE TOWN_SITE_02_MARK[6] = { 0xFF, 0x92, 0xD4, 0x00, 0x00, 0x00 };  // the teaching: the town asked again
#define TOWN_SITE_03_RVA 0x45075du
static const BYTE TOWN_SITE_03_MARK[6] = { 0xFF, 0x92, 0xD4, 0x00, 0x00, 0x00 };  // the teaching: with the hero
#define TOWN_SITE_04_RVA 0x451d7cu
static const BYTE TOWN_SITE_04_MARK[6] = { 0xFF, 0x90, 0xD4, 0x00, 0x00, 0x00 };  // the guild button's enable
#define TOWN_SITE_05_RVA 0x4564e4u
static const BYTE TOWN_SITE_05_MARK[6] = { 0xFF, 0x90, 0xD4, 0x00, 0x00, 0x00 };  // which building the guild button is
#define TOWN_SITE_06_RVA 0x4ba72eu
static const BYTE TOWN_SITE_06_MARK[6] = { 0xFF, 0x90, 0xD4, 0x00, 0x00, 0x00 };  // the guild window's header
#define TOWN_SITE_07_RVA 0x6c30f5u
static const BYTE TOWN_SITE_07_MARK[6] = { 0xFF, 0x92, 0xD4, 0x00, 0x00, 0x00 };  // a guild record is no building here
#define TOWN_SITE_08_RVA 0x6c7c05u
static const BYTE TOWN_SITE_08_MARK[6] = { 0xFF, 0x90, 0xD4, 0x00, 0x00, 0x00 };  // build rules: the guild's level
#define TOWN_SITE_09_RVA 0x6c7db8u
static const BYTE TOWN_SITE_09_MARK[6] = { 0xFF, 0x90, 0xD4, 0x00, 0x00, 0x00 };  // build rules: what may be built
#define TOWN_SITE_10_RVA 0x6caf76u
static const BYTE TOWN_SITE_10_MARK[6] = { 0xFF, 0x92, 0xD4, 0x00, 0x00, 0x00 };  // the build list skips the guild

typedef struct {
  DWORD rva;
  const BYTE *mark;
} MagicSite;

static const MagicSite CLASS_SITES[] = {
  { CLASS_SITE_01_RVA, CLASS_SITE_01_MARK }, { CLASS_SITE_02_RVA, CLASS_SITE_02_MARK },
  { CLASS_SITE_03_RVA, CLASS_SITE_03_MARK }, { CLASS_SITE_04_RVA, CLASS_SITE_04_MARK },
  { CLASS_SITE_05_RVA, CLASS_SITE_05_MARK }, { CLASS_SITE_06_RVA, CLASS_SITE_06_MARK },
  { CLASS_SITE_07_RVA, CLASS_SITE_07_MARK }, { CLASS_SITE_08_RVA, CLASS_SITE_08_MARK },
  { CLASS_SITE_09_RVA, CLASS_SITE_09_MARK }, { CLASS_SITE_10_RVA, CLASS_SITE_10_MARK },
  { CLASS_SITE_11_RVA, CLASS_SITE_11_MARK }, { CLASS_SITE_12_RVA, CLASS_SITE_12_MARK },
  { CLASS_SITE_13_RVA, CLASS_SITE_13_MARK }, { CLASS_SITE_14_RVA, CLASS_SITE_14_MARK },
  { CLASS_SITE_15_RVA, CLASS_SITE_15_MARK }, { CLASS_SITE_16_RVA, CLASS_SITE_16_MARK },
  { CLASS_SITE_17_RVA, CLASS_SITE_17_MARK }, { CLASS_SITE_18_RVA, CLASS_SITE_18_MARK },
  { CLASS_SITE_19_RVA, CLASS_SITE_19_MARK },
};

static const MagicSite TOWN_SITES[] = {
  { TOWN_SITE_01_RVA, TOWN_SITE_01_MARK }, { TOWN_SITE_02_RVA, TOWN_SITE_02_MARK },
  { TOWN_SITE_03_RVA, TOWN_SITE_03_MARK }, { TOWN_SITE_04_RVA, TOWN_SITE_04_MARK },
  { TOWN_SITE_05_RVA, TOWN_SITE_05_MARK }, { TOWN_SITE_06_RVA, TOWN_SITE_06_MARK },
  { TOWN_SITE_07_RVA, TOWN_SITE_07_MARK }, { TOWN_SITE_08_RVA, TOWN_SITE_08_MARK },
  { TOWN_SITE_09_RVA, TOWN_SITE_09_MARK }, { TOWN_SITE_10_RVA, TOWN_SITE_10_MARK },
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
  int ok = 1;
  if (g_warcryClassCount) {
    ok &= install_magic_sites(CLASS_SITES, (int)(sizeof CLASS_SITES / sizeof *CLASS_SITES),
                              (void *)hero_class_as_asked, "a class of warcries");
  }
  if (g_hallTownCount) {
    ok &= install_magic_sites(TOWN_SITES, (int)(sizeof TOWN_SITES / sizeof *TOWN_SITES),
                              (void *)town_type_as_asked, "a town with a hall");
  }
  return ok;
}
