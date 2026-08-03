# The battle API — ours

*What a mod's Lua can call and be called by INSIDE a fight, once the extension
is installed. The game's own 306 functions are
[EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md); this page is only what we added.*

Everything here was measured in game on 2026-08-03, one battle per claim. Where a
thing looks obvious and is not, it says so — most of this page is that.

## Where a mod's battle code goes

Two files, and the split is not tidiness:

```
scripts/combat-startup.lua        the game's own, plus ONE line of ours
scripts/homm5-editor/combat.lua   the runtime, then a doFile per skill's script
```

**The engine compiles `combat-startup.lua` as a single chunk.** It reads the
whole file and hands the text to the battle's script host in one call, so a
mistake anywhere in it fails EVERY declaration the file makes — `IsAttacker`,
`UnitDeath`, `GetAttackerHero`, the whole vocabulary every combat script in the
game is written against. A mod that appends its code there and gets one token
wrong silently breaks battle scripting for the entire game, and it looks exactly
like "my perk does nothing".

So our copy of the game's file differs from it by two lines, and everything of
ours is behind that `doFile`. A separate file is a separate chunk, and our
mistakes cost only ours.

## Calling into a battle: `H5EFire`

The extension does not use Lua's C API. The engine talks to a battle by running
SOURCE — its own `DoPrepare()`, `UnitMove("%s")` are text it composes and
executes — so an event of ours is a string like any other, and **arguments are
free in that direction**: they are printed into the call.

```lua
H5EFire(kind, a, b, c)     -- called BY the extension, once per event
```

