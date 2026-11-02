# Reading the executable: method

Tools and findings: [ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md). Matching a
port number for number: [numbers.md](numbers.md).

## Order of work

1. The game's ordinary behaviour (console, syntax, formats): docs and the web
   first — `Editor Documentation/*.pdf`, Steam guides, maps4heroes, MMH5.5.
   The executable only when they are silent.
2. Search `docs/` for what is already written.
3. Questions about drawing: read the code and log from the process; never
   decide by comparing pictures. If you are asking for a screenshot, stop and
   find the instruction (a name string, a constant, a slot, an import).
4. Before extracting a value from a structure, check whether the asking side
   already has it — then extraction becomes a comparison.
5. Find a value from where it is already correct (its display, its log line,
   the formula that needs it) and read backwards; never scan memory for its
   shape.
6. `[esp+N]` is never read by eye: `node tools/net-probe.ts <exe> --frame
   <addr>` names every access `arg1` / `localN`.
7. A disputed reading is settled by a probe or a battle, not by reasoning.

## Checks before believing an answer

- Proven about the file ≠ proven about the consumer. Write beside each
  assumption what would refute it.
- A negative from a tool ("not found", "no such string", "none on this
  install") is checked a second way before it is said.
- `calls X` misses callers of thunks (`jmp X`): expand every `…j` entry.
- Data delivered but not shown: read the first lines of the consumer (its
  guard). No log line from the handler at all: read its caller.
- A probe that writes into a structure: check the write survives to the read;
  write as close to the consumer as possible. Until then say "the probe could
  not show it".
- "Zero everywhere": first check the object's own data (abilities, flags — a
  clone carries its donor's).
- Editor and game are different builds: same stages, different addresses, x87
  against SSE. Read the build whose behaviour is measured — references made by
  the editor → `H5_MapEditor_H5E.exe`; a mod in the game → the game.
- Grep the hedges in comments (`FITTED`, `NOT PORTED`, `not decided`,
  `unmeasured`) now and then; resolve each by reading, proving it unreachable,
  or an honest note.

## Reports from the owner

- Fix the symptom reported. A different real bug found on the way is named as
  such: "found X; your symptom is not reproduced yet".
- A vague report gets one question back — what is on the screen — or a
  reproduction.
- "You did not understand" → reproduce the owner's case exactly: their map,
  object, gesture and settings, in a harness.
