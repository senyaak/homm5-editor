// What the engine compiled per race, answered for a race of ours from a row.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_race_traits

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HAS. Three properties of a race are not data anywhere: they
// are `switch (townType - 3)` over the eight shipped values, compiled, with a
// default arm for anything else — which is what a ninth race is. The sweep
// that found them is docs/engineInternals/FACTIONS.md, "what the executable
// compiled per race".
//
//   0xB43E80  Alignment(town): 1 for Haven, Sylvan, Academy, Fortress; 2 for
//             Dungeon, Necropolis, Inferno, Stronghold; 0 for anything else.
//             Eighteen callers: the army's morale (0xB45C80 — a hero and a
//             creature of opposite alignments cost two), the chance a neutral
//             stack joins (0xD0CC10), six creature bonuses gated on it
//             (0xAB9920 …), the hero screen, the AI (0xC2EE80). A race of
//             ours is nobody's enemy and nobody's friend until it says.
//
//   0xB4F130  DwellingsGroupName(out, town): "DWELLINGS_HAVEN" … the name of
//             the shared group a random dwelling of that race is drawn from
//             (a map's `AdvMapDwelling` with a random race: 0x5D6DD0, and the
//             walk over every race at 0xD0F9B0). Default: the empty name, and
//             an empty name finds no group — a random dwelling of ours never
//             stands.
//   0xB53E04  the same switch again, inline in the dwelling resolver
//             0xB53D30 (the owner's race, the linked player's, the linked
//             town's, else the draw — src/rmg/world-race.ts reads it): eight
//             arms `push "DWELLINGS_…" / lea ecx,[esp+14h] / call String::
//             String / jmp 0xB53EB3`, and the default arm builds "" the same
//             way. Not a function to detour: the switch is in the middle of
//             one, so its TABLE moves out instead — the compare's bound and
//             the table's address are the two operands of the site, and a
//             table of ours has the engine's eight arms first and then, per
//             race of ours, an arm generated here that does what the eight do
//             with a name of ours.
//
//   0xD96BB0  SkillValueForHero(hero, skill): the AI's worth of a skill at a
//             level-up ("available skill/perk: %s (mastery %d, value %d)" at
//             0xD85086, chosen by 0xD84730). The skill's record (0xB1EF90:
//             table + 8 + id * 0xFC) holds `AIRacesValues` at +0x6C — eight
//             named blocks of 0x10, Haven's at +0x70, one per race in enum
//             order — and the hero's role (his vtable +0x2BC: 0 Freelancer,
//             1 Commander, 2 Collector, 3 Supplier) picks the field: +0xC
//             FreelancerValue, +4 CommanderValue, +8 CollectorSupplierValue.
//             Default: -1 for every skill, so a hero of ours levels up blind.
//             This is the ONE reader of that block in the image: the getter's
//             forty-six direct callers touch nothing past +0x64, and this one
//             reaches it through the thunk 0xB41E30.
//
// WHAT WE DO. A row per race of ours in `bin/homm5-editor-races.txt`, beside
// the picker's `race` lines (src/mods/race-order.ts writes both):
//
//   trait <townType> alignment good|evil|neutral
//   trait <townType> dwellings <sharedGroupName>
//   trait <townType> ai-skills-like <townType>
//   skillvalue <townType> <skill> <commander> <collectorSupplier> <freelancer>
//
// A race without a row is the engine's business: the three functions are
// detoured and fall through to their own code for any town they were compiled
// for, and for any of ours that says nothing. `ai-skills-like` names a shipped
// race whose block answers for ours; a `skillvalue` row answers for that one
// skill first. Nothing in the executable is extended in place.

#define MAX_SKILL_VALUE_ROWS 1024
#define DWELLINGS_NAME_LEN 64

typedef struct {
  int town;
  /** 0 neutral, 1 good, 2 evil; -1 when the row does not say. */
  int alignment;
  /** The shared group's name; empty when the row does not say. */
  char dwellings[DWELLINGS_NAME_LEN];
  /** A shipped town type whose AI block answers for ours; -1 when unsaid. */
  int aiLike;
} RaceTrait;

typedef struct {
  int town;
  int skill;
  /** CommanderValue, CollectorSupplierValue, FreelancerValue — the file's order. */
  int values[3];
} SkillValueRow;

static RaceTrait g_traits[MAX_RACES];
static int g_traitCount = 0;
static SkillValueRow g_skillValues[MAX_SKILL_VALUE_ROWS];
static int g_skillValueCount = 0;