Reading an argument back out of Lua is the expensive direction (it goes through
the engine's own argument parser), which is why the registration below is
ordinary Lua rather than a function of ours.

## Registering a handler

```lua
H5ESetCombatTrigger(H5E_COMBAT_STARTED, MyHandler);
```

- **A handler is a FUNCTION, not the name of one.** The game registers none of
  Lua's standard library — no `getglobal`, no `type`, no `tinsert`, no `getn` —
  so a name could not be resolved to anything.
- **Handlers stack.** Several perks may want the same moment; the one that
  registers second does not silence the first, exactly as the adventure map's
  triggers stack.

### The kinds

| constant | when | arguments |
|---|---|---|
| `H5E_COMBAT_STARTED` | the battle begins, after everything a mod loaded is loaded | — |
| `H5E_MANA_SPENT` | a hero's mana went DOWN, noticed on the next unit's turn | `spent`, `side` (0 attacker, 1 defender) |

**`H5E_MANA_SPENT` is watched from Lua, and that is the interesting part.** The
extension hooked `CSetCombatCasterMana` (`0xb74300`) first, on the reasoning that
a network command is where mana changes — and it never fired once, in a dozen
battles, with a hero who had 300 mana and spells to spend it on. A cast does not
go that way.

What does work needs no reverse engineering at all: the battle's own vocabulary
reads mana (`GetUnitManaPoints("attacker-hero")`), and every unit's turn arrives
as `UnitMove` — in ordinary battles, not only scripted ones. So the runtime wraps
`UnitMove`, compares each hero's mana with what it saw last time, and fires this
trigger for the difference. Only downwards, and the value is stored either way:
mana comes back — a well, an artifact, a skill — and a perk that counted those
would pay a hero for standing still.

### The functions we register into the battle's table

| function | what it does |
|---|---|
| `H5ETentCharge()` | one more use for the first aid tent |
| `H5ECombatTest()` | writes a line into `bin/homm5-editor.log` — the probe that proved this whole path |

**No arguments, deliberately.** Reading one means reproducing a registered
function's prologue — two heap strings, a format like `"sn"`, and the engine's
parser at `0xa454d0` — and the perk did not need it. The cost is stated rather
than discovered: with no arguments the extension cannot be told WHOSE tent, so
the use goes to the last one built. One tent a side is the ordinary case.

This is the division the whole design turns on: **Lua reads what only Lua can
read, the extension writes what only it can write.** No registered function of
the game's touches a war machine's uses (`machine+0xB0`), and the DLL cannot read
a Lua argument yet — so the watching goes where the answers are and the writing
goes where the memory is, and neither half needs the thing it lacks.

## Four things that cost a day between them

**Wrapping one of the game's hooks means returning its answer.** The engine does
not call `UnitMove` for its side effect — it runs
`Callback(n, UnitMove("attacker-hero"))`, and the value IS the point. Our wrapper
called the original and dropped what it gave back, and every turn in the battle
became:

```
(Script) ERROR: Not enough arguments when calling function Callback.
```

So a wrapper keeps the old function, calls it, and hands its result on:

```lua
H5E_OLD_UNIT_MOVE = UnitMove;
function UnitMove(unitName)
	local answer = nil;
	if H5E_OLD_UNIT_MOVE ~= nil then answer = H5E_OLD_UNIT_MOVE(unitName); end;
	H5ECheckMana();
	return answer
end;
```

(`return answer`, no semicolon, last in the block — see the rule below.)

**`return;` fails the whole file.** In Lua 4 `return` ends a block and the `;`
that may follow any other statement is not part of it. Lua 5 accepts it, every
modern reference shows it, and the line looks perfect. The game's own console
(`bind show_console` in `profiles/autoexec_a2.cfg`) is what named it:

```
(Script) ERROR: expected;   last token read: `;' at line 2
```

The editor's Lua linter knows this rule now (`src/script/lua-lint.ts`), and the
generated runtime is checked by `tools/test-skill-scripts.ts` — in a test rather
than in a battle.

**`doFile` is queued, not run where it stands.** The line after a `doFile` runs
BEFORE the file does. So `createCombatAliases();` — which the engine runs
immediately after the startup file and which reads like the moment everything is
in place — is too early: our own file has not executed and every name in it is
still nil. `H5E_COMBAT_STARTED` fires on the engine's `DoStart()` instead, which
is both late enough and the honest name for the event.

**An ordinary battle is a scripted battle.** Every fight builds a script host and
loads `combat-startup.lua`; the four kinds of battle differ only in which code
path gets them there (one calls `CCombat::LoadScripts`, three carry it inlined).
There is no mode to turn on.

## What is NOT here yet

- **`H5ESetShots(unit, n)`** — reading arguments from Lua needs the engine's
  parser at `0xa454d0` plus the two heap strings it checks against; a job of its
  own, and its mistakes crash a battle.
- **`Hit` / `Spell` / `Death`** — combat is already an event bus in C++
  (`CCombatEvent` and its twelve descendants), which is where those attach. This
  is the one the dragon that roars when struck is waiting for.
- **A multiplayer battle refuses scripts.** `Warning: console script commands are
  not allowed` / `scripts are not allowed` (the strings are at `0xf60fac` and
  `0xf597a0`, pushed from `0x6d9d2f`, `0x65b064`, `0x84c7a7`). Everything on this
  page therefore holds for a single-player fight and is untested in a
  multiplayer one — which also means a perk of ours would quietly do nothing
  there. Nobody has read what gates it yet.
- **The native `tent_mana` row is dead weight.** It is still in the config the
  editor writes (`tent_mana skill <id> <n>`) and the extension still reads it,
  but the sum it was meant to join lives behind the mana command that never
  fires. The working ultimate is the Lua watch above. Either the row goes or the
  extension learns to count mana itself; leaving a stat in the skill form that
  does nothing is the worse of the two.
- **Linting a call against the engine's own signature.** The argument formats of
  all 306 registered functions are already extracted (`src/script/script-api.json`,
  from the executable), so "wrong number of arguments" is checkable without
  reading the binary again. What the formats do NOT carry is the RETURN value —
  `UnitMove` had to be learned from a battle — so those are ours to write down as
  we meet them.

The engine internals behind all of this are in
[engineInternals/EXTENSION.md](engineInternals/EXTENSION.md) («A battle can be
spoken to»); how the two global scripts are reached is in
[NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md).
