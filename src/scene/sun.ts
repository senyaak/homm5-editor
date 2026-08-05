// Where a lighting preset's sun is, from its two angles.
//
// Its own module because BOTH sides of the renderer need it — the shading
// (viewport/lighting.ts) and the shadow pass (viewport/shadows.ts) — and those
// two reading the angles apart is the one way they could ever disagree about
// where the light is. `ambient.ts` would have been the natural home, but that
// one reads files; the renderer bundle cannot import `node:fs`.

/**
 * A unit vector pointing AT the light.
 *
 * `Pitch` counts from the ZENITH — 35 is a high sun, not a low one — which is
 * read out of the code at `0x51aa30`, where the sine makes the horizontal part
 * and the cosine the vertical one. Reading it as elevation renders every
 * shipped day map as dusk.
 *
 * `Yaw` counts from **−X**, which is what the probe read out of the running
 * game (`vs c35` = (−0.439, −0.369, 0.819) under Pitch 35 / Yaw 40 — see
 * docs/LIGHTING.md §3). On a map drawn with +X east and +Y north that stands
 * the light in the SOUTH-WEST and drops the shadows to the north-east, which is
 * where they belong in the editor's picture.
 *
 * Both alternatives were tried against that picture and both were wrong: the
 * plain yaw-from-+X lights from the north-east and throws shadows south-west,
 * and a clockwise yaw (mirrored y) lights from the south-east and throws them
 * north-west.
 */
export function sunDirection(pitchDeg: number, yawDeg: number): [number, number, number] {
  const p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  return [-Math.sin(p) * Math.cos(y), -Math.sin(p) * Math.sin(y), Math.cos(p)];
}
