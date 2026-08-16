# SLICE — The extension logs what it was asked to, and nothing else

> **Status: landed, 2026-08-08.** Every native source has its own switch, a
> build cuts out everything it was not asked for, and each run writes its own
> file. The list of things deliberately NOT done outlived the slice and moved to
> [LOG.md](../../LOG.md) — "What was deliberately left undone" — where the
> switches themselves are documented; what stays here is what the logging was
> before, and the measurements that chose this shape.

Reading first: the bottom of [native/core/log.c](../../native/core/log.c) (what
the switch is and why it is per file), `logDefines` in
[src/mods/extension.ts](../../src/mods/extension.ts) (how the sources become
`-D` flags), and [tools/test-native-log.ts](../../tools/test-native-log.ts)
(what is actually proved, and how it is proved it can fail).

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

Five decisions, none of them oversights: whether the crash report ships, that
"did the hook install" is off for most hooks, a writer thread of its own,
`console_line` still re-entering the engine's Lua, and versioning the log's
format. They are not repeated here because they are not history — they are still
live decisions somebody may revisit, and they live with the switches they are
about, in [LOG.md](../../LOG.md): "Where did the hook install actually lives"
and "What was deliberately left undone", each with what would settle it.
