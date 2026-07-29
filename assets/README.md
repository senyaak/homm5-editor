# assets — the files the specs need and the repo must not carry

One place for everything a test or a dialog reads off disk that is **not ours to
publish**: artwork from another game, maps built out of the game's own, anything
extracted from an install. The folder is in `.gitignore` except for this file, so
the paths are fixed and documented while the contents never reach GitHub.

This is not a hiding place for large files. It is for files whose *provenance*
makes them uncommittable. Anything we authored from nothing belongs in the repo
proper, where a fresh checkout has it.

## What lives here

```
assets/
  artifacts/    icons an artifact can be built from — .gif, 58x64, Heroes III
  maps/         reference maps the specs rebuild and compare against
```

### artifacts/

The Cloak of the Undead King's three pieces, as Heroes III drew them:

| file | artifact |
| --- | --- |
| `amulet_grob.gif` | Амулет гробовщика — `ARTIFACT_H3_UNDERTAKERS_AMULET` |
| `mantia_vamp.gif` | Плащ вампира — `ARTIFACT_H3_VAMPIRES_CLOAK` |
| `sapogi_mertv.gif` | Сапоги мертвеца — `ARTIFACT_H3_DEAD_MANS_BOOTS` |

They come from a Heroes III install. The Artifacts dialog takes one as the
artifact's picture and builds the game's own 64x64 texture from it
(`src/gif.ts` reads it, `src/texture.ts` writes it), so nothing here has to be
converted by hand.

Absent, an artifact is built with a shipped artifact's icon instead — which is
what the specs do, since what they need is that the artifact exists.

### maps/

`Sharpshooter Test.h5m` — the map `e2e/sharpshooter-map.spec.ts` rebuilds through
the window and holds its result against. It was made by editing a map the stock
editor produced, and it carries hand edits since: the necromancer's measurement
army. The spec prefers the copy here and falls back to the one installed in the
game, so a checkout with this folder filled in is reproducible and one without it
still runs against whatever the install has.
