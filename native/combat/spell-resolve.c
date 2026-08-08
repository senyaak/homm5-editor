// What a spell of OURS does, written out here instead of borrowed.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, and this is the LAST of the four a spell is made of: it uses
// the record accessor (spell-record.c), the question about a stack's abilities
// (spell-cast.c) and the switches taught about our ids (spell-switches.c).
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS.
//
// Until now a cast of ours ended in a `jmp` into the MIDDLE of a shipped
// spell's branch: the whole-field shape was Unholy Word's six instructions, the
// area shape was Fireball's, the single target was Magic Arrow's. It worked, and
// it cost exactly what borrowing a stack frame costs — three crashes in a row on
// casts of *Unholy Word*, the spell whose branch we had taken, and one cast of
// ours running the per-target filter 178 times because we were inside somebody
// else's loop on somebody else's terms.
//
// So the rule, which is Senya's and is a standing one: WRITE OUR OWN. The line
// it draws is not "never touch the engine" — every hook here is a call into it:
//
//   ALLOWED, and correct: calling an engine function through ITS OWN ENTRY
//   POINT with a signature taken from the code — arity from its `ret`. All five
//   below are functions with fourteen to twenty-one callers of the engine's own;
//   none belongs to a spell.
//
//   NOT ALLOWED: entering the middle of another spell's branch and inheriting
//   its frame. There is none of that left in a cast of ours.
//
// SPELL_ARMAGEDDON and SPELL_UNHOLY_WORD are now untouched by us: not borrowed,
// not detoured, not read.
//
// ---------------------------------------------------------------------------
// WHAT A CAST IS MADE OF.
//
// `CCombatSpellCast` is the object `Resolve` is called on, and its prologue
// copies ten of its fields onto the frame before the dispatch — which is how
// each shipped branch reads them. We read them from the object instead, because
// the object is the thing that is actually documented and a frame offset is only
// true until somebody pushes.
//
// Every offset below was read out of the code that uses it:
//
//   +0x04  the spell id                    `mov ecx,[eax+4]` before every worth
//   +0x14  the caster                      ebp for the whole function
//   +0x18  the one stack aimed at          the single-target branch's argument
//   +0x24  the affected stacks, begin      the area routine's vector…
//   +0x28  the affected stacks, end        …already built from the covered tiles
//   +0x2C  the caster's spell power        reaches 0xAD4EC0 as the multiplier
//   +0x30  the caster's mastery            reaches 0xAD4EC0 as the table index
//   +0x34  a scale, float                  the last-but-one argument of the hit
//
// THE AREA SHAPE COSTS NOTHING EXTRA, and that is worth saying out loud: the
// command has ALREADY turned the covered tiles into a list of stacks and left it
// at +0x24. Those tiles are ours — `install_area_shape` in spell-switches.c fills
// them from the spell's own row — so an area spell of ours needs no tile-to-unit
// lookup here. It walks a list the engine built to our shape.

#define CAST_SPELL 0x04u
#define CAST_CASTER 0x14u
#define CAST_TARGET 0x18u
#define CAST_AFFECTED 0x24u
#define CAST_AFFECTED_END 0x28u
#define CAST_POWER 0x2Cu
#define CAST_MASTERY 0x30u
#define CAST_SCALE 0x34u
/** The last field the prologue copies — so a cast that reads this far is whole. */
#define CAST_BYTES 0x3Cu

// ---------------------------------------------------------------------------
// THE FIVE FUNCTIONS OF THE ENGINE'S THAT WE CALL, and how each was measured.
//
// The count of stack arguments is taken from the `ret` at the end of each, never
// from the shape of a call site — four battles were dropped learning that.

/**
 * `CCombat::AllUnits(out)` — every stack on the field, both sides.
 *
 * `ret` with nothing to clean, so `ecx` and `edx` are the whole signature. It
 * asks the combat for side 1 and side 0, appends each side's units, and leaves a
 * plain `vector<CCombatUnit*>` — begin, end, capacity, four bytes an element
 * (`sar ecx,2` on the difference is the proof).
 *
 * The storage is malloc'd and belongs to the caller. We free it.
 */
#define ALL_UNITS_RVA 0x7ab520u
#define ALL_UNITS_HEAD_LEN 6
static const BYTE ALL_UNITS_HEAD[ALL_UNITS_HEAD_LEN] = {
  0x83, 0xEC, 0x18, 0x56, 0x8B, 0xF2                          // sub esp,18h / push esi / mov esi,edx
};
typedef struct {
  void **begin;
  void **end;
  void **capacity;
} UnitList;
typedef void(__fastcall *AllUnitsFn)(void *combat, UnitList *out);
static AllUnitsFn g_allUnits = NULL;

