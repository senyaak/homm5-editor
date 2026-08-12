// One step up the talisman ladder — the barbarian's own door to adventure magic.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_hero_talisman

// ---------------------------------------------------------------------------
// WHY A FUNCTION OF OURS AT ALL. `TeachHeroSpell` refuses a barbarian every
// adventure spell there is, and it is right to: the gate at `0xc200f0` reads
// the school off the spell's record and lets a hero with ability `0xAC` — the
// one that means "he shouts rather than casts" — hold war cries and nothing
// else. A box that promises him Town Portal promises what the engine will not
// give.
//
// THE SHIPPED GAME GIVES IT ANYWAY, through a channel of its own. The
// Stronghold's Traveller's Shelter sells TALISMAN levels, and
// `DefaultStats.xdb`'s `TalismanOfAdventure` ladder is what a level means:
// 1 Summon Boat, 2 Summon Creatures, 3 Dimension Door, 4 Town Portal — exactly
// the four spells of `MAGIC_SCHOOL_ADVENTURE` the game has. So for a barbarian,
// "hand over adventure magic" IS "raise the talisman", and a box hands over one
// step of it (Senya, 12.08.2026: one adventure spell is one talisman level).
//
// WHAT THE ENGINE DOES WITH THE LEVEL, read out of `CHero::0xc2a400` — the
// slot the purchase command calls right after it writes a new level:
//
//   if (race != 8) return;                 // Stronghold, and nobody else
//   if (talisman < 1) return;
//   for (i = 1; i <= talisman; i++) {
//     if (heroLevel < row[i].HeroLevel) break;      // BREAK, not skip
//     ... add row[i].Spell to the hero's lists ...
//   }
//
// Three things follow, and none of them is ours to change: the ladder is
// CUMULATIVE, a level whose `HeroLevel` the hero has not reached yet yields
// nothing until he does, and a talisman does nothing whatsoever for a hero who
// is not of the Horde. The last one is why this answers "not my case" instead
// of guessing: the box then teaches the spell the ordinary way.
//
// WHAT WE CALL, and why it is only virtuals:
//
//   vt+0x300  the level he has            `mov eax,[ecx+0x230]; ret`
//   vt+0x304  set it — and it CLAMPS to the table's own length and rings the
//             interface, so "the top" never has to be written down here
//   vt+0x384  the recompute above, which is what actually hands the spells over
//   vt+0x258  his race
//   vt+0x0    his player, whose vt+0x0 is the world (`mov eax,[ecx+0x128]`)
//
// The recompute takes one argument: the thing asked whether a spell is
// forbidden on this map. The engine passes `world->vt[0x34]()`; a null is a
// legal value there (the code tests it before use) and means "nothing is
// forbidden", so a world we cannot reach costs the ban list and not the call.

/** `NWorld::CHero`'s primary vtable — the one class in the build with a 0x304. */
#define CHERO_VTABLE_RVA 0xbc69fcu

#define VT_GET_PLAYER 0x0u
#define VT_HERO_RACE 0x258u
#define VT_TALISMAN_GET 0x300u
#define VT_TALISMAN_SET 0x304u
#define VT_TALISMAN_REFRESH 0x384u

// AND WHAT THOSE THREE SLOTS HAVE TO LEAD TO, by their own first bytes. A slot
// number is a fact about ONE build: the vtable is checked above, and this is
// the other half — a table that grew a slot somewhere in the middle would
// otherwise leave every number here pointing one function along, and each of
// them still callable. `tools/test-native-anchors.ts` reads these off the
// executable on disk, so a build that moved them says so before a launch.

/** `CHero::GetTalismanLevel` — `mov eax,[ecx+0x230]; ret`. */
#define TALISMAN_GET_RVA 0x82e9c0u
static const BYTE TALISMAN_GET_HEAD[6] = { 0x8B, 0x81, 0x30, 0x02, 0x00, 0x00 };
/** `CHero::SetTalismanLevel` — clamps to the table and rings the interface. */
#define TALISMAN_SET_RVA 0x828ca0u
static const BYTE TALISMAN_SET_HEAD[4] = { 0x56, 0x8B, 0xF1, 0xE8 };
/** `CHero::RefreshTalismanSpells` — the race check, the ladder, the lists. */
#define TALISMAN_REFRESH_RVA 0x82a400u
static const BYTE TALISMAN_REFRESH_HEAD[6] = { 0x83, 0xEC, 0x20, 0x57, 0x8B, 0xF9 };
/** The world's "what may not be cast here", as the engine's own callers take it. */
#define VT_WORLD_SPELL_BANS 0x34u

