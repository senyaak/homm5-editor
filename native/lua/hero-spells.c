// May this hero hold this spell — the engine's own two questions, for a script.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_hero_spells

// ---------------------------------------------------------------------------
// WHY FUNCTIONS OF OURS AT ALL. `TeachHeroSpell` hands over whatever it is
// given and the engine then refuses half of it in silence: a barbarian is
// refused every school but war cries, a knight is refused the cries, a wizard
// with no Dark Magic is refused Curse, and a hero short of a level is refused
// the spell that asks for it. A script has no way to ask any of that — so it
// asks here, and the answer is the engine's, not a copy of its rules.
//
// A BOX NEEDS BOTH HALVES TOLD APART. Refused for what the hero IS, he is paid
// in experience the way the game's own shrines pay him; refused for what he has
// not got yet — a skill, a level — the spell is simply lost. So `CanLearnSpell`
// answers "will it land" and the school gate answers "is it even his kind".
//
// WHAT USED TO BE HERE. A barbarian's adventure magic is the TALISMAN, bought a
// level at a time at the Traveller's Shelter, and this file once raised it by
// one — `H5ETalismanStep`, over `CHero`'s vt+0x300/+0x304/+0x384. It is GONE
// (Senya, 12.08.2026): a box hands nobody a talisman, and a barbarian handed
// Town Portal is paid for it like any other magic. The reading behind it, and
// what it would take to bring it back, are in
// docs/engineInternals/SPELLS.md and docs/PANDORA_BOX.md.

/** `NWorld::CHero`'s primary vtable — the one class in the build with a 0x304. */
#define CHERO_VTABLE_RVA 0xbc69fcu

#define VT_HERO_RACE 0x258u

/** `TOWN_STRONGHOLD` as the race slot answers it — the Horde, and only it. */
#define RACE_STRONGHOLD 8

typedef int(__fastcall *HeroRaceFn)(void *hero, void *edx);

// --- may this hero hold this spell at all ------------------------------------
//
// THE SAME QUESTION THE ENGINE ASKS ITSELF, and asking it any other way would
// be a second copy of a rule that already exists. `0xc200f0` reads the school
// off the spell's own record and answers for every case at once: a barbarian
// and a battle spell, a knight and a war cry, anybody and a rune. Nothing here
// knows what a school is.
//
// It takes the RECORD, not the number — `SpellRecord(id)` is the same accessor
// the announcement path uses (docs/engineInternals/PANDORA_OBJECT.md).

// The record accessor is `g_spellRecord`, already recognised and kept by
// combat/spell-record.c — one file above this one in the translation unit. A
// second copy of the same anchor is a second thing to keep true.

/**
 * `CHero::CanLearnSpell` — the WHOLE question, as the game asks it.
 *
 * `__fastcall(hero, &needSkill, &needMastery, &needLevel, spellId)`, `ret 0x10`,
 * answering 0 or 1 and filling the three outs with what is missing (the level
 * comes off the record's `+0x8C`, which is `RequiredHeroLevel`).
 *
 * WHY NOT THE SCHOOL GATE. `0xc200f0` answers "does this hero cast or shout",
 * and that is one of four things the game checks: it also wants the SKILL of
 * the spell's school, the hero's LEVEL against the record, and the runic case
 * of its own. A wizard with no Dark Magic passes the gate and is handed
 * Curse — which is what a play-through showed, and what the game itself never
 * does. This is the function the spell shop and the shrine go through, and it
 * takes the hero as the lookup hands him over: `[hero-0x1c]` for the gate is
 * something it works out itself.
 */
#define CAN_LEARN_RVA 0x824480u
static const BYTE CAN_LEARN_HEAD[8] = { 0x8B, 0x44, 0x24, 0x04, 0x53, 0x8B, 0x5C, 0x24 };

/**
 * The outs, in the order the code fills them: LEVEL first — `mov [eax],esi`
 * with `esi = [record+0x8C]` and `eax` the first argument — then the skill and
 * the mastery of it. Read off the run rather than assumed: a war cry refused a
 * level-1 barbarian came back (2, 0, 0), which is `RequiredHeroLevel` 2 and no
 * skill named, and a destructive spell came back (0, 9, 2) — no level, skill 9
 * (`HERO_SKILL_DESTRUCTIVE_MAGIC`), at mastery 2.
 */
typedef char(__fastcall *CanLearnFn)(void *hero, void *edx, int *needLevel, int *needSkill,
                                     int *needMastery, int spell);

/** `CHero::CanHoldSpell` — `__fastcall(wholeHero, spellId)`, the school half. */
#define CAN_HOLD_RVA 0x8200f0u
static const BYTE CAN_HOLD_HEAD[5] = { 0x56, 0x8B, 0x74, 0x24, 0x08 };

typedef char(__fastcall *CanHoldFn)(void *hero, void *edx, int spell);

/**
 * `H5ECanLearnSpell(heroName, spellId)` - 1 when he may, nothing when he may not.
 *
 * Nothing is also the answer when the question cannot be asked at all: no such
 * hero, no such spell. A caller that pays for "may not" would then pay for a
 * typo too, which is the right way round - the box hands something over either
 * way, and a silent nothing is the failure worth avoiding.
 *
 * The three outs the engine fills (skill, mastery, level) are read only for the
 * log: what is MISSING is the game's business to say, and a box only needs to
 * know whether the spell will land.
 */
