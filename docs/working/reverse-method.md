# Reading the executable: method

How a question about the engine is answered, and the ways an answer turns out
wrong. The tools and the per-subsystem findings are in
[ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md); comparing a port with the
engine number by number is [numbers.md](numbers.md).

## Before the disassembler

- **Docs and the web first for the game's ordinary behaviour.** "How do you
  run Lua from the console" is answered in a minute by a search (prefix `@`),
  not by finding the console's dispatcher in the executable. Thousands of
  players and modders have described the shipped behaviour: Steam guides,
  maps4heroes, MMH5.5, `Editor Documentation/*.pdf`. The executable is for
  what none of them says — our hooks, the insides of screens.
- **Search what is written down before reading anything.** The answer has
  been in `docs/` more than once.
- **Read the code, not the picture.** Not "look whether it seems right": a
  loop of hypothesis → screenshot → hypothesis gives answers that are each
  plausible and none final. The sun's direction, derived from pictures three
  times, came out three different ways; three instructions at `0x51aa30` gave
  the whole convention. There is nearly always an anchor — a field's name
  string, a constant like π/180, a vtable slot, an import. The tell that the
  loop has started again: asking for a picture or offering "let's compare".
- **Ask the question the other way round.** Before digging a value out of
  someone else's structure, see whether the side asking already has it. A rule
  needed to know which hero casts; the script already had every name from
  `GetPlayerHeroes`, so the extension only answers "is it this one?".
- **Go from where the value is already right.** Find the visible use of the
  number (a log line, a panel caption, a formula that does not close without
  it), find the code that writes it, and read backwards — never scan memory
  for a word of the right shape. Seven battles went on a word that did not
  exist: the top creature's remaining health is computed on the spot by the
  panel, never stored.
- **`[esp+N]` is not read by eye.** N drifts with every `push`, so one slot is
  `[esp+8]` before two pushes and `[esp+10h]` after; one reader read three
  times gave three different wrong answers, each a launch.
  `node tools/net-probe.ts <exe> --frame <addr>` counts the stack —
  push/pop, `sub/add esp`, the ebp frame and the callee's `ret N` clean-up —
  and names every access `arg1` / `localN` from the function's entry.
- **When a reading is disputed, measure.** A probe or a launch that
  contradicts a reading beats the reading; three conclusions in this repo were
  wrong until a battle said so.

## Wrong answers that look right

- **Proven about the FILE is not proven about the CONSUMER.** Parsing every
  byte proves the record complete, not that the engine plays it as it reads.
  "Exact by construction" almost always means one half was checked. Beside an
  assumption, write what would refute it. A constant field can be informative
  (`WindAffected=false` on all 1814 answers "nobody") or not
  (`<Static>=P_STATIC` on all 2709 answers nothing) — the difference is
  whether the constant cuts a hypothesis off.
- **"It found nothing" is a property of the tool.** capstone stops at the
  first invalid byte, so a scan "found 0 readers" where iced-x86 finds 55772.
  A string search wanting a whole NUL-terminated literal answers "no such
  string" for one inside a longer literal. A test message saying "none on
  this install" described its own wrong guess of the install. Check a negative
  a second way before saying it.
- **A thunk hides the real callers.** `calls X` lists rel32 calls and jumps to
  X, not the callers of a one-line `jmp X` wrapper; the only reader of a block
  called "dead" came through one. Expand every `…j` entry and merge the lists
  before concluding "nobody reads it".
- **Data delivered, nothing shown: read the consumer's guard.** An empty lobby
  list was one `cmp dword ptr [esi+4],0 / jne → ret` at the top of
  `OnMemberJoined`, after four hypotheses about the data. Guards sit in a
  function's first lines. If even the handler's own log line is missing, the
  message was dropped BEFORE it — read whoever calls it.
- **A probe that writes too early reports an absence.** A poke applied on the
  request's constructor was overwritten by the console handler that fills the
  fields after it, and eleven offsets were "proven" to hold no water level.
  Write as close to the consumer as possible, check that the write survives to
  the read, and phrase the result "the probe could not show it" until it does.
- **"Everywhere 0" — check the object's own data first.** Morale 0 on a
  faction's stacks was `ABILITY_UNDEAD`, carried over from the donor by the
  clone; the morale function wrote +1 correctly. Open the record (abilities,
  flags) before probing the function.
- **The editor and the game are different builds of one code.** Addresses
  differ and are not a constant shift; stages and structure are the same.
  Arithmetic is what differs: the game is SSE (round to float32 each step), the
  editor x87 (round once, at the store) — four cases already. Before writing
  an address down or porting a float formula, ask WHOSE behaviour is being
  measured: references made by the editor → read `H5_MapEditor_H5E.exe`; a mod
  that runs in the game → read the game.
- **Hedges in comments are a worklist.** "FITTED, not read", "NOT PORTED",
  "not decided", "unmeasured" — grep them now and then; each is read in the
  executable and replaced by an address, proven unreachable, or left with an
  honest note of how it is held. A stale warning is worse than none: one such
  pass found a real bug and three warnings about work long since done.
- **Fix the symptom that was reported.** A real bug found on the way is still
  not the one asked about; say "found this, your symptom is not reproduced
  yet". A vague report ("it breaks") gets one question back — what is on the
  screen — or a reproduction. When the owner says "you did not understand"
  twice, reproduce THEIR case — their map, their object, their gesture, their
  settings — instead of arguing with one's own test scene: the swapped normal
  bytes showed only on the owner's map, in the owner's configuration.
