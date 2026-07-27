# Map lighting (`Lights/_(AmbientLight)`, map `pointLights`, `bin/Lights`) — notes

Status: **the per-map ambient preset is read and applied, and the designers'
point lights pool on the ground.** The editor lights a map with the map's own
preset — sun colour and direction, ambient and shade — and bakes the ~hundreds
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

## 2. The gamma trap: why GAIN is 2^2.2 and not 2 **[OK]**

The game's fixed-function pipeline multiplies colours in **gamma space** —
`albedo · (Ambient + Light·N·L) · 2`, the era's modulate-×2 (`Whitening`) —
while three.js lights in linear space. Multiplication commutes with a pure
power transfer function, so a gamma-space factor k is a linear-space factor
k^2.2: the honest ×2 renders every day map as dusk, and the editor's three.js
lights run at `2^2.2 ≈ 4.6` instead.

The terrain does not go through three.js lighting at all — the splat shader
works on raw (gamma) texture values, so it gets the game's own formula
verbatim: `col · (uAmb + uSunCol·|N·sunDir|) · 2`, with the preset colours
passed in raw. Same for the terrain-projected building mounds, which must
shade exactly like the ground they borrow their texture from. Arithmetic
cross-check on A1C1M1 plan view: measured tile brightness matches
`tile × (amb + sun·0.82) × 2` to within the mixed-tile noise. The three
uniforms are shared objects mutated in place (`uSunDir`/`uSunCol`/`uAmbCol` in
renderer/app.ts), so a floor switch recolours every terrain material without
touching it.

How the four colours map onto three.js lights: sun = `LightColor` from its
Pitch/Yaw; hemisphere = `AmbientColor` (sky side) down to `ShadeColor` (the
underside reaches the faces the game paints with shade); plus a small constant
floor so decoded props with broken normals never go black.

## 3. Sun direction **[~]**

`Pitch` counts from the **zenith**, not the horizon: presets carry 35–50, and
read as elevation those made flat ground catch barely half the sun — every
shipped day map rendered as dusk. `Yaw` is taken as degrees around +Z from +X,
counter-clockwise. The pitch reading is backed by the brightness arithmetic
(§2); which axis yaw counts from, and which way it turns, has no reachable
ground truth yet — judged by eye against the game.

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

* `npx playwright test ambient-light` — the real app: opening A1C1M1 turns the
  preset's exact colours up in `view.ambientState()` (terrain uniforms raw,
  three.js sun converted), with the sun unit-length at the pitch/yaw the
  preset names; before any map, the fallback look. Skips itself without the
  game data.
* `npx playwright test point-lights` — opening A2C1M2 and switching to the
  underground bakes its 68 lights; asserted on the LIT AREA, not just a flag,
  because the texel count scales with radius² and a misread unit would move
  it 4× — `view.pointLights()`.
* The gamma reasoning and the zenith reading of Pitch are checked by
  arithmetic against measured pixels (§2), not by a test — a change to either
  shows up as every day map rendering dark, which is exactly what both bugs
  looked like.