static RaceTrait *trait_of(int town) {
  for (int i = 0; i < g_traitCount; i++) {
    if (g_traits[i].town == town) return &g_traits[i];
  }
  return NULL;
}

static RaceTrait *trait_for(int town) {
  RaceTrait *t = trait_of(town);
  if (t) return t;
  if (g_traitCount >= MAX_RACES) return NULL;
  t = &g_traits[g_traitCount++];
  t->town = town;
  t->alignment = -1;
  t->dwellings[0] = 0;
  t->aiLike = -1;
  return t;
}

static void load_race_traits(void) {
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-races.txt", &got);
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
    int town = 0;
    if (take_word(&q, stop, "trait")) {
      if (!read_int(&q, stop, &town) || town < SHIPPED_TOWN_TYPES) continue;
      RaceTrait *t = trait_for(town);
      if (!t) continue;
      if (take_word(&q, stop, "alignment")) {
        if (take_word(&q, stop, "good")) t->alignment = 1;
        else if (take_word(&q, stop, "evil")) t->alignment = 2;
        else if (take_word(&q, stop, "neutral")) t->alignment = 0;
      } else if (take_word(&q, stop, "dwellings")) {
        race_word(&q, stop, t->dwellings, sizeof t->dwellings);
      } else if (take_word(&q, stop, "ai-skills-like")) {
        int like = 0;
        if (read_int(&q, stop, &like) && like >= TOWN_HEAVEN && like < SHIPPED_TOWN_TYPES) t->aiLike = like;
      }
    } else if (take_word(&q, stop, "skillvalue")) {
      SkillValueRow r;
      if (!read_int(&q, stop, &r.town) || r.town < SHIPPED_TOWN_TYPES) continue;
      if (!read_int(&q, stop, &r.skill) || r.skill < 0) continue;
      if (!read_int(&q, stop, &r.values[0])) continue;
      if (!read_int(&q, stop, &r.values[1])) continue;
      if (!read_int(&q, stop, &r.values[2])) continue;
      if (!trait_for(r.town)) continue;
      if (g_skillValueCount < MAX_SKILL_VALUE_ROWS) g_skillValues[g_skillValueCount++] = r;
    }
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("race traits: races with rows: ", g_traitCount);
  log_num("race traits: skill value rows: ", g_skillValueCount);
}

// ---------------------------------------------------------------------------
// Alignment.

/** `add ecx,-3 / cmp ecx,7` — six bytes, two instructions; the `ja` after
 *  them reads the compare's flags, which the trampoline's jump leaves alone. */
#define ALIGNMENT_RVA 0x743e80u
static const BYTE ALIGNMENT_HEAD[6] = { 0x83, 0xC1, 0xFD, 0x83, 0xF9, 0x07 };

typedef int (__fastcall *AlignmentFn)(int town);
static AlignmentFn g_alignment = NULL;

static int __fastcall alignment_hook(int town) {
  RaceTrait *t = trait_of(town);
  if (t && t->alignment >= 0) {
    // Asked to speak: who asks about a race of ours, and what it was told.
    // The return address is the caller — the morale, the joining, a bonus.
    log_hex("race traits: alignment of ours asked from ", (DWORD)__builtin_return_address(0));
    log_num("  answered ", t->alignment);
    return t->alignment;
  }
  return g_alignment(town);
}

// ---------------------------------------------------------------------------
// The dwellings group, the function.

/** `add edx,-3 / push esi / mov esi,ecx` — six bytes, three instructions. */
#define DWELLINGS_NAME_RVA 0x74f130u
static const BYTE DWELLINGS_NAME_HEAD[6] = { 0x83, 0xC2, 0xFD, 0x56, 0x8B, 0xF1 };

typedef EngineName *(__fastcall *DwellingsNameFn)(EngineName *out, int town);
static DwellingsNameFn g_dwellingsName = NULL;

static EngineName *__fastcall dwellings_name_hook(EngineName *out, int town) {
  RaceTrait *t = trait_of(town);
  if (t && t->dwellings[0]) {
    g_stringCtor(out, NULL, t->dwellings);
    return out;
  }
  return g_dwellingsName(out, town);
}

