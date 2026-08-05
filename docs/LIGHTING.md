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

**Read out of the code**, at `0x51aa30`–`0x51abb0`, which is the only place in
the executable that multiplies a field by π/180 with Pitch and Yaw beside it:

```
[obj+0xa4] * pi/180      -> pitch in radians
[obj+0xa8] * pi/180      -> yaw in radians
x = cos(yaw) * sin(pitch)
y = sin(yaw) * sin(pitch)
z = -cos(pitch)                  ; xorps with a sign mask at 0x51aba0
```

The two calls are import thunks and the import table names them outright —
`0x94AC04` is `sin`, `0x94ABFE` is `cos`, so there is nothing left to assume.
`z` comes out NEGATIVE, so what that code builds is the direction the light
TRAVELS; the vector above, the one to dot a normal against, is its negation.
Pitch counting from the zenith falls straight out of it too: the sine makes the
horizontal part and the cosine the vertical one.

The same routine does it for **two** presets and weights the results — that is
the light-state crossfade `c30` carries, and it is why a scene can change its
lighting smoothly.

Confirmed independently: under Pitch 35 / Yaw 40 the probe in the running game
reads `vs c35` as `(-0.439, -0.369, 0.819)`, three decimals on all three
components, and a fit over the game's own baked vertices lands on the same
direction at R² 0.999 across four unrelated meshes.

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

## 3b. Shadows — the whole mechanism, measured

Read out of the executable and out of one run of the running game, so the
implementation is not designed on guesses. **Everything marked [OK] is
measured**; §3c is what the editor draws with it.

The short of it: the shadow map is **one texture over the world's ground
plane**, addressed not by the fragment's own column but by its column *sheared
along the sun* — so a lookup is "which sun ray am I on". What it stores is the
HEIGHT of the caster on that ray, in units of `MaxShadowHeight`; a fragment is
in shadow when something on its ray is recorded as higher than itself.

**An object is shaded by TWO baked colours, and the shadow picks between them.
[OK]** The object pixel shader (file offset `0xc77f48` and its family, ps.1.1):

```
tex t0                          ; the texture
tex t1                          ; the shadow map
texcoord t2                     ; where this fragment is in it, and how high
mul_x4_sat r0.rgb, v0, t0       ; SHADOWED colour x texel   (v0 = oD0, see below)
+add_x4_sat r0.a, t1, -t2.z     ; the height test: what the map holds, minus mine
mul_x4_sat r1.rgb, v1, t0       ; LIT colour x texel
+add r0.a, c4, r0               ; ...with a bias
lrp r1.rgb, t1, r1, r0          ; blend the two by the shadow map's rgb
cnd r0.rgb, r0.a, r0, r1        ; ...or take the SHADOWED one outright
+mul r0.a, t0.a, v0.a
```

So a shadow is not "multiply by something dark": it is a **lerp toward a second
colour the vertex already carries**, and a variant of the same shader
(`0xc78190`) does only the lerp with no height test at all.

Read the last two lines together and the two channels of the map turn out to do
different jobs. `lrp` takes the LIT end as the map's rgb rises, so **rgb is the
footprint** — where a caster drew, softly. `cnd` then overrides with the
SHADOWED colour whenever `r0.a > 0.5`, and `r0.a` is `4·sat(map − mine) + c4`:
**alpha is the caster's height**, and it forces full shadow for anything under
it. A back face never triggers the override — the vertex shader adds 1 to its
own height (below), which no map value can beat, so a surface already facing
away from the sun is left to the soft term and cannot shadow-acne itself.

**Both colours come out of the vertex stream, and nothing computes them on the
GPU. [OK]** The vertex shader (`0xc693a4`):

```
mul r4.w, v4.w, c30.y
mad r4.w, v5.w, c30.x, r4.w     ; one weight out of two light STATES (c30)
mul r4.xyz, r4.w, c29           ; c29 = the scene fade, 1 when nothing fades
mul oD0.xyz, v4, r4             ; shadowed
mul oD1.xyz, v5, r4             ; lit
dp3 r5.x, r1, c35               ; the normal against the sun
sge r7.y, -r5.x, c35.w          ; faces away -> 1
dp4 r7.x, v0, c24               ; this fragment's own height, scaled
add oT2, r7.x, r7.y             ; ...+1, so a back face is never overridden
```

