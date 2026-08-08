// The ultimate: mana spent in battle, paid back as uses.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT combat_tent_mana

// ---------------------------------------------------------------------------
// The ultimate: mana spent in a battle, paid back as uses of the tent.
//
// TWO HALVES, and the one that had to be found is the counting. Every change to
// a caster's mana inside a battle goes through ONE command —
// `CSetCombatCasterMana`, whose whole `Execute` is "take the caster out of the
// command and hand it the number the command carries" (0xb74300). It is a
// networked command, which is exactly why it is a funnel: a multiplayer game
// cannot afford a second route that the other side would not hear about.
//
//     [cmd+0x0C]  the caster        [cmd+0x10]  what his mana becomes
//     [caster vtable +0x234]  what it is now    +0x22C  set it
//
// The pair of slots is the engine's own: a mana-draining spell reads +0x234,
// adds, and writes +0x22C on the same object twice over (0xb78929, 0xb78949).
// So "how much did he spend" is the difference between what we read before the
// command runs and what the command is about to write — no second guess, and
// nothing of ours has to know what a spell costs.
//
// GIVING IT BACK needs the tent, and the tent knows its hero rather than the
// other way round. So the amount hook writes down every tent it sees together
// with the three pointers its owner answers on, and the counting side matches
// the caster against all three. Which of them it is has never been measured, and
// a table of three costs nothing — see the log line, which says what matched.
#define TENTS_KNOWN 4
static struct {
  void *machine;  /**< the combat war machine, whose charges are at +0xB0 */
  void *hero;     /**< as `unit_hero` reaches him */
  void *base;     /**< his virtual base — level and specialization answer here */
  void *skills;   /**< one call further along — his skills answer here */
} g_tents[TENTS_KNOWN];
static int g_tentAt = 0;

/**
 * What one caster has spent this battle, and how much of it we have paid for.
 *
 * `given` rather than a remainder, because the rate is read afresh every time:
 * the honest question is "how many charges has all of this spending earned",
 * and what is owed is that minus what has already been handed over.
 */
#define CASTERS_WATCHED 4
static struct { void *caster; int spent; int given; } g_casters[CASTERS_WATCHED];
static int g_casterAt = 0;
static int g_manaLogged = 0;

static void note_tent(void *unit, void *hero, void *base, void *skills) {
  void *m = (BYTE *)unit - MACHINE_AS_UNIT;
  // That this really is a tent is asked here rather than assumed: what gets
  // written later is `+0xB0` of this object, and the charges hook has the
  // pending list to keep it honest where this has nothing.
  if (!readable((BYTE *)m + MACHINE_WORLD, 4)) return;
  void *world = *(void **)((BYTE *)m + MACHINE_WORLD);
  if (!readable((BYTE *)world + WORLD_MACHINE_TYPE, 4)) return;
  if (*(int *)((BYTE *)world + WORLD_MACHINE_TYPE) != MACHINE_TYPE_TENT) return;
  for (int i = 0; i < TENTS_KNOWN; i++) if (g_tents[i].machine == m) return;
  int at = g_tentAt++ & (TENTS_KNOWN - 1);
  g_tents[at].machine = m;
  g_tents[at].hero = hero;
  g_tents[at].base = base;
  g_tents[at].skills = skills;
}

/** The tent of the hero this caster is, or nothing when he brought none. */
static int tent_of_caster(void *caster) {
  for (int i = 0; i < TENTS_KNOWN; i++) {
    if (!g_tents[i].machine) continue;
    if (caster == g_tents[i].hero || caster == g_tents[i].base || caster == g_tents[i].skills) return i;
  }
  return -1;
}

