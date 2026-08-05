// Imbue Ballista costs the ranger mana, not his turn.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHAT THE GAME SAYS. The perk: "Все снаряды баллисты будут нести чары
// рейнджера, поэтому запас маны последнего будет уменьшаться." The ballista's
// shots carry the enchantment and the ranger pays MANA for them. Nothing about
// his turn.
//
// WHAT IS WRONG. dredknight's `ImbueBalistaAtbFix.cpp` says the cast takes his
// ATB as well — the hero's place on the turn bar moves back for a shot that was
// not his — and fixes it by saving the value before the enchantment is cast and
// writing it back after.
//
// WHERE IT IS. `0xBC00F0` resolves a hit. At `0xBC1573` it asks the shooter's
// owner for `HERO_SKILL_IMBUE_BALLISTA` (113), having already established that
// the shooter is the ballista, and `0xBC15A0` is the cast: `call 0xB7B320`,
// with the hero in `ecx` and the target in `edx`. The hero arrives as
// `shooter->vt[0x18]()->vt[0xC]()` and is walked to its virtual base —
// `(hero+4) + [[hero+4]+8]` — before the call, so what `ecx` holds there is the
// COMBAT UNIT subobject of a `CCombatHero`, vtable `0xFDFC04`.
//
// WHERE THE ATB IS — the one fact that kept this unported. On that unit vtable,
// `+0x184` returns the object that holds the value (`0xB62DC0`, which is
// `mov eax,[ecx-0x70]; ret`) and its ATB is the float at `+0x1C`; `+0x18C` sets
// it (`0xB5ED60`, which reads the old value from that same `[-0x70]` and `+0x1C`
// before it writes). Both are adjustor thunks, and the one on the hero's side
// adjusts by `0x68`.
//
// That is dredknight's chain, constant for constant: his `[X-0x68]` is our
// thunk's `sub ecx,0x68`, his `[-0x70]` is the getter's whole body, and his
// `[hero+0x1C]` is where the float sits. It was written off as a claim about
// his build's layout because the slot was read from the wrong vtable start:
// `CCombatHero` has six vtables and `0xFDFB34`, the first, is `0x34` bytes long
// — `+0x184` from there lands inside `0xFDFC04`, at its `+0xB4`, which is a
// different pair of functions entirely. `CCombatCreature` reaches the SAME two
// implementations from ITS `+0x184` and `+0x18C`, by thunks adjusting `0x94`
// instead: one interface, two classes, and the imbue site itself uses that pair
// on the defender twenty instructions further down.
//
// HOW WE DO IT. The five bytes of `call 0xB7B320` are pointed at us instead —
// the call, not the function, since `0xB7B320` has two other callers whose
// turns are their own. We read the ATB, run their cast unchanged, read it
// again, and put the old value back ONLY IF IT MOVED, so a build where this
// does not happen is a build we have not touched.
//
// WATCHED, 2026-08-05, and the bug is real: play the ranger with the flag off
// and his marker on the turn bar slides back when the ballista fires; with it
// on, it stays. That is the observation the claim needed.
//
// HOW IT WAS ALMOST DELETED ANYWAY, because the lesson is worth more than the
// fix. Both logged battles were played with the flag ON — it had been installed
// before the first of them — so the log was reporting a fixed game and every
// line said the turn had not moved. Read as "the bug does not happen", that was
// nearly an AgilityFix. A run of the map with the fix OFF is not a formality on
// this one: it is the only half of the experiment that can see the bug at all,
// and the log alone cannot tell the two halves apart.

/** `call 0xB7B320` — cast the enchantment onto the ballista's shot. */
#define IMBUE_CALL_RVA 0x7c15a0u
/** The cast itself, which we still run: `__fastcall(caster, target, a1, a2)`. */
#define IMBUE_CAST_RVA 0x77b320u
/** `CCombatHero`'s combat-unit vtable — the only pointer we act on. */
#define HERO_UNIT_VTABLE_RVA 0xbdfc04u
/**
 * `CCombatCreature`'s, which we only ever READ — and only to keep ourselves
 * honest.
 *
 * The first battle came back with the hero's reading identical on all six
 * shots, and a number that never moves cannot be told from a number that is not
 * the one we think. The defender is the same interface (its `+0x184` and
 * `+0x18C` reach the same two implementations, by thunks adjusting `0x94`
 * instead of `0x68`) and it is a creature stack taking hits, so ITS value moves
 * if anything does. Printed beside the hero's, it is the control.
 */
#define CREATURE_UNIT_VTABLE_RVA 0xbbbca8u
/** On that vtable: the object holding the ATB, and the setter. */
#define UNIT_ATB_HOLDER_SLOT 0x184u
#define UNIT_SET_ATB_SLOT 0x18cu
/** Inside that object: the value itself. */
#define ATB_IN_HOLDER 0x1cu
/** How many shots say what they saw. Enough to read, too few to spam a battle. */
#define IMBUE_LINES 6