and, a few instructions above it in the same shader, the lookup itself:

```
dp4 r8.x, v0, c25               ; u — a row of the projection, world position
dp4 r8.y, v0, c26               ; v
mad r9.xy, r8.xy, r8.xy, c3.z   ; the warp: t -> t.log2(t^2+k)/sqrt(t^2+k)
logp r10, r9.x                  ;   k = c3.z = 7, more texels near the origin
mul r8.x, r8.x, r10.z
logp r10, r9.y
mul r8.y, r8.y, r10.z
rsq r9.x, r9.x
rsq r9.y, r9.y
mul r8.xy, r8.xy, r9.xy
mad oT1.xy, r8.xy, c27.xy, c27.zw   ; scale and bias into the texture
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

**What fills the map. [OK]** Eight vertex shaders in the executable share one
shape (`0xc663c8`, `0xc66798`, `0xc66a28`, `0xc66cd8`, `0xc670d8`, `0xc67358`,
`0xc67728`, `0xc679d8` — warped and plain, colour-out and texcoord-out):

```
dp4 r0.x, v0, c25               ; the same two rows as the lookup
dp4 r0.y, v0, c26
  (the same warp, in the four warped variants)
mad oPos.xy, r0.xy, c27.xy, c27.zw  ; c27 is (2,-2,-1,1) here: into CLIP space
dp4 oPos.z, v0, c17             ; what the z-buffer sorts casters by
dp4 oD0.w, v0, c24              ; and what is STORED: the caster's own height
mov oD0.xyz, c1                 ; rgb: the flat footprint colour
```

Which is the same projection as the lookup, drawn instead of read. `c27` is the
only register that differs between the two passes — `(2, −2, −1, 1)` when the
map is being drawn into (unit square → clip space) and `(1, 1, 0, 0)` when it is
being read. Known because the probe reports a watched register only when its
value CHANGES: `c27` reports twice in a row with those two values, and `c24`,
`c25`, `c26` do not report in between although the uploader (`0x57e260`) sends
all five together. Both passes therefore address the map identically, which is
the point — a lookup is only "which sun ray am I on" if the filler agrees.

**The three rows, out of the running game. [OK]** In A2C1M1, whose preset has
`MaxShadowHeight` 20 and a sun at Pitch 35 / Yaw 40 (`c35` = −0.439, −0.369,
0.819):

| register | value | what it is |
|---|---|---|
| `c24` | 0, 0, **0.050**, 0 | height ÷ `MaxShadowHeight` — 0.05 = 1/20 |
| `c23` | 0, 0, 0.050, 0.010 | the same row with the fill pass's bias |
| `c25` | 0, −0.009, −0.004, 0.910 | u = −0.009·(y + 0.451·z) + 0.910 |
| `c26` | 0.008, 0, 0.004, 0.084 | v = 0.008·(x + 0.536·z) + 0.084 |

**The z terms are the sun.** Projecting a point down its sun ray onto z = 0 is
`x + z·(−Lx/Lz)`, `y + z·(−Ly/Lz)` = `x + 0.536·z`, `y + 0.451·z` for that
sun — which is what the ratios in the rows are, to the thousandth the probe
prints. So the map is a picture of the ground *taken along the sun*, and the two
scales (0.008 and 0.009 here) are it re-fitting itself to what the camera can
see — the same run caught 0.004 and 0.005 in later frames, 125 to 250 world
units across.

**`MaxShadowHeight` is at `+0x134`, and zero means 20** — the fallback is
hard-coded at `0x51b01e`. That single number is the whole vertical range the
map's 8-bit alpha has to spend, which is why it is a preset field at all.

**`ShadowPitch` / `ShadowYaw` = 100 means "follow the sun". [OK]** Not an angle:
`0x51ac98` compares `ShadowPitch` against 100.0 and, on equal, copies the sun
direction computed a few instructions earlier straight into the shadow slot.
Only on any other value does it build a second direction — same π/180, same
sin/cos, same negated z as §2a. 295 of the 308 shipped presets carry 100/100,
and of the 13 that do not, `TestProg` carries 40/80 with a sun of 40/80.
Reading 100 as degrees would have tilted every shadow on every shipped map.

Also carried by the preset and unread: `ShadowColor` (0,0,0 on all 308 — a
default that discriminates nothing, and `mov oD0.xyz, c1` in the fill pass is
where it would land), `GroundAmbientColor` (0,0,0 on all 308 likewise),
`ShadowsMaxDetailLength` 10, and the cloud shadows (`CloudTex`, `CloudSize`,
`CloudDir`, `CloudSpeed`, and `CCopyShadowsAndCloudsEffect`) — those ride in the
same map's rgb, which is the channel the editor does not fill. Materials say who
takes part, and the flags discriminate: `CastShadow` true on 10062 of 11639,
`ReceiveShadow` on 10156 — while `BackFaceCastShadow` is false on all 11639 and
therefore answers nothing.

## 3c. What the editor draws instead **[OK]**

`renderer/viewport/shadows.ts`. The MECHANISM above is reproduced; the
parametrisation is not, and the difference is deliberate.

Reproduced: the direction (the preset's, sentinel resolved), the question asked
per fragment ("is anything on my sun ray above me"), and — the part that shows —
what a shadow DOES to a surface. It substitutes: the same three-way mix runs a
second time with `IncidentShadowColor` where `LightColor` was, and the fragment
takes one or the other. Objects go through `gameLit` in
renderer/viewport/materials.ts, the ground and the ground-projected parts
through the splat's own shaders, and all three sample one map.

Not reproduced: the sheared top-down parametrisation, its 8-bit depth over
`MaxShadowHeight`, its logarithmic texel warp (`c3.z` = 7), and the map's rgb
footprint channel with the cloud shadows in it. A shear that turns the map's u/v
into "which sun ray" is exactly what an ordinary light-space shadow map already
is, so three.js's `DirectionalLight` shadow is the same map with even texels —
and it brings the alpha test for foliage, skinning and instancing along, none of
which a hand-rolled pass would have. The 8-bit depth and the warp are the
engine's precision budget, not its picture.

The EDGE is hard, and that is a decision rather than a default. The engine takes
one sample of the map and decides with `cnd`: lit or shadowed, nothing between.
Soft PCF went in first and Senya caught it against the game's own picture — nine
taps of blur the engine never draws. (It does have a soft term, the map's rgb
footprint sampled bilinearly, but that is the channel the cloud shadows ride in
and the one not filled here.)

Kept, though: the map re-fits itself to what the camera can see, which is what
the engine does too (the probe caught its own 125 and then 250 units across in
one run). Ours is 1.6× the view's half-extent, clamped to 40–400 world units, so
a 2048 map spends its texels where the work is. A fixed size fails visibly in
both directions — shadows stopping at a circle around the orbit target, or a
tree drawn with four texels.

Also not reproduced, and worth knowing when a shadow looks wrong: the engine
decides caster and receiver per MATERIAL and our decoder does not read those
flags, so everything drawn does both — except the terrain and the water sheet,
which receive only. A heightfield casting into a map indexed along the sun
shadows itself down every slope, and the ground's own `max(N·L, 0)` already
darkens what faces away.

Verified in `e2e/shadows.spec.ts`, by the only measurement that can fail
usefully: the same frame with the pass on and off, differing only where a shadow
was drawn, and the objects' own screen positions slid over that difference to
find the offset that overlaps best. That offset is the direction — and reading
it by eye instead got it backwards twice in one sitting.

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
* `npx playwright test shadows` — that shadows are drawn at all, and which way
  they fall. On/off frames of the same plan view differ only where the pass
  darkened something; the objects' own screen positions (the plan camera is
  orthographic about a named target, so the mapping is exact) are slid over that
  difference and the best-overlapping offset is the direction. It lands 5° off
  the preset's sun on A2C1M1. Checked by sabotage: flipping the sign of the
  direction in `shadows.ts` takes the agreement from +0.995 to −0.945.
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
