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
| `H5E_HERO_MANA_CHANGED` | a combat caster's mana changes, up or down | `now, before` |

## Three things that cost a day between them

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
  (`CCombatEvent` and its twelve descendants), which is where those attach.

The engine internals behind all of this are in
[engineInternals/EXTENSION.md](engineInternals/EXTENSION.md) («A battle can be
spoken to»); how the two global scripts are reached is in
[NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md).