// ---------------------------------------------------------------------------
// The dwellings group, the inline switch.
//
//   0xB53E04  cmp eax,7                    83 F8 07
//   0xB53E07  ja 0xB53E97                  0F 87 8A 00 00 00
//   0xB53E0D  jmp [eax*4+0xB53FB4]         FF 24 85 <B4 3F B5 00>
//
// The bound and the table's address are the two operands that change; the
// address bytes are the loader's under ASLR, so they are read, not compared.
// An arm of ours, in memory of ours, per race of ours:
//
//   push <name>                  68 <imm32>
//   lea ecx,[esp+14h]            8D 4C 24 14
//   call String::String(char*)   E8 <rel32>       (0x4DC940)
//   jmp 0xB53EB3                 E9 <rel32>       (the arms' common tail)

#define DWELLINGS_SWITCH_RVA 0x753e04u
static const BYTE DWELLINGS_SWITCH_HEAD[12] = {
  0x83, 0xF8, 0x07, 0x0F, 0x87, 0x8A, 0x00, 0x00, 0x00, 0xFF, 0x24, 0x85
};
#define DWELLINGS_TABLE_RVA 0x753fb4u
#define DWELLINGS_DEFAULT_RVA 0x753e97u
#define DWELLINGS_TAIL_RVA 0x753eb3u
#define SHIPPED_RACES 8
#define ARM_LEN 19

static int install_dwellings_switch(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *site = base + DWELLINGS_SWITCH_RVA;
  for (int i = 0; i < (int)sizeof DWELLINGS_SWITCH_HEAD; i++) {
    if (site[i] != DWELLINGS_SWITCH_HEAD[i]) {
      log_line("race traits: the dwelling resolver's switch is not the one measured - not moving it");
      return 0;
    }
  }
  DWORD **tableOperand = (DWORD **)(site + sizeof DWELLINGS_SWITCH_HEAD);
  if (*tableOperand != (DWORD *)(base + DWELLINGS_TABLE_RVA)) {
    log_line("race traits: the dwelling resolver's table is not where it was measured - not moving it");
    return 0;
  }

  int maxIndex = SHIPPED_RACES - 1;
  for (int i = 0; i < g_traitCount; i++) {
    if (g_traits[i].dwellings[0] && g_traits[i].town - TOWN_HEAVEN > maxIndex) maxIndex = g_traits[i].town - TOWN_HEAVEN;
  }
  if (maxIndex == SHIPPED_RACES - 1 || maxIndex > 127) return 0;

  int entries = maxIndex + 1;
  DWORD room = (DWORD)entries * 4 + (DWORD)g_traitCount * ARM_LEN;
  BYTE *page = (BYTE *)VirtualAlloc(NULL, room, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!page) { log_line("race traits: no memory for the dwelling table"); return 0; }
  DWORD *table = (DWORD *)page;
  BYTE *arm = page + entries * 4;
  const DWORD *shipped = (const DWORD *)(base + DWELLINGS_TABLE_RVA);
  for (int i = 0; i < SHIPPED_RACES; i++) table[i] = shipped[i];
  for (int i = SHIPPED_RACES; i < entries; i++) table[i] = (DWORD)(base + DWELLINGS_DEFAULT_RVA);
  int arms = 0;
  for (int i = 0; i < g_traitCount; i++) {
    if (!g_traits[i].dwellings[0]) continue;
    BYTE *a = arm + arms * ARM_LEN;
    a[0] = 0x68; *(DWORD *)(a + 1) = (DWORD)g_traits[i].dwellings;
    a[5] = 0x8D; a[6] = 0x4C; a[7] = 0x24; a[8] = 0x14;
    a[9] = 0xE8; *(DWORD *)(a + 10) = (DWORD)g_stringCtor - (DWORD)(a + 14);
    a[14] = 0xE9; *(DWORD *)(a + 15) = (DWORD)(base + DWELLINGS_TAIL_RVA) - (DWORD)(a + 19);
    table[g_traits[i].town - TOWN_HEAVEN] = (DWORD)a;
    arms++;
  }

  DWORD old = 0;
  if (!VirtualProtect(site, sizeof DWELLINGS_SWITCH_HEAD + 4, PAGE_EXECUTE_READWRITE, &old)) {
    log_line("race traits: could not make the dwelling resolver writable");
    return 0;
  }
  site[2] = (BYTE)maxIndex;
  *tableOperand = table;
  VirtualProtect(site, sizeof DWELLINGS_SWITCH_HEAD + 4, old, &old);
  FlushInstructionCache(GetCurrentProcess(), site, sizeof DWELLINGS_SWITCH_HEAD + 4);
  log_num("race traits: dwelling arms of ours: ", arms);
  return 1;
}