/**
 * `CCombatUnit::MaySpellTouch(kind, spell)` — may a spell land on this stack.
 *
 * `ret 4`. The whole-field routine asks it about every unit with both arguments
 * zero, which skips the two special cases inside it (the ids 0x146 and 0x14A)
 * and leaves the general question: is this a live stack and not a thing that
 * only looks like one. Ours asks it the same way, and a `no` means the stack is
 * passed over — which is what the engine does with it.
 */
#define MAY_TOUCH_RVA 0x757100u
#define MAY_TOUCH_HEAD_LEN 6
static const BYTE MAY_TOUCH_HEAD[MAY_TOUCH_HEAD_LEN] = {
  0x56, 0x8B, 0xF1, 0x57, 0x8B, 0xFA                          // push esi/mov esi,ecx/push edi/mov edi,edx
};
typedef BYTE(__fastcall *MayTouchFn)(void *unit, int kind, int spell);
static MayTouchFn g_mayTouch = NULL;

/**
 * `CCombatSpell::Worth(power, mastery, week, …)` — what this spell is worth.
 *
 * `ret 0Ch`. Nineteen callers. For a spell of ours it goes through the branch
 * that READS THE DOCUMENT — `0xAD4EC0`, base plus per-point by mastery — which
 * is where `install_spell_power` in spell-switches.c points our ids.
 *
 * The third argument is the WEEK, and it is a number rather than an object: the
 * modifier at `0xC76720` compares it against 0x41, 0x44…0x47 and 0x48 and adds
 * a half or a double for a week of the spell's own school. Zero is a legal
 * answer there — no week matches, nothing is added — but we ask the combat for
 * the real one, so a spell of ours rides the calendar like every other.
 */
#define SPELL_WORTH_RVA 0x77ce70u
#define SPELL_WORTH_HEAD_LEN 6
static const BYTE SPELL_WORTH_HEAD[SPELL_WORTH_HEAD_LEN] = {
  0x51, 0x53, 0x56, 0x57, 0x8B, 0xDA                          // push ecx/ebx/esi/edi / mov ebx,edx
};
typedef int(__fastcall *SpellWorthFn)(int spell, int power, int mastery, int week, void *out);
static SpellWorthFn g_spellWorth = NULL;

/**
 * `CCombatSpell::HitOne(worth, cast, …)` — what this spell does to that stack.
 *
 * `ret 18h`, so six stack arguments, and twenty-one callers of the engine's own.
 * Inside it the power is adjusted for the caster, `0xB861A0` turns it into a
 * number — magic resistance, anti-magic, protection from the school, and OUR
 * filter, which is detoured onto it in spell-cast.c — and the Empowered term is
 * applied. It returns the damage.
 *
 * This is the one thing we must NOT do arithmetic for: a number of ours would
 * bypass all four of those and look exactly like our bug.
 */
#define HIT_ONE_RVA 0x77d030u
#define HIT_ONE_HEAD_LEN 6
static const BYTE HIT_ONE_HEAD[HIT_ONE_HEAD_LEN] = {
  0x83, 0xEC, 0x14, 0x53, 0x56, 0x8B                          // sub esp,14h / push ebx / push esi
};
typedef int(__fastcall *HitOneFn)(int worth, void *cast, void *caster, void *unit, int one,
                                  void *chain, float scale, int alsoOne);
static HitOneFn g_hitOne = NULL;

/**
 * `CCombatUnit::TellAbout(chain, damage, …)` — the combat log line, the number
 * that floats up over the stack, and whatever a vulnerability ADDS to the hit.
 *
 * `ret 10h`, fourteen callers.
 *
 * ITS RETURN IS NOT THE DAMAGE, and a whole run was spent on that. The name it
 * had here first — "the stack loses it" — made its answer look like the amount
 * that landed, so a cast of ours summed those and got zero eight times out of
 * eight, called itself a spell that did nothing, and skipped the entry the
 * battle shows. The stacks took their twenty each; nothing said so.
 *
 * What it really does, read after the run said `landed 0`:
 *
 *   ecx = 0xAD4E90(spell)                    ; the spell's own text
 *   call one of 0xC49DB0 / 0xC49F20 /        ; THE COMBAT LOG LINE, four
 *        0xC49D90 / 0xC49E00                 ; composers by what is known
 *   st  = a multiplier that comes back       ; 1.0 unless something is
 *   if (1.0 >= it) return 0                  ; vulnerable to this
 *   extra = damage * (it - 1)                ; only the SURPLUS
 *   if (extra <= 0) return                   ;
 *   "FLYING_SIGN_ELEMENTAL_DAMAGE"           ; the number over the stack
 *
 * So it answers the EXTRA, and the engine's own branches add it to the damage:
 * `mov [esp+20h],eax` (the damage) / `call` / `add ecx,eax` / `sete [esp+13h]`.
 * Ours does the same. The damage itself is carried by the entry the applier
 * builds, which is why a cast that reports nothing also does nothing.
 */
