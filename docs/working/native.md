# Native craft: hooks, vtables, logs

How the extension (`native/`) is written so that it does not crash the game,
and how it is made to say something. The source layout and the rules that hold
for every subsystem are in [ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md);
reading the executable is [reverse-method.md](reverse-method.md).

## Calling and hooking

- **Arity comes from the callee's `ret imm`, never from counting pushes.** A
  constructor ending `ret 18h` takes six arguments; its call site shows five,
  the sixth pushed five instructions earlier with a virtual call between. Pushes
  beside a call may belong to the NEXT call; a `push ebp` before
  `call [eax+24h]` may be a saved register with its `pop` at the end of the
  block. A hook that takes one argument too many or too few breaks the stack
  on its first call — four crashed battles for one task (02.08.2026). Since
  then `tools/test-controller-slots.ts` checks our slots' `ret` against the
  engine's, from the built DLL.
- **Copy the engine's path to an object instruction for instruction**,
  intermediate slots included: `[vt+0x18]` → owner, `[vt+0x0C]` → hero,
  `[vt+0]` → another object, and only that one answers `[vt+0x174]`. Skipping
  slot 0 calls real code on the wrong object, and no check catches it.
- **A condition before a call may be a guard, not an optimisation.** `engine >
  0` kept the function's second call site from walking to an owner.
- **Never ask an object about anything inside its own constructor** — its
  owner does not exist yet. The constructor records the pointer; the work
  happens when the engine hands over the live object.
- **Functions of one family are not interchangeable.** The four per-element
  appliers look like one API and have `ret 10h/14h/18h/10h`, and the fire one
  swaps the roles of `ecx` and `edx`. Compare `ret` AND register roles before
  substituting one for another.
- **A detour's byte head IS its length.** The trampoline takes exactly the
  bytes it is given, so the head is whole instructions covering at least five
  bytes — counted per image: the same function needed five in the editor and
  eight in the game. Eight bytes "to be safe" cut `mov esi,[esp+3Ch]` in half,
  twice, before a single log line.
- **Relocated operands are excluded from the head check.** An instruction
  with an absolute address is rewritten by the loader; `detour_relocated`
  handles it.
- **An engine check may be a deed.** "Can the player pay" in the hire command
  compares AND subtracts; asked on every refresh of a window it drained the
  purse on each click (launch 53, 25.09.2026). `CanDo` runs the command's
  Execute; `SetPlayerResource` and `AddObjectCreatures` are queued commands.
  Read the body to the end before reusing an engine call as a question, and
  use the pure comparison inside.
- **A patch is found by what it belongs to, never by its value.** The ceiling
  patcher looked for a count accessor by `mov eax,11; ret`; there were two,
  the live one belonged to another table, and the AI went for a twelfth effect
  on its first turn. Identify by the path string, the global, the vtable start;
  the value is only checked afterwards.

## Vtables and objects

- **A slot number means nothing without its vtable's start and length.** A
  class with multiple inheritance has several vtables in a row; "slot +0x184"
  read from a short first one lands in the next one at +0xB4, on a plausible
  pair of functions that are not the ones. `node tools/reverse/vtable.ts
  <Class>` prints them all; the length runs to the first dword not pointing
  into `.text`. When only the slot number is known, the vtable it fits is the
  one long enough to hold it. Check: across related classes the same slot
  leads to the same implementation through thunks with different adjustments.
- **A pointer to a base is not a pointer to the object.** The "current screen"
  hands out a subobject 0x844 bytes in; RTTI names the class RIGHT, so nothing
  looks wrong, while every documented field offset reads a neighbour. The tell:
  the class name is right and the fields are zeros or garbage. The fix is the
  number RTTI keeps — the complete-object locator's offset at `+0x04`
  (`whole_object_of`), which is what `dynamic_cast<void*>` does.
- **Replacing an engine vtable slot breaks our own callers of it.**
  `vtable_entry` answers only with code inside the executable, so every call
  of ours through that slot becomes "no function". Grep `native/` for the
  slot's offset and give those callers the kept original; prefer a code detour
  when the head allows.
- **An exception handler pays at once**: one that writes eip, the registers
  and the return addresses on the stack turned "module and offset" into a
  place in the code in one run (`native/core/faults.c`).

## Logs

- **Logs are for development builds only.** `npm run build-native` writes no
  log at all — no file, no clean-up, no fault handler. A log is
  `npm run build-native -- --dev`, or `-- --log <files>` (dev plus those
  files); a line that bypasses the switches (`log_*_now`) sits under
  `if (H5E_DEV)`. Read [LOG.md](../../LOG.md) before deciding a hook "did not
  install" or a feature "says nothing".

  ```bash
  npm run build-native -- --dev
  npm run build-native -- --log combat/spell-resolve,lua/battle
  npm run build-native -- --list-log
  npm run install-native
  ```

- **Install the logging build LAST.** `tools/test-native-log.ts` builds its own
  quiet and loud copies into the same `native/build/`, so running it after
  `install-native` leaves a DLL that is not the one installed — and a live e2e
  run reinstalls whatever is there. Build, install, launch; if a suite ran in
  between, install again.
- **A log macro's arguments are not evaluated when its unit is off.**
  `log_line(x)` is `if (LOG_ON) log_line_now(x)`, so
  `log_line(tick_the_map_scripts() ? …)` never ticked the scheduler in an
  ordinary build — the Bone Pit camp "stopped working" in the no-log build, and
  six hook installs were lost the same way. Call on its own line, log the
  result. `tools/test-native-log.ts` fails on any function inside a log
  argument that is not on its readers list. "Worked in the probe, not now" —
  suspect a build-flag difference first.
- **Log events whole; questions are not events.** No caps, no `first 40
  calls`, no "only code-like words", no "first dword of each pointer": a cut
  log went quiet exactly before the interesting place, five times, and the
  silence was read as "never called". Write the object whole, the stack whole,
  every argument whole, and separate runs with markers. But a hook echoing a
  question the engine asks continuously (the UI asking about the target under
  the cursor) is not diagnostics — one such hook made 86% of a 147 MB log and
  crashed the game. A probe on a question is switched on for the hunt and then
  commented out, with a note of what it bought.
- **A launch is never for one question.** If the game is launched, log how the
  WHOLE piece of the executable in focus works — every function of the
  subsystem from the disassembly, all arguments, state in and out, every read
  of its tables. "A million gigabytes of log is simpler than a million
  launches." Filter when READING (grep, awk), never when writing.
