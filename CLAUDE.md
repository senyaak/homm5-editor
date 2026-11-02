# homm5-editor — orientation

A map, campaign and mod editor for *Heroes of Might and Magic V: Tribes of the
East* on Electron + TypeScript, plus a native extension of the game
(`native/`, Zig-built C) and a byte-exact port of its random map generator. It
reads a legally installed game; nothing of the game is committed. The repo is
**public**.

## Where things are

- [README.md](README.md) — what works, how to run it
- [CONTRIBUTING.md](CONTRIBUTING.md) — layout, code conventions, the one hard rule (no game content)
- [docs/working/](docs/working/README.md) — how work is done here: tests, e2e, the game, design, mods, native, reverse engineering, git
- [docs/README.md](docs/README.md) — formats, the map document, mods and content, what was read out of the executable
- [docs/todo.md](docs/todo.md) — the work list: one file per open item
- [ROADMAP.md](ROADMAP.md) — the plan and its history; `SLICE_*.md` at the root — designs in flight
- [CHANGELOG.md](CHANGELOG.md) — what changed, as people read it on GitHub
- [LOG.md](LOG.md) — what the extension's development build writes

## Before running anything

```bash
export HOMM5_GAME="C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East"
```

Nothing guesses the install; without it four suites fail for a reason that is
not the change. Run the tests of what you touched, at once; the rest only for
a shared change or a release; the C1M1 reconstruction only before a release
([docs/working/testing.md](docs/working/testing.md)).

## Working rules

- **Never launch anything with a window** — not the game, not the editor, not
  the packaged app. The owner plays; hand over what to start, where, and one or
  two things to see ([the-game.md](docs/working/the-game.md)).
- **An install is shared by every session that points at it.** Install only
  into a copy of your own; a copy of your own is expendable.
- **Every new test is broken on purpose once** and must go red; a check made in
  a console goes into a test in the same commit.
- **e2e: every gesture is followed by a check that nothing threw**, and maps
  are built through the palette, never under the UI ([e2e.md](docs/working/e2e.md)).
- **Separate what is proven from what is assumed.** Proven about the file is
  not proven about the engine; "found nothing" is a property of the tool.
- **Read the code, not the picture**; docs and the web before the disassembler
  for the game's ordinary behaviour ([reverse-method.md](docs/working/reverse-method.md)).
- **Show data as saved; take a value, don't derive it; a preset fills every
  field visibly** ([editor-design.md](docs/working/editor-design.md)).
- **A real modding tool, not workarounds**: one mod, the editor its only
  writer; a faction's files apart; new engine tables live in our DLL; our own
  code, never the middle of the engine's ([mods-and-the-engine.md](docs/working/mods-and-the-engine.md)).
- **Files are changed with Edit/Write**, never by shell rewrites; code with a
  backslash never goes through a heredoc ([shell-and-files.md](docs/working/shell-and-files.md)).
- **Commit and push each verified change**: author the owner, committer the
  running Claude model via `GIT_COMMITTER_*`, no `Co-Authored-By`; stage your
  own files only; never rewrite pushed history; a user-visible change adds its
  changelog entry as a file under `changes/` in the same commit — never an
  edit of CHANGELOG.md ([git.md](docs/working/git.md)).
- **Everything in the repo and on GitHub is English.** Only the chat with the
  owner is Russian.
- **A task does what it says**; a neighbouring bug is named, small stale
  comments in our code are fixed in passing ([scope-and-docs.md](docs/working/scope-and-docs.md)).
- **One subject per file**, split past about 500 lines; a correction replaces
  the wrong text.

## Traps worth knowing before touching the code

- The game must start with `bin/` as its working directory — the install's root breaks creature models quietly — [the-game.md](docs/working/the-game.md)
- Arity of a hooked function comes from its `ret imm`, never from the pushes at its call site — [native.md](docs/working/native.md)
- A detour's byte head is its length: whole instructions, counted per image — [native.md](docs/working/native.md)
- A log macro's arguments are not evaluated in a quiet build; never call anything inside one — [native.md](docs/working/native.md)
- Install the logging build LAST: `test-native-log` overwrites `native/build/` — [native.md](docs/working/native.md)
- A vtable slot means nothing without its vtable's start; a base pointer is not the object — [native.md](docs/working/native.md)
- The editor and the game are different builds: x87 against SSE, so read the one whose behaviour is measured — [reverse-method.md](docs/working/reverse-method.md)
- `Math.hypot` is inexact; the map editor's FPU runs single precision, round toward zero — [numbers.md](docs/working/numbers.md)
- Playwright restarts the worker after a failure: a cleanup in `beforeAll` wipes the chain — [e2e.md](docs/working/e2e.md)
- A probe launching the app runs the BUILT renderer: `npm run build:renderer` first — [e2e.md](docs/working/e2e.md)
- Never `| tail` a test run: the log keeps only what passed the pipe — [testing.md](docs/working/testing.md)
- `test-heroes` takes the data directory positionally; `--game ..` makes it skip — [testing.md](docs/working/testing.md)