// ---------------------------------------------------------------------------
// The AI's worth of a skill.

/** `push esi / mov esi,ecx / push edi / test esi,esi` — six bytes; the `je`
 *  after them reads the test's flags. */
#define SKILL_VALUE_RVA 0x996bb0u
static const BYTE SKILL_VALUE_HEAD[6] = { 0x56, 0x8B, 0xF1, 0x57, 0x85, 0xF6 };
/** The skill record getter — `mov eax,[table] / imul ecx,0FCh`; the global's
 *  address is the loader's, so only the opcode and the stride are compared. */
#define SKILL_RECORD_RVA 0x71ef90u
/** The skill count — `mov eax,imm32 / ret`; the number is the editor's to raise. */
#define SKILL_COUNT_RVA 0x71ef80u
/** The hero's town type, and his AI role. */
#define VT_HERO_TOWN 0x254u
#define VT_HERO_ROLE 0x2BCu
/** Haven's block in the record; a block per race after it. */
#define RECORD_RACE_BLOCKS 0x70u
#define RACE_BLOCK_LEN 0x10u

typedef int (__fastcall *SkillValueFn)(void *hero, int skill);
typedef BYTE *(__fastcall *SkillRecordFn)(int skill);
typedef int (__fastcall *HeroIntFn)(void *hero);
static SkillValueFn g_skillValue = NULL;
static SkillRecordFn g_skillRecord = NULL;
static BYTE *g_skillCount = NULL;

/** Which of the three values a role reads: the engine's own arms. */
static int role_field(int role) {
  switch (role) {
    case 0: return 2;  // Freelancer  -> FreelancerValue, +0xC
    case 1: return 0;  // Commander   -> CommanderValue, +4
    case 2: case 3: return 1;  // Collector, Supplier -> CollectorSupplierValue, +8
    default: return -1;
  }
}

static int __fastcall skill_value_hook(void *hero, int skill) {
  if (!hero || readable_bytes(hero, 4) < 4) return g_skillValue(hero, skill);
  HeroIntFn townOf = (HeroIntFn)vtable_entry(hero, VT_HERO_TOWN);
  if (!townOf) return g_skillValue(hero, skill);
  int town = townOf(hero);
  RaceTrait *t = town >= SHIPPED_TOWN_TYPES ? trait_of(town) : NULL;
  if (!t) return g_skillValue(hero, skill);

  HeroIntFn roleOf = (HeroIntFn)vtable_entry(hero, VT_HERO_ROLE);
  if (!roleOf) return -1;
  int field = role_field(roleOf(hero));
  if (field < 0) return -1;

  int value = -1;
  int fromRow = 0;
  for (int i = 0; i < g_skillValueCount; i++) {
    if (g_skillValues[i].town == town && g_skillValues[i].skill == skill) { value = g_skillValues[i].values[field]; fromRow = 1; break; }
  }
  if (!fromRow && t->aiLike >= 0 && skill >= 0 && skill < *(int *)(g_skillCount + 1)) {
    BYTE *record = g_skillRecord(skill);
    if (record) {
      int *block = (int *)(record + RECORD_RACE_BLOCKS + (DWORD)(t->aiLike - TOWN_HEAVEN) * RACE_BLOCK_LEN);
      value = block[field + 1];
    }
  }
  // Every answer, when asked to speak: a level-up asks about every skill,
  // and which value won is the whole question a launch has to settle.
  log_num("race traits: skill ", skill);
  log_num(fromRow ? "  a row of ours says " : "  the borrowed block says ", value);
  return value;
}

// ---------------------------------------------------------------------------
// A probe on the army's morale, in a build that asks (`--log faction/race-traits`).
//
// Launch 40 read every stack's morale as 0 under a hero of a race of ours
// with creatures of the race, where 0xB45C80 as read — +1 for a stack of the
// hero's race — says otherwise. So the function itself is watched: what race
// it is handed for the hero, and what race each stack answers (0xAB98B0:
// the creature record's +0x98). Nothing is changed; the engine's runs after.

