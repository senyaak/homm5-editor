# Particle effects (`bin/effects`) — the baked-simulation format

Status: **decoded and playing.** The format is structurally verified over the
whole library (1922/1924 files; the other two are empty headers), and the
editor plays every effect a placed object references — campfires burn, mana
crystals spark, portals shimmer. §5 lists what the playback still simplifies.

## 1. The discovery that makes this easy

`bin/effects/<uid>` is neither GR2 nor the Nival record container. It is a
**recording**: the effects were authored as Maya particle systems (every
`.(Particle).xdb` names its `.mb` source, exported with prefix `FX`), and what
shipped is the baked result of running them — each particle's birth and death,
and keyframes for position, rotation, size, colour and texture frame, sampled
at 30 fps (a handful of files use 24/25/15). There is **no emitter logic to
reverse**: spawn rates, forces, turbulence — all of it is already applied in
the data. Playback is interpolation, and it is exact by construction.

The scale of what shipped: 1.69 million particles, 41.8 million keys across
1924 files. The largest file (573 KB) records 2592 particles.

## 2. Reaching the file from a placed object

```
X.(AdvMapXxxShared).xdb → <Effect href="/Effects/_(Effect)/…xdb">
Effect.xdb              → <Instances> ParticleInstance(s)
                          <Models>    ModelInstance(s)   — already rendered
                          <Lights>    LightInstance(s)   — see below
ParticleInstance        → placement (Position/Rotation/Scale), <Speed>, <Textures> list,
                          <Particle href="…(Particle).xdb">
Particle.xdb            → <uid>  →  bin/effects/<uid>
```

The `<Textures>` list on the INSTANCE is the frame table the baked texture
indices point into (a campfire's is 11 fire frames + glow + sparks + smoke).
The same particle file can be instanced several times with different textures,
placements and speeds.

**Creatures reach their effects a different way.** Every monster shared's
`<Effect/>` is empty; the ghost dragon's mist and eye glow hang off the
ANIMATION CLIP instead:

```
Shared → <AnimSet href> → idle00 → BasicSkelAnim → <Effect href="…idle00.xdb">
```

Same Effect format from there, played whether or not the idle animation is on
(the original editor shows the mist on a frozen dragon too). Two extras appear
on these instances:

* `<GlueToNamedBone>` (or a numeric `<GlueToBone>`): the instance lives in a
  BONE's frame — the eye glow is two particles 0.3 apart around the Head
  bone's origin, and played in object space they'd hover at the feet. The
  baked keys stay bone-local, so the bone's rest-pose world transform (from
  the clip's own GR2 — the skeleton lives inside the animation file) is
  composed in. A glued instance whose bone can't be resolved is dropped:
  absent beats at-the-feet. The rest-pose composition is the *fallback* — the
  instance also keeps its transform bone-LOCAL, and with the idle animation
  playing the renderer re-hangs it off the live bone every frame, so the glow
  rides the swaying head. (The bone's world matrix already carries the object's
  placement and the creature's display scale, since the bones are children of
  the skinned mesh, so only the bone-local part is composed then — and the
  root's display scale is divided back out of it, or it would be counted
  twice. The matrix has to be refreshed by hand: three.js updates world
  matrices during render, which is after the effects advance.)
* Colour bytes are authored around **128 = full brightness** (the era's
  modulate-×2 stage, the same one the terrain lighting has): the ghost
  dragon's mist peaks at 57 and rendered near-black under a plain modulate.
  The renderer doubles the colour term (not alpha); saturated effects
  (campfires at 255) just clamp where they already clamped.
* **Fire art ships with NO alpha channel at all** — the phoenix's entire
  fire sequence is zero-alpha (only the `NoADD/` variants carry one). That is
  not an omission but the blend convention itself: rgb adds, alpha occludes —
  see §5 for the single blend mode this implies and the two traps it set.
* **The clip skeleton's root bone carries the creature's display scale**
  (Phoenix 0.37, Devil/ArchDevil 0.7, Griffin 1.5): the mesh is authored
  full-size and the game shows it through the rig. The editor applies it to
  the placed mesh; the effect stays unscaled — the phoenix's flames are baked
  full-size around the 0.37 bird, which is the game's own look (small bird,
  towering fire). Bone-glued instances compose the scale through the bone
  chain, so the eye glow of a scaled head stays on the head.

