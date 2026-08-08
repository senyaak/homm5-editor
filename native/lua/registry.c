// Registering Lua functions of our own.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Registering our own Lua functions.

/**
 * The proof that this works at all: say so in the log, and nothing else.
 *
 * Kept after the thing it proved started working, because "the extension is
 * loaded" and "the game's Lua can reach it" are different claims and only the
 * second one explains why a script does nothing.
 */
static void *__fastcall lua_editor_test(void *ctx) {
  (void)ctx;
  log_line("lua: EditorTest() was called from a script");
  return NULL;
}

// --- RestoreDarkEnergy(player) ----------------------------------------------
//
// What Lua could never do: put dark energy back. There is no setter because the
// engine does not set the pool — it fills it to a ceiling — so "restore" here
// means asking the player to do its own weekly refill, out of turn. Our ceiling
// term rides along, because that refill is one of the calls we already extend.
//
// The player is found by CALLING the engine's own `GetPlayerNecroEnergy` and
// watching where it lands: its last step reads the pool through the player's
// vtable, and that slot is ours, so the player it found arrives as `this`. That
// is one address instead of the service locator, the world walk, the argument
// parser and its two heap strings — none of which we would be reimplementing,
// only copying badly.

static int g_restoreTraceLeft = 24;

static void *__fastcall lua_restore_dark_energy(void *ctx) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  g_capturedPlayer = NULL;
  g_capturing = 1;
  // Its own error reporting stands: a bad player number is refused in the words
  // every other function of the engine's uses, before we are ever involved.
  void *result = ((LuaFn)(base + LUA_GET_NECRO_ENERGY_RVA))(ctx);
  g_capturing = 0;

  void *player = g_capturedPlayer;
  if (!player) {
    log_line("RestoreDarkEnergy: no player was reached - nothing restored");
    return result;
  }
  int before = *(int *)((BYTE *)player + ENERGY_FIELD);
  void **vtable = *(void ***)player;
  ((RefillFn)vtable[VT_PLAYER_REFILL / 4])(player);
  if (g_restoreTraceLeft > 0) {
    g_restoreTraceLeft--;
    log_num("RestoreDarkEnergy: was ", before);
    log_num("                   now ", *(int *)((BYTE *)player + ENERGY_FIELD));
  }
  return result;
}

static LuaEntry g_ourFunctions[MAX_LUA_FUNCTIONS] = {
  { "EditorTest", &lua_editor_test },
  { "RestoreDarkEnergy", &lua_restore_dark_energy },
};
static int g_ourFunctionCount = 2;

/**
 * One more row, from a feature that lives further down the file.
 *
 * The table above is written where the shape of a registered function is
 * explained, but the functions themselves belong with the thing they do — a
 * window's two doors belong beside the window. So the table takes rows until
 * `install_lua_functions` copies it, and everything after this file adds its
 * own from `DllMain`.
 */
static void add_map_function(const char *name, void *fn) {
  if (g_ourFunctionCount >= MAX_LUA_FUNCTIONS) {
    log_text("no room in our lua table for ", name);
    return;
  }
  g_ourFunctions[g_ourFunctionCount].name = name;
  g_ourFunctions[g_ourFunctionCount].fn = fn;
  g_ourFunctionCount++;
}

/**
 * The same proof, one context over: a battle's script can reach us.
 *
 * It takes no arguments deliberately. Reading one would mean going through the
 * engine's argument parser, and this function exists to answer a question that
 * has nothing to do with arguments — whether a battle runs our code at all.
 */
static void *__fastcall lua_combat_test(void *ctx) {
  (void)ctx;
  log_line("lua: H5ECombatTest() was called from inside a battle");
  return NULL;
}


#define MACHINE_CHARGES_EARLY 0xB0u


/** The tent this battle built last — what `H5ETentCharge()` hands a use to. */
static void *g_lastTent = NULL;

