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
  absent beats at-the-feet. The composition is the REST pose — with the idle
  animation playing the glow does not ride the swaying head. **[~]**
* Colour bytes are authored around **128 = full brightness** (the era's
  modulate-×2 stage, the same one the terrain lighting has): the ghost
  dragon's mist peaks at 57 and rendered near-black under a plain modulate.
  The renderer doubles the colour term (not alpha); saturated effects
  (campfires at 255) just clamp where they already clamped.

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
  color     6B  [i16 frame][u8 r][u8 g][u8 b][u8 a]
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
  size keys are w/h pairs; colour keys are RGBA bytes (a fire effect's are
  orange).
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
renderer (renderer/particles.ts) packs the texture table into one atlas and
draws each instance as instanced camera-facing quads; a frame update lerps the
alive particles' channels at the loop time and rewrites the attributes. One
shared clock, phases spread per placement so identical objects don't flicker
in lockstep. The static glow card (§2 of the scene resolver) stays underneath
as the pick target and the fallback for anything that fails to decode.

Still simplified, in the order they would matter:

* Blending is guessed from the art: any frame with real alpha → normal
  blending, none → additive (fire on black adds; smoke with alpha blends).
  One mode per instance, though a table mixes both kinds. **[~]**
* The instance's `<Offset>`, `<EndCycle>`/`<CycleCount>` (loop windows) and
  `<WindAffected>` are ignored; `<Speed>` is applied as a time scale.
* Position space is taken as the instance's local frame before its
  Position/Rotation/Scale (matches how `<Models>` instances behave). **[~]**
* Bone-glued instances sit at the bone's REST pose; they do not follow the
  playing idle animation. **[~]**
* Particles are unlit sprites; the game's `L_LIT` instances (163 of 2723)
  would be tinted by scene light, and `ParticlesColor` of the ambient preset
  is not applied.
* `bin/Lights` (AnimLight flicker curves) — parked, see §2.
