# Probe: does the game accept an artifact set of our own?

The premise the whole artifact-effects plan rests on:
`ArtifactSetEffect` is an ordinary enum in `types.xml`, so we should be able to
**append** our own value and declare a set that uses it — without touching any
of the eleven the game ships. If the parser refuses an unknown value, everything
downstream has to be redesigned, and it is cheaper to find out now than after
the native code exists.

This mod declares exactly one thing: a twelfth effect, `ARTFSET_EFFECT_PROBE`,
and a set that uses it. Its members are three **shipped** artifacts that already
belong to the Necromancer set — deliberately, so the probe adds no artifact of
its own and nothing else can be what worked or what broke. A shipped artifact
belonging to two sets at once is itself part of the question.

```bash
node tools/units-mod.ts build probes/artifact-set --install "C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East"
```

It adds no creature and no artifact, so no ceiling moves and the executable is
not touched. To remove it, delete `UserMODs/probe-artifact-set.h5u`.

## What to look for, in order

1. **The game starts.** A rejected enum value shows up at load, not in play.
2. **Put two of the three on a hero.** The hero screen should name *Probe Set*
   and show "Two pieces…". If the set draws at all, the enum was accepted and
   the counting is the engine's own.
3. **The Necromancer set still works.** Same hero, its own four pieces: the
   raise percentage must be what it always was. This is the check that says we
   built on top rather than over.
4. **From a map script:** `GetArtifactSetItemsCount(hero, 11)` should return the
   number worn. That is what a native term would call, so it decides whether the
   set is addressable at all.

Answers belong in [docs/ENGINE_INTERNALS.md](../../docs/ENGINE_INTERNALS.md);
this folder is the experiment, not the record.

`packed/` is the build output and is not checked in.