#define TELL_ABOUT_RVA 0x775c10u
#define TELL_ABOUT_HEAD_LEN 6
static const BYTE TELL_ABOUT_HEAD[TELL_ABOUT_HEAD_LEN] = {
  0x83, 0xEC, 0x1C, 0x53, 0x55, 0x56                          // sub esp,1Ch / push ebx/ebp/esi
};
typedef int(__fastcall *TellAboutFn)(void *chain, int damage, void *caster, void *unit,
                                     int spell, int zero);
static TellAboutFn g_tellAbout = NULL;

/**
 * `CCombatEffect::Show(damage, chain, spell, …)` — ONE STACK'S entry.
 *
 * `ret 10h`. This is what the damage above does not do: it builds the sixty-byte
 * object the battle plays back and links it into the CHAIN, the list the resolver
 * itself returns. Nothing before it has changed anything a player can see, which
 * is why a cast that skips it computes every number correctly and does nothing.
 *
 * PER STACK, and that was learned the expensive way. It is called once for EACH
 * unit, with that unit as `edx` and that unit's amount — the mass routine's call
 * sits INSIDE its loop (`mov edx,edi`, its loop variable, at `0xD61152`), and so
 * does the area routine's. Ours called it once after the loop, with the cast's
 * total and the caster, and eight stacks that had each been dealt twenty lost
 * nothing at all. The numbers in the log were right the whole time.
 *
 * THIS IS THE ELEMENT-LESS ONE, and that is a known gap rather than a choice.
 * There are four appliers, three of them an element each (fire `0xBD1420`, water
 * `0xBD12C0`, air `0xBD1790`), and each asks the caster for that element's Master
 * perk and leaves its mark. They are NOT interchangeable: their `ret`s are 10h,
 * 18h and 14h, and fire even swaps the roles of `ecx` and `edx` against this one
 * — so each needs its own reading before it can be called, and none of them can
 * be reached by a call written for another. Until then a spell of ours leaves no
 * Master's mark. See docs/engineInternals/SPELLS.md, "The Master's mark".
 *
 * It answers the chain unchanged when the damage is zero or less — its first two
 * instructions — so calling it on a cast that hit nobody is free and honest.
 */
#define PLAIN_APPLIER_RVA 0x7d1980u
#define PLAIN_APPLIER_HEAD_LEN 12
static const BYTE PLAIN_APPLIER_HEAD[PLAIN_APPLIER_HEAD_LEN] = {
  0x51,                                                       // push ecx
  0x83, 0x7C, 0x24, 0x08, 0x00,                               // cmp dword ptr [esp+8],0
  0x57,                                                       // push edi
  0x8B, 0xFA,                                                 // mov edi,edx
  0x89, 0x4C, 0x24                                            // mov [esp+4],ecx
};
typedef void *(__fastcall *PlainApplierFn)(void *caster, void *unit, int damage, void *chain,
                                           int spell, void *whatResolveWasGiven);
static PlainApplierFn g_plainApplier = NULL;

/**
 * The allocator's own `free`, for the list of stacks we asked it to build.
 *
 * Only three bytes are checked: the fourth instruction names an absolute
 * address, and the loader rewrites those when the game does not get its
 * preferred base — this session it loaded at 0x003B0000. A head that includes a
 * relocated operand refuses to install for a reason that is not a reason.
 */
#define FREE_RVA 0xdd510u
#define FREE_HEAD_LEN 3
static const BYTE FREE_HEAD[FREE_HEAD_LEN] = { 0x55, 0x8B, 0xEC };  // push ebp / mov ebp,esp
typedef void(__cdecl *FreeFn)(void *block);
static FreeFn g_free = NULL;

/**
 * `SpellVisual(spell, which)` — one entry of the document's `visuals` list.
 *
 * `ret` with nothing to clean, so `ecx` and `edx` are the whole signature: the
 * spell id and WHICH visual. Inside, the record's `+0xDC`/`+0xE0` are the
 * vector's begin and end, eight bytes an entry (`sar eax,3`), and an index past
 * the end answers NULL — which is what makes asking for the second one and
 * falling back to the first honest rather than hopeful.
 *
 * The engine asks for `0` from its single-target branch and `1` from its mass
 * routine, so the list is authored in that order and a spell may have only one.
 *
 * Three pushes sit between this call and the next at the shipped site, and they
 * belong to the NEXT call, not this one — the `ret` says so. Reading them as
 * this function's arguments is exactly the mistake that drops battles.
 */
