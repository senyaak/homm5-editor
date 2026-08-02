# How the engine hands functions to Lua — and how we add ours

*Answers: where the script API comes from, why the manuals disagree with it, and
what it costs to register a function of our own.*

The list of what is there is generated: [EXE_LUA_REGISTRY.md](../EXE_LUA_REGISTRY.md).
This is how the mechanism works.

Seven null-terminated arrays of `{name pointer, function pointer}` pairs in
`.data`, 298 entries. Each function starts by copying a **format string** and
its own name to the heap and handing both to the argument parser at
`0xa454d0`, which validates the call and names the function in any error.
The format is a small grammar: `s` string, `n` number, `b` bool, `f` float,
`[default]` for an optional argument. That is how
[EXE_LUA_REGISTRY.md](../EXE_LUA_REGISTRY.md) can list a real signature for every
function, including the 129 the manuals never mention.

Two consequences for us:

- **The manuals are incomplete and occasionally wrong.** `HasArtefact` is
  documented as two arguments and compiles as `snn[0]`.
- **Adding a function costs four bytes.** The tables are packed with no slack,
  so nothing can be appended in place — but each one is reached through a tiny
  accessor of its own, and the adventure map's is
  **`0x5ce710`: `mov eax,0108D858h; ret`**. So the whole mechanism is: read
  their table through that immediate, copy it, append rows of ours, terminate
  with the `{0,0}` pair they end with, and rewrite the four bytes of the
  immediate to point at the copy. No detour, no trampoline, and their 99
  functions stay the first 99 entries in order.

  A registered function is `__fastcall(void *ctx)`: the call context arrives in
  `ecx` and a result handle comes back in `eax`, or 0 — every shipped one
  returns 0 on a path it cannot serve, so 0 is a value the caller tolerates.
  Argument parsing is the fiddly part (the parser wants string objects, built on
  the heap), and there is a way around it worth knowing: **call the engine's own
  function that already takes the argument you want** and watch where it lands.
  `RestoreDarkEnergy(player)` does exactly that — it calls
  `GetPlayerNecroEnergy`, whose last step reads the pool through a vtable slot
  the extension has already replaced, so the player the lookup found arrives as
  `this`. Their error text for a bad player number comes free with it.

  Seen in game 2026-07-29: `native/homm5-editor.c`, and the log line a script
  produced by calling one.
