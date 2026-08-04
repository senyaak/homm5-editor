# SLICE — Ask the engine how it draws an effect

> **Status:** agreed, nothing started. Senya's call on 2026-08-04: stop
> inferring how effects are consumed and go read it out of the running game.
> Nothing in this file is built; it is a plan to be picked up in a fresh
> session. When it lands, fold the answers into
> [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) (what the format means) and
> [docs/engineInternals/](docs/engineInternals/) (what the code does), then
> retire this file.
>
> **It needs the game launched, which needs Senya's say-so each time**, and a
> scratch DLL that is never committed (the same shape as the lighting probe,
> §2a of [docs/LIGHTING.md](docs/LIGHTING.md)).

Reading first: [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) (the bake IS the
simulation; the blend convention; what is still parked),
[docs/LIGHTING.md](docs/LIGHTING.md) §2a (the probe that already worked, and the
trap it fell into first), [docs/ENGINE_INTERNALS.md](docs/ENGINE_INTERNALS.md)
(how to reach an unwrapped binary and the rules that hold in it),
[renderer/viewport/particles.ts](renderer/viewport/particles.ts) and
[src/scene/object-effects.ts](src/scene/object-effects.ts) (what we do today).

---

## 1. Why the engine and not more data

Every remaining defect in the effects is a **"how is this consumed"** question,
and the files cannot answer those by construction. The last three bugs all had
the file read correctly and the consumption guessed wrong:

| bug | the file was right about | we guessed wrong about |
| --- | --- | --- |
| impact rings stood still, the gating vortex was a knot of ribbons | the `scaleShear` curves | that a clip is position + rotation |
| grass grew roots-up, every effect drew mirrored | the frames themselves | which end of the image is world-up |
| the gating panels are a diamond lattice | V running 0..32 | whether anything moves that UV |

Each cost a round of screenshot → hypothesis → corpus census → screenshot. And
the precedent for going to the engine is in exactly this area: the lighting
formula was settled only when a throwaway DLL patched the D3D9 device vtable and
watched C1M1's opening play. Three reasonable readings of the data had been
wrong in a row before that (the `<Whitening>` switch, a bare ×2, an uncapped
×4). The tooling is already ours: own copy of the exe, detours, a Zig build, and
live constant reads.

**What this slice plans not to do, and how sure that is.** It does not port a
particle simulator, on the working assumption that the bake IS the recording and
playback is interpolation. That assumption is **half verified**, and the half
that is not is written out in §7 with the checks that would kill it — because
"the file says so" is exactly the reasoning that produced the three bugs above.

## 2. The questions, in the order they pay

1. **Does a texture matrix or UV offset move?** — `SetTransform(D3DTS_TEXTURE0…)`,
   `D3DTSS_TEXTURETRANSFORMFLAGS`, and any vs constant that changes per frame
   while a gating vortex is on screen. This is the "ромбики": the Gating model's
   V runs 0..32 (measured), so the texture is meant to repeat 32× along the
   panel, and a static sample of that reads as a lattice. One log answers
   yes/no, and if yes, gives the rate.
2. **Which shader is bound for a particle draw?** — the open question in
   EFFECTS_FORMAT (four candidates were found in the binary, and the data
   cannot say which the engine hangs on a system). Log the bound vs/ps by hash
   per draw, and the texture-stage state with it.
3. **What makes a standing quad stand?** — today we derive it from the bake
   (≥8 particles, no channel moving, alive the whole loop) because `<Static>`
   says `P_STATIC` on all 2709 shipped instances and separates nothing. That is
   an inference of exactly the sort that already broke once on this field. The
   probe sees the truth: whether the engine builds these quads differently at
   all (a different vertex declaration, a different shader, a fixed up-vector).
4. **Blend and render state per draw, for MODELS as well as particles.** We
   apply the particle convention (`ONE / ONE_MINUS_SRC_ALPHA`, straight colour)
   to particles and material flags to effect models. Confirm both, and find out
   what `AddPlaced` really turns into.
5. **Is the bake played as recorded?** — the assumption this whole plan rests
   on, and §7 says how far it is actually verified. Read from the same log: how
   many particles the engine draws against how many our decode expects, what
   alpha reference it sets, and whether draws arrive sorted.
6. **Cheap while we are in there:** does anything animate a material's texture
   *frame* on a model (the meteor trail's stretch is a bone, but the fire on it
   may be a frame sequence), and are effect `<Lights>` (parked, 8 of 532
   adventure-reachable effects) fed to D3D at all.

## 3. The harness, and the one hard part

A D3D-level log gives ground truth per draw call but says nothing about *which
effect* a call belongs to. The correlation is the work:

* Log per draw: bound texture pointers → the texture's own bytes (hash a mip
  level), vertex/index counts, the full render + texture-stage state that
  changed since the last call, and the transforms.