#define SPELL_VISUAL_RVA 0x6d5050u
#define SPELL_VISUAL_HEAD_LEN 4
static const BYTE SPELL_VISUAL_HEAD[SPELL_VISUAL_HEAD_LEN] = {
  0x53, 0x57, 0x8B, 0xDA                                      // push ebx / push edi / mov ebx,edx
};
typedef void *(__fastcall *SpellVisualFn)(int spell, int which);
static SpellVisualFn g_spellVisual = NULL;

/**
 * `CCombatUnit::Play(chain, visual, …)` — vtable `+0x280`.
 *
 * The stack plays the spell's visual on itself and hands back a longer chain.
 * Five stack arguments, counted at the shipped single-target site, which is the
 * resolver's own frame: `push 1 / push 0 / push 0 / push eax / push edi`, so
 * `(chain, visual, 0, 0, 1)` lowest first, with the STACK as `this`.
 *
 * Both shipped branches ask the combat first — `combat->vt[0x108]()`, and a yes
 * means skip every visual. That is how a battle the player is not watching (an
 * autofight, a replay) costs nothing, and ours asks it the same way.
 */
#define UNIT_PLAY_SLOT 0x280u
#define COMBAT_NO_VISUALS_SLOT 0x108u
typedef void *(__thiscall *UnitPlayFn)(void *unit, void *chain, void *visual, int zeroA,
                                       int zeroB, int one);
typedef BYTE(__thiscall *NoVisualsFn)(void *combat);

/**
 * HOW MANY CREATURES ARE STILL IN THAT STACK — vtable `+0x1D8`.
 *
 * A probe, and it is here because reading the code stopped answering. Six
 * functions were followed to their `ret` and **not one of them writes**: the
 * worth is arithmetic, `0xB861A0` ends `mov eax,edi / ret 8`, `0xB7D030` returns
 * `esi`, `0xB75C10` writes a log line and a floating figure, and the object the
 * appliers build is — by its own RTTI — `CCombatEventLog`, a LOG entry. So where
 * a stack actually loses creatures is not yet known, and one more inference
 * would be the third in a row.
 *
 * This asks the stack itself, before the hit and after the entry. Whatever the
 * next run says, it says it about the thing we care about rather than about a
 * function we hope is the right one.
 *
 * The slot is the engine's own: `0xB57310` — "how many would this much damage
 * kill" — clamps its answer against `[vt+0x1D8]`, and takes the creature's hit
 * points from `[vt+0x1A8]` two lines above.
 */
#define UNIT_COUNT_SLOT 0x1D8u
typedef int(__thiscall *UnitCountFn)(void *unit);

/** `CCombatUnit::GetCombat()` — vtable slot 8, the way the engine asks. */
#define UNIT_COMBAT_SLOT 0x08u
/** `CCombat::WeekOf()` — slot 0x3C, what the resolver's own prologue asks for. */
#define COMBAT_WEEK_SLOT 0x3Cu
typedef void *(__thiscall *GetCombatFn)(void *unit);
typedef int(__thiscall *CombatWeekFn)(void *combat);

// ---------------------------------------------------------------------------
// LIVENESS, IN THE ENGINE'S OWN SPELLING.
//
// Everything in a combat is held by a weak handle and the test is the same four
// instructions everywhere — the object names a shape, the shape names an offset,
// and the count at that offset going negative means the thing is gone:
//
//   mov eax,[obj+4] / mov eax,[eax+4] / cmp dword ptr [eax+obj+8],0 / jl <gone>
//
// Ours does the same, and refuses to read anything it cannot read.

/** One virtual slot of an object, or nothing — checked before it is called. */
static void *slot_of(void *obj, unsigned slot) {
  if (readable_bytes(obj, 4) < 4) return NULL;
  void **vtable = *(void ***)obj;
  if (readable_bytes(vtable, slot + 4) < slot + 4) return NULL;
  void *at = vtable[slot / 4];
  return points_at_code(at) ? at : NULL;
}

static int handle_is_live(void *obj) {
  if (readable_bytes(obj, 8) < 8) return 0;
  DWORD *shape = (DWORD *)*(DWORD *)((BYTE *)obj + 4);
  if (readable_bytes(shape, 8) < 8) return 0;
  DWORD at = shape[1];
  BYTE *count = (BYTE *)obj + at + 8;
  if (readable_bytes(count, 4) < 4) return 0;
  return *(int *)count >= 0;
}

