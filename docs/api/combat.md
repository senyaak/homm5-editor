# Inside a battle

*What a mod's Lua may call in a fight, and what calls it. Reference; the whys
are in [../engineInternals/BATTLE_SCRIPTING.md](../engineInternals/BATTLE_SCRIPTING.md).*

Needs the extension installed (`npm run install-native`). Single-player fights
only — a multiplayer battle refuses scripts outright.

## Where your code goes

A skill's battle script, written in the skill form, is built into the mod as
`scripts/homm5-editor/<SKILL>-combat.lua` and loaded for you. Nothing to wire.

```
scripts/combat-startup.lua        the game's own + one line of ours
└── scripts/homm5-editor/combat.lua        the runtime
    └── …/<SKILL>-combat.lua               yours, one per skill
```

Your file runs once, when the battle has been built.

## Triggers

```lua
H5ESetCombatTrigger(H5E_MANA_SPENT, MyHandler);

function MyHandler(spent, side)
	-- side: 0 attacker, 1 defender
end;
```

| constant | fires | arguments |
|---|---|---|
| `H5E_COMBAT_STARTED` | the battle begins, after every file a mod loaded has run | — |
| `H5E_MANA_SPENT` | a hero's mana went down; seen on the next unit's turn | `spent`, `side` |

- A handler is a **function**, not its name — the game registers none of Lua's
  standard library, so a name could not be looked up.
- Handlers **stack**: registering a second does not silence the first.
- `H5E_MANA_SPENT` reports **drops only**. Mana returning is not an event.

## Functions

| call | does |
|---|---|
| `H5ETentCharge()` | gives the first aid tent one more use |
| `H5ECombatTest()` | writes one line to `bin/homm5-editor.log` |

Neither takes arguments, and that is a limit as well as a style: with no
arguments `H5ETentCharge()` cannot be told whose tent, so it charges the last one
built — right when one side has a tent, which is the ordinary case.

## Rules you have to obey

**`return;` fails the whole FILE.** Lua 4 wants a bare `return`, last in its
block. Lua 5 accepts the semicolon and so does every reference you will read.

```lua
if x == nil then return; end;   -- NO: the file will not compile
if x ~= nil then … end;         -- write it as a positive branch instead
```

**Wrapping one of the game's hooks means returning its answer.** The engine runs
`Callback(n, UnitMove(name))` — the value is the point.

```lua
H5E_OLD_UNIT_MOVE = UnitMove;
function UnitMove(unitName)
	local answer = nil;
	if H5E_OLD_UNIT_MOVE ~= nil then answer = H5E_OLD_UNIT_MOVE(unitName); end;
	-- yours here
	return answer
end;
```

**No standard library.** No `tinsert`, `getn`, `tostring`, `type`, `pairs`. Keep
your own count in the table. The engine's file loader is `doFile`, capital F —
`dofile` is not defined.

**`doFile` is queued.** The statement after it runs BEFORE the file does; do not
read a name the file defines until a later moment.

## Seeing what happened

Bind the console (`profiles/autoexec_a2.cfg` already has `dev_console_password`
and `show_console` on F11). `print("…")` from your script goes there, and the
extension echoes its own log into it as well, so the script's line and the
extension's land in one stream. The same lines are in `bin/homm5-editor.log`.

## Not here yet

`H5ESetShots(unit, n)`; `Hit` / `Spell` / `Death` events; anything at all in a
multiplayer battle. See the engine notes for what each is waiting on.
