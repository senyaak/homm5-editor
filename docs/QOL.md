# Quality of life

Settings that change how the game **plays**, as opposed to what a map contains:
a borderless window, a user folder of the mod's own. They live in the editor's
`Game settings…` panel, they are written to one flat file in the install, and
the native extension reads that file when the game starts.

Everything here is **off** unless it is turned on, and a file that is not there
is the same as everything off. An install that never opened the panel behaves
exactly as it did before — that is the promise the whole feature rests on, and
the reason the config is written in full rather than only where something is
enabled.

## The pieces

| | |
|---|---|
| `bin/homm5-editor-qol.txt` | the config. Flat text, one flag per line. |
| `native/homm5-editor.c` | reads it at load, installs only what it asks for. |
| `src/mods/qol.ts` | the flags and their words — no I/O, so the panel can import it. |
| `src/mods/qol-file.ts` | reading and writing that file. |
| `src/mods/qol-ui.ts` | the health bar's archive, built from the install's own `data.pak`. |
| `H5E/homm5-editor-qol.h5u` | that archive in the install — written and removed by apply, following the flag. |
| `src/game/video-config.ts` | the game's own video settings, in its own profile. |
| `electron/channels/qol.ts` | `qol:get` and `qol:apply`. |
| `renderer/features/qol.ts` | the panel. |

The split between `qol.ts` and `qol-file.ts` is not taste: the panel runs in the
renderer, and a module that imports `node:fs` cannot be bundled into a browser
page at all. Same shape as `mod-model.ts` beside `mod-files.ts`.

## The config file

```
# Quality of life, written by homm5-editor.
# Read by homm5-editor.dll at startup. 1 is on, 0 is off; a missing file is all off.

borderless 1

own-profile 0
```

A comment, a blank line, or a name and one decimal. The name on its own means
on, in both readers — a file edited by hand to try something out should mean the
same thing to the C as it does to the TypeScript.

**It is a SECOND file, beside `homm5-editor-effects.txt`, deliberately.** The
effects file is content: it belongs to what the editor built and travels with
it. These are how one person wants their own install to behave, and no map of
theirs should carry them anywhere.

`tools/test-qol.ts` checks the two readers against each other, including that
every flag the panel offers is a flag the C source declares. A flag added on one
side only is a switch that silently does nothing, which is the one failure this
feature must not have.

## How the hooks work

Both flags are **import table hooks**: one pointer is replaced in the
executable's IAT, and not one instruction of the game's is touched. This is the
cheapest cut this repo has — cheaper than the detours in
[ENGINE_INTERNALS.md](ENGINE_INTERNALS.md), which need an address and the bytes
at it verified, and cheaper than the string patching in `src/game/mod-paths.ts`,
where every replacement has to be SHORTER than what it replaces. An answer given
at runtime has no such bargain, and needs no address at all.

What is verified before writing: the slot still holds what the loader put there
(`GetProcAddress` of the same name out of the same library). That is at once a
check that this is the right slot and a check that nobody got there first.

## `borderless`

The game window without its frame, filling the screen.

Three hooks, and all three are needed — established by log, not by guessing:

- **`CreateWindowExA`** — the frame is decided here. The game makes three
  top-level windows (`ScreenFadeWnd`, `SplashScreen_WindowClass_DEFAULT`, and
  `H5`); only the last has `WS_CAPTION`, so "top-level and framed" picks the
  right one and leaves the splash alone.
- **`SetWindowPos`** — the window is created with `CW_USEDEFAULT` and sized
  afterwards, once the device exists. Without this the frame comes off and the
  geometry goes back to whatever the engine had in mind.
- **`SetWindowLongA`** — the game re-applies its style (`0x10CF0000`, which adds
  `WS_THICKFRAME`) after creation. A frame that returns halfway through a
  session is the same bug as one that never came off.

### The half that is not a hook

Exclusive fullscreen belongs to Direct3D, not to the window: with
`gfx_fullscreen = 1` the display is taken and there is no frame to remove. So
applying `borderless` also writes the game's own settings —

- `gfx_fullscreen = 0`, or the switch does nothing on most installs;
- `gfx_resolution` = the screen's real size, or the engine draws 1024x768 and
  Windows stretches it over the whole display, which reads as a broken mod
  rather than as a setting.

Only a line that is already there is changed, never appended: the game rewrites
that file from its own list of variables on exit, so a name it does not know
would be dropped anyway.

