# Native craft: hooks, vtables, logs

Writing the extension (`native/`). Source layout and engine-wide rules:
[ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md); reading the executable:
[reverse-method.md](reverse-method.md).

## Calling and hooking

- A hooked or called function's arity comes from its `ret imm` — never from
  the pushes at a call site (they may belong to the next call, or be saved
  registers). `tools/test-controller-slots.ts` checks our slots against the
  engine's.
- Reach an object exactly as the engine does, every intermediate virtual call
  included (slot 0 too).
- A condition before an engine call may be a guard: keep it.
- Never query an object inside its own constructor; store the pointer and work
  when the engine hands over the live object.
- Before substituting one engine function for another of the same family,
  compare `ret` AND register roles.
- A detour's byte head is whole instructions covering at least 5 bytes,
  counted separately for each image — the trampoline takes exactly those
  bytes.
- Exclude loader-relocated operands from a head check (`detour_relocated`).
- Before reusing an engine call as a question ("can pay?"), read it to the
  end: it may act. Use the pure comparison inside.
- Find a patch site by what it belongs to (path string, global, vtable start),
  never by its value; check the value afterwards.

## Vtables and objects

- Read a slot only from the vtable it falls inside: `tools/reverse/vtable.ts
  <Class>` prints all of a class's vtables; one ends at the first dword not
  pointing into `.text`. With only a slot number, the right vtable is the one
  long enough. Cross-check: related classes reach the same implementation
  through thunks.
- Correct class name but garbage fields = a pointer to a base subobject. Use
  RTTI's complete-object offset (`whole_object_of`).
- After replacing an engine vtable slot, grep `native/` for our own calls
  through that slot (`vtable_entry` refuses non-exe code) and give them the
  kept original. Prefer a code detour when the head allows.
- Keep the vectored exception handler (`native/core/faults.c`): it turns a
  crash into a place in the code.

## Logs

- `npm run build-native` writes no log at all. For a log:
  `npm run build-native -- --dev` or `-- --log <files>`; a direct `log_*_now`
  call sits under `if (H5E_DEV)`. [LOG.md](../../LOG.md) lists what each file
  says.

  ```bash
  npm run build-native -- --dev
  npm run build-native -- --log combat/spell-resolve,lua/battle
  npm run build-native -- --list-log
  npm run install-native
  ```

- Install the logging build LAST: `tools/test-native-log.ts` overwrites
  `native/build/`, and a live e2e run reinstalls whatever is there.
- Never call a function inside a log macro's arguments — they are not
  evaluated when the unit is off. Call on its own line, log the result.
  "Worked in the probe, not now": suspect the build flags first.
- Log events whole: no caps, no first-N, no filtering by "looks like an
  address", whole objects, whole stacks, all arguments; separate runs with
  markers. Do not log questions the engine asks continuously (UI hover
  queries) — switch such a probe on for a hunt, then comment it out.
- A game launch logs the whole subsystem in focus (every function, every
  argument, state in and out), never one question. Filter when reading, never
  when writing.