/**
 * One more use for the tent, asked for by a script. NO ARGUMENTS, deliberately.
 *
 * This is the half of the ultimate that Lua cannot do: the charges live at
 * `machine+0xB0` and no registered function of the game's touches them. What
 * Lua CAN do is watch the mana — `GetUnitManaPoints` is in its own vocabulary,
 * and every unit's turn arrives as `UnitMove`. So the script counts and this
 * writes, and neither side needs the thing it does not have — which is also why
 * this takes no arguments: reading them means reimplementing the engine's
 * parser, and the perk does not need to.
 *
 * ITS LIMIT, stated rather than discovered later: with no arguments it cannot be
 * told WHOSE tent, so the use goes to the last one built. One tent a side is the
 * normal case and the stand has one; telling them apart waits for arguments.
 */
static void *__fastcall lua_tent_charge(void *ctx) {
  (void)ctx;
  if (!g_lastTent || !readable((BYTE *)g_lastTent + MACHINE_CHARGES_EARLY, 4)) {
    log_line("H5ETentCharge: no tent to give a use to");
    return NULL;
  }
  int *charges = (int *)((BYTE *)g_lastTent + MACHINE_CHARGES_EARLY);
  *charges += 1;
  log_num("H5ETentCharge: the tent now has ", *charges);
  return NULL;
}

static LuaEntry g_ourCombatFunctions[MAX_LUA_FUNCTIONS] = {
  { "H5ECombatTest", &lua_combat_test },
  { "H5ETentCharge", &lua_tent_charge },
};
static int g_ourCombatFunctionCount = 2;

/**
 * Give the engine a table of our own: theirs, plus ours, plus the terminator.
 *
 * The four bytes rewritten are the accessor's immediate, and the address that
 * was in them is where the engine's own table is — read rather than assumed, so
 * a build that loads at another base still finds it.
 *
 * TWO CONTEXTS, ONE ROUTINE. The adventure map's table and the BATTLE's are
 * handed over by accessors of the same five bytes (`mov eax,<table>; ret`) at
 * two addresses, so the map's vocabulary and the battle's are extended the same
 * way. That is what makes a function of ours callable from inside a fight, where
 * the two contexts otherwise share nothing but the game variables.
 */
static int install_lua_table(DWORD rva, const LuaEntry *ours, int count, const char *what) {
  BYTE *accessor = (BYTE *)GetModuleHandleW(NULL) + rva;
  if (accessor[0] != LUA_MOV_EAX_IMM || accessor[5] != LUA_RET) {
    log_text("the lua table accessor is not the shape we know - not registering: ", what);
    return 0;
  }

  LuaEntry *theirs = *(LuaEntry **)(accessor + 1);
  int n = 0;
  while (theirs[n].name || theirs[n].fn) n++;

  LuaEntry *ext = (LuaEntry *)VirtualAlloc(NULL, (n + count + 1) * sizeof(LuaEntry),
                                           MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!ext) { log_line("no memory for the lua table"); return 0; }

  for (int i = 0; i < n; i++) ext[i] = theirs[i];
  for (int i = 0; i < count; i++) ext[n + i] = ours[i];
  ext[n + count].name = NULL;
  ext[n + count].fn = NULL;

  DWORD old = 0;
  if (!VirtualProtect(accessor + 1, sizeof(void *), PAGE_EXECUTE_READWRITE, &old)) {
    log_line("could not make the lua accessor writable");
    return 0;
  }
  *(LuaEntry **)(accessor + 1) = ext;
  VirtualProtect(accessor + 1, sizeof(void *), old, &old);
  FlushInstructionCache(GetCurrentProcess(), accessor, 6);

  log_text("lua: extended the table of the ", what);
  log_num("     the engine's had ", n);
  log_num("     ours added:      ", count);
  return 1;
}

static int install_lua_functions(void) {
  int done = install_lua_table(LUA_TABLE_ACCESSOR_RVA, g_ourFunctions, g_ourFunctionCount,
                               "adventure map");
  done += install_lua_table(LUA_COMBAT_TABLE_ACCESSOR_RVA, g_ourCombatFunctions,
                            g_ourCombatFunctionCount, "battle");
  return done;
}