### On DPI

`GetSystemMetrics(SM_CXSCREEN)` answers differently depending on a per-exe
compatibility flag (`HKCU\…\AppCompatFlags\Layers` — Windows offers to set
`HIGHDPIAWARE` after it has seen a game run, and did so between two of our
runs). A DPI-unaware process sees the scaled size, 1463x823 where the display is
2560x1440 at 175%. Coverage is right either way — Windows scales the window back
up — so nothing compensates for it. Only sharpness differs, which is what
`gfx_resolution` is for.

## `own-profile`

Profiles, key bindings, settings and **saves** go to `H5E/user` inside the
install instead of Documents.

The game builds its user path as

```
<Documents>\My Games\<PRODUCT_NAME>\Profiles\<profile>\user_a2.cfg
```

and finds Documents with a single named import, `SHGetFolderPathA` from
SHELL32. Our hook answers `CSIDL_PERSONAL` with `<install>\H5E\user` (derived
from where the DLL itself is, so a moved or copied install keeps working) and
passes every other folder through. In practice the game asks **once** per run,
and for nothing else — logged rather than assumed.

**Nothing is seeded.** The folder starts empty: no profile, no saves, no hall of
fame. Copying the existing tree in would be one command and several ways to go
wrong; whoever wants their campaign here can copy it themselves, knowing — as we
do not — which of their saves they mean.

The game does fill a new profile from `<install>/profiles/default_profile/`,
which is worth knowing on its own: **that file is a template, not the
settings.** Setting `gfx_fullscreen` there changes what the next new profile
starts with and nothing about the game running now.

### Why this exists

Our copy of the executable already reads and writes a mod folder of its own, so
a map or a mod cannot disturb a plain install. Settings and saves were the
exception — shared through Documents by every install on the machine. A second
copy of the game isolates its binaries and its data and **not** these, which is
how an afternoon of testing came to rewrite the video settings of the game
somebody actually plays.

With this on, the panel writes video settings into our profile rather than the
shared one, which closes the same hole from the editor's side.

## `stack-losses` and `stack-health-bar`

The battle plates: Shift shows `now / at the start` on every stack's number,
and a bar under the plate shows what the creature at the front has left. How
both work — the detours, the health accessors, the widths — is a page of its
own: [engineInternals/STACK_PLATE.md](engineInternals/STACK_PLATE.md).

What belongs HERE is the part `qol:apply` owns: the bar is **half archive**.
Its two strips are child windows declared in `H5E/homm5-editor-qol.h5u`, and
the game draws them at their declared size whether or not the extension runs.
So the archive follows the flag — written on apply when the bar is on, deleted
when it is off — or a config line alone would leave a bar on the screen of
somebody who turned it off. The build lives in `src/mods/qol-ui.ts`
(`tools/qol-ui.ts` is the same build by hand), and it is made from the
install's own `data.pak`, so every field we do not set is what the engine
already reads elsewhere.

## Plans

**The bar's own settings** — colour and texture of the strips, maybe their
height. The values sit in one place today (`stripTexture(...)` calls in
`src/mods/qol-ui.ts`), so the feature is a settings surface, not a rebuild.
When it happens it gets its OWN home — a section of its own in the panel and
its own lines in the config, not more fields squeezed into the existing flags —
and the archive is simply rebuilt from those values on apply.

## Adding a flag

1. A name in `QOL_NAMES` and a `QolFlag` value in `native/homm5-editor.c`, and
   the code it turns on.
2. An entry in `QOL_FLAGS` in `src/mods/qol.ts` — `title` for the panel,
   `detail` for what ticking it COSTS. Both go into the config file's comments,
   so the file explains itself away from the editor.
3. Nothing in the panel: it builds its rows from that list.

`test-qol` fails if the two lists disagree.

## What testing this needs

The extension only does anything in a running game, so a change here is proved
by launching one and reading `bin/homm5-editor.log` — every hook says whether it
installed, and the interesting ones say what they saw. Three of the findings
above (the third window, `CW_USEDEFAULT`, the style being re-applied) came out
of that log contradicting what seemed obvious.

The panel is covered without a game by `e2e/qol-panel.spec.ts`. It sets
`HOMM5_DOCUMENTS` at a tree of its own — without that, running the suite would
edit the game profile of whoever ran it.
