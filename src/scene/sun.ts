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
 * `Yaw` counts from **+X**, CLOCKWISE seen from above — so on a map drawn with
 * +X east and +Y north, Yaw 40 puts the light in the south-east and drops the
 * shadows to the north-west, which is what the game shows.
 *
 * The y flip is the whole difference from the naive reading, and it is not a
 * turn: the two axes disagree, not the angle. Read anticlockwise, the same 40
 * lands north-east. Half a turn was tried too (a yaw from −X, on the strength
 * of `vs c35` reading (−0.439, −0.369, 0.819) in the running game — see
 * docs/LIGHTING.md §3) and lit maps from the north. Which of the two ends is
 * being misread — the constant's frame, or which way the editor lays the map's
 * y axis on the screen — is not settled yet.
 */
export function sunDirection(pitchDeg: number, yawDeg: number): [number, number, number] {
  const p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  return [Math.sin(p) * Math.cos(y), -Math.sin(p) * Math.sin(y), Math.cos(p)];
}
