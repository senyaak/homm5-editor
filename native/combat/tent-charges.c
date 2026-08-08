// Where the tent's charges come from, and H5ETentCharge.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT combat_tent_charges

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
  g_lastTent = m;
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

static void tent_charges_term(void *unit, void *skills) {
  if (!unit || !skills) return;
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
  int add = hero_term(skills, STAT_TENT_CHARGES, 0);
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
  g_machineCtor = (MachineCtorFn)detour(MACHINE_CTOR_RVA, MACHINE_CTOR_HEAD, DETOUR_LEN,
                                        &machine_ctor_hook, "war machine ctor");
  return g_machineCtor != NULL;
}

