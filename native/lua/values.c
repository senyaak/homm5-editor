// Arguments and results: what a Lua function of ours may be told, and answer.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT lua_values

// ---------------------------------------------------------------------------
// The value stack a registered function is called with.
//
// Until this file every function of ours took nothing and answered nothing, and
// the reason given was that reading an argument means going through the
// engine's parser at 0xa454d0 — which wants a format string and a name built on
// the heap. That is true of the parser and NOT of the values: `sleep` reads its
// own argument in nine instructions without going near it, and that is the
// whole of what is written down here.
//
// The context handed to a registered function keeps the running script at
// `+0x10`, and the script keeps one array of slots for both directions:
//
//   +0x0C  top          one past the last value on the stack
//   +0x10  base         where this call's arguments start
//   +0x14  slots        sixteen bytes each: a type at +0, a double at +8
//   +0x18  end of slots what the engine grows past
//
// So argument N is `slots[base + N - 1]` while that is below the top, and a
// RESULT is one more slot written at the top — which is what `0xa2e4f0` does,
// growing the array when the top has caught up with the end.
//
// And a registered function returns THE NUMBER OF RESULTS it pushed. Every
// shipped one that answers nothing returns 0, which is why 0 always looked like
// "a handle, or nothing" — it is a count, and the count is zero. Read off
// `GetPlayerNecroEnergy`, whose last two steps push a number and hand back the
// count the push kept for it.

#define LUA_SCRIPT 0x10u
#define SCRIPT_TOP 0x0Cu
#define SCRIPT_BASE 0x10u
#define SCRIPT_SLOTS 0x14u
#define SLOT_STRIDE 0x10u
#define SLOT_VALUE 0x08u
/** The three the engine tells apart in a slot's first word. */
#define LUA_TYPE_NIL 1
#define LUA_TYPE_NUMBER 2
#define LUA_TYPE_STRING 3

/** `0xa2e4f0` — write a number at the top and move the top up, growing first. */
#define LUA_PUSH_NUMBER_RVA 0x62e4f0u
#define LUA_PUSH_NUMBER_HEAD_LEN 6
static const BYTE LUA_PUSH_NUMBER_HEAD[LUA_PUSH_NUMBER_HEAD_LEN] = {
  0xF2, 0x0F, 0x10, 0x44, 0x24, 0x04
};

typedef void(__fastcall *PushNumberFn)(void *ctx, void *edx, double value);

/** The running script, or nothing when the context is not one we can read. */
static BYTE *lua_script_of(void *ctx) {
  if (!readable(ctx, LUA_SCRIPT + 4)) return NULL;
  BYTE *script = *(BYTE **)((BYTE *)ctx + LUA_SCRIPT);
  return readable(script, SCRIPT_SLOTS + 4) ? script : NULL;
}

/** Argument N (the first is 1) as a whole number, or 0 when there is no such
 *  argument or it is not a number. The engine's own error text is NOT produced:
 *  that belongs to the parser, and a function that reads its own arguments has
 *  to say what is wrong in its own words. */
static int lua_arg_int(void *ctx, int n, int *out) {
  BYTE *script = lua_script_of(ctx);
  if (!script) return 0;
  int at = *(int *)(script + SCRIPT_BASE) + n - 1;
  if (at < 0 || at >= *(int *)(script + SCRIPT_TOP)) return 0;
  BYTE *slots = *(BYTE **)(script + SCRIPT_SLOTS);
  if (!readable(slots, (SIZE_T)(at + 1) * SLOT_STRIDE)) return 0;
  BYTE *slot = slots + (SIZE_T)at * SLOT_STRIDE;
  if (*(int *)slot != LUA_TYPE_NUMBER) return 0;
  *out = (int)*(double *)(slot + SLOT_VALUE);
  return 1;
}

static PushNumberFn g_luaPushNumber = NULL;

/** One number back to the script. The caller returns the count of these. */
static int lua_push_int(void *ctx, int value) {
  if (!g_luaPushNumber) {
    g_luaPushNumber = (PushNumberFn)code_at(LUA_PUSH_NUMBER_RVA, LUA_PUSH_NUMBER_HEAD,
                                            LUA_PUSH_NUMBER_HEAD_LEN, "the lua number push");
    if (!g_luaPushNumber) return 0;
  }
  g_luaPushNumber(ctx, NULL, (double)value);
  return 1;
}
