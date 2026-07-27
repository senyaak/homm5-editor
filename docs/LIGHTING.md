# Map lighting (`Lights/_(AmbientLight)`, `bin/Lights`) — notes

Status: **the per-map ambient preset is read and applied.** The editor lights a
map with the map's own preset — sun colour and direction, ambient and shade —
instead of one hard-coded look for every map. Point lights inside effects
(`AnimLight` → `bin/Lights`) are located but not yet decoded; they are part of
the effects work.

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
* The gamma reasoning and the zenith reading of Pitch are checked by
  arithmetic against measured pixels (§2), not by a test — a change to either
  shows up as every day map rendering dark, which is exactly what both bugs
  looked like.
