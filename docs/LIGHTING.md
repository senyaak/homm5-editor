# Map lighting (`Lights/_(AmbientLight)`, map `pointLights`, `bin/Lights`) — notes

Status: **the per-map ambient preset is read and applied, everything is lit by
the game's own sum, and the designers' point lights pool on the ground.** The
editor lights a map with the map's own preset — sun colour and direction, ambient and shade — and bakes the ~hundreds
of per-object point lights a map carries (the violet glow under an underground
crystal) into a lightmap the terrain adds on top. Point lights inside effects
(`AnimLight` → `bin/Lights`) are located but not yet decoded; they are part of
the effects work — and they are the SMALL mechanism (§4), not this one.

Confidence: **[OK]** = verified against a redundancy in the data · **[~]** =
strong heuristic, not yet proven.

## 1. Where a map's light comes from **[OK]**

```
map.xdb → <GroundAmbientLights>      <Item href="/Lights/_(AmbientLight)/AdvMap/C1M1.xdb …">
          <UndergroundAmbientLights> <Item/>            (often empty underground)
```

Each floor names its own preset — surface day, underground dark. Both are
lists, but every shipped map carries at most one usable entry, so the first
`<Item>` with an href is the answer (`HommMap.ambientLightRef`). A map that
names none, or names a missing file, falls back to the stock
`0_Default_AmbientLight.xdb`; if even that is unreadable the editor keeps its
old hard-coded look, so lighting can never make a map unopenable.

The preset itself is plain XML. What the editor reads:

| field | meaning |
|---|---|
| `LightColor` | the sun — colour of surfaces it reaches |
| `AmbientColor` | what every surface receives regardless of facing |
| `ShadeColor` | colour of surfaces facing *away* from the sun |
| `Pitch`, `Yaw` | sun direction, degrees — see §3 |

Colours are 0..1 floats, authored dim (a midday sun is ~0.55) — see §2 for why
that is not dim at all. The preset also carries fog, vapour, bloom and gloss
settings the editor does not attempt, and a `<Sky>` cubemap that is **not a
sky**: every adventure preset points it at `/Textures/RefMaps/`, six blurred
highlight blobs for glossy REFLECTIONS. Drawn as a background they look like
lens flares pasted on the void — the game's adventure camera never shows a sky,
and the editor keeps its neutral backdrop. **[OK]**

## 2. One light model, in gamma space **[OK]**

Every surface the game draws ends the same way:

```
albedo · 2 · mix,   clamped to 1

mix = Ambient + max(N·L, 0)·(Light − Ambient) + max(−N·L, 0)·(Shade − Ambient)
```

multiplied in **gamma space on the raw texel** — no sRGB decode going in, no
encode coming out.

**`LightColor` is not a term added to ambient.** It is the colour a surface
facing the sun is turned INTO, `ShadeColor` is the colour of one facing away,
and `AmbientColor` is the middle — a mix between three of the preset's fields,
not a sum of two. The shadowed twin of the same vertex (§3b) is the identical
mix with `IncidentShadowColor` in `LightColor`'s place.

**How that is known**, and it is a measurement, not a model. The engine bakes
this colour per vertex on the CPU at load and writes it into the vertex buffer,
so a probe that hooks `IDirect3DVertexBuffer9::Lock`/`Unlock` and dumps every
range the engine writes can read the answer straight out
(`_tmp/probe/homm5-editor.c`, `_tmp/vbscan.ts`). From a 5 GB dump, 390,000
shaded vertices were fitted against `Flat + Toward·max(N·L,0) + Away·max(−N·L,0)`
over a grid of directions. The best direction is Pitch 35 / Yaw 220 at
**R² 0.999–1.000**, and every coefficient lands on a preset field **to the
byte**:

| fitted term | bytes | preset field | bytes |
|---|---|---|---|
| Flat (N·L = 0) | 66 70 89 | `AmbientColor` | 66 70 89 |
| at N·L = −1 | 65 113 129 | `ShadeColor` | 65 113 129 |
| at N·L = +1, shadowed slot | 37 46 69 | `IncidentShadowColor` | 37 46 69 |
| at N·L = +1, lit slot | 53 64 83 | `LightColor` | 53 64 83 |

Checked against data the fit never saw: flat ground (normal +Z, N·L = 0.819)
must come out 42/50/73 shadowed and 55/65/84 lit, and those are the bytes the
buffer holds for flat ground.

