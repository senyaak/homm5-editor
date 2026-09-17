// The ground under a point, off the height plane — the one interpolation the
// terrain mesh, the object anchors and the draping shader all share.

/**
 * Height of the ground at grid coordinates (gx, gy), in vertices, as the
 * terrain mesh draws it: each cell is two triangles split along the
 * (x+1, y)–(x, y+1) diagonal (renderer/viewport/terrain-mesh.ts), and the
 * same two triangles are what renderer/viewport/drape.ts evaluates on the
 * GPU. Bilinear would be smoother and wrong — it puts a point between the
 * two triangles' planes, and an object anchored there floats or sinks by the
 * difference on any cell whose diagonal corners differ.
 *
 * Cut cells (a change of tier, drawn as two flat sides and a wall) are the
 * one place this and the mesh disagree; the mesh's wall is its own.
 */
export function groundHeight(heights: ArrayLike<number>, V: number, gx: number, gy: number): number {
  const cx = Math.max(0, Math.min(V - 1, gx)), cy = Math.max(0, Math.min(V - 1, gy));
  const fx = Math.floor(cx), fy = Math.floor(cy);
  const tx = cx - fx, ty = cy - fy;
  const at = (x: number, y: number): number => heights[Math.min(V - 1, y) * V + Math.min(V - 1, x)]!;
  const h00 = at(fx, fy), h10 = at(fx + 1, fy), h01 = at(fx, fy + 1), h11 = at(fx + 1, fy + 1);
  return tx + ty <= 1
    ? h00 + tx * (h10 - h00) + ty * (h01 - h00)
    : h11 + (1 - tx) * (h01 - h11) + (1 - ty) * (h10 - h11);
}

/**
 * The ground an object placed on tile (x, y) stands on.
 *
 * An object's position is a cell index and it is drawn at the cell's CENTRE
 * — (x + 0.5) · U (renderer/core/coords.ts, tileCenter) — so that is where its
 * height is read too. Reading the corner vertex instead, as this used to,
 * anchored a model half a tile away from where it was drawn: level ground
 * hid it, and on any slope a building stood off the ground on the downhill
 * side, or sank on the uphill one, by half a tile of that slope.
 *
 * (x, y) may be fractional — a free (alt) drag places at thousandths of a
 * tile — and the centre offset applies the same.
 */
export function groundUnder(heights: ArrayLike<number>, V: number, x: number, y: number): number {
  return groundHeight(heights, V, x + 0.5, y + 0.5);
}