`<Lights>` (`LightInstance` → `AnimLight` → `bin/Lights/<uid>`, the Nival
container, 98 files) is deliberately parked: of the 532 effects reachable from
adventure-map objects only 8 carry lights, and most of those are combat spell
hits — on the adventure map it amounts to one dwarven interior. The glow the
player perceives comes from the additive particle textures themselves.

## 3. Layout

All little-endian. Offsets in directories count from **byte 4**.

```
u32   payload size (= file length - 4; one shipped file writes 0)
f32   duration, seconds
f32   sample rate, frames/second
u32   particle count
per particle:
  i16   birth frame  (negative = born before t=0: a pre-warmed loop)
  u16   death frame  (ABSOLUTE frame, not a lifetime)
  5 x { u16 keyCount; u32 offset }     — channel directory, in this order:
        pos, rot, size, color, texframe
then the key blocks, contiguous, in directory order:
  pos      14B  [i16 frame][f32 x][f32 y][f32 z]
  rot       6B  [i16 frame][f32 radians]
  size     10B  [i16 frame][f32 w][f32 h]
  color     6B  [i16 frame][u8 b][u8 g][u8 r][u8 a]    D3DCOLOR order — see below
  texframe  4B  [i16 frame][u16 index]      0xffff = hidden
```

What pinned each piece down:

* **Header**: the size field equals file length − 4 on 1923/1924 files; the
  rate is 30.0 on 98% and the duration divides into the per-particle frame
  numbers.
* **Death is absolute**: read as a lifetime it fails exactly the files whose
  birth is negative — keys land at `life − birth` past the supposed end.
* **Channel shapes**: 90-byte single-particle files are the rosetta — five
  directory entries with keyCount 1, and the blocks between the offsets have
  exactly the widths above. Rotation keys carry π/4 and π/180-scaled values;
  size keys are w/h pairs; colour keys are bytes in **B,G,R,A** order — the
  era's little-endian D3DCOLOR. Read as RGBA every flame in the library tints
  BLUE (campfire averages (215,229,255), the phoenix's bone flames (0,160,255));
  swapped they are the warm oranges fire actually has. The parser presents
  them as RGBA.
* **texframe = index into the instance's `<Textures>`**: across every file
  whose particle doc is referenced by exactly resolvable instances, the
  maximum baked index stays below the instance's texture count (1079 of 1152;
  the rest are multi-instance or carry the oddities below).

Verified invariants (tools/test-effects.ts): blocks contiguous in directory
order, every byte of every file covered exactly once, every key frame inside
its particle's `[birth, death]`.

## 4. Known data oddities (the game shipped them; a renderer clamps)

* 12 files with slightly negative sizes — Maya curve overshoot around zero.
* One file (`4EF44924…`) with `Infinity` sizes.
* One file (`7918369A…`) whose texture indices all carry bit `0x400` on top
  of a plausible frame number — read as `index & 0x3ff` until proven
  otherwise. **[~]**

## 5. How the editor plays it, and what is still simplified

The scene payload carries only each instance's placement, texture table (data
URIs) and uid (`FxInstancePayload`); the keys go over their own IPC (`map:fx`)
as typed arrays — as JSON they doubled the scene payload of one map. The
renderer (renderer/particles.ts) packs the texture table into atlases and
draws each instance as instanced camera-facing quads; a frame update lerps the
alive particles' channels at the loop time and rewrites the attributes. One
shared clock, phases spread per placement so identical objects don't flicker
in lockstep. The static glow card (§2 of the scene resolver) stays underneath
as the pick target and the fallback for anything that fails to decode.