// ---------------------------------------------------------------------------
// WHOM THE SPELL TOUCHES.
//
// The shape comes from the two flags the document already carries, exactly as
// the editor's Spells… window authors them, and nothing new has to be said
// anywhere:
//
//   IsAimed  IsAreaAttack   whom
//   -------  ------------   ---------------------------------------------
//   false    false          every stack on the field
//   true     true           the stacks under the tiles the row named
//   true     false          the one stack aimed at
//
// AND THIS IS THE DOOR THE REST GOES THROUGH. Once the list is ours, a spell can
// be authored to hurt whom we choose — everyone, only the enemy, only the
// living, only what a rule names — because choosing is a loop here rather than a
// case in the executable.

#define OUR_TARGETS_MAX 64

/** Fills `into` and answers how many — and says so when the field is bigger. */
static int our_targets(void *cast, void *record, void *combat, void **into) {
  int aimed = *((BYTE *)record + SPELL_RECORD_AIMED);
  int area = *((BYTE *)record + SPELL_RECORD_AREA);
  int n = 0;

  if (aimed && !area) {
    void *one = *(void **)((BYTE *)cast + CAST_TARGET);
    log_line("   shape: one stack");
    if (one) into[n++] = one;
    return n;
  }

  if (aimed && area) {
    // The list the command built from the tiles our own row named.
    void **from = *(void ***)((BYTE *)cast + CAST_AFFECTED);
    void **to = *(void ***)((BYTE *)cast + CAST_AFFECTED_END);
    log_line("   shape: an area — the stacks under the tiles our row names");
    if (!from || !to || to < from) return 0;
    for (void **at = from; at < to; at++) {
      if (readable_bytes(at, 4) < 4) break;
      if (n >= OUR_TARGETS_MAX) { log_num("   MORE than we will hit, dropped ", (int)(to - at)); break; }
      if (*at) into[n++] = *at;
    }
    return n;
  }

  // The whole field: asked of the combat, not walked out of somebody's loop.
  log_line("   shape: the whole field");
  if (!g_allUnits || !combat) { log_line("   no way to ask for the field"); return 0; }

  UnitList list = { NULL, NULL, NULL };
  g_allUnits(combat, &list);
  if (list.begin && list.end && list.end >= list.begin) {
    for (void **at = list.begin; at < list.end; at++) {
      if (n >= OUR_TARGETS_MAX) { log_num("   MORE than we will hit, dropped ", (int)(list.end - at)); break; }
      if (*at) into[n++] = *at;
    }
  }
  // Ours to free — the engine hands the storage over and keeps nothing.
  if (list.begin && g_free) g_free(list.begin);
  return n;
}

// ---------------------------------------------------------------------------
// AND THE CAST ITSELF.

/** Set by the C, read by the stub after its `popad` — no register survives that. */
static BYTE g_castWasOurs = 0;
static BYTE g_castDidNothing = 1;
/**
 * What the resolver returns, which is `edi` at its exit.
 *
 * The chain of entries a cast leaves behind: the caller passed one in, the
 * applier may hand back a longer one, and every shipped branch does `mov edi,eax`
 * before it jumps to the exit. Ours travels in a variable for the usual reason —
 * `popad` puts the old edi back — and the stub writes it into edi afterwards.
 */
static void *g_castChain = NULL;

/** The battle-side event a spell of ours is written against. */
#define H5E_SPELL_CAST 4

/** Non-zero when the row says this stack is passed over. */
static int row_spares(SpellRow *row, void *unit) {
  for (int i = 0; row && i < row->spareCount; i++) {
    if (!unit_has_ability(unit, row->spares[i])) continue;
    log_num("   spared, it has ability ", row->spares[i]);
    return 1;
  }
  return 0;
}

/**
 * One cast of ours, start to finish. Answers whether we handled it at all.
 *
 * The stub calls this instead of jumping anywhere. `chain` is the second
 * argument `Resolve` itself was called with — the thing every branch passes to
 * the hit and to the log, and the value the function goes on to return — so it
 * travels through us untouched rather than being invented.
 */
