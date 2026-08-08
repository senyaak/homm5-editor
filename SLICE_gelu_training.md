# SLICE — Gelu, and a specialization that ACTS

> **Status: step 1 is DONE and seen in game, 07.08.2026.** Gelu's specialization
> puts a spell of the mod's in his book, on the map, at run time — the page is
> there. What runs when it is CAST is the next step and is not written.
>
> The count window is built and unproven (`native/ui/count-window.c`).

## Two classes of hero, and the offset that belongs to each

The most expensive thing on this page, and it is not about Gelu.

| | |
|---|---|
| `CCombatHero@NWorld` | what the first aid tent reaches — unit → owner (`vt+0x18`) → hero (`vt+0x0C`), then a virtual base **124 bytes in**. Specialization at **`+0xEC`**, and a virtual `HasSpecialization` at `+0x294`. |
| `CHero@NWorld` | what `map->+0x14(name)` gives on the adventure map. Specialization at **`+0x8C`**. `+0x294` there is a different function entirely. |

`docs/ENGINE_INTERNALS.md` says `+0xEC` and is right — about the combat hero. It
was applied to `CHero` three times (raw pointer, virtual base, then as a vtable
slot), and every time it read a heap pointer, and every time it cost a launch.

**The rule that would have saved all three: ask what the object IS before
applying a number to it.** RTTI answers in the running game — `vtable[-1]` is the
complete-object locator, its `+0x0C` the type descriptor, and the decorated name
starts at the descriptor's `+8`. One log line.

Three more, learned the same evening:

- **A check that can only confirm is not a check.** Asking the engine "do you
  have specialization *&lt;whatever I just read&gt;*" answers a truthful "no" to
  garbage and never says the QUESTION is the broken half. The control that
  worked asked about *every* value: a real slot names exactly one, a wrong slot
  is silent on all ninety.
- **"We logged everything" — check that it was everything.** The first dump
  listed pointers to named objects and was blind to two things that mattered:
  subobjects (a base class lives INSIDE the object, it is not a pointer) and the
  plain numbers. The answer appeared the moment every word was printed: 84 and
  85 at `+140` on the two heroes the mod itself authored.
- **Take both sides in one run.** The battle knows the answer, the map does not;
  dumping the battle's hero is what made the map's dump readable.

Heroes III gave Gelu sharpshooters: elves in his army became them, for free and
by simply being there. This port trades that for a door the player opens — **an
ability in his book that trains elves into sharpshooters, for gold, as many as
he chooses** — because the free version is a rule this engine has no seam for.

It is worth doing carefully because none of it is Gelu's alone. A specialization
that grants an ability, an adventure-map click that runs our code, a window that
asks for a number, and an action that moves creatures and takes money — that is
the whole vocabulary of "a hero who can DO something", and every hero of the
port after this one is spelled out of it.

## The mechanism is `scripts/A2_Zehir/A2_Zehir.lua`

Zehir's campaign ability is exactly this feature, written by the people who made
the engine, and everything it uses is registered and reachable:

| | |
|---|---|
| `ControlHeroCustomAbility(hero, CUSTOM_ABILITY_n, mode)` | grant, grey out, or take away — the modes are `CUSTOM_ABILITY_ENABLED`, `_DISABLED`, `_NOT_PRESENT` |
| `Trigger(CUSTOM_ABILITY_TRIGGER, "Fn")` | the click; `Fn(heroName, abilityId)` |
| `GameMechanics/Spell/Script_Abilities/Custom1…4` | the four ability records, each with its own `Name.txt`, `Desc.txt` and `Icon.xdb` beside it — a mod overrides those |
| `startThread(fn)` + `sleep(1)` | the watcher that keeps ENABLED/DISABLED current, which is the greying-out asked for |
| `QuestionBox(msg, "Yes", "No")` | the OK/Cancel for the case with no free slot |
| `GetPlayerResource` / `SetPlayerResource` | the gold |
| `GetHeroCreaturesTypes`, `GetHeroCreatures`, `AddHeroCreatures`, `RemoveHeroCreatures` | the army, slot by slot |

