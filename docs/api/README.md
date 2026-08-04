# The API this editor adds to the game

One folder, because these pages have one job: **say what a mod may call, and
with what.** Reference only — a name, its arguments, what it does, and the rule
you have to obey to use it. No addresses, no history, nothing about how it was
found.

The reasons, the measurements and the mistakes live in `../engineInternals/`,
one subsystem per file. Where a page here has a rule that looks arbitrary, it
links to the page there that explains it; if the two ever disagree, the one
there is the record and this one is the summary that drifted.

- [combat.md](combat.md) — inside a fight: triggers a battle script can hook,
  and the functions the extension registers into the battle's own Lua table.

The game's OWN vocabulary is not here either: those 306 functions are read out
of the executable and listed in
[../EXE_LUA_REGISTRY.md](../EXE_LUA_REGISTRY.md), with the hand-written
reference in [../SCRIPT_API.md](../SCRIPT_API.md).
