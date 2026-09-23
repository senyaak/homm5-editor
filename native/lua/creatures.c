// What the game's creatures are, for a script that wants to choose one.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_creatures

// ---------------------------------------------------------------------------
// THE TABLE, NOT A LIST. The map's Lua has no way to ask what creatures exist:
// `advmap-startup.lua` declares the shipped ids as constants and that is the
// whole of it, so a script that wants "any creature of tiers three to six" has
// to carry its own list — which a mod's own creatures are not in, and which
// goes stale the moment anything is added.
//
// These three read the engine's own table, to the ceiling the installer set
// (src/exe/creature-limit.ts), so a creature added yesterday is in the answer
// today. A filter that leaves nothing answers with nothing, which in Lua is a
// call that returned no values — `{ H5ECreatures(9, 9) }` is an empty table,
// not an error.

/** The record's fields, as its own serializer names them (0xA85F80…). */
#define RECORD_TIER 0x8Cu
#define RECORD_TOWN 0x98u
#define RECORD_GROWTH 0xA8u
/** `Cost`, seven resources in the shipped order — gold is the last of them. */
#define RECORD_COST 0xACu
#define COST_RESOURCES 7
#define COST_GOLD 6

/** A creature's record from its number — `push esi; mov esi,ecx; test esi,esi; js`, `__fastcall(creature)`. */
#define CREATURE_RECORD_RVA 0x727630u
static const BYTE CREATURE_RECORD_HEAD[8] = { 0x56, 0x8B, 0xF1, 0x85, 0xF6, 0x78, 0x15, 0xE8 };
/** How many creatures there are — `mov eax,imm32; ret`, the immediate being what the installer set. */
#define CREATURE_COUNT_RVA 0x69efa0u
#define CREATURE_COUNT_OPCODE 0xB8
#define CREATURE_COUNT_RET_AT 5

typedef void *(__fastcall *CreatureRecordFn)(int creature);
typedef int (__cdecl *CreatureCountFn)(void);

static CreatureRecordFn g_creatureRecord = NULL;
static CreatureCountFn g_creatureCount = NULL;

static int creatures_ready(void) {
  if (g_creatureCount) return 1;
  g_creatureRecord = (CreatureRecordFn)code_at(CREATURE_RECORD_RVA, CREATURE_RECORD_HEAD,
                                               sizeof CREATURE_RECORD_HEAD, "a creature's record");
  BYTE *count = (BYTE *)GetModuleHandleW(NULL) + CREATURE_COUNT_RVA;
  if (count[0] != CREATURE_COUNT_OPCODE || count[CREATURE_COUNT_RET_AT] != 0xC3) {
    log_line("creatures: the creature count is not where it was measured");
    return 0;
  }
  if (!g_creatureRecord) return 0;
  g_creatureCount = (CreatureCountFn)count;
  return 1;
}

/** A creature's record, or nothing when the table has no such id. */
static BYTE *creature_record(int creature) {
  if (!creatures_ready() || creature <= 0) return NULL;
  BYTE *record = (BYTE *)g_creatureRecord(creature);
  return readable(record, RECORD_COST + COST_RESOURCES * 4) ? record : NULL;
}

/**
 * `H5ECreatures([minTier, maxTier])` — the id of every creature there is, the
 * mod's own included, within the tiers asked.
 *
 * One result per creature, so `{ H5ECreatures(3, 6) }` is the table to roll
 * from. Without arguments it is every creature in the table.
 */
static void *__fastcall lua_creatures(void *ctx) {
  if (!creatures_ready()) return NULL;
  int lo = 0;
  int hi = 99;
  (void)lua_arg_int(ctx, 1, &lo);
  (void)lua_arg_int(ctx, 2, &hi);
  int n = g_creatureCount();
  int pushed = 0;
  for (int id = 1; id < n; id++) {
    BYTE *record = creature_record(id);
    if (!record) continue;
    int tier = *(int *)(record + RECORD_TIER);
    if (tier < lo || tier > hi) continue;
    if (!lua_push_int(ctx, id)) break;
    pushed++;
  }
  return (void *)(INT_PTR)pushed;
}

/** `H5ECreatureTier(creature)` — its tier, 1…7, or nothing for an id the table lacks. */
static void *__fastcall lua_creature_tier(void *ctx) {
  int creature = 0;
  if (!lua_arg_int(ctx, 1, &creature)) return NULL;
  BYTE *record = creature_record(creature);
  return record ? (void *)(INT_PTR)lua_push_int(ctx, *(int *)(record + RECORD_TIER)) : NULL;
}

/** `H5ECreatureGrowth(creature)` — what a week of it is, the number a dwelling stocks. */
static void *__fastcall lua_creature_growth(void *ctx) {
  int creature = 0;
  if (!lua_arg_int(ctx, 1, &creature)) return NULL;
  BYTE *record = creature_record(creature);
  return record ? (void *)(INT_PTR)lua_push_int(ctx, *(int *)(record + RECORD_GROWTH)) : NULL;
}

/**
 * `H5ECreatureCost(creature [, resource])` — what one costs.
 *
 * The resource is the game's own `RESOURCE_*` number, and gold (6) is the
 * default, because gold is what a creature is bought with and the rest are
 * zero for all but a few.
 */
static void *__fastcall lua_creature_cost(void *ctx) {
  int creature = 0;
  if (!lua_arg_int(ctx, 1, &creature)) return NULL;
  int resource = COST_GOLD;
  (void)lua_arg_int(ctx, 2, &resource);
  if (resource < 0 || resource >= COST_RESOURCES) {
    log_num("H5ECreatureCost: there is no resource ", resource);
    return NULL;
  }
  BYTE *record = creature_record(creature);
  return record ? (void *)(INT_PTR)lua_push_int(ctx, *(int *)(record + RECORD_COST + resource * 4)) : NULL;
}

/** `H5ECreatureTown(creature)` — the `TOWN_*` number of the race it belongs to. */
static void *__fastcall lua_creature_town(void *ctx) {
  int creature = 0;
  if (!lua_arg_int(ctx, 1, &creature)) return NULL;
  BYTE *record = creature_record(creature);
  return record ? (void *)(INT_PTR)lua_push_int(ctx, *(int *)(record + RECORD_TOWN)) : NULL;
}

static void add_creature_map_functions(void) {
  add_map_function("H5ECreatures", (void *)&lua_creatures);
  add_map_function("H5ECreatureTier", (void *)&lua_creature_tier);
  add_map_function("H5ECreatureGrowth", (void *)&lua_creature_growth);
  add_map_function("H5ECreatureCost", (void *)&lua_creature_cost);
  add_map_function("H5ECreatureTown", (void *)&lua_creature_town);
}
