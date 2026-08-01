# The shape of our own extension

*Answers: what the three layers are, why the DLL hardcodes nothing, and what we
deliberately do NOT do.*

Written before the extension existed, as a plan; kept because the plan is what
the code is shaped like. Where it has been overtaken by what landed, it says so
inline. The code is `native/homm5-editor.c` and `src/mods/extension.ts`.

The goal is a Cloak of the Undead King that the engine treats as its own, with
**our** set, **our** effect id and **our** numbers — not our artifact wearing
Ubisoft's set, and not a shipped enum quietly repurposed. Everything above says
that is affordable, because the engine's own bonuses are already
data-parameterised and the seams are named.

Three layers, and each is useful before the next exists.

**Data — declares that our set exists.** `types.xml` gains
`ARTFSET_EFFECT_<OURS> = 11`; `DefaultStats.xdb` gains a `<Sets>` entry using
it, with members, per-count texts and icons. From here the game already counts
worn pieces, names the set and draws its tooltip, and
`GetArtifactSetItemsCount(hero, 11, 1)` answers from Lua. No shipped byte
changed, nothing borrowed.

**Native code — makes the effect real.** It installs detours where the engine
sums its own bonuses — `0xc77850` for the necromancy percentage, `0xc77270` for
the raise cost, `0x77fca0` for the first aid tent — and each one calls the
original and adds our terms: exactly term 7's twenty bytes, in our own code, reading our own
numbers. The result goes through the engine's own arithmetic, its own caps and
its own display — which is what "indistinguishable from a shipped artifact"
actually means.

*How it is loaded, as built:* a proxy DLL was the plan (the game imports a local
`zlib1.dll`, also `granny2.dll` and `fmod.dll`, so a forwarding stub would need
no patched executable). What landed is simpler and needs no forwarding at all:
`H5_Game_H5E.exe` is OUR copy already, so it names the extension in its own
import table. Turning the mod off is what it always was — launch the game's own
executable instead.

**A config the editor writes — makes it editable.** The DLL should hardcode
nothing: it reads a table saying *which set id, which threshold, which kind of
bonus, how much*, and the map editor generates that table. Add an artifact,
change a percentage, drop an effect — all of it is editing data in the editor,
not rebuilding a DLL. This is the requirement that decides the DLL's design,
so it belongs in the first version, not a later one.

New Lua functions (registered by the same DLL, following the convention above)
are the third face of the same table: useful for a map or campaign to
read and adjust bonuses at runtime. But they should not be how the *artifact*
works — an artifact whose bonus depends on a script running is exactly the
seam we are trying not to have.

**Two cheap experiments were worth running first**, because each answered a
question the design rests on. Both have since been answered, and the answers
are why the rest of this held up:

- *Does an added enum work?* Answered for SPECIALIZATIONS, in a battle: value 84
  loads and the engine answers about it
  ([SPECIALIZATIONS.md](SPECIALIZATIONS.md)). Still an open question for an
  eleventh artifact SET, where the container is dynamic but nothing proves the
  absence of a ceiling.
- *Does our term reach the engine's arithmetic?* Yes, three times over — the
  necromancy percentage, the dark energy ceiling and the first aid tent all
  carry a term of ours, each seen in game.

**And the piece that turned out not to exist:** the equipment aggregator. The
hypothesis was that stats are applied to the hero when an artifact is put on, so
there would be an apply-and-undo pair to hook. There is no such pair — the
engine asks what is worn at the moment it needs the answer, inside each
calculation, through one function
([ARTIFACTS_AND_EQUIPMENT.md](ARTIFACTS_AND_EQUIPMENT.md)). That is better than
the hypothesis: one door, and a hook per calculation rather than a hook on
every route an artifact can take. What IS still missing is the spellbook side —
how a Scroll's spell arrives and leaves with the item.