**What this replaced, and why it was wrong for a year.** The old reading was
`albedo · min(4·(Ambient + Light·N·L), 2)`: no `ShadeColor` term at all, and a
cap that every day preset drove straight into, so the brightest thing on screen
and a merely bright thing came out the same white. It survived because it was
tuned against screenshots until the *level* matched, and a wrong structure with
a fitted constant can match a level. The lesson is the one this file keeps
learning: fit against the engine's own numbers, and check the fit on a case it
was not fitted to.

The multiplier is **×4**, and the preset's `<Whitening>` flag does not reach it
— what that switch does is still unidentified. The chain, measured from both
ends:

* The CPU writes the mix into the vertex as a **plain byte**: `AmbientColor`
  arrives as its own 66/70/89, undoubled.
* The vertex shader scales it by `c29`, and **c29 is not a constant.** One probe
  run caught it at 0.5 and this document called it "the halving" for a year; the
  run that settled the mix caught it at **1.000, 0.564, 0.220 and 0.500 in one
  session** — it is the scene FADE, and its steady state on a map is 1. Taking
  one sample of a moving value as a constant made the editor render every map at
  half the game's brightness, and it took Senya one look at a screenshot to say
  so. The instruction is `mul r4.xyz, r4.w, c29;
  mul oD0.xyz, v4, r4`, where `r4.w` is the vertex's own weight. §2a of this
  same document had **already written down** that c29 "sweeps 1.0 → 0.564 →
  0.220 — a fade, not a colour", and §2 went on using 0.5 as a constant anyway.
  Two sections of one file disagreed for a year and neither was checked against
  the other.
* The ps.1.1 pixel shader multiplies by **four** — as an instruction modifier,
  not a constant — and clamps:

```
mul_x4_sat r0.rgb, v0, t0    ; texel × lit vertex colour, ×4, clamped
mul_x4_sat r1.rgb, v1, t0    ; same for the shadowed colour
lrp r0.rgb, t1, r1, r0       ; picked by the shadow map
```

Net: `mix · 4`, saturated. A2C1M1's lit ground runs ×1.42 and clips while its
shaded side runs ×0.75 — a bright floor with real shading on what faces away,
which is the shape of the game's own picture. The independent check is
photometric and predates all of this: the Sharpshooter map measured `tex·1.66`
in the game against a mix of 0.415, and 4 × 0.415 = 1.66. The probe run
also shows **no SetPixelShaderConstantF ever touches c7** — the ps.2.0 object
shader with `c7.x`, quoted in earlier revisions of this section, is not the
path the game runs.

That is read out of the executable rather than guessed. The shipped shaders are
embedded in it as **assembler text**, 115 of them, assembled at run time by
`d3dx9_25.dll` — scan for the `vs.1.1` / `ps.2.0` blocks and they read out
whole. The object one, with its shadow-map lookup trimmed away:

```
texld r2, t0, s0          ; the texture
mul   r3, v0, r2          ; × the LIT vertex colour
mul_sat r0, r3, c7.x      ; × Whitening, clamped
mul   r1.rgb, v1, r2      ; × the SHADOWED vertex colour
mul_sat r1.rgb, r1, c7.x
lrp   r1.rgb, r4, r1, r0  ; pick between them by the shadow map
```

Two interpolated colours per vertex, a lit one and a shadowed one, each
multiplied by the texel and by `c7.x`, each clamped. The terrain shader is the
same shape with the two colours coming from vertex attributes `v4`/`v5`.

The editor runs that sum for **everything**: the terrain splat always did, and
since 08.2026 so do objects, actors and props (`gameLit` in
renderer/viewport/materials.ts patches the end of three.js's fragment shader
rather than replacing the material, so skinning and instancing survive). The
uniforms `uSunDir`/`uSunCol`/`uAmbCol`/`uWhiten` are shared objects mutated in
place, so a floor switch recolours every material without touching one.

**Why it cannot be left to three.js.** three.js lights in LINEAR space, and
against a gamma-authored preset that is not a brightness difference but a
colour one. The Inferno arena's sun, `0.635/0.267/0.141`, decodes to
`0.361/0.058/0.018`: the green channel loses a factor of four and a warm sun
becomes a red one. C1M1's knights came out salmon-pink over ground that was
fine, because the ground already ran this sum and they did not. The old
workaround — three.js lights at `2^2.2 ≈ 4.6`, so that a gamma ×2 came out
right after the linear round trip — fixed the level and could not fix the hue.