/** `TOWN_STRONGHOLD` as the race slot answers it — the Horde, and only it. */
#define RACE_STRONGHOLD 8

typedef int(__fastcall *TalismanGetFn)(void *hero, void *edx);
typedef void(__fastcall *TalismanSetFn)(void *hero, void *edx, int level);
typedef void(__fastcall *TalismanRefreshFn)(void *hero, void *edx, void *bans);
typedef int(__fastcall *HeroRaceFn)(void *hero, void *edx);
/** A no-argument virtual that answers with another object — `GetterFn`'s shape,
 *  spelled again because that name is already taken by combat/tent-term.c. */
typedef void *(__thiscall *HeroLinkFn)(void *self);

/**
 * What the recompute is given — the map's forbidden spells, or nothing.
 *
 * Reached the way every engine caller reaches it and no other way: the hero
 * knows his player, the player knows the world, the world is asked. Each step
 * is checked, and a step that does not answer ends the walk — the recompute
 * takes a null and reads it as "nothing is forbidden here", which is a worse
 * answer than the real list and a much better one than a wild pointer.
 */
static void *spell_bans_for(void *hero) {
  HeroLinkFn player = (HeroLinkFn)vtable_entry(hero, VT_GET_PLAYER);
  if (!player) return NULL;
  void *owner = player(hero);
  if (!owner || !readable(owner, 4)) return NULL;
  HeroLinkFn world = (HeroLinkFn)vtable_entry(owner, VT_GET_PLAYER);
  if (!world) return NULL;
  void *where = world(owner);
  if (!where || !readable(where, 4)) return NULL;
  HeroLinkFn bans = (HeroLinkFn)vtable_entry(where, VT_WORLD_SPELL_BANS);
  return bans ? bans(where) : NULL;
}

/**
 * `H5ETalismanStep(heroName)` — one level up, and the level he ends on.
 *
 * Three answers, because the caller has three things to do:
 *
 *   nil  this hero is not somebody a talisman serves — teach him the spell;
 *   0    he is, and his talisman is already at the top — hand over nothing;
 *   1…N  he took the step, and this is where he stands now.
 *
 * THE TOP IS NOT WRITTEN DOWN HERE. The setter clamps to the length of the
 * game's own table, so this asks for one more and then READS BACK what it got:
 * unchanged means he was already at the top, and a table a mod lengthens works
 * without this file being touched.
 */