* Match those hashes against **our** decode of the same scene: we already know
  every frame table and every model texture by uid, so the hash is the join key.
  `tools/scene-stage.ts` and `_tmp/shot20.ts` (the anatomy dump written for the
  meteor work) are the starting points for the expected side.
* Drive the game to a **deterministic** moment. C1M1's opening scene is the one
  we know shot-by-shot, and shot 20 (MeteorShower, fires 0.5 s in) and shots
  14–15 (Gating) are the two frames this slice is about.

Traps to carry in from the lighting probe: a grey triple identifies nothing —
only values whose channels differ can prove where a number went; and the first
"find" was a fade scalar that happened to pass through the preset's ambient. The
same applies to a UV rate of 1.0 or a scale of 1.0.

## 4. What the probe cannot answer

Anything the engine computes on the **CPU at load** and writes into a buffer —
that is how the two vertex colours turned out to work, and no constant carried
them. If a question comes back empty at the D3D boundary, the answer is above
it: then, and only then, disassemble the specific function the probe fingered
(that is the cheap direction — a targeted read of one function, not a sweep of
the effect pipeline).

## 5. Order of work

1. Scratch DLL from `native/homm5-editor.c` (never committed) that logs §3 per
   draw call to a file, gated to the frames of interest.
2. Ask before launching; run C1M1's opening once; keep the log.
3. Answer question 1 (UV motion) first — it is the visible defect Senya
   reported, and the cheapest to read.
4. Then 2 and 4 from the same log, since they are per-draw state we already
   captured.
5. Fold each answer into the docs as it is proven, with the number that proves
   it. Fix the renderer only after the answer is written down — the fix is
   usually small once the state is known (the scale channel was 20 lines).

## 6. Known state of the effects today

Working and verified: baked playback with the trigger train, per-instance
placement and speed, the blend convention for particles, bone-glued instances,
clip-driven models with their own end, the clip's **scale** channel (2026-08-04,
`docs/ANIMATION_FORMAT.md` §5), and frame orientation (`EFFECTS_FORMAT.md` §5).

Known broken or unknown, and why it is in this slice: the gating panels' lattice
(no UV motion), the particle colour shader, the standing-quad discriminator
being an inference, effect `<Lights>` unfed, and the 46 of 298 placed effects
that fly a `MovePoints` path and are drawn at their start point.

## 7. "The bake is the simulation" — what is proven and what is assumed

Senya pushed back on this being stated as settled, and the pushback was right:
it is two claims, and only one of them is established.

**Established, on the file side.** Every byte of every one of the ~1921 shipped
`bin/effects` files is accounted for by our parser (`tools/test-effects.ts`
checks the directory's own claims: blocks contiguous, no byte covered twice, no
key outside its particle's lifetime). So there is no unread channel that could
be a simulation input, and each particle's keys really do span its whole life.
The recording is complete AS a recording.

**Not established, on the engine side** — whether anything is applied on top of
it at run time. What was checked while writing this, and what it says:

* **Wind: answered, and the answer is no.** The format carries `<WindAffected>`
  and `<WindPower>` on every effect — and `WindAffected` is `false` on all 1814,
  with `WindPower` 1 on all 1814. A mechanism nothing shipped uses. (Note this
  constant is the *useful* kind, unlike `<Static>`: a field that is false
  everywhere answers the question, a field that is `P_STATIC` everywhere cannot.)
* **`gfx_particles` — open.** The game's own profile carries
  `setvar gfx_particles = 1`, one of 80 `gfx_*` vars in the executable. Whether
  it is a boolean, a density fraction, or a quality tier that subsamples what
  gets played is unknown, and a density tier would mean the engine does NOT play
  the bake as recorded.
* **`gfx_effect_alpha_treshold` — open, and we invented our own.** The engine has
  a configurable alpha threshold for effects (0 in this profile). Our shaders
  discard below hand-picked 0.003 / 0.01 (`renderer/viewport/particles.ts`),
  which is our number, not the engine's.
* **More than one draw path exists.** `fx_nopixelshaders` and `fx_tnl_mode` say
  the engine has a fixed-function fallback, so question 2 above is not "which
  shader" but "which shader under which mode" — the probe must record the mode
  it ran in, or the answer is only true for this machine.
* **The phase spread is ours.** Forty demons whose fires flicker in lockstep
  read as one animation played forty times, so each placement is offset by
  `i * 0.37` (`renderer/viewport/fx.ts`). Nothing was ever read that says the
  engine does this, or with what offset.
* **Sorting is unknown.** Whether the engine depth-sorts particles per draw is
  not something we have looked at; it changes how overlapping smoke reads.

All of these fall out of the same log the probe already has to produce — draw
counts against our expected counts (`gfx_particles`), the alpha ref and test
state (`gfx_effect_alpha_treshold`), the bound shader plus the mode, and the
order draws arrive in (sorting). Flipping the two config vars between runs and
diffing the log is the cheap experiment for the first two.