/** `sub esp,18h / push ebx / push ebp / push esi` — six bytes, four instructions. */
#define ARMY_MORALE_RVA 0x745c80u
static const BYTE ARMY_MORALE_HEAD[6] = { 0x83, 0xEC, 0x18, 0x53, 0x55, 0x56 };
/** `mov ecx,[ecx+1Ch] / call <record>` — the stack's creature race. */
#define STACK_RACE_RVA 0x6b98b0u
static const BYTE STACK_RACE_HEAD[3] = { 0x8B, 0x49, 0x1C };

typedef void (__fastcall *ArmyMoraleFn)(void *army, int heroRace, int base);
typedef int (__fastcall *StackRaceFn)(void *stack);
static ArmyMoraleFn g_armyMorale = NULL;
static StackRaceFn g_stackRace = NULL;

static void __fastcall army_morale_probe(void *army, int heroRace, int base) {
  log_num("morale: hero race ", heroRace);
  log_num("  base ", base);
  if (readable_bytes(army, 8) >= 8) {
    void **from = *(void ***)army, **to = *(void ***)((BYTE *)army + 4);
    for (int i = 0; from + i < to && i < 16; i++) {
      if (!from[i] || readable_bytes(from[i], 0x20) < 0x20) { log_num("  slot empty ", i); continue; }
      log_num("  stack race ", g_stackRace(from[i]));
    }
  }
  g_armyMorale(army, heroRace, base);
}

static int install_morale_probe(void) {
  if (!LOG_ON) return 0;
  g_stackRace = (StackRaceFn)code_at(STACK_RACE_RVA, STACK_RACE_HEAD, sizeof STACK_RACE_HEAD, "stack race");
  if (!g_stackRace) return 0;
  g_armyMorale = (ArmyMoraleFn)detour(ARMY_MORALE_RVA, ARMY_MORALE_HEAD, sizeof ARMY_MORALE_HEAD,
                                      &army_morale_probe, "army morale probe");
  return g_armyMorale != NULL;
}

// ---------------------------------------------------------------------------

static int install_race_traits(void) {
  if (!g_traitCount) return 0;
  int done = 0;

  int aligned = 0, housed = 0, valued = 0;
  for (int i = 0; i < g_traitCount; i++) {
    aligned += g_traits[i].alignment >= 0;
    housed += g_traits[i].dwellings[0] != 0;
    valued += g_traits[i].aiLike >= 0;
  }
  for (int i = 0; i < g_skillValueCount; i++) valued++;

  if (aligned) {
    g_alignment = (AlignmentFn)detour(ALIGNMENT_RVA, ALIGNMENT_HEAD, sizeof ALIGNMENT_HEAD,
                                      &alignment_hook, "race alignment");
    if (g_alignment) { log_num("race traits: alignments of ours: ", aligned); done++; }
    if (install_morale_probe()) log_line("race traits: the army's morale is being watched");
  }

  if (housed && g_stringCtor) {
    g_dwellingsName = (DwellingsNameFn)detour(DWELLINGS_NAME_RVA, DWELLINGS_NAME_HEAD,
                                              sizeof DWELLINGS_NAME_HEAD, &dwellings_name_hook,
                                              "dwellings group name");
    if (g_dwellingsName) { log_num("race traits: dwelling groups of ours: ", housed); done++; }
    if (install_dwellings_switch()) done++;
  } else if (housed) {
    log_line("race traits: no string constructor - the dwelling groups stay the engine's");
  }

  if (valued) {
    BYTE *base = (BYTE *)GetModuleHandleW(NULL);
    BYTE *getter = base + SKILL_RECORD_RVA;
    static const BYTE STRIDE[6] = { 0x69, 0xC9, 0xFC, 0x00, 0x00, 0x00 };
    int ok = getter[0] == 0xA1;
    for (int i = 0; i < 6; i++) ok = ok && getter[5 + i] == STRIDE[i];
    BYTE *count = base + SKILL_COUNT_RVA;
    ok = ok && count[0] == 0xB8 && count[5] == 0xC3;
    if (!ok) {
      log_line("race traits: the skill table's getter is not the one measured - the AI keeps its own values");
    } else {
      g_skillRecord = (SkillRecordFn)getter;
      g_skillCount = count;
      g_skillValue = (SkillValueFn)detour(SKILL_VALUE_RVA, SKILL_VALUE_HEAD, sizeof SKILL_VALUE_HEAD,
                                          &skill_value_hook, "AI skill value");
      if (g_skillValue) { log_num("race traits: AI skill values answered for rows: ", valued); done++; }
    }
  }
  return done;
}
