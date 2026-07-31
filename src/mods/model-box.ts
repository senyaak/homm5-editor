// Where a borrowed model's ground plane is, and how to move its bounding box.
//
// Two things want this: a dwelling, which has to stand ON the terrain rather
// than float or sink into it, and an artifact's board, which is a poster
// rescaled to a plaque. Both retune the <BoundingBox> the game places the model
// by, and getting it wrong is visible from across the map.



import { extractMeshesStructured } from '../scene/geometry.ts';
import type { BBox } from '../scene/geometry.ts';

/**
 * Where the GROUND is in a town building, in its own coordinates.
 *
 * A town is built in terraces and every building stands on one, on a column of
 * rock the town's own landscape hides. Place such a model by its lowest point and
 * you get a building on a stalk. So the terrace has to be found, and the model
 * says where it is if you ask the right mesh: **the decoration stands on it**. No
 * modeller hangs grass off the underside of a cliff, so the lowest leaf, plant or
 * tree in the file is the ground — and across the four Sylvan tier-4-to-7
 * buildings that agrees with the top of the pedestal mesh where there is one
 * (the Unicorn Glade: pedestal ends at 41.6, its trees start at 41.5).
 *
 * Asking the pedestal directly is the fallback rather than the rule because the
 * naming does not hold: the Unicorn Glade and the Forest Nest have a `…Pod_O`,
 * while Stonehenge's column is part of its main mesh and the Treant Arches' is
 * too. Nothing to key on there — but all four have decoration.
 *
 * The geometry document names its meshes and says how many material groups each
 * splits into; the decoder returns those groups in the same order, so a group
 * belongs to whichever mesh's run it falls in.
 */
export function groundLevel(doc: string, bin: Buffer): number | null {
  const list = (tag: string): string[] => {
    const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1] ?? '';
    return [...body.matchAll(/<Item>([^<]*)<\/Item>/g)].map((m) => m[1]!);
  };
  const names = list('MeshNames');
  const quantities = list('MaterialQuantities').map(Number);
  if (!names.length || names.length !== quantities.length) return null;
  const groups = extractMeshesStructured(bin);
  if (!groups) return null;

  const zRange = (from: number, runs: number): { lo: number; hi: number } | null => {
    let lo = Infinity, hi = -Infinity;
    for (const g of groups.slice(from, from + runs)) {
      for (let v = 2; v < g.positions.length; v += 3) {
        const z = g.positions[v]!;
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    return lo === Infinity ? null : { lo, hi };
  };

  let decoration: number | null = null;
  let pedestal: number | null = null;
  let at = 0;
  for (let i = 0; i < names.length; i++) {
    const runs = quantities[i]! || 1;
    const z = zRange(at, runs);
    at += runs;
    if (!z) continue;
    if (/plant|tree|grass|flower|leaf|bush/i.test(names[i]!)) {
      if (decoration === null || z.lo < decoration) decoration = z.lo;
    } else if (/pod/i.test(names[i]!)) {
      if (pedestal === null || z.hi > pedestal) pedestal = z.hi;
    }
  }
  return decoration ?? pedestal;
}

/** Rewrite a geometry document's box and its best-fit point to match the mesh. */
export function retuneBox(doc: string, box: BBox, p: { scale: number; shift: [number, number, number] }): string {
  const vec = (tag: string, x: number, y: number, z: number): [RegExp, string] => [
    new RegExp(`(<${tag}>\\s*<x>)[^<]*(</x>\\s*<y>)[^<]*(</y>\\s*<z>)[^<]*(</z>)`),
    `$1${x.toFixed(4)}$2${y.toFixed(4)}$3${z.toFixed(4)}$4`,
  ];
  let out = doc;
  for (const [re, to] of [
    vec('Size', box.sx, box.sy, box.sz),
    vec('Center', box.cx, box.cy, box.cz),
  ]) out = out.replace(re, to);
  // The best-fit point is a position too — where the object's label and its
  // selection marker hang — so it follows the same transform rather than a box.
  const fit = /(<BestFitPoint>\s*<x>)([^<]*)(<\/x>\s*<y>)([^<]*)(<\/y>\s*<z>)([^<]*)(<\/z>)/.exec(out);
  if (fit) {
    const moved = [Number(fit[2]), Number(fit[4]), Number(fit[6])]
      .map((v, i) => (v + p.shift[i]!) * p.scale);
    out = out.replace(fit[0], `${fit[1]}${moved[0]!.toFixed(4)}${fit[3]}${moved[1]!.toFixed(4)}${fit[5]}${moved[2]!.toFixed(4)}${fit[7]}`);
  }
  return out;
}
