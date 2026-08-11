# SLICE — The extension logs what it was asked to, and nothing else

> **Status:** the first stage is in — every native source has its own switch,
> a build cuts out everything it was not asked for, and each run writes its own
> file. What is left here is the list of things deliberately NOT done, each with
> the reason it was deferred and what would settle it. When that list is empty
> or dismissed, fold what is worth keeping into
> [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md) and retire this file.

Reading first: the bottom of [native/core/log.c](native/core/log.c) (what the
switch is and why it is per file), `logDefines` in
[src/mods/extension.ts](src/mods/extension.ts) (how the sources become `-D`
flags), and [tools/test-native-log.ts](tools/test-native-log.ts) (what is
actually proved, and how it is proved it can fail).

---

## 1. What was wrong

395 places in the extension logged, unconditionally. A single spell cast walked
every stack on the field and wrote about fifteen lines each, and every one of
those lines did two things beyond appending text:

- **It re-entered the engine.** `log_line` called `console_line`, which runs
  `print(...)` through the game's own Lua host — from inside a detour, on
  whichever thread got there, guarded by one non-atomic global.
- **It opened and closed the file.** `CreateFileW` + three `WriteFile` +
  `CloseHandle`, per line, plus the directory metadata each open touches.

Between them the game hung, and sometimes stopped. And the file it wrote was
one file for every launch ever, so the run that mattered was somewhere in the
middle of it with nothing marking where it began.

## 2. What is done

- **A switch per file.** `#define LOG_UNIT <folder>_<file>` near the top of each
  source; `-DH5E_LOG_<unit>=1|0` on the compiler's command line; `LOG_ON` folds
  to a constant, so a file nobody asked for leaves nothing in the DLL — not the
  call, not the string. Measured: 97 792 bytes with `--log none`, 99 840 as it
  builds by default, 120 832 with all forty-five speaking.
- **The sources are the register.** `logUnits` reads every `#define LOG_UNIT`
  out of `native/` rather than keeping a list, so a renamed file cannot leave a
  flag behind that turns nothing on. The one hand-written list —
  `LOG_UNITS_BY_DEFAULT` — is checked against what was found.
- **A file per run**, `homm5-editor-YYYYMMDD-HHMMSS.log`, oldest pruned to ten.
- **Proved by building.** `tools/test-native-log.ts` compiles twice and looks
  for the same three sentences in both: absent from the silent build, present in
  the loud one. The second half is the point — a check that can only confirm
  would pass on a typo. Sabotage-checked: opening the gate unconditionally turns
  four of its lines red.

## 3. What was deliberately NOT done

### 3.1. Whether the crash report ships

`core/faults.c` is on by default, with `homm5-editor.c`'s roll-call of which
hooks installed. That is a decision, not an oversight: those two are how anybody
finds out the mod is there at all and what it was doing when it stopped, and
`--log none` still silences them for a build meant purely for playing.

**What would settle it:** the first time this mod is handed to somebody who is
not building it. Until then the question is theoretical — the author rebuilds
for every change, so nothing is ever shipped that could not be rebuilt louder.

### 3.2. "Did the hook install" is now off for most hooks

The roll-call in `DllMain` is default-on, but a fix that reports from its own
file — `qol/combat-ai.c` saying how many of its three patches went in — is
silent unless asked for. The docs that told a reader to check the log now name
the flag to build with instead.

**Why it was left:** widening the default to "every install report" means
picking which lines are reports and which are chatter, in forty-five files, by
hand — exactly the per-subject judgement the per-file switch exists to avoid.

**What would settle it:** noticing, twice, that a launch had to be repeated
because the report was not there. Once is a rebuild; twice is a pattern.

### 3.3. Writing from a thread of its own

Proposed and turned down for now. The measurement says it is not needed: with
the volume cut, a run writes tens of lines rather than hundreds, and the file
open per line that was drowning a cast is no longer in a loop. And a queue is
not free of cost in the direction that matters — lines still in it when the game
faults are the lines nobody gets to read, which is the opposite of what the
crash report is for.

**What would settle it:** a run, with one unit asked for, that still stutters.
If it comes to that, the queue has to be drained synchronously from the fault
handler before it hands the crash on, and from `DLL_PROCESS_DETACH`.

### 3.4. `console_line` still re-enters the engine's Lua

The gate cuts how OFTEN it happens — from every line to only the lines of the
one file being debugged — and it cuts where, since a person asking for
`combat/spell-resolve` knows they are asking for lines from inside a battle.
It does not make the re-entry safe.

**Why it was left:** the console echo is how a log reaches a screenshot, and a
screenshot is how it reaches somebody who is not at the machine. Removing it
takes away the channel; the volume was the part that could be fixed without
taking anything away.

**What would settle it:** the game hanging in a battle on a build with one unit
asked for. Then this is the first suspect and the test is cheap — comment out
the `console_line` call in `log_line_now` and run the same battle. Note that
nothing here has PROVED the re-entry ever hung anything; it is read off the
code, and the volume alone is a sufficient explanation for what was seen.

### 3.5. Versioning the log's format

The next stage as originally sketched. Nothing about the per-run naming
forecloses it — a header line at the top of each file is where a version would
go, and the pruning sorts by name, which a version prefix would break and a
version *inside* the file would not.