static char __cdecl our_cast(void *cast, void *chain, void *whatResolveWasGiven) {
  g_castDidNothing = 1;
  g_castChain = chain;
  if (readable_bytes(cast, CAST_BYTES) < CAST_BYTES) return 0;
  int spell = *(int *)((BYTE *)cast + CAST_SPELL);
  if (spell < FIRST_SPELL_OF_OURS) {
    log_num("[resolver] the game's own, spell id ", spell);
    return 0;
  }
  log_num("[resolver] OURS, spell id ", spell);

  void *record = g_spellRecord ? g_spellRecord(spell) : NULL;
  if (!record || readable_bytes(record, SPELL_RECORD_AREA + 1) < SPELL_RECORD_AREA + 1) {
    log_line("   the engine has no readable record for it — it will do nothing");
    return 0;
  }
  if (!g_spellWorth || !g_hitOne || !g_tellAbout) {
    log_line("   one of the engine's own damage functions is not where we left it");
    return 0;
  }

  // The script first, and whatever it did is already done by the time the
  // damage starts — the same door every other event of ours goes through.
  fire_trigger(H5E_SPELL_CAST, 1, spell, 0, 0);

  void *caster = *(void **)((BYTE *)cast + CAST_CASTER);
  int power = *(int *)((BYTE *)cast + CAST_POWER);
  int mastery = *(int *)((BYTE *)cast + CAST_MASTERY);
  float scale = *(float *)((BYTE *)cast + CAST_SCALE);

  // The two questions the resolver's own prologue asks, asked the same way: the
  // combat the caster is standing in, and what week it is.
  GetCombatFn getCombat = (GetCombatFn)slot_of(caster, UNIT_COMBAT_SLOT);
  void *combat = getCombat ? getCombat(caster) : NULL;
  CombatWeekFn getWeek = (CombatWeekFn)slot_of(combat, COMBAT_WEEK_SLOT);
  int week = getWeek ? getWeek(combat) : 0;

  void *targets[OUR_TARGETS_MAX];
  int count = our_targets(cast, record, combat, targets);
  log_num("   stacks to consider ", count);

  SpellRow *row = spell_row(spell);
  if (!row) log_line("   no row of its own — it passes over nobody");

  // Asked once, not per stack: a battle nobody is watching says so about itself,
  // not about a target. Both shipped branches ask it before every visual.
  NoVisualsFn quiet = (NoVisualsFn)slot_of(combat, COMBAT_NO_VISUALS_SLOT);
  int noVisuals = quiet && quiet(combat);
  if (noVisuals) log_line("   the battle wants no visuals — none will be played");

  int total = 0;
  for (int i = 0; i < count; i++) {
    void *unit = targets[i];
    log_hex("   stack ", (DWORD)(INT_PTR)unit);
    if (!handle_is_live(unit)) { log_line("      gone"); continue; }
    if (g_mayTouch && !g_mayTouch(unit, 0, 0)) { log_line("      a spell may not touch it"); continue; }
    if (row_spares(row, unit)) continue;
    // ASKED PER STACK, and the engine asks it ONCE — that is a difference, not
    // a copy. Nothing in its arguments is about the stack, so today the two give
    // the same number for every target; asking inside the loop is what lets a
    // spell of ours ever answer differently per target without moving anything.
    // If that turns out to cost measurable time in a big battle, hoisting it is
    // one line.
    UnitCountFn howMany = (UnitCountFn)slot_of(unit, UNIT_COUNT_SLOT);
    if (howMany) log_num("      creatures before ", howMany(unit));
    int worth = g_spellWorth(spell, power, mastery, week, NULL);
    int dealt = g_hitOne(worth, cast, caster, unit, 1, chain, scale, 1);
    int extra = g_tellAbout(chain, dealt, caster, unit, spell, 0);
    log_num("      worth ", worth);
    log_num("      damage ", dealt);
    log_num("      extra a vulnerability adds ", extra);
    // BOTH, the way every shipped branch does it — `add ecx,eax` on the damage
    // it already had. Counting only the second gave eight zeroes on a cast that
    // dealt twenty apiece, and the cast then called itself a spell that did
    // nothing.
    total += dealt + extra;

    // THE HIT, PER STACK, and before the entry — the order the mass routine
    // uses.
    //
    // INDEX 1, and never index 0. The document's `visuals` list is two jobs, not
    // two takes on one: `0` is the CAST, played once where the cast happens —
    // the middle of the field for a spell that aims at nobody — and `1` is the
    // HIT, played on every stack the spell touches. Every shipped whole-field
    // spell carries both and names them so: `Armageddon` + `Armageddon_Hit`,
    // `Unholy_Word` + `Unholy_Word_Hit`.
    //
    // An earlier version of this fell back to `0` when a document named only
    // one, which would have put the middle-of-the-field effect on top of every
    // stack. The engine does not: `0xAD5050` answers NULL past the end of the
    // list and the mass routine's `test eax,eax / je` skips the visual
    // altogether. So does ours, and it says so — because a spell of ours with
    // one visual is a document to finish, not a thing to paper over.
    if (!noVisuals && g_spellVisual) {
      void *visual = g_spellVisual(spell, 1);
      UnitPlayFn play = (UnitPlayFn)slot_of(unit, UNIT_PLAY_SLOT);
      if (!visual) log_line("      the document names no HIT visual — nothing to show on it");
      else if (!play) log_line("      the stack cannot be asked to play one");
      else chain = play(unit, chain, visual, 0, 0, 1);
    }

    // AND THE ENTRY, PER STACK — which is the whole of "the numbers are right
    // and nothing happens". The entry an applier builds is what the battle
    // plays back, and it carries ONE stack's damage: the mass routine calls the
    // applier INSIDE its loop with `mov edx,edi`, its loop variable, and this
    // stack's amount. Called once afterwards with the cast's total it names the
    // wrong amount for the wrong unit, and eight stacks lose nothing.
    if (g_plainApplier) {
      chain = g_plainApplier(caster, unit, dealt + extra, chain, spell, whatResolveWasGiven);
      log_hex("      the entry left behind ", (DWORD)(INT_PTR)chain);
    }
    // THE ONE LINE THAT SETTLES IT. If this differs from "creatures before",
    // something on this path applies the damage and the cast is nearly done. If
    // it does not, nothing here applies it and the search moves to what the
    // shipped branches do AFTER the entry — `unit->vt[0x27C]` in the mass
    // routine, `unit->vt[0x280]` in the single-target one, both called per stack
    // and both extending the chain.
    if (howMany) log_num("      creatures after ", howMany(unit));
  }
  g_castChain = chain;
  log_num("   the whole cast came to ", total);

  // The byte the engine calls "this spell did nothing" — and the Payback perk
  // reads it as a resisted spell, so it has to be honest. See qol/fix-payback.c.
  g_castDidNothing = (BYTE)(total == 0);
  return 1;
}

