# What the mod says, and how to make it say it

The native extension writes a log. **Almost none of it is switched on**, and
that is deliberate: with everything speaking, one spell cast wrote some fifteen
lines for every stack on the field, each line opening and closing the file and —
in a battle — also being spoken into the game's own console through the engine's
Lua interpreter. The game stuttered, sometimes stopped, and the file was
unreadable anyway.

So a build says only what it was asked for, and the asking is per FILE.

**And logs are for development only** (Senya, 2026-10-09). An ordinary build —
a plain `npm run build-native`, the editor's first run, every install from
the editor — writes no log at all: no file is made, no old one pruned, not
even a crash is written down. A development build is asked for with `--dev`,
or by naming any file with `--log`.

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
npm run build-native            # the ordinary build — a game's: no log at all
npm run build-native -- --dev   # the development set below, nothing else
```

Naming any file is a development build too: the set below speaks alongside it.

It is the **preprocessor** doing the cutting, so a file nobody named costs the
DLL nothing — not the call, not the format, not the sentence; and an ordinary
build carries none of the log's own machinery either (`H5E_DEV`, top of
`native/core/log.c`). Measured 09.10.2026: 135 168 bytes ordinary, 185 344
with three files speaking. `tools/test-native-log.ts` proves it by compiling
both ways and looking for the same sentences — and the log file pattern — in
both.

**After a rebuild the DLL has to reach the game**, or the run you are about to
watch is the old build:

```bash
npm run install-native
```

**And `npm test` puts a SILENT one there.** `test-native-log` builds the
extension both ways to prove the switches cut what they say they cut, and the
last build it leaves behind is the ordinary one — which `install-native` then
carries into the game if you run it after. It cost a play-through on
10.08.2026: a run that should have printed a line per spell wrote five lines and
stopped. If a run is being watched, build with `--dev` or `--log` and install
AFTER the suite, not before.

## What a development build says without being asked

Only a development build. These are how anybody finds out the mod is there at
all and what it was doing when it stopped — and, while the multiplayer agent is
still only watching, what it saw:

| unit | what it says |
| --- | --- |
| `homm5-editor` | `--- homm5-editor extension loaded`, then which hooks went in |
| `core/faults` | on an access violation: the registers, and the return addresses still on the stack |
| `net/agent`, `net/relay`, `net/lobby` | the multiplayer agent's traffic |

They are `LOG_UNITS_DEV` in [src/mods/extension.ts](src/mods/extension.ts),
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
report, that is the signal to revisit it — once is a rebuild, twice is a
pattern.

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

## What was deliberately left undone

Three things this could have and does not, each deferred on purpose rather than
forgotten. Each says what would settle it, so a decision made once does not have
to be argued again from scratch.

**Whether the crash report ships** — settled 09.10.2026: it does not. Logs are
for development only, the crash report with them; a crash to look into is
reproduced with a `--dev` build.

**Writing from a thread of its own.** Proposed and turned down. With the volume
cut, a run writes tens of lines rather than hundreds, and the file open per line
that was drowning a spell cast is no longer inside a loop. A queue is not free
in the direction that matters either: lines still in it when the game faults are
the lines nobody gets to read, which is the opposite of what the crash report is
for. *What would settle it:* a run, with one unit asked for, that still stutters.
Then the queue has to be drained synchronously from the fault handler before it
hands the crash on, and from `DLL_PROCESS_DETACH`.

**`console_line` still re-enters the engine's Lua.** The gate cuts how often it
happens — from every line to only the lines of the one file being debugged — and
it cuts where, since somebody asking for `combat/spell-resolve` knows they are
asking for lines from inside a battle. It does not make the re-entry safe. It
stays because the console echo is how a log reaches a screenshot, and a
screenshot is how it reaches somebody who is not at the machine; the volume was
the part that could be fixed without taking anything away. Note that nothing has
PROVED the re-entry ever hung anything — it is read off the code, and the volume
alone explains what was seen. *What would settle it:* the game hanging in a
battle on a build with one unit asked for. Then this is the first suspect and
the test is cheap — comment out the `console_line` call in `log_line_now` and
run the same battle.

Versioning the log's format is not foreclosed by anything here: a header line at
the top of each file is where a version would go. A version *prefix* on the name
would break the pruning, which sorts by name; a version inside the file would
not.

## Where the rest of it is written down

- The bottom of [native/core/log.c](native/core/log.c) — what the gate is, and
  why it is per file rather than per subject.
- [docs/_slices_done/SLICE_native_logging.md](docs/_slices_done/SLICE_native_logging.md)
  — what the logging was before the gate (395 unconditional sites, a file open
  per line, one file for every launch ever) and the measurements that chose the
  shape it has now.