So there is **no spell of ours, no enum entry, no hero record carrying
anything.** The ability is one of the game's own four, its words and icon come
from the mod, and what it does is a script.

## What makes it come from the SPECIALIZATION — DONE

Not the four custom abilities after all, and no native code either.

The mod already writes the document of every hero holding a specialization of
ours: the game keeps a specialization's name, description and icon **on the
hero**, so the build fills those in for whoever holds it. Starting spells live in
the same document. So a specialization carries `ability` — a spell id — and the
build puts it in the book of every holder.

The specialization stays the one place that says what it gives, which is the
whole requirement: **give it to another hero and he has the ability on the next
build**, with nothing to copy across. Written by the build and never by the
author, so a hero can never become the source of it.

| where | what |
|---|---|
| `src/mods/specializations.ts` | `ability?: string` on the spec, and why it is not a number |
| `src/mods/hero-files.ts` | `withSpecialization` adds it to the holder's spells, beside his own |
| `electron/ipc.ts`, `channels/mods-heroes.ts` | the field carried through the payload |
| `renderer/…/specializations.ts`, `parts/dialogs/heroes.html` | the Ability picker, over the mod's own spells |
| `tools/test-heroes.ts` | the holder gets it, keeps what he had, and a hero holding another specialization does NOT |

A spell of the mod's rather than one of the engine's four: `SPELL_ABILITY_CUSTOM1…4`
are spells 348…351 and they ARE this mechanism, but four is a compiled ceiling in
two places (`ControlHeroCustomAbility` checks `cmp eax,3`, and the command it
posts is executed against a per-hero store of the same size). One more entry in
an enum the mod already appends to has no ceiling at all.

`H5EHeroSpecialization(heroName)` is therefore not needed to GRANT anything. It
may still be wanted later — a script that greys the page out has to know whose
page it is — and the way in is written down here so it is not re-derived:
`GetHeroLevel` reaches a hero from a name in four steps (the adventure map
through `0x94ab92`, `map->+0x14(name)`, the liveness check, `hero->+0x20()`), and
`hero+0xEC` is the specialization. **Do not take `CAdvMapHero`'s first vtable for
the one it calls** — its `+0x20` is `0xd06040`, which is not a level getter.

## The rest, as the player sees it

1. The watcher enables the ability while there is somebody to train AND gold
   enough; otherwise it is greyed, so the book answers before the click.
2. Clicking it with a free slot (or one already holding sharpshooters): the
   count window opens on the first trainable stack and that slot.
3. OK does **not** split. It removes that many trainees, takes the gold, and
   puts that many sharpshooters where they go.
4. With no free slot: no slider — a `QuestionBox` naming what training them all
   would cost.

### The count window, as a script sees it

