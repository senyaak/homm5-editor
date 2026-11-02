# A guard on file size

**What.** `tools/test-file-size.ts` (nodata, in `npm test`): every tracked
source and doc file (`.ts`, `.c`, `.html`, `.css`, `.js`, `.md`) is at most
500 lines, except those named in an allowlist with their current length. A
listed file may only shrink: growing past its recorded length fails, and so
does a listed file that is now under 500 or no longer exists (it must leave
the list). Generated files (`docs/SCRIPT_API.md`, `docs/api/functions.md`,
`docs/EXE_LUA_REGISTRY.md`) and frozen records (`docs/_slices_done/`) are
excluded by rule, not by listing.

On 2026-11-02, 56 files were over 500 lines and 12 over 1000.

**Source.** [docs/working/scope-and-docs.md](../working/scope-and-docs.md):
a file past about 500 lines is split.

**Acceptance.** The guard is sabotaged once (a listed file grown by a line, an
unlisted file past 500) and goes red each way.

**Depends on.** none.