static void *__fastcall lua_can_learn_spell(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  int spell = 0;
  if (!name || !lua_arg_int(ctx, 2, &spell)) {
    log_line("H5ECanLearnSpell: takes a hero's script name and a spell id");
    return NULL;
  }
  void *map = adventure_map(ctx);
  void *find = map ? vtable_entry(map, VT_FIND_BY_NAME) : NULL;
  if (!find) {
    log_line("H5ECanLearnSpell: no adventure map to ask for the hero");
    return NULL;
  }
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero) || !is_a(hero, CHERO_VTABLE_RVA)) {
    log_line("H5ECanLearnSpell: no living CHero of that name");
    return NULL;
  }
  CanLearnFn canLearn = (CanLearnFn)code_at(CAN_LEARN_RVA, CAN_LEARN_HEAD,
                                            sizeof CAN_LEARN_HEAD, "the can-learn question");
  if (!g_spellRecord || !canLearn) {
    log_line("H5ECanLearnSpell: the record accessor or the question is not where it was measured");
    return NULL;
  }
  // The record is fetched only to be SURE THE SPELL EXISTS: a number with no
  // document behind it would make the box teach nothing while reporting that it
  // had, and paying for it would be just as wrong.
  if (!g_spellRecord(spell)) {
    log_num("H5ECanLearnSpell: the game has no spell ", spell);
    return NULL;
  }
  int needLevel = 0, needSkill = 0, needMastery = 0;
  char may = canLearn(hero, NULL, &needLevel, &needSkill, &needMastery, spell);
  if (may) {
    log_num("H5ECanLearnSpell: yes, spell ", spell);
  } else {
    log_num("H5ECanLearnSpell: no, spell ", spell);
    log_num("                  it wants hero level ", needLevel);
    log_num("                  and skill ", needSkill);
    log_num("                  at mastery ", needMastery);
  }
  return may ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

/**
 * The WHOLE hero, from the subobject the lookup hands out.
 *
 * `FindObjectByName` answers with the interface at +0x1c, and the school gate
 * takes the object PROPER — it reaches that interface itself with `[this+0x1c]`.
 * Given the subobject it lands 0x1c further along, reads a vtable that is not
 * one and calls address zero: the game died on the first war cry handed to a
 * knight. (`CanLearnSpell` wants the interface, and does the same subtraction
 * inside — which is how the two came to differ.)
 *
 * Not a constant: the dword before every vtable is the complete-object locator,
 * and its second word is how deep that subobject sits.
 */
static void *whole_hero(void *sub) {
  if (!readable(sub, 4)) return sub;
  DWORD vt = *(const DWORD *)sub;
  if (!readable((const void *)(DWORD_PTR)(vt - 4), 4)) return sub;
  DWORD locator = *(const DWORD *)(DWORD_PTR)(vt - 4);
  if (!readable((const void *)(DWORD_PTR)locator, 8)) return sub;
  DWORD into = ((const DWORD *)(DWORD_PTR)locator)[1];
  return into < 0x1000 ? (void *)((BYTE *)sub - into) : sub;
}

/**
 * `H5ECanHoldSpell(heroName, spellId)` — the SCHOOL half on its own.
 *
 * Which is a different question from `H5ECanLearnSpell`, and the box needs
 * both: a spell refused because of what the hero IS (a barbarian handed magic,
 * a knight handed a war cry) is paid for; one refused because he is too young
 * or lacks the skill is simply lost, the way it is at a shrine. Told apart
 * here, decided in the script.
 */
static void *__fastcall lua_can_hold_spell(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  int spell = 0;
  if (!name || !lua_arg_int(ctx, 2, &spell)) {
    log_line("H5ECanHoldSpell: takes a hero's script name and a spell id");
    return NULL;
  }
  void *map = adventure_map(ctx);
  void *find = map ? vtable_entry(map, VT_FIND_BY_NAME) : NULL;
  if (!find) return NULL;
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero) || !is_a(hero, CHERO_VTABLE_RVA)) return NULL;
  CanHoldFn canHold = (CanHoldFn)code_at(CAN_HOLD_RVA, CAN_HOLD_HEAD,
                                         sizeof CAN_HOLD_HEAD, "the spell-school gate");
  if (!canHold || !g_spellRecord || !g_spellRecord(spell)) return NULL;
  char may = canHold(whole_hero(hero), NULL, spell);
  log_num(may ? "H5ECanHoldSpell: his kind may, spell " : "H5ECanHoldSpell: not his kind, spell ",
          spell);
  return may ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

/**
 * `H5EIsBarbarian(heroName)` - 1 for a hero of the Horde, nothing for anybody
 * else.
 *
 * Asked because only he is PAID for a spell he cannot learn (Senya, 12.08.2026,
 * off the game's own shrines). For everybody else an unlearnable spell is lost,
 * which is what the game does at a shrine and at the spell shop.
 */
static void *__fastcall lua_is_barbarian(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  void *map = name ? adventure_map(ctx) : NULL;
  void *find = map ? vtable_entry(map, VT_FIND_BY_NAME) : NULL;
  if (!find) {
    log_line("H5EIsBarbarian: takes a hero's script name, and needs the map");
    return NULL;
  }
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero) || !is_a(hero, CHERO_VTABLE_RVA)) return NULL;
  HeroRaceFn race = (HeroRaceFn)vtable_entry(hero, VT_HERO_RACE);
  if (!race) return NULL;
  int who = race(hero, NULL);
  return who == RACE_STRONGHOLD ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

/** The rows a map may call. Added where the others are — BEFORE the table is
 *  handed to the engine, or the map finds a global that is NIL. */
static void add_hero_spell_map_functions(void) {
  add_map_function("H5ECanLearnSpell", (void *)&lua_can_learn_spell);
  add_map_function("H5ECanHoldSpell", (void *)&lua_can_hold_spell);
  add_map_function("H5EIsBarbarian", (void *)&lua_is_barbarian);
  log_line("a box may ask: H5ECanLearnSpell, H5ECanHoldSpell, H5EIsBarbarian");
}
