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
albedo · (Ambient + Light·N·L) · Whitening,   clamped to 1
```

multiplied in **gamma space on the raw texel** — no sRGB decode going in, no
encode coming out. The multiplier is a **constant ×4**, written into the
ps.1.1 shaders as an instruction modifier rather than into any constant:

```
mul_x4_sat r0.rgb, v0, t0    ; texel × lit vertex colour, ×4, clamped
mul_x4_sat r1.rgb, v1, t0    ; same for the shadowed colour
lrp r0.rgb, t1, r1, r0       ; picked by the shadow map
```

Two earlier readings — a ×2, then the preset's `<Whitening>` switch (2 on,
1 off) — both render a dusk where the game shows noon. Measured on two
screenshot pairs of the same spots: the Sharpshooter map (default preset,
`Whitening=false`) has the editor at `tex·0.83` under ×2 against the game's
`tex·1.66`, exactly the missing doubling; C1M1's day scene puts tree
backsides at `amb·4 = 0.75` — the game's bright canopy — where ×2 gave 0.38.
The ×4 also dissolves §6's old "the game ignores dark presets" puzzle: the
Inferno arena preset's 0.345 ambient SATURATES to 1 under ×4, so most "dark"
presets look daylit in the game too, while the two all-zero presets (the one
case the game visibly darkens) stay black under any multiplier. What
`<Whitening>` actually switches is still unidentified; it is not this factor.
The ps.2.0 object shader's `c7.x` is presumably set to the same 4 at runtime
— unverified, a probe hooking SetPixelShaderConstantF would settle it.

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
around +Z from +X, counter-clockwise:

```
sunDir = (sin(Pitch)·cos(Yaw), sin(Pitch)·sin(Yaw), cos(Pitch))
```

Measured, not judged by eye. For Pitch 35 / Yaw 40 the editor computes
`(0.439, 0.369, 0.819)`; the probe in the running game read `vs c35` as
`(-0.439, -0.369, 0.819)` under the same preset — the same vector, negated,
because the engine hands the shader the direction light TRAVELS and the shader
uses `-(N·c35)`. Three decimals, all three components. This was `[~]` until
that run.

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