**Blending is NOT guessed — the art has one convention.** Every instance
draws `ONE / ONE_MINUS_SRC_ALPHA` with STRAIGHT colour: a texel's rgb is what
it ADDS and its alpha is what it OCCLUDES. Fire is painted on black with a
zero alpha channel (purely additive), smoke carries real alpha (covers), and
one frame table freely mixes both — the phoenix's fire frames sit next to its
smoke frames in the same instance. Two consequences worth knowing:

* An early blend-per-instance heuristic ("any frame with alpha → normal")
  classified zero-alpha fire as smoke and the alpha gate discarded every
  flame fragment — the fire elemental stood bare while 350 flame particles
  drew nothing.
* Colour under alpha 0 cannot ride a normal PNG through the renderer: a
  browser canvas premultiplies, so the atlas received black where the fire
  was. Each frame therefore ships as TWO images — colour with alpha forced
  opaque, and the real alpha as a grayscale — recombined in the shader.

**The recording is a one-shot, and the loop is a TRIGGER TRAIN.** In 1911 of
1921 files the population ramps from zero and dies back to zero (only 10 have
the pre-warmed negative births) — the baked file is not a loop, it is one
run of the emitter. What keeps a campfire burning is retriggering:

* `<EndCycle>` — the retrigger PERIOD, in playback (real, post-`<Speed>`)
  seconds. A fresh copy of the recording starts every period; the die-out of
  one copy overlaps the ramp-in of the next. The campfire (5.0s recording,
  period 3): a single looping copy dips to ONE alive particle every cycle —
  a fire that dies and relights — where the train holds a steady 35–45. The
  name says "cycle" but the values are seconds — 3.1, 1.83333 — and a period
  LONGER than the recording is meaningful: recording 1.1s, period 7 is a
  puff of smoke every seven seconds, not a loop at all.
* `<CycleCount>` — how many triggers fire; 0 = forever. Adventure-reachable
  instances are 389× `0`, 7× `1`.
* `<Offset>` — delays the train's first trigger (relative timing of the
  instances inside one effect: the splash, then the drips).
* A CLIP-hung effect (a creature's idle) is replayed by the engine with
  every ANIMATION CYCLE, which is what a finite train means there: the
  phoenix's 1118-particle wing whoosh is `CycleCount 1` and fires once per
  flap — and the same effect's looping instance is authored with
  `EndCycle 3.16666`, exactly the idle clip's 3.1666667s, which is what gave
  the mechanism away. The editor restarts a clip effect's finite trains at
  the clip length (`retrigger` on the payload); an OBJECT effect's finite
  train really does play once — a birth flash at map open, then quiet. **[~]**
* Copies alive at once max out at 6 across the adventure-reachable library;
  the renderer keeps one playback slot per concurrent copy (buffers scale by
  the same factor) and caps at 8.

`<WindAffected>` needs no implementing: it is `false` on every effect in the
game's data — there is not one `true` anywhere. Likewise the presets'
`<ParticlesColor>` is `0.25 0.25 0.25` in every preset that has one — an
engine constant already absorbed by the colour stage, not a per-map knob.

`<Light>` on an instance is the one lighting split that varies: `L_LIT`
(163 of the 396 adventure-reachable instances — mostly the falling leaves of
oaks and pines) is tinted by the scene light — the terrain's own gamma-space
sum at full incidence, `2·(amb + sun)` clamped to 1, shared into every system
as a uniform — so leaves darken on a night map while the self-lit (`L_NORMAL`)
fire beside them keeps burning. Daylight presets clamp to white, which is why
nothing changes on a noon map.

Still simplified, in the order they would matter:
* Position space is taken as the instance's local frame before its
  Position/Rotation/Scale (matches how `<Models>` instances behave). **[~]**
* ~~Bone-glued instances sit at the bone's REST pose~~ — **done** (2026-07-28):
  they follow the playing animation, checked by measurement rather than by eye
  (`e2e/glued-effects.spec.ts`: over one beat of the shadow dragon's clip the
  Head-glued glow moves ~0.35 world units while the unglued mist beside it
  moves exactly zero).
* `bin/Lights` (AnimLight flicker curves) — parked, see §2.
