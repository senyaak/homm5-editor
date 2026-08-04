// The first aid tent: the term a specialization of ours adds.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

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
static void tent_charges_term(void *unit, void *skills);
/** The object a combat hero's SKILLS answer on — defined below, with its why. */
static void *hero_for_skills(void *hero);
/** Remember a tent and every pointer its owner answers on — defined below. */
static void note_tent(void *unit, void *hero, void *base, void *skills);

typedef void(__fastcall *TentAmountFn)(int *amount, int *second, void *unit, int mastery);
static TentAmountFn g_tentAmount = NULL;
static int g_amountLogged = 0;

/**
 * How a combat caster answers about his own mana: read it, and set it.
 *
 * The pair is the engine's own — the mana command uses `+0x22C` to write and a
 * mana-draining spell `+0x234` to read.
 */
#define VT_CASTER_MANA 0x234u
#define VT_CASTER_SET_MANA 0x22Cu
static int caster_mana(void *caster);

/** How a combat unit hands over the hero behind it, as the engine asks at 0xb7fcee. */
#define VT_UNIT_OWNER 0x18u
#define VT_OWNER_HERO 0x0Cu
/** `HasSpecialization(id)` — the question the tent asks about Empiric. */
#define VT_HAS_SPECIALIZATION 0x294u
/** The hero's level, as the tent reads it inside that branch. */
#define VT_HERO_LEVEL 0x23Cu
/**
 * The question that makes the engine DOUBLE the tent's healing.
 *
 * The last thing `0x77fca0` does: ask the object his skills answer on this, and
 * if it says anything above zero, `add eax,eax` (`0xb7fd47`…`0xb7fd53`). The
 * Ring of Machine Affinity is what its own description promises to double, and
 * we do not have to know that — asking the same question is enough to be
 * doubled by the same thing.
 */
#define VT_TENT_DOUBLED 0x314u

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
  // One walk, two questions: the charges and the healing are both a SKILL's, and
  // a skill answers on the object one virtual call past the hero.
  void *skills = hero ? hero_for_skills(hero) : NULL;
  tent_charges_term(unit, skills);
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
  // And what his SKILLS add to the same number: points rather than percent, so
  // a perk is worth the same at every mastery of War Machines.
  //
  // DOUBLED WHEN THE ENGINE DOUBLES, which is the whole reason this is not just
  // `+ flat`. A perk that adds fifty is raising the tent's own number, exactly
  // as the mastery raises it to a hundred — so whatever multiplies that number
  // has to multiply ours. The engine's own doubling is the last thing this
  // function does and it comes after everything we can reach, so we ask the
  // question it asks (`[+0x314]` on the object his skills answer on) and apply
  // the same factor ourselves. At expert with the ring: engine 200, ours 100,
  // and 300 is (100 + 50) × 2.
  int flat = skills ? hero_term(skills, STAT_TENT_HEALING, 0) : 0;
  int doubled = 0;
  if (flat && skills) {
    void **vt = *(void ***)skills;
    if (readable(vt, VT_TENT_DOUBLED + 4) && points_at_code(vt[VT_TENT_DOUBLED / 4])) {
      doubled = ((LevelFn)vt[VT_TENT_DOUBLED / 4])(skills) > 0;
    }
    if (doubled) flat += flat;
  }
  int total = engine + add + flat;
  // A negative row is allowed to mean a curse, but a negative AMOUNT is not
  // something the engine is ever handed by itself.
  if (total < 0) total = 0;
  if (add || flat) *amount = total;

  // THE SECOND OUT-PARAMETER IS THE CLEANSE THRESHOLD, and this is where it was
  // finally named. The engine fills it with {0,0,1,3} by mastery and then walks
  // the effects on the healed stack, asking of each one whether its spell's
  // level is at most this number (`0xc78910`, and the same comparison in the
  // tooltip at 0xb82dd3). So a perk that lifts stronger curses is this number
  // raised — no place of its own to find, and nothing else in the engine to
  // teach. It is also why war machines alone never reach level 4 and 5 effects.
  int cleanse = skills ? hero_term(skills, STAT_TENT_CLEANSE, 0) : 0;
  int threshold = *second;
  if (cleanse > 0) {
    threshold += cleanse;
    *second = threshold;
  }
  // And the ultimate's half that gives the charges back: the tent is known here
  // and the mana is counted where it is spent.
  if (skills) note_tent(unit, hero, self, skills);

  if (g_amountLogged++ >= 24) return;
  log_line("tent:");
  log_num("      mastery       ", mastery);
  log_num("      engine said   ", engine);
  log_num("      hero level    ", level);
  log_num("      our spec      ", matched);
  log_num("      we add        ", add);
  log_num("      our skills add", flat);
  log_num("      doubled       ", doubled);
  log_num("      cleanse up to ", threshold);
  log_num("      amount        ", *amount);
  log_num("      second        ", *second);
  // The two pointers the war machine probe is looking for. This walk is the one
  // that WORKS, so whichever number the constructor also printed is the route
  // from a freshly built machine to its hero.
  log_object("      unit        ", unit);
  log_object("      hero        ", hero);
  // AND ONE THING THIS HERO MUST NOT BE ASKED. `+0x22C` and `+0x234` are the
  // slots the mana command uses on ITS caster; on this object they are two other
  // methods entirely, reached through virtual-base thunks (`sub ecx,[ecx-4]`),
  // and calling one ended the battle. Same mistake in a new coat: a slot that
  // holds real code is not a promise that the object is the right one.
  //
  // SO WE PRINT, AND CALL NOTHING. The mana command at 0x774300 is hooked and
  // has never fired in a single battle — measured, with a hero who had 300 mana
  // and spells to spend it on — so a cast does not go that way and the caster
  // has to be found from this side. `unit_hero` walks the unit's owner (`+0x18`)
  // and then asks THAT for the adventure hero (`+0x0C`); the owner it passes
  // through is the combat-side object, and the Lua `GetUnitManaPoints` asks a
  // combat unit for its mana through `+0x234`. If the owner's slot holds a small
  // field reader, it is the getter, and its neighbour `+0x22C` is where a spell
  // pays for itself. Both are logged as RVAs, to be read off disk rather than
  // trusted in flight.
  if (readable(unit, 4)) {
    void **uvt = *(void ***)unit;
    if (readable(uvt, VT_UNIT_OWNER + 4) && points_at_code(uvt[VT_UNIT_OWNER / 4])) {
      void *owner = ((GetterFn)uvt[VT_UNIT_OWNER / 4])(unit);
      if (readable(owner, 4)) {
        void **ovt = *(void ***)owner;
        if (readable(ovt, VT_CASTER_MANA + 4)) {
          BYTE *base = (BYTE *)GetModuleHandleW(NULL);
          log_hex("      owner set mana rva ", (DWORD)((BYTE *)ovt[VT_CASTER_SET_MANA / 4] - base));
          log_hex("      owner get mana rva ", (DWORD)((BYTE *)ovt[VT_CASTER_MANA / 4] - base));
        }
      }
    }
  }
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

