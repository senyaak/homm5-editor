// How much the machine itself can take.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// How much the machine itself can take — the second number a first aid tent has.
//
// `CWarMachine::GetHealth` is the ONLY place a war machine's hit points are
// decided, and it is shaped like the sum every other term of ours joins:
//
//     hp  = record-><Health>                       // 100 for the tent
//         + GetSkillMastery(WAR_MACHINES) * WarMachines_HealthBonusPerSkillTrained
//     switch (type - 1)                            // jump table at 0xabc148
//       tent → if the hero holds HERO_SKILL_FIRST_AID, hp *= the perk multiplier
//
// So "a perk makes the machine tougher" is a shape the engine already has, and
// ours is a second multiplier applied to the number it arrives at — which is why
// the row is a PERCENT rather than points: doubling the hit points of a tent
// whose owner is an expert of War Machines should be worth more than doubling a
// novice's, exactly as the shipped perk is.
//
// `this` is the WORLD machine (the one the combat machine keeps at +0xA8), so
// its type is at the same +0x1C the constructor hook reads, and the hero is the
// function's one stack argument — the object skills answer on directly, because
// the engine asks it for a mastery through `[vtable+0x174]` two instructions in.
#define MACHINE_HEALTH_RVA 0x6bc040u
/** `push ecx; push ebx; push ebp; mov ebp,[esp+10h]` — seven bytes, four whole
 *  instructions, and none of them relocated. */
#define MACHINE_HEALTH_HEAD_LEN 7
static const BYTE MACHINE_HEALTH_HEAD[MACHINE_HEALTH_HEAD_LEN] = {
  0x51, 0x53, 0x55, 0x8B, 0x6C, 0x24, 0x10,
};

typedef int(__fastcall *MachineHealthFn)(void *machine, void *edx, void *hero);
static MachineHealthFn g_machineHealth = NULL;
static int g_healthLogged = 0;

static int __fastcall machine_health_hook(void *machine, void *edx, void *hero) {
  int engine = g_machineHealth(machine, edx, hero);
  // The tent alone. The function answers for all four machines and a hero who
  // brought a ballista has no business gaining from a perk about bandages.
  if (engine <= 0 || !hero) return engine;
  if (!readable((BYTE *)machine + WORLD_MACHINE_TYPE, 4)) return engine;
  if (*(int *)((BYTE *)machine + WORLD_MACHINE_TYPE) != MACHINE_TYPE_TENT) return engine;

  int percent = hero_term(hero, STAT_TENT_HEALTH, 0);
  int add = engine * percent / 100;
  int total = engine + add;
  if (total < 1) total = 1;
  if (add && g_healthLogged++ < 8) {
    log_line("tent health:");
    log_num("  the engine said ", engine);
    log_num("  our percent     ", percent);
    log_num("  hit points      ", total);
  }
  return add ? total : engine;
}