typedef int(__fastcall *ImbueCastFn)(void *caster, void *target, void *a1, void *a2);
typedef void *(__thiscall *AtbHolderFn)(void *unit);
typedef void(__thiscall *SetAtbFn)(void *unit, float atb);

static const BYTE IMBUE_CALLS_THE_CAST[5] = { 0xE8, 0x7B, 0x9D, 0xFB, 0xFF };
/** The same call through us; the four zeroes are the distance, filled in below. */
static BYTE IMBUE_CALLS_US[5] = { 0xE8, 0x00, 0x00, 0x00, 0x00 };

/**
 * Counted APART, and that is the whole lesson of the first evening with this.
 *
 * One counter for both outcomes meant the first six shots used it up, and the
 * six that happened to take no turn made the log read "this never happens" — on
 * a run where the fix was ON and putting the value back on later shots, in
 * silence, because the counter was spent. The conclusion drawn from that file
 * was that the bug was not real and the fix should be deleted. It was real: turn
 * the flag off and the ranger's marker slides back.
 *
 * So the interesting outcome gets a budget the boring one cannot spend.
 */
static int g_imbueRestored = 0;
static int g_imbueQuiet = 0;

/** Where this unit's ATB lives right now, or null if it cannot be read. */
static float *unit_atb(void *unit, void **vt) {
  void *holder = ((AtbHolderFn)vt[UNIT_ATB_HOLDER_SLOT / 4])(unit);
  float *at = (float *)((BYTE *)holder + ATB_IN_HOLDER);
  return readable(at, sizeof(float)) ? at : NULL;
}

static int __fastcall imbue_ballista_hook(void *caster, void *target, void *a1, void *a2) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  ImbueCastFn cast = (ImbueCastFn)(base + IMBUE_CAST_RVA);
  void **vt = readable(caster, sizeof(void *)) ? *(void ***)caster : NULL;

  // The slots below were read out of ONE vtable. Any other pointer here and we
  // are a spectator: calling a slot number on a vtable it was not counted on is
  // exactly the failure this whole page of fixes is disciplined against.
  if (vt != (void **)(base + HERO_UNIT_VTABLE_RVA)) return cast(caster, target, a1, a2);

  float *at = unit_atb(caster, vt);
  if (!at) return cast(caster, target, a1, a2);
  float before = *at;

  int damage = cast(caster, target, a1, a2);

  // Asked again rather than remembered. The cast is a turn of engine work, and
  // a pointer taken before it is a claim that nothing moved the object.
  at = unit_atb(caster, vt);
  if (!at) return damage;
  float after = *at;

  if (after != before) {
    ((SetAtbFn)vt[UNIT_SET_ATB_SLOT / 4])(caster, before);
    if (g_imbueRestored < IMBUE_LINES) {
      g_imbueRestored++;
      // Thousandths, because the log writes integers and the turn bar is a
      // fraction — 3600 here is 3.6 of whatever the engine counts in.
      log_num("imbue ballista: the cast moved the hero's turn to ", (int)(after * 1000.0f));
      log_num("imbue ballista: put back where it was, ", (int)(before * 1000.0f));
    }
  } else if (g_imbueQuiet < IMBUE_LINES) {
    g_imbueQuiet++;
    log_num("imbue ballista: the cast cost the hero no turn, still ", (int)(before * 1000.0f));
    // THE CONTROL, and the reason it is here: the first battle said "no turn
    // taken" six times with the same number every time, which is what a live
    // deterministic value looks like AND what a value we are misreading looks
    // like. The defender is a stack being shot at, so its own reading moves if
    // these accessors read anything at all. Read, never written.
    void **theirs = readable(target, sizeof(void *)) ? *(void ***)target : NULL;
    if (theirs == (void **)(base + CREATURE_UNIT_VTABLE_RVA)) {
      float *his = unit_atb(target, theirs);
      if (his) log_num("                the stack he shot reads ", (int)(*his * 1000.0f));
    }
  }
  return damage;
}

static void install_imbue_ballista_fix(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  *(DWORD *)(IMBUE_CALLS_US + 1) =
      (DWORD)&imbue_ballista_hook - ((DWORD)(base + IMBUE_CALL_RVA) + (DWORD)sizeof IMBUE_CALLS_US);
  overwrite_code(IMBUE_CALL_RVA, IMBUE_CALLS_THE_CAST, IMBUE_CALLS_US,
                 sizeof IMBUE_CALLS_THE_CAST, "the enchantment a ballista shot carries");
}
