# Talking to a battle

*Answers: how the extension reaches a fight's Lua, why the moment it fires on is
the one it is, what a mod must not do to `combat-startup.lua`, and which four
discoveries each cost a day. The API this pays for is
[../api/combat.md](../api/combat.md).*

Everything here was measured in game on 2026-08-03, one battle per claim.

## An ordinary battle is a scripted battle

Every fight builds a script host and loads `scripts/combat-startup.lua`. The four
kinds of battle differ only in the path that gets them there — one calls
`CCombat::LoadScripts` (`0x652870`), three carry the same code inlined
(`0x65af6d`, `0x6691ed`, `0x66a74d`) — and the flag they all gate on,
`[combat+0x4F0]`, is set outright at `0x65af0b`. There is no mode to switch on.

**The hook that never fired was the measurement that proved it.** The first probe
detoured `LoadScripts` and stayed silent through a battle the tent hooks clearly
ran in; that silence is what sent the search to the inlined paths.

## One slot, and every line of Lua goes through it

```
CCombat +0x1B4          the script host
  vtable slot 0         run this text
```

Both the engine's own calls and ours pass through it: the startup file arrives as
one string, `createCombatAliases();` as another, `Callback(n, UnitMove("%s"))` as
a third. The extension takes the slot from the LIVE vtable in the host's
constructor (`0xa44bc0`) and puts its own function there, keeping the original —
so it needs no address of its own, and one swap covers all four kinds of battle,
because a vtable belongs to a class rather than to a fight.

**Read the slot, do not compute it.** The game's image has `DYNAMIC_BASE` set, so
a pointer printed from the DLL means nothing on disk — the first attempt to
disassemble one landed in the middle of an unrelated function. Log RVAs.

**The extension never uses Lua's C API.** It composes source and hands it to that
slot, exactly as the engine does. Arguments in that direction are free: they are
printed into the call. Reading one back is the expensive direction — it goes
through the engine's parser at `0xa454d0` and the two heap strings a registered
function checks against — which is why the API's own functions take none.

## The moment: `DoStart()`, not `createCombatAliases()`

`doFile` is QUEUED. The statement after it runs before the file does, so at
`createCombatAliases();` — which the engine runs immediately after the startup
file, and which reads like the moment everything is in place — our own runtime
has not executed and every name in it is still nil. Measured: the extension asked
for `H5EFire` there and the console answered `Value was NIL when getting global`.

`DoStart()` comes after everything queued, and is the honest name for the event
besides. That is where `H5E_COMBAT_STARTED` fires.

## What a mod must not do to `combat-startup.lua`

**The engine compiles it as ONE chunk** — the whole file in a single call — so a
mistake anywhere in it fails EVERY declaration it makes: `IsAttacker`,
`UnitDeath`, `GetAttackerHero`, the vocabulary every combat script in the game is
written against. A mod that appends its code there and gets one token wrong
silently breaks battle scripting for the entire game, and the symptom is "my perk
does nothing".

That is not hypothetical: it is what ours did for a day. The probe that settled
it asked the battle for four names in file order and got none of them — not ours,
and not the game's own either.

So the mod's copy differs from the shipped file by two lines, and everything of
ours sits behind that `doFile`, where a separate file is a separate chunk.

## The mana, and the shape it settled into

`CSetCombatCasterMana` (`0xb74300`) looked like where combat mana changes: a
network command carrying a caster and a value. It was hooked, and **it never
fired once** — a dozen battles, a hero with 300 mana and spells to spend it on. A
cast does not go that way, and where it does go is still unread.

It did not need to be. The battle's own vocabulary reads mana
(`GetUnitManaPoints`), and every unit's turn arrives as `UnitMove` with the
unit's name (`attacker-hero`, `attacker-warmachine-WAR_MACHINE_FIRST_AID_TENT`).
So the runtime wraps that hook and compares each hero's mana against what it last
saw. The half Lua cannot do — write `machine+0xB0`, the tent's uses — is one
argument-less call into the extension.

**The division worth keeping: watch where the answers already are, write where
the memory is.** Neither side needs the capability it lacks.

An unfinished edge, stated so it is not rediscovered: the native `tent_mana` row
still exists in the config the editor writes and nothing can reach it now.

## Four things that cost a day between them

- **`return;` fails the whole file** in Lua 4 — `return` ends a block and the
  optional `;` of an ordinary statement is not part of it. Lua 5 takes it, every
  reference shows it, and the line looks perfect. The game's console named it in
  one frame: `ERROR: expected;  last token read: ';'`. The linter knows it now
  (`src/script/lua-lint.ts`), and generated scripts are checked in
  `tools/test-skill-scripts.ts` rather than in a battle.
- **Wrapping a hook means returning its answer.** `Callback(n, UnitMove(name))` —
  the value IS the point, and swallowing it turned every turn into `Not enough
  arguments when calling function Callback`.
- **Identical log lines for opposite outcomes prove nothing.** Three runs were
  spent on probes where "our handler ran" and "our handler was missing" wrote the
  same words. Different outcomes, different functions.
- **The console beat the log**, and it was suggested a day earlier than it was
  used. A log line is written when the extension acts; a script error is only
  ever printed by the engine, and it names the token.

Two more habits that earned their place: **probes as FILES** rather than strings
in C — they are edited without rebuilding the DLL and travel the same path the
real file does — and **a probe with three distinguishable outcomes**, which is
what finally separated "the file is not loaded" from "the file is loaded and
fails".

## Where the code is

`native/homm5-editor.c` (the slot swap, the trigger call, `H5ETentCharge`),
`src/mods/skill-scripts.ts` (the runtime and the mana watch),
`tools/test-skill-scripts.ts` (what is checked before a battle).
See also [EXTENSION.md](EXTENSION.md) and
[../NAMES_AND_SCRIPTING.md](../NAMES_AND_SCRIPTING.md).
