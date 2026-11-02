# Split the hot files

**What.** Make the files nearly every change touches safe for two changes at
once: each split by subject, or turned into a sorted list of one entry per
line, so two changes that each add one thing never edit the same lines. A
split is a pure move — no behaviour change; the tests of the area green before
and after.

Measured 2026-11-02 (commits touching the file since 2026-08-01, lines):

| file | commits | lines | the way out |
| - | - | - | - |
| `CHANGELOG.md` | 276 | 2855 | done: entries are files under `changes/` |
| `docs/RMG.md` | 237 | 7972 | an index of one file per subject under `docs/rmg/` |
| `package.json` (scripts) | 101 | 220 | scripts sorted by name, a new one at its sorted line |
| `native/homm5-editor.c` (the include list) | 94 | 437 | a list per folder (`native/<folder>/all.c`), the root including the folders |
| `docs/FACTION_PLAN.md` | 63 | 887 | open parts moved to `docs/todo/factions-*`; the rest a record |
| `renderer/app.ts` | 49 | 1292 | by concern, as the 07.2026 split did |
| `electron/ipc.ts` | 44 | 2455 | the contract per domain, beside `electron/channels/<domain>.ts` |
| `docs/engineInternals/SPELLS.md` | 43 | 1226 | one file per subject behind an index |
| `native/combat/spell-cast.c` | 42 | 787 | by concern |
| `e2e/mods.ts` | 41 | 1809 | fixtures per subject (`e2e/mods/<subject>.ts`) |

**Source.** The fleet's rule: two parallel changes must never touch the same
lines ([docs/working/scope-and-docs.md](../working/scope-and-docs.md)).

**Acceptance.** Each split in its own commit; `npm run typecheck`, the area's
suites and `test-doc-links` green before and after; the native split proved by
an identical DLL built before and after; nothing renamed that other code
imports without its importers updated in the same commit.

**Depends on.** none. One file per change, never two splits of one file side
by side.
