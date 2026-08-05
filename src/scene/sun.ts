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
 * `Yaw` counts from **+X**, the plain reading — the light comes from the south.
 * It was turned half a circle here for a while, on the strength of `vs c35`
 * reading (−0.439, −0.369, 0.819) in the running game (docs/LIGHTING.md §3),
 * and against the app's own picture beside the game that was the wrong side.
 * Which of the two is being misread is not settled yet.
 */
export function sunDirection(pitchDeg: number, yawDeg: number): [number, number, number] {
  const p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  return [Math.sin(p) * Math.cos(y), Math.sin(p) * Math.sin(y), Math.cos(p)];
}
