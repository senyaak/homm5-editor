# assets — what the specs are made of

Everything a test reads off disk that is not the game's unpacked data: pictures
an artifact is built from, reference maps a spec rebuilds and compares against.

**Committed, and that is the whole point.** A spec that reaches into somebody's
game install passes or fails on the state of that install, and cannot run at all
on a machine where the folders happen not to exist. What lives here travels with
the checkout, so the suite behaves the same everywhere.

Nothing extracted from a game belongs here — that is `data-unpacked/`, which is
ignored. The rule is provenance, not size: a file is here because it is ours to
publish.

## What lives here

```
assets/
  artifacts/    pictures an artifact can be built from — .gif, 58x64
  maps/         reference maps the specs rebuild and compare against
```

### artifacts/

The Cloak of the Undead King's three pieces, drawn as Heroes III had them and
taken from the open web:

| file | artifact |
| --- | --- |
| `amulet_grob.gif` | Амулет гробовщика — `ARTIFACT_H3_UNDERTAKERS_AMULET` |
| `mantia_vamp.gif` | Плащ вампира — `ARTIFACT_H3_VAMPIRES_CLOAK` |
| `sapogi_mertv.gif` | Сапоги мертвеца — `ARTIFACT_H3_DEAD_MANS_BOOTS` |

An artifact takes one as its `picture` and the mod builds the game's own 64x64
texture from it — `src/gif.ts` reads the file, `src/texture.ts` writes the
texture — so the specs exercise that path rather than borrowing a shipped icon.
The Artifacts dialog takes the same files in its Icon field.

### maps/

`Sharpshooter Test.h5m` — the map `e2e/mod-005-sharpshooter-map.spec.ts` rebuilds through
the window and holds its result against: a town, three heroes, three neutral
stacks, the Sharpshooter's palace and the three artifacts on the ground. It also
carries the necromancer's measurement army, which is what a necromancy bonus is
read off in game.

The spec prefers this copy and falls back to whatever is installed, so a
checkout is self-contained and an older install still runs.