## 2a. What the running game says **[OK]**

A throwaway DLL (a scratch copy of `native/homm5-editor.c`, never committed)
patched the D3D9 device vtable and watched a whole play-through of C1M1's
opening scene. It reports:

| watched | answer |
| --- | --- |
| `D3DRS_LIGHTING` | **0** — Direct3D's own lighting is off |
| `SetLight`, `SetMaterial` | never called, not once |
| `D3DRS_AMBIENT` | never set |
| every vs/ps constant, searched for the preset's exact numbers | **no colour of any preset ever arrives** |
| `vs c35` | the sun DIRECTION does arrive |
| `vs c29` | a grey scalar that sweeps 1.0 → 0.564 → 0.220 — a fade, not a colour |

So the two vertex colours are computed by the engine on the CPU, at load, and
written into the vertex buffer; only the direction and the fade travel as
constants. The formula above is therefore the END of the pipeline, proven, and
the per-vertex term is inferred from it rather than read.

One trap worth remembering: the hunt first "found" `AmbientColor` in `c29` and
in `ps c0`. That preset's ambient is grey (0.345×3) and matched a fade scalar
passing through it. A grey triple identifies nothing — only the colours whose
channels differ can answer where a preset went.

## 3. Sun direction **[OK]**

`Pitch` counts from the **zenith**, not the horizon, and `Yaw` is degrees
around +Z, counted from **−X** — half a circle away from the obvious reading:

```
sunDir = (−sin(Pitch)·cos(Yaw), −sin(Pitch)·sin(Yaw), cos(Pitch))     toward the light
```

Measured, not judged by eye. Under Pitch 35 / Yaw 40 the probe in the running
game reads `vs c35` — the vector the object shader dots the normal against — as
`(-0.439, -0.369, 0.819)`, three decimals on all three components.

**The half-circle was missed once, and the way it was missed is the lesson.**
Sin and cos of the preset give `(+0.439, +0.369, +0.819)`; the run above was
read as "the same vector, negated, because the engine hands the shader the
direction light TRAVELS". Two of three signs fit that story and the third
refutes it: **z does not flip**. A light travelling with z UP is a sun below the
ground. The shader settles it on its own — `dp3 r5.x, r1, c35` then
`sge r7.y, -r5.x, c35.w`, "the normal points away from c35, so mark it
shadowed", only reads as sense if c35 points AT the light. So the elevation was
right all along and the azimuth was pointing the opposite way, on 62 of the 73
adventure presets at once (Pitch 35 / Yaw 40 is nearly the whole corpus — the
sun is the same on almost every shipped map). Senya caught it from the picture:
"in the game the light has never once come from anywhere but the north."

Matching magnitudes to three decimals is not a match. Check every sign.

## 3a. Designer point lights (`<pointLights>` on placed objects) **[OK]**

Where the light a player actually notices lives. Every placed object in
`map.xdb` may carry a `<pointLights>` list:

```
<AdvMapStatic>
  <pointLights>
    <Item>
      <Pos><x>0</x><y>0</y><z>6</z></Pos>       world units, see below
      <Color><x>0.78</x><y>0.26</y><z>1</z></Color>
      <Radius>20</Radius>
    </Item>
  </pointLights>
  <Shared href=".../Subterra/Crystal03.(AdvMapStaticShared).xdb ..."/>
```

That Item is the violet pool under an underground crystal. Counted across the
shipped maps: **~10,800** of these (A2C3M1 alone has 546; C5M5 401) — against
8-of-532 effects with an `AnimLight`. While reverse-engineering "light" we
stared at presets and effects; the designers' light was sitting in the map
file itself.

Readings, and what backs them:

* **Everything is world units.** The z values (3–6 over crystals and mine
  torches) match the models' world-unit heights, and a single `<Pos>` vector
  does not mix units.
* **The offset is in MAP axes, not the object's.** The same mine placed at
  Rot 0 and Rot 3π/2 stores offsets differing by exactly that rotation — the
  original editor baked the rotation in when the designer dragged the light,
  and the engine adds the vector as-is. So does ours.
