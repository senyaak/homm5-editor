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

## Arguments and results, without the parser

The paragraph above says argument parsing is the fiddly part and offers a way
round it. That was true of **the parser** and not of **the values**, and the
difference is worth the twenty lines it costs: `sleep` reads its own argument in
nine instructions without going anywhere near `0xa454d0`.

The context a registered function is handed keeps the running script at `+0x10`,
and the script keeps one array of slots for arguments and results alike:

| | |
|---|---|
| `+0x0C` | top — one past the last value on the stack |
| `+0x10` | base — where this call's arguments start |
| `+0x14` | the slots, sixteen bytes each: a type at `+0`, a double at `+8` |
| `+0x18` | the end of them, which the engine grows past |

A type is `1` nil, `2` number, `3` string. So **argument N is
`slots[base + N - 1]`** while that is below the top — which is exactly what the
engine's own accessors do (`0xa2e000` the type, `0xa2e0f0` whether it is there,
`0xa2e2f0` as a string).

A **result** is one more slot written at the top: `0xa2e4f0(ctx, double)` writes
the type and the value, grows the array when the top has caught the end, and
moves the top up.

And the thing every reading of "a result handle comes back in eax" missed:
**what a registered function returns is the NUMBER OF RESULTS it pushed.** Zero
is not "no handle", it is a count of none — which is why every shipped function
returns it on a path it cannot serve. Read off `GetPlayerNecroEnergy`, whose
last two steps push a number and hand back the count kept for it.

`native/lua/values.c` is the whole of it, and
[UI_INTERNALS.md](../UI_INTERNALS.md#a-window-of-ours-out-of-the-engines-own) is
what it was written for.

**What it does not buy: waiting.** The count is taken the moment the function
returns, so a function cannot answer with a number it does not have yet — a
window's answer, say. `sleep` shows why: it writes its argument into the
script's own `+0x2C` and returns immediately, so suspending is the SCHEDULER's
business and not something a native call can do in the middle of itself. A
function that opens something and a function that collects the answer are
therefore two functions, and the loop between them is Lua's.

## The dialect: `return f()` from inside a block does not return

This one is not about registration — it is about the language the maps are
written in, and it is the sharpest trap found in it so far.

```lua
if spell == 353 then return H5ETrainMayCast(); end;   -- DOES NOT DO THAT
```

**The call happens and the block does not end.** Execution carries on past the
`end` and into whatever follows, and the value the caller finally receives is
whatever the LAST `return` executed left behind — not the one that was written.

Measured in game rather than argued about, with the rule stamping a step number
into a global at every branch. One tick of the training spell's watcher reported,
in one breath, both halves of the impossibility: the plan had reached its own
last line — the kind and the count both written down, the whole army printed —
and the reason left behind was the marker from the statement AFTER the `if`. Two
branches of one function, both executed. And the verdict handed back read as yes
every time, which is why a spell page stayed live over an army with nothing to
train while the rule inside was refusing honestly.

**What is safe is what the shipped scripts do.** `tools/nested-returns.ts`
counts the shapes across the 47 scripts the game ships, 1096 functions:

| shape | times the game uses it |
| --- | --- |
| `if c then return <value>; end` — one line | 41 |
| multi-statement `then` block ending in `return` or `return <value>` | 24 |
| `if c then return <call>(); end` | **0** |
| multi-statement `then` block ending in `return <call>()` | **0** |

Not one occurrence in either call-returning shape. So: **put the call in the
CONDITION, or in a local, and give the function a single exit.**

```lua
if H5EWhoCanTrain() == nil then return nil; end;   -- the call is in the test
return 1;

local verdict = nil;                               -- or in a local
if spell == 353 then verdict = H5ETrainMayCast(); end;
return verdict;
```

`src/script/lua-lint.ts` refuses the shape, so the script editor catches it in a
map of your own as well; `tools/test-lua-lint.ts` pins both the error and the
four spellings that must stay legal.

**The method lesson is worth as much as the finding.** "The game does it 108
times" was the count that nearly closed the case in favour of the construct —
and it was the wrong count, because it lumped four shapes together. A compiler
does not; the number to gather is the number for the exact shape in hand.
