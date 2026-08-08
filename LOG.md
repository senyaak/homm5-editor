# What the mod says, and how to make it say it

The native extension writes a log. **Almost none of it is switched on**, and
that is deliberate: with everything speaking, one spell cast wrote some fifteen
lines for every stack on the field, each line opening and closing the file and —
in a battle — also being spoken into the game's own console through the engine's
Lua interpreter. The game stuttered, sometimes stopped, and the file was
unreadable anyway.

So a build says only what it was asked for, and the asking is per FILE.

## Reading the log

Each launch writes its own file beside the executable:

```
bin/homm5-editor-20260808-143012.log
```

Named for the moment the run started, so sorted by name is sorted by time, and
the newest one is the run you just did. The last ten are kept; older ones go at
the start of a run. Every line carries the thread it was written from and a
counter, because line order in a file is call order only while there is one
thread:

```
[t4128 #17] [resolver] OURS, spell id 143
```

In a battle the same lines also appear in the game's own console, which is how a
log reaches a screenshot.

## Asking a file to speak

```bash
npm run build-native -- --log combat/spell-resolve,lua/battle
```

The name is the file's path under `native/`, and every way of writing it is
accepted — `combat/spell-resolve`, the same with `.c`, the same with `native/`
in front. Repeat `--log` or separate with commas, whichever gets typed.

```bash
npm run build-native -- --list-log
```

Lists everything there is to ask for. A name that matches no file is refused
with the list, rather than quietly turning nothing on.

```bash
npm run build-native -- --log none
```

A build for playing: no logging in it at all, not even the two defaults below.

It is the **preprocessor** doing the cutting, so a file nobody named costs the
DLL nothing — not the call, not the format, not the sentence. Measured: 97 792
bytes with `--log none`, 99 840 as it builds by default, 120 832 with all
forty-five files speaking. `tools/test-native-log.ts` proves it by compiling
twice and looking for the same sentences in both.

**After a rebuild the DLL has to reach the game**, or the run you are about to
watch is the old build:

```bash
npm run install-native
```

## What speaks without being asked

Two units, because they are how anybody finds out the mod is there at all and
what it was doing when it stopped:

| unit | what it says |
| --- | --- |
| `homm5-editor` | `--- homm5-editor extension loaded`, then which hooks went in |
| `core/faults` | on an access violation: the registers, and the return addresses still on the stack |

Both are in `LOG_UNITS_BY_DEFAULT` in [src/mods/extension.ts](src/mods/extension.ts),
which is checked against the sources — it cannot name a unit that no longer
exists.

## Where "did the hook install" actually lives

**The roll-call in `DllMain` is default-on, but a hook that reports from its own
file is not.** `qol/combat-ai.c` saying how many of its three patches went in is
silent unless you build with `--log qol/combat-ai`; the same for the rules
fixes, the borderless window, the quick split, and the artifact config.

This is the one place the per-file switch is coarser than one might want, and it
was left that way on purpose: sorting "report" from "chatter" line by line
across forty-five files is exactly the per-subject judgement that the per-file
switch exists to avoid. If a launch has to be repeated twice for want of a
report, that is the signal to revisit it — see
[SLICE_native_logging.md](SLICE_native_logging.md) §3.2.

## Which file to ask for

Ask the build. It prints every file and what each one is about, read out of the
sources at the moment you ask:

```bash
npm run build-native -- --list-log
```

```
combat/spell-resolve   What a spell of OURS does, written out here instead of borrowed.
qol/combat-ai          The battle AI's own bugs, taken back out.
lua/battle             Saying something to a battle's script: vocabulary and triggers.
```

**There is no such list written down anywhere, on purpose** — not here, not in a
generated block, not in a table somebody regenerates. A list in a file is a list
that has to be noticed when it goes stale, and a stale one is worse than none
because it gets believed. This one cannot go stale: it does not exist between
runs. The names come from each file's `#define LOG_UNIT` and the sentences from
each file's own first line of comment, which is edited by whoever edits the
file.

If the summary is not enough, open the file that owns the behaviour and look at
what it already logs. The unit IS that file's path —
`native/combat/spell-resolve.c` is asked for as `--log combat/spell-resolve` —
so finding the line and naming the switch are one step, not two.

## Adding a file

Put this near the top, under the header comment, and nothing else is needed —
the build reads the units out of the sources rather than keeping a list:

```c
/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_my_new_fix
```

The name is the path with `/` and `-` turned into `_`. The `#undef` matters:
without it the compiler warns on every file, and a build whose warnings nobody
reads is a build with no warnings.

`node tools/test-native-log.ts` checks that every source has exactly one, that
it matches its own path, that no two share a name, and that the `#undef` is
there. It runs as part of `npm test`.

## Where the rest of it is written down

- The bottom of [native/core/log.c](native/core/log.c) — what the gate is, and
  why it is per file rather than per subject.
- [SLICE_native_logging.md](SLICE_native_logging.md) — what was deliberately
  NOT done and what would settle each: whether the crash report ships, the
  console echo still re-entering the engine's Lua, a writer thread.