* **Falloff [~]:** the game's own attenuation curve is unmeasured; the editor
  uses `(1 − d/r)²`, which reads as a soft pool with no hard rim. `d` is true
  3D distance to the ground (the light's height narrows its pool).

How the editor draws them (renderer/app.ts, `bakeLightMap`): hundreds of
lights per map is beyond what three.js light objects can carry, and they only
move when their object does — so each floor bakes its lights into one RGBA
texture over the ground plane (4 texels per tile side), and the terrain and
projected-mound shaders add the sample to the game's own sum:
`col · (uAmb + uSunCol·|N·L| + lightmap) · 2` — the baked colours join in the
same gamma space the rest of the formula runs in. Moving or deleting a
light-carrying object marks the floor dirty and the render loop re-bakes,
throttled to 4 Hz so a drag stays smooth.

Still simplified:

* **Objects standing in a pool are not tinted by it** — the pool on the
  ground is what reads as "the crystal glows"; the game also brightens the
  props around it.
* Map-level `<PointLights>` (named, e.g. `undead_light2`) exist in 5 maps and
  are script-driven — their stored positions are placeholders, so drawing
  them would light the wrong place. Ignored.
* New objects placed from the palette carry no lights yet (the palette's
  Shared templates have none — the shipped maps' designers added them by
  hand); a lights editor is Phase 4 property-panel work.

## 3b. Shadows — what is measured so far, and what is still open

The editor draws none yet. This records the mechanism as it has been read out of
the executable and the running game, so the implementation is not designed on
guesses. **Everything marked [OK] here is measured; the open question is named
at the end and is not to be filled in by plausibility.**

**An object is shaded by TWO baked colours, and the shadow picks between them.
[OK]** The object pixel shader (`0xc78694` and its family, ps.1.1) is:

```
tex t0                          ; the texture
tex t1                          ; the shadow map
texcoord t2                     ; where this fragment is in it, and how deep
mul_x4_sat r0.rgb, v0, t0       ; LIT colour x texel
+add_x4_sat r0.a, t1, -t2.z     ; the depth test: map depth vs this fragment's
mul_x4_sat r1.rgb, v1, t0       ; SHADOWED colour x texel
+add r0.a, c4, r0               ; ...with a bias
lrp r1.rgb, t1, r1, r0          ; blend the two by the shadow map's rgb
cnd r0.rgb, r0.a, r0, r1        ; ...or take the lit one outright if in front
+mul r0.a, t0.a, v0.a
```

So a shadow is not "multiply by something dark": it is a **lerp toward a second
colour the vertex already carries**, and a variant of the same shader
(`0xc781f4`) does only the lerp with no depth test at all.

**Both colours come out of the vertex stream, and nothing computes them on the
GPU. [OK]** The vertex shader (`0xc693a4`):

```
mul r4.w, v4.w, c30.y
mad r4.w, v5.w, c30.x, r4.w     ; one weight out of two light STATES (c30)
mul r4.xyz, r4.w, c29           ; c29 = the scene fade, 1 when nothing fades
mul oD0.xyz, v4, r4             ; lit
mul oD1.xyz, v5, r4             ; shadowed
dp3 r5.x, r1, c35               ; the normal against the sun
sge r7.y, -r5.x, c35.w          ; faces away -> 1
dp4 r7.x, v0, c24               ; depth in the shadow map's plane
add oT2, r7.x, r7.y             ; ...so a back face never lights itself
```

**The runtime vertex, read from the declaration in the running game. [OK]**
Stride 32, six elements:

| offset | type | declared as | what it is |
|---|---|---|---|
| 0 | FLOAT3 | position0 | position |
| 12 | D3DCOLOR | normal0 | normal, unbiased by `v·2.008 − 1.008` (c3) |
| 16 | SHORT2 | texcoord0 | the diffuse UV |
| 20 | SHORT2 | texcoord1 | the second UV set |
| 24 | D3DCOLOR | tangent0 | **the SHADOWED colour** (`oD0`, the ps's `v0`) |
| 28 | D3DCOLOR | tangent1 | **the LIT colour** (`oD1`, the ps's `v1`) |

Which of the two is which was read backwards at first, from the register names
alone. The data settles it: the +28 slot fits `LightColor` and +24 fits
`IncidentShadowColor` (§2), and the pixel shader agrees — `cnd` takes `v0` when
the fragment sits BELOW the height the shadow map recorded, which is what being
inside a shadow means. So `lrp r1.rgb, t1, r1, r0` lerps from shadowed toward
lit as the shadow texture rises: **t1 = 0 is full shadow, t1 = 1 is full sun.**

The two colours ride in the slots a tangent basis would use, and they are typed
`D3DCOLOR` — they are colours, not directions. That is worth holding beside
[GEOMETRY_FORMAT.md](GEOMETRY_FORMAT.md) §5: the FILE's render vertex really
does carry a normal and a real tangent basis, and the engine keeps the normal
and the two UVs and **writes the baked light over the tangent slots** at load.
Our decoder read the first of those slots as the normal for months.

**What draws it.** Every object in a scene draws out of one 26 MB
`D3DPOOL_DEFAULT`, dynamic, write-only vertex buffer.

**What the CPU puts in those two colours — answered, §2.** Both are the same
three-way mix; they differ only in which field the sun end of it reaches, and
the editor now runs the lit one. The field offsets in `CAmbientLight`, read out
of the reflection table at `0x9bdd00`, in case another of them is wanted:
`LightColor` +0x64, `AmbientColor` +0x70, `ShadeColor` +0x7c,
`IncidentShadowColor` +0x88, `GroundAmbientColor` +0x128, `ShadowColor` +0xfc.

**Still open: the shadow texture itself** — what draws into it, at what
resolution, and how `MaxShadowHeight` bounds it. The vertex shader's
`dp4 r7.x, v0, c24` and the `c25`/`c26` pair say the lookup is a **top-down**
projection of world x/y with the fragment's HEIGHT as the compared depth, which
is why the shadow map's alpha reads as "the height up to which this column is
shadowed". That is the next thing to measure, and the editor's own
`bakeLightMap` — a per-floor texture over the ground plane — is the shape the
implementation will take.

Also carried by the preset and unread: `ShadowPitch`/`ShadowYaw` (100/100 where
the sun is 35/40 — a separate direction), `ShadowColor`, `MaxShadowHeight` 20,
`ShadowsMaxDetailLength` 10, and the cloud shadows (`CloudTex`, `CloudSize`,
`CloudDir`, `CloudSpeed`, and `CCopyShadowsAndCloudsEffect`). Materials say who
takes part, and the flags discriminate: `CastShadow` true on 10062 of 11639,
`ReceiveShadow` on 10156 — while `BackFaceCastShadow` is false on all 11639 and
therefore answers nothing.

## 4. Not the map view's problem

* `PWLpic.dds` next to a map is its **loading screen**, a staged cinematic —
  not a render of the adventure view, and useless as a lighting reference
  (bright noon grass on maps whose tiles are all DarkGround/Dead_Land).
* Arena lighting (`ArenaDesc` → its own AmbientLight with real sky cubemaps)
  is combat-screen territory, untouched.
* `bin/Lights/<uid>` (98 files) is the Nival record container behind an
  effect's `AnimLight` — time-keyed curves, by the look of the floats a
  flicker of colour/intensity. Decoding it belongs to the effects work.

## 5. Verification

* `npx playwright test object-light` — the sum itself, by arithmetic.
  `view.shadeProbe(albedo, normal)` draws ONE known albedo under ONE known
  normal into a 1x1 target and reads the pixel back; the test computes what the
  loaded preset says it should be and compares. Every term separates: a normal
  facing away isolates Ambient, halving the albedo must halve the pixel (which
  it would not in linear space), and a white albedo proves the clamp. Checked
  by sabotage both ways — dropping `Whitening` moves a channel by 65, decoding
  the texture as sRGB moves it by 74.
* `npx playwright test ambient-light` — the handoff: opening A2C1M1 turns the
  preset's exact colours up in `view.ambientState()`, raw, with the sun
  unit-length at the pitch/yaw the preset names; before any map, the fallback
  look. Skips itself without the game data. (It named A1C1M1 until 08.2026 — a
  path that is not in the unpacked data, so it had been skipping itself on
  every run instead of checking anything.)
* `npx playwright test point-lights` — opening A2C1M2 and switching to the
  underground bakes its 68 lights; asserted on the LIT AREA, not just a flag,
  because the texel count scales with radius² and a misread unit would move
  it 4× — `view.pointLights()`.
* The shape of the sum and the sun direction are read out of the executable and
  out of the running game (§2, §2a) rather than tested here: no change in the
  editor can alter what the game does, so there is nothing for a test to guard.
