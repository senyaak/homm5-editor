// What a function registered with the engine's Lua has to look like.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Functions of our own, callable from a map's Lua.
//
// The engine hands Lua 306 functions out of seven `{name, function}` tables in
// .data. The tables are packed with no slack, so nothing can be appended in
// place — but each one is reached through a tiny accessor of its own,
// `mov eax,<table>; ret`, and the adventure map's is the only one we need. So
// the whole mechanism is: copy their table, add our rows, and rewrite the four
// bytes of that immediate. No detour, no trampoline, and the engine's own 99
// functions are the first 99 entries of the copy — untouched, in order.
//
// A registered function is `__fastcall(void *ctx)`: the call context arrives in
// ecx and the result is a handle returned in eax, or 0. Every shipped one
// returns 0 on a path it cannot serve (no adventure map, bad argument), so 0 is
// a value the caller is known to tolerate.

/**
 * `GetPlayerNecroEnergy`, the engine's own Lua function.
 *
 * We CALL it rather than reimplement it. It already parses the player argument
 * the way every other function does, complains in the same words when the
 * number is out of range, walks the world to the player and asks for the pool.
 * That last step goes through the player's vtable — the slot below — so a
 * replacement in that slot sees the player the lookup found, which is the one
 * thing we need and the one thing a Lua function cannot be handed.
 */
#define LUA_GET_NECRO_ENERGY_RVA 0x1e2ce0u
/** `mov eax,[ecx+638h]; ret` — the pool getter, vtable +0x1fc. */
#define ENERGY_GETTER_RVA 0x806c50u
static const BYTE ENERGY_GETTER_HEAD[7] = { 0x8B, 0x81, 0x38, 0x06, 0x00, 0x00, 0xC3 };
/** Where a player refills its own pool to the ceiling — the weekly grant. */
#define VT_PLAYER_REFILL 0x214u

/** `mov eax,<adventure-map table>; ret`, and the two bytes that say it is. */
#define LUA_TABLE_ACCESSOR_RVA 0x1ce710u
/**
 * And the battle's, which is the same five bytes at another address.
 *
 * `0x601480: mov eax,0x108dfb0; ret` — 53 functions, the vocabulary a combat
 * script is written against. One code site names that table and this is it, so
 * the battle's Lua is extended exactly as the map's is.
 */
#define LUA_COMBAT_TABLE_ACCESSOR_RVA 0x201480u
#define LUA_MOV_EAX_IMM 0xB8
#define LUA_RET 0xC3
/** How many of ours can be added. Room to grow; the table is ours to size. */
#define MAX_LUA_FUNCTIONS 16

/** One row of a registration table, exactly as the engine lays it out. */
typedef struct {
  const char *name;
  void *fn;
} LuaEntry;

typedef void *(__fastcall *LuaFn)(void *ctx);

/** The jump we write. The head we DISPLACE can be longer — see `detour`. */
#define DETOUR_LEN 5
/** As much of a head as a trampoline has room for, jump home included. */
#define MAX_HEAD_LEN 16
#define MAX_ROWS 64
/** Members of one set. The game's longest is eight (the Dragonish). */
#define MAX_MEMBERS 12

typedef void *(__thiscall *WornFn)(void *hero);
typedef void *(__thiscall *HeroesFn)(void *player);
typedef int(__thiscall *CountEquippedFn)(void *worn, int artifactId);
typedef int(__thiscall *SkillMasteryFn)(void *hero, int skillId);
typedef int(__fastcall *RaiseFn)(void *hero);
typedef int(__fastcall *CostFn)(void *hero, void *what);
typedef void(__fastcall *PlayerFn)(void *player);
typedef void *(__fastcall *CapsFn)(void *player);

static CountEquippedFn g_countEquipped = NULL;