static void *__fastcall lua_talisman_step(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  if (!name) {
    log_line("H5ETalismanStep: the first argument has to be a hero's script name");
    return NULL;
  }
  void *map = adventure_map(ctx);
  void *find = map ? vtable_entry(map, VT_FIND_BY_NAME) : NULL;
  if (!find) {
    log_line("H5ETalismanStep: no adventure map to ask for the hero");
    return NULL;
  }
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero || !pointer_alive(hero)) {
    log_line("H5ETalismanStep: no living hero of that name");
    return NULL;
  }
  // THE CLASS, not the slot number. A slot is only a slot on the vtable it was
  // measured on, and `FindObjectByName` is free to hand back anything the map
  // holds under that name — see docs/engineInternals/PANDORA_OBJECT.md on what
  // reading a slot off the wrong table costs.
  if (!is_a(hero, CHERO_VTABLE_RVA)) {
    log_line("H5ETalismanStep: that name is not a CHero");
    return NULL;
  }

  HeroRaceFn race = (HeroRaceFn)vtable_entry(hero, VT_HERO_RACE);
  // EACH SLOT AGAINST THE FUNCTION IT IS SUPPOSED TO REACH, by its bytes. The
  // vtable is the right one and the slot still has to be: taking the entry and
  // the recognised address separately, and refusing when they differ, is what
  // turns a table that shifted into a feature that says nothing rather than one
  // that writes a number into whatever field the neighbour keeps.
  void *getSlot = vtable_entry(hero, VT_TALISMAN_GET);
  void *setSlot = vtable_entry(hero, VT_TALISMAN_SET);
  void *refreshSlot = vtable_entry(hero, VT_TALISMAN_REFRESH);
  TalismanGetFn level = (TalismanGetFn)code_at(TALISMAN_GET_RVA, TALISMAN_GET_HEAD,
                                               sizeof TALISMAN_GET_HEAD, "the talisman level");
  TalismanSetFn setLevel = (TalismanSetFn)code_at(TALISMAN_SET_RVA, TALISMAN_SET_HEAD,
                                                  sizeof TALISMAN_SET_HEAD, "the talisman setter");
  TalismanRefreshFn refresh = (TalismanRefreshFn)code_at(TALISMAN_REFRESH_RVA, TALISMAN_REFRESH_HEAD,
                                                         sizeof TALISMAN_REFRESH_HEAD,
                                                         "the talisman's spells");
  if (!race || !level || !setLevel || !refresh) {
    log_line("H5ETalismanStep: the hero has no talisman where we measured one");
    return NULL;
  }
  if ((void *)level != getSlot || (void *)setLevel != setSlot || (void *)refresh != refreshSlot) {
    log_line("H5ETalismanStep: the talisman slots do not lead where they did when measured");
    return NULL;
  }
  // NOT OURS TO OVERRULE. The recompute asks this same question first and gives
  // a hero of any other race nothing at all, so a step taken here would be a
  // number rising with no spell behind it.
  int who = race(hero, NULL);
  if (who != RACE_STRONGHOLD) {
    log_num("H5ETalismanStep: no talisman for race ", who);
    return NULL;
  }

  int had = level(hero, NULL);
  setLevel(hero, NULL, had + 1);
  int now = level(hero, NULL);
  // AT THE TOP, AND THAT IS NOT THE SAME AS "not my case". Nil sends the script
  // to `TeachHeroSpell`, which for a barbarian is a spell the engine refuses —
  // so a box past the end of the ladder announced Town Portal and handed over
  // nothing, which is the worst of both. ZERO says "he is of the Horde and
  // there is nothing left to give": the box then keeps quiet.
  if (now == had) {
    log_num("H5ETalismanStep: already at the top of the ladder, ", had);
    return (void *)(INT_PTR)lua_push_int(ctx, 0);
  }
  // The step is the number; the SPELLS come from this call, which is the engine's
  // own and is what the shelter's purchase runs the moment it has written a
  // level. Without it the hero owns a talisman nobody has read yet.
  refresh(hero, NULL, spell_bans_for(hero));
  log_num("H5ETalismanStep: the talisman is now ", now);
  return (void *)(INT_PTR)lua_push_int(ctx, now);
}

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

typedef char(__fastcall *CanLearnFn)(void *hero, void *edx, int *needSkill, int *needMastery,
                                     int *needLevel, int spell);

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
  int needSkill = 0, needMastery = 0, needLevel = 0;
  char may = canLearn(hero, NULL, &needSkill, &needMastery, &needLevel, spell);
  if (may) {
    log_num("H5ECanLearnSpell: yes, spell ", spell);
  } else {
    log_num("H5ECanLearnSpell: no, spell ", spell);
    log_num("                  it wants skill ", needSkill);
    log_num("                  at mastery ", needMastery);
    log_num("                  and hero level ", needLevel);
  }
  return may ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

/**
 * `H5EIsBarbarian(heroName)` - 1 for a hero of the Horde, nothing for anybody
 * else.
 *
 * Asked because only he is PAID for a spell he cannot learn (Senya, 12.08.2026,
 * off the game's own shrines). For everybody else an unlearnable spell is lost,
 * which is what the game does at a shrine and at the spell shop.
 *
 * The race slot is the same one the engine's own talisman recompute asks first.
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
static void add_talisman_map_function(void) {
  add_map_function("H5ETalismanStep", (void *)&lua_talisman_step);
  add_map_function("H5ECanLearnSpell", (void *)&lua_can_learn_spell);
  add_map_function("H5EIsBarbarian", (void *)&lua_is_barbarian);
  log_line("a box may ask: H5ETalismanStep, H5ECanLearnSpell, H5EIsBarbarian");
}
