# Reading the game's executable

The workbench behind [docs/ENGINE_INTERNALS.md](../../docs/ENGINE_INTERNALS.md)
and [docs/EXE_LUA_REGISTRY.md](../../docs/EXE_LUA_REGISTRY.md). Everything here
only reads; no game file is ever written.

All of it wants an **unwrapped** executable. `npm run unwrap-exe` makes one — a
Steam build ships its code encrypted and disassembles to nonsense. When the
editor is not inside the install (a worktree, say), point `HOMM5_GAME` at the
game folder or pass `--exe`.

```bash
npm run lua-registry                              # rewrite EXE_LUA_REGISTRY.md
npm run test-lua-registry                         # fail if it drifted

npm run rmg-map                                   # rewrite RMG_CODE_MAP.md
npm run test-rmg-map                              # fail if it drifted

node tools/reverse/vtable.ts CAdvMapHero          # RTTI name -> vtables -> slots
node tools/reverse/vtable.ts --list Artefact      # which classes exist

node tools/reverse/trace.ts show 0xc77850         # disassemble, strings annotated
node tools/reverse/trace.ts calls 0xb1ef70        # who calls this
node tools/reverse/trace.ts common 0xb2d030 0xb2a790   # what both reach
node tools/reverse/trace.ts field 0x44 0x48 --min 2    # who reads these offsets
node tools/reverse/trace.ts field 0x638 --all         # every instruction, ungrouped

node tools/reverse/equipment.ts                   # every behaviour keyed on an artifact id

# the same code in ANOTHER build — see docs/engineInternals/RULES_FIXES.md
node tools/reverse/match.ts table <a> b55f8c <b> c1ea48 b8    # a switch by its shape
node tools/reverse/match.ts find <exe> c0 "FF??6C:3"          # functions whose bytes fit
node tools/reverse/match.ts fingerprint <a> 9bb340 <b> dc3090 # score by what it does
```

`field --all` is what closed dark energy: the pool is ONE int, so grouping had
nothing to group, and the ten instructions that touch it are the whole story —
a getter, a spend, two clamps and a refill, and no setter anywhere.

`common` is the one that earned its keep: an artifact can leave a hero from the
hero screen, a script, a quest or a death, so what those paths share is where
the engine really does the work. `equipment` prints what that search ended at —
the single function every "is this worn" question goes through, and the fifty-odd
artifact ids the executable reacts to by name.

`rmg-map` is the newest, and the one whose output is a plan rather than a
reference: the random map generator logs a counter and a step name at every
phase boundary, so its own narration recovers the pipeline it runs. See
[docs/RMG.md](../../docs/RMG.md).

The decoding lives in `src/pe.ts` (sections, addresses, strings, references)
and `src/disasm.ts` (iced-x86). `src/lua-registry.ts` holds the registration
and signature reading, because that is knowledge about the game rather than a
script.

**On the disassembler.** These tools filter code rather than read it — "who
touches offset +0x44", "what does this call" — so they need decoded operands,
not text to run regular expressions over. Of the JavaScript options only
iced-x86 provides them: `capstone-wasm` exposes text only, and
`@alexaltea/capstone-js` exposes a detail struct that comes back as garbage (a
displacement reading `0x3900000000`, which is really the opcode bytes). It is
also a decoder rather than a binding, so there is no native build step.

**Addresses are landmarks, not constants.** A GOG build is a different
compilation, so anything found here is the starting point for a pattern search
— the discipline `src/creature-limit.ts` and `src/artifact-limit.ts` already
follow.

`match.ts` is that discipline turned into a tool, and it was written because
somebody else's bugfix patch names addresses in the RETAIL build while ours is
compiled for SSE — a megabyte of code apart, not one address in common. Its
three commands are the three things that survive recompilation: a switch's
grouping, a function's rare byte sequences, and the order of the virtual slots
it calls. Registers, encodings and addresses are exactly what it ignores.