// ---------------------------------------------------------------------------
// AND THE ONE PLACE THE ENGINE HANDS US THE CAST.
//
// `cmp ecx,115h` at the head of `Resolve`'s dispatch — ecx IS the id at that
// instant, and the dispatch has no case for a number of ours. Six bytes become a
// jump to a stub that CALLS the resolver above and then leaves through the
// function's own exit.
//
// THE EXIT IS NOT A BORROWED BRANCH. `0xB7FAF0` is the epilogue every one of the
// two hundred and fifty cases jumps to — it writes the "did nothing" byte
// through the caller's pointer, frees two things the prologue made and returns
// `edi`. It belongs to the function, not to a spell. We arrive with the frame
// untouched (a pushad, a call and a popad), `edi` still the chain the caller
// passed in, exactly as the shipped single-target branch leaves it.
//
// The flags are saved and restored around the call, and our own test sits
// between the restore and the displaced comparison — so the dispatch below reads
// flags set by its own instruction and not by our arithmetic.

/** `cmp ecx,115h` at the head of the dispatch — ecx is the spell id. */
#define SPELL_DISPATCH_RVA 0x77eaf8u
#define SPELL_DISPATCH_LEN 6
static const BYTE SPELL_DISPATCH_HEAD[SPELL_DISPATCH_LEN] = {
  0x81, 0xF9, 0x15, 0x01, 0x00, 0x00
};

/** `mov ecx,[esp+0BCh]` — the function's own way out, shared by every case. */
#define SPELL_EXIT_RVA 0x77faf0u
#define SPELL_EXIT_MARK_LEN 7
static const BYTE SPELL_EXIT_MARK[SPELL_EXIT_MARK_LEN] = {
  0x8B, 0x8C, 0x24, 0xBC, 0x00, 0x00, 0x00
};

/**
 * THREE THINGS THE STUB HANDS OVER, and where each sits once the stub has pushed.
 *
 * `pushad` is 32 bytes and `pushfd` four, so a frame slot moves by 0x24 the
 * moment the stub starts, and by four more with every argument pushed. Counted
 * out rather than remembered:
 *
 *   the cast object   at [esp+14h] → 0x24 + 8 pushed → [esp+40h]
 *   the chain         is `edi`, straight from the register
 *   Resolve's own a1  at [esp+0B4h] → 0x24 pushed → [esp+0D8h]
 *
 * Pushed in reverse, so the C reads them left to right.
 */
#define RESOLVE_STUB_LEN 69
static BYTE RESOLVE_STUB[RESOLVE_STUB_LEN] = {
  0x60,                                     //  0  pushad
  0x9C,                                     //  1  pushfd
  0xFF, 0xB4, 0x24, 0xD8, 0x00, 0x00, 0x00, //  2  push dword ptr [esp+0D8h] — Resolve's a1
  0x57,                                     //  9  push edi                  — the chain
  0xFF, 0x74, 0x24, 0x40,                   // 10  push dword ptr [esp+40h]  — the cast
  0xE8, 0x00, 0x00, 0x00, 0x00,             // 14  call our_cast
  0x83, 0xC4, 0x0C,                         // 19  add esp,12
  0xA2, 0x00, 0x00, 0x00, 0x00,             // 22  mov [g_castWasOurs],al
  0x9D,                                     // 27  popfd
  0x61,                                     // 28  popad
  0x80, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // 29  cmp byte ptr [g_castWasOurs],0
  0x74, 0x14,                               // 36  je +20                    — not ours
  0xA0, 0x00, 0x00, 0x00, 0x00,             // 38  mov al,[g_castDidNothing]
  0x88, 0x44, 0x24, 0x13,                   // 43  mov [esp+13h],al
  0x8B, 0x3D, 0x00, 0x00, 0x00, 0x00,       // 47  mov edi,[g_castChain]     — what it returns
  0xE9, 0x00, 0x00, 0x00, 0x00,             // 53  jmp <the function's exit>
  0x81, 0xF9, 0x15, 0x01, 0x00, 0x00,       // 58  cmp ecx,115h              — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // 64  jmp back
};

