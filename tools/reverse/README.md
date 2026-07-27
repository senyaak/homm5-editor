# Reading the game's executable

Three small scripts behind [docs/EXE_LUA_REGISTRY.md](../../docs/EXE_LUA_REGISTRY.md)
and [docs/ENGINE_INTERNALS.md](../../docs/ENGINE_INTERNALS.md). They only read;
nothing here writes to a game file.

**Why Python, in a TypeScript repo.** Disassembly needs capstone, and capstone
has a maintained Python binding and no comparable one for Node. Everything the
editor ships stays TypeScript; this is a workbench for answering questions
about the binary, and the answers live in the documents, not here.

```bash
python tools/reverse/pe.py                       # section map, sanity check
python tools/reverse/sigs.py sigs.json           # every Lua function + signature
python tools/reverse/gendoc.py sigs.json docs/EXE_LUA_REGISTRY.md
```

`pe.py` is the library the other two import: PE parsing, VA↔offset, string
reader, xref and call scanners, annotated disassembly. `PATH` at the top points
at the executable to read — **an unwrapped one**, which `npm run unwrap-exe`
produces (a Steam-wrapped file disassembles to noise; see the top of
`src/exe-unwrap.ts`).

Requires `pip install capstone`.

**Addresses are landmarks, not constants.** A GOG build is a different
compilation, so anything found here is a starting point for a pattern search —
the discipline `src/creature-limit.ts` and `src/artifact-limit.ts` already
follow.