`native/ui/count-window.c`: the engine's own split slider driven by a controller
of ours, and `AskTroopCount(most, from, creature)` in Lua over it. See
[docs/UI_INTERNALS.md](docs/UI_INTERNALS.md#a-window-of-ours-out-of-the-engines-own).

The picture turned out to want a **number**, not an army: the engine's own
controller answers `+0x00` by taking `stack->+0x1C` — which creature — and
asking the creature table for its pictures. So the window draws what a script
names, and a script that names nothing gets the frame with the picture empty.

**Seen in game 07.08.2026:** the slider opens on the adventure map, draws the
creature it was told, and OK comes back to Lua as a number. Three things stood
between "built" and "on screen", and each one is written up where it belongs:

- the slot `+0x24` takes no argument, and reading it off the call site instead
  of the engine's `ret` crashed the game inside our own data
  (`tools/test-controller-slots.ts` now compares every slot);
- a window has to be handed to a screen — `Show` is only half of it;
- the "current screen" comes back as a base 0x844 bytes in, and RTTI is what
  turns it back into the object (docs/UI_INTERNALS.md).

What is left is the part this was for: opening it from the spell rather than
from a probe.

## The page is live — 07.08.2026

The map has its own gate, `CanCastHere` (0xc614c0), and it is asked BOTH by the
cast command and by the interface — so the greyed page and the dead click were
one verdict. It is a switch on the number with two ranges, 49…208 and 348…351,
and everything else falls out silently. (That second range is
`SPELL_ABILITY_CUSTOM1…4`, and the `cmp eax,3` beside it is the four-slot
ceiling those abilities are known for — written in two instructions.)

Ours answers for itself now, shipped spells are untouched, and the page takes a
click.

Full write-up: [docs/engineInternals/SPELLS.md](docs/engineInternals/SPELLS.md).

## The click reaches the map's own Lua — 07.08.2026

`native/lua/adv-cast.c`. Past the gate the map runs `0xc619a0`; for a number of
ours the engine's body is not run at all — its switch has no branch for an id it
was not compiled against — and the map's script is asked instead:

| | |
|---|---|
| `onSpellCast(spell)` | the click. Fired after the gate let it through. |
| `checkSpellCastable(spell)` | the rule. The gate asks it, so it decides whether the page is grey. |
| `H5EAnswer(value)` | how the script's verdict comes BACK: running a line returns nothing, so the line calls this. |
| `H5ELog(number)` | a script measuring the engine, into our log rather than the game's console. |

**Where the Lua runs.** The battle half runs source through `0xa44cf0`, and the
map does not use it at all — nothing ever passed through. The map keeps its
script engine (`CLuaScriptEngine`) in `world+0x40` and runs source through that
object's FIRST virtual slot, which is how `advmap-startup.lua` and
`createAdvmapAliases();` are themselves run. The world comes from the map
pointer a script of ours already fetched — the lookup needs a Lua context and a
detour has none (handing it NULL faults at 0xa455f1).

### Four things this cost, all of them ordering or types

- **A row added to the Lua table after `install_lua_functions()` does not
  exist.** `H5EAnswer` was registered later and the game said so: "Value was NIL
  when getting global with name 'H5EAnswer'". The install now runs before the
  copy.
- **`nil` is an ANSWER, not silence.** `H5EAnswer(checkSpellCastable(x))` with a
  nil verdict pushed no number, which read here as "the map did not answer" and
  fell back to yes — a hero with no elves kept a live page. The line now turns
  the verdict into 1 or 0 in Lua, where nil still means something.
- **`CREATURE_…` does not exist while `advmap-common.lua` loads.**
  `createAdvmapAliases()` runs after it, so a top-level `X = CREATURE_GRAND_ELF`
  stores nil. Ids are read inside functions. A mod's OWN creature has no
  constant at all and declares its own, the way spells already do.
- **This Lua has no `type`, and no `getn`/`tostring`/`tonumber`.** Measured by
  the game: "Value was NIL when getting global with name 'type'". `type` was on
  the linter's allowed list because the string is in the executable — which
  proves only that something mentions the name. `src/script/lua-lint.ts` now
  refuses it.

### And the window, once it was really used

- **`CGUIWindow::Close` (0x7421b0) is hooked.** Clearing "a window of ours is
  open" on Execute and on may-cancel covers the two BUTTONS; Esc, the cross and
  everything else never ask the controller, so one such close jammed every later
  window for the session.
- **A choice of one is not a choice.** With `most == 1` the slider has a single
  position, the engine closes the window itself without asking anything, and the
  script gets the answer straight away instead. The one-trainee case is a
  `QuestionBox` in the script, not a window.

### Where it stands, and what is a stand rather than the feature

The stand lives in the INSTALLED mod and the installed map, not in the
generator: `_tmp/probe-train.ts` rewrites the tail of the mod's
`advmap-common.lua` (the rule, the work, the price, the question's text) and
`_tmp/arm-gelu.ts` wrote Gelu's six stacks of shooters into
`H5E/Sharpshooter Test.h5m` by hand. The same army is in the e2e spec
(`GELU_ARMY`) so a rebuilt map comes out the same.

What is NOT written yet: the hero is not passed to the script — the gate has him
as `CAdvMapHero` in `edx`, but a script deals in NAMES and his is not found yet,
so the rule says "any hero of the player" for now. Nothing of this is in the
editor's UI or in `src/mods/artifact-scripts.ts` — the generator still writes
only the ability block.

## Two things the army API does not say, and one run each cost

**`GetHeroCreaturesTypes` gives back SEVEN NUMBERS, not a table** — the distinct
creature ids of the army in slot order, padded out with zeroes. Everything about
the name says table, and `for kind in GetHeroCreaturesTypes(h)` dies with
"`for' table must be a table"; there is no way to ask what it DID answer either,
because this game has no `type`. It took reading `0x5da670`, which pushes seven
numbers and ends `mov ebx,7`. It is the right function to use after all: slot
order is exactly the order the player sees, which is what "train the first slot
holding a shooter" means.

**`RemoveHeroCreatures` leaves one behind rather than empty a hero.** At
`0x5d3cff` it weighs the slots holding that kind (`0xB438B0`) against the slots
holding anything at all (`0xB43820`), and when they are the same it quietly
removes one less. Training a hero whose only stack was one marksman produced a
sharpshooter AND the marksman he was supposed to stop being.

**And the army calls are COMMANDS, not edits.** Neither `Add` nor
`RemoveHeroCreatures` touches the army: each builds a command object and hands it
to the world through its own vtable (`0x5d3d8d`) to be run later. `GetHeroCreatures`
reads the army itself. So the two facts compound, and each one alone hides the
other:

- counting straight after an add counts the army as it was — which is how a
  guard written to make the fix safe (`remove only what was really added`) turned
  into the bug it was guarding against;
- and the "leave one behind" clamp is worked out **when the command is made**, so
  add-then-remove written back to back still leaves one: the remove is decided
  while the army is still that one lonely stack.

The shape that works is add → **sleep until the count really changes** → remove.
The sleep is not politeness; it is what lets the add happen at all.

Both are written up in `docs/SCRIPT_API.md` now.

## A spell of a mod carries its own two hooks

Senya's shape, and it is better than making the training a property of the
creature: a spell owns "may it be cast" and "what the click does", and the
training is simply what those two say. Any spell a mod adds is authored the same
way.

One thing that follows and had to be built at once rather than later: **both
hooks branch on the spell's NUMBER**. A mod carries more than one spell, and
without the dispatch the second would answer the first one's page and run the
first one's cast — a fault that shows up in somebody else's mod, not in the one
that introduced it. The extension remembers a verdict per spell for the same
reason; one remembered answer belonged to whichever question came last.

The number stays a CONSTANT (`TRAINING_SPELL`) and that is Senya's call, not a
gap: a spell is picked by name in the editor and the name is what a person sees,
so the number only ever has to be one thing the generated script and the
extension agree on. Nothing needs to carry it around.

Still to come, in this order: the specialization that grants the spell, the hero
who holds that specialization (portrait and skills), and the map that puts him
down with six stacks of shooters — then one e2e stage that authors the lot
through the editor and reads the archive back.

## The rule, once, in one function

Three separate wrongnesses in one run — a live page with nothing to train, a
slider offering two when two stacks held one archer each, and a training the
game answered by asking which creature to throw away — were all the same thing:
the page, the question and the work each worked out for themselves what was
about to happen. Now `H5EPlan(hero)` works it out once and the other three read
it. It answers the kind, how many, how many he has, how many slots are used and
whether there is room; `nil` is what greys the page.

What it insists on:

- a shooter with a price, taken in SLOT ORDER — the first one the player sees,
  not the first one our list happens to name;
- gold for at least one;
- somewhere for the sharpshooters to land. Seven slots full and none of them
  sharpshooters means the source stack has to leave first, and it only leaves
  whole — so a training that cannot pay for the whole stack is refused rather
  than offered. Offering it is what made the game ask which creature to drop.

It counts a KIND, not a slot, and that is a decision rather than a limitation we
hide: `GetHeroCreatures` sums the kind over the whole army and
`GetHeroCreaturesTypes` throws duplicates away before answering, so two stacks of
one archer are two archers to any script. Senya's call: the honest reading, and
the simpler one.

The work then follows the plan — add-then-remove when there is room,
remove-then-add when there is not — waits for each queued command to really
happen, mops up the one the engine spares, and charges for what actually
arrived.

**And the plan says the FEWEST as well as the most.** With no room the whole
stack is the only training allowed, so `least` and `most` meet and there is
nothing to slide: it is asked as a question rather than offered on a window
whose first position would have been one. That hole was found by
`tools/test-training-plan.ts` rather than by a launch — the rule said "all or
nothing" and then handed the player a slider that started at one, which is the
drop question all over again.

**Two of the three readings the rule needs, the engine will not give a script.**
Slots are the one it hid: `H5EArmySlots(heroName)` is ours, and it calls the
engine's own count (`0xb43820`) rather than walking the vector, because the same
walk written twice is the same walk wrong twice. The rule and its Lua live in
`src/mods/sharpshooter-training.ts`; `_tmp/probe-train.ts` only carries them
into the installed mod.

**And a rule that dies is no longer a rule that said yes.** The line the
extension runs answers NO first and replaces it only on success, so a
`checkSpellCastable` that asks the engine one wrong question closes its own page
instead of leaving it open. A map that defines no rule at all still gets yes.

## There is no synchronous door into a map's Lua, and the rule keeps itself current

`DoString` does not run the source it is given: at `0xa33942` it builds a thread
named "Buffer thread" and hands it to the scheduler. So do triggers, so does
`startThread`, and the class sitting beside the script engine is called
`CLuaThread`. Every way in makes a thread; none of them answers.

**How that was finally settled**, after two readings of the same log had
contradicted each other: a bracket either side of the call, the thread id and a
sequence number on every line, and the whole chain logged rather than one link.
One thread wrote all 735 lines, the counter had no gaps, and between
`>>> the rule runs now` and `<<< it has run` there was nothing — three questions
answered, then the three rules running in a row. Senya's "log all the calls and
look at the difference" is what turned a week's worth of plausible theories into
one measurement.

So the gate no longer asks at the moment of drawing. The first time a page of
ours is wanted, the extension hands the map one line that starts a thread; that
thread recomputes the verdict every tick and gives it to `H5EAnswer`, and the
gate answers with the last thing it heard. Per tick, which Senya had objected to
— rightly, about the engine we believed we had.

Everything that now runs per tick keeps quiet unless its answer CHANGES: the
rule leaves its reason in `H5E_WHY` and only writes it out when the verdict
moves, and `H5EArmySlots` and `H5EIsCastingHero` do the same. A log that repeats
itself once a tick is not a record of anything.

**Seen working, 07.08.2026**: `7005` allowed → `7003` no gold after a training
→ `7005` again next turn → `7002` when nothing trainable was left, with the gate
answering 1/0 in step, and three trainings landing exactly as asked (103 archers,
then 1, then 4 grand elves). The control was the engine's own Town Portal, taught
to Gelu for one run: its page flips 0 and 1 through the same gate, so a book that
redraws is not the problem and never was.

## The map's Lua does not run when you hand it to the map

Measured 07.08.2026, and it invalidated a reading that had stood for a day.
`CLuaScriptEngine`'s first slot TAKES source and runs it later — the same habit
the army commands have. In one run: 25 gate asks produced 25 complete runs of
the rule (counted by what the rule itself logged), and every one of them landed
in the log BETWEEN two asks rather than inside one.

So `ask_the_map` clearing the answer and reading it back in the next breath read
nothing, 25 times out of 25 — and every page was drawn on the fallback, which is
yes. That is the whole of "the page is live when there is nothing to train",
"live when there is no gold" and "live when there is no room": the rule was
right every time and nobody was listening.

It also means the earlier reading, that a refusal was arriving as silence, was
wrong about which half was broken. Turning nil into 1/0 in Lua was a real fix
for a real thing, and it changed nothing, because the answer never got back at
all.

**The answer is not awaited, it is REMEMBERED.** The book asks on every draw, so
the verdict a rule gives is the one the next draw uses: a page is at most one
draw stale, and only the very first draw, before any rule has ever spoken, gets
the fallback. `H5EAnswer` now says in the log what it recorded, so "the rule
never answered" can never again look like "the rule said yes".

## Whose spell it is, and the direction that was wrong

The rule was written about "any hero of the player", which lights one hero's
page for another hero's archers. The obvious fix was to read the casting hero's
NAME off the `CAdvMapHero` the gate is handed, and a probe that printed every
readable string in his first 0x200 bytes found none.

It was the wrong direction, and Senya said so in one line: the script already
has the names, out of `GetPlayerHeroes`. Nothing needs reading off the hero — the
script offers a name and `H5EIsCastingHero(name)` says whether it is this one,
because the map turns a name into an object and we hold the object.

One trap in it: the gate is handed a `CAdvMapHero` and the map's lookup answers
with a `CHero`. Comparing those pointers fails for the same hero, so both are
taken back to the start of the whole object first — the offset RTTI keeps beside
every vtable, the same trick that found the screen 0x844 bytes in. And because a
comparison across two classes that quietly never matches would read as a rule
that simply always refuses, both answers are logged, and the script falls back
to the old behaviour with a marker (`9002`) rather than silently refusing
everything.

## The regression the per-spell dispatch brought, and how it was found

The rule worked, and then the fix that made both hooks branch on the spell's
NUMBER broke it — for days, across half a dozen of Senya's runs. Worth writing
down in full, because the finding is about the dialect and the method is about
counting.

**What was seen.** The page stayed pressable over an army with nothing left to
train, and pressing it did nothing. Five red `Value was NIL when getting global`
lines on screen. In the log, the map answered exactly ONCE per run and then went
quiet — where the version that worked had answered eight times, 1/0/1/0.

**Three wrong answers came first**, all of them mine and all of them reasoning
where a measurement was owed:

1. The globals initialised with `nil`. Real (assigning nil does not CREATE a
   global here, so the first read of each is a nil-global read, which is what the
   red lines were) — but cosmetic, and not the fault.
2. One `H5E_CASTABLE_WAS` for every spell. A real latent bug — a second spell
   would find the number already equal to its own answer and say nothing — but
   with one spell it changes nothing.
3. **The gate's default flipped to NO.** A guess, and Senya named it as one. It
   swapped a page that was always live for a page that was always grey, and
   taught us nothing. Reverted.

**What settled it** was the rule stamping a step number into `H5E_WHY` at every
branch, plus `H5E_GOT` — the number the dispatch actually received. One tick then
reported both halves of an impossibility: `H5E_GOT` was 353, the plan had reached
its own last line (`H5E_WHAT` = 3, `H5E_MOST` = 100, the army printed), and the
reason left behind was `9011` — the marker from the statement AFTER the `if`.
Both branches of one function had run.

**The cause.** `if spell == 353 then return H5ETrainMayCast(); end;` — returning
the result of a CALL from inside a nested block. This engine's Lua runs the call
and does not end the block, so the caller gets whatever the last `return`
executed left behind, which read as yes every time. The version that worked put
the call in the CONDITION (`if H5EWhoCanTrain() == nil then return nil; end;`)
and never met the shape. Full write-up:
[LUA.md](docs/engineInternals/LUA.md#the-dialect-return-f-from-inside-a-block-does-not-return).

**The method lesson, which cost as much as the bug.** "The game's own scripts do
this 108 times" was the count that nearly closed the case in the construct's
favour — and it was the wrong count, because it lumped four shapes together.
Counted apart (`tools/nested-returns.ts`): a VALUE returned from a nested block,
65 times; the result of a CALL, zero. A compiler does not lump shapes, so the
number to gather is the number for the exact shape in hand.

`src/script/lua-lint.ts` refuses it now, and the shipped scripts are the
regression test for the rule itself: zero false positives across all 47.

## Open questions

- Nothing outstanding on the rule; the remaining work is moving the stand into
  the editor (`src/mods/artifact-scripts.ts` still writes only the ability
  block) and drawing the target creature in the count window's second icon.
- The second icon in the count window draws the source creature: the engine asks
  side 0 only and uses one picture for both.
- `ControlHeroCustomAbility` is undocumented in the manuals and is not used here,
  but Zehir's script is the only worked example of a hero ability in the shipped
  data and is worth keeping in view: `scripts/A2_Zehir/A2_Zehir.lua`.