static BYTE RESOLVE_TO_STUB[SPELL_DISPATCH_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_our_resolver(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  // Every one of them checked against the bytes we measured before it is ever
  // called. `engine_code` lives in core/detour.c beside `detour` and
  // `overwrite_code`, because it is the third thing one can do with an
  // address — call it — and it is refused on a mismatch like the other two.
  g_allUnits = (AllUnitsFn)engine_code(ALL_UNITS_RVA, ALL_UNITS_HEAD, ALL_UNITS_HEAD_LEN,
                                       "every stack on the field");
  g_mayTouch = (MayTouchFn)engine_code(MAY_TOUCH_RVA, MAY_TOUCH_HEAD, MAY_TOUCH_HEAD_LEN,
                                       "may a spell touch this stack");
  g_spellWorth = (SpellWorthFn)engine_code(SPELL_WORTH_RVA, SPELL_WORTH_HEAD,
                                           SPELL_WORTH_HEAD_LEN, "what a spell is worth");
  g_hitOne = (HitOneFn)engine_code(HIT_ONE_RVA, HIT_ONE_HEAD, HIT_ONE_HEAD_LEN,
                                   "what a spell does to one stack");
  g_tellAbout = (TellAboutFn)engine_code(TELL_ABOUT_RVA, TELL_ABOUT_HEAD,
                                         TELL_ABOUT_HEAD_LEN, "the line a hit stack gets");
  g_plainApplier = (PlainApplierFn)engine_code(PLAIN_APPLIER_RVA, PLAIN_APPLIER_HEAD,
                                               PLAIN_APPLIER_HEAD_LEN, "the entry a cast leaves");
  g_spellVisual = (SpellVisualFn)engine_code(SPELL_VISUAL_RVA, SPELL_VISUAL_HEAD,
                                             SPELL_VISUAL_HEAD_LEN, "a spell's visual");
  g_free = (FreeFn)engine_code(FREE_RVA, FREE_HEAD, FREE_HEAD_LEN, "the allocator's free");
  BYTE *exit = engine_code(SPELL_EXIT_RVA, SPELL_EXIT_MARK, SPELL_EXIT_MARK_LEN,
                           "the way out of the resolver");
  // The three that decide the damage are the ones a cast cannot do without. The
  // rest degrade honestly — a missing field getter costs the whole-field shape
  // its targets and says so, once, per cast.
  if (!exit || !g_spellWorth || !g_hitOne || !g_tellAbout) {
    log_line("no resolver of our own — spells of ours will do nothing");
    return;
  }

  BYTE *stub = (BYTE *)VirtualAlloc(NULL, RESOLVE_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("our resolver: no memory for the stub"); return; }
  for (int i = 0; i < RESOLVE_STUB_LEN; i++) stub[i] = RESOLVE_STUB[i];
  *(DWORD *)(stub + 15) = (DWORD)(void *)our_cast - (DWORD)(stub + 19);
  *(DWORD *)(stub + 23) = (DWORD)(void *)&g_castWasOurs;
  *(DWORD *)(stub + 31) = (DWORD)(void *)&g_castWasOurs;
  *(DWORD *)(stub + 39) = (DWORD)(void *)&g_castDidNothing;
  *(DWORD *)(stub + 49) = (DWORD)(void *)&g_castChain;
  *(DWORD *)(stub + 54) = (DWORD)exit - (DWORD)(stub + 58);
  *(DWORD *)(stub + 65) =
      (DWORD)(base + SPELL_DISPATCH_RVA + SPELL_DISPATCH_LEN) - (DWORD)(stub + RESOLVE_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, RESOLVE_STUB_LEN);

  *(DWORD *)(RESOLVE_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + SPELL_DISPATCH_RVA) + 5);
  if (overwrite_code(SPELL_DISPATCH_RVA, SPELL_DISPATCH_HEAD, RESOLVE_TO_STUB,
                     SPELL_DISPATCH_LEN, "the spell dispatch")) {
    log_line("a spell of ours resolves itself — no branch of the game's is borrowed");
  }
}