/** Mana spent by this caster, and the charges it has earned him so far. */
static void note_mana(void *caster, int spent) {
  int at = -1;
  for (int i = 0; i < CASTERS_WATCHED; i++) if (g_casters[i].caster == caster) { at = i; break; }
  if (at < 0) {
    at = g_casterAt++ & (CASTERS_WATCHED - 1);
    g_casters[at].caster = caster;
    g_casters[at].spent = 0;
    g_casters[at].given = 0;
  }
  g_casters[at].spent += spent;

  int tent = tent_of_caster(caster);
  if (tent < 0) return;
  // The rate is the hero's, asked the way every other row of ours is asked, and
  // it is per HUNDRED points so that a level of mastery can be worth a sensible
  // fraction of a charge rather than a whole one.
  int rate = hero_term(g_tents[tent].skills, STAT_TENT_MANA, 0);
  if (rate <= 0) return;
  int earned = g_casters[at].spent * rate / 100;
  int owed = earned - g_casters[at].given;
  if (owed <= 0) return;
  if (!readable((BYTE *)g_tents[tent].machine + MACHINE_CHARGES, 4)) return;
  *(int *)((BYTE *)g_tents[tent].machine + MACHINE_CHARGES) += owed;
  g_casters[at].given = earned;
  if (g_manaLogged++ >= 16) return;
  log_line("tent mana:");
  log_num("  spent in all ", g_casters[at].spent);
  log_num("  charges back ", owed);
}

#define CASTER_MANA_RVA 0x774300u
static const BYTE CASTER_MANA_HEAD[DETOUR_LEN] = { 0x8B, 0xD1, 0x8B, 0x4A, 0x0C };
/** Where the command keeps the caster and the number it is about to write. */
#define MANA_CMD_CASTER 0x0Cu
#define MANA_CMD_VALUE 0x10u

typedef char(__fastcall *CasterManaFn)(void *cmd, void *edx);
typedef int(__thiscall *ManaGetterFn)(void *caster);
static CasterManaFn g_casterMana = NULL;

/** What the caster's mana is at this moment, or -1 if he will not say. */
static int caster_mana(void *caster) {
  if (!readable(caster, 4)) return -1;
  void **vt = *(void ***)caster;
  if (!readable(vt, VT_CASTER_MANA + 4)) return -1;
  void *fn = vt[VT_CASTER_MANA / 4];
  if (!points_at_code(fn)) return -1;
  int mana = ((ManaGetterFn)fn)(caster);
  // A number no hero has. Reading the wrong slot would answer something, and
  // "something" must not be allowed to look like spending.
  return mana < 0 || mana > 100000 ? -1 : mana;
}

static char __fastcall caster_mana_hook(void *cmd, void *edx) {
  void *caster = NULL;
  int before = -1, after = -1;
  if (readable((BYTE *)cmd + MANA_CMD_VALUE, 4)) {
    caster = *(void **)((BYTE *)cmd + MANA_CMD_CASTER);
    after = *(int *)((BYTE *)cmd + MANA_CMD_VALUE);
    before = caster_mana(caster);
  }
  char ok = g_casterMana(cmd, edx);
  // Said out loud, bounded: "the command never came" and "it came and we made
  // nothing of it" are different faults, and a hook that only speaks when it
  // acts cannot tell them apart. A spell cast with no line here means the mana
  // does not travel this way at all.
  if (g_manaLogged < 16) {
    log_line("caster mana command:");
    log_num("  was ", before);
    log_num("  now ", after);
  }
  // Only downwards: the same command hands mana BACK, and a hero drinking from
  // a well has not earned anything.
  if (ok && caster && before >= 0 && before > after) note_mana(caster, before - after);
  // The script hears about it either way, up or down — what a perk of somebody
  // else's makes of a hero being GIVEN mana is not ours to decide here. New
  // first, as the name says: `H5EFire(2, now, before)`.
  if (ok && caster && before >= 0) fire_trigger(TRIGGER_HERO_MANA_CHANGED, 2, after, before, 0);
  return ok;
}

/** Installed only when a row asks for it — one detour, and nothing else. */
static int install_caster_mana(void) {
  g_casterMana = (CasterManaFn)detour(CASTER_MANA_RVA, CASTER_MANA_HEAD, DETOUR_LEN,
                                      &caster_mana_hook, "combat caster mana");
  return g_casterMana != NULL;
}

/** Installed only when a row asks for it — one detour, and nothing else. */
static int install_machine_health(void) {
  g_machineHealth = (MachineHealthFn)detour(MACHINE_HEALTH_RVA, MACHINE_HEALTH_HEAD,
                                            MACHINE_HEALTH_HEAD_LEN, &machine_health_hook,
                                            "war machine health");
  return g_machineHealth != NULL;
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

