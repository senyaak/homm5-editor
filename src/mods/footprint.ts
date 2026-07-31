// How many tiles a placed object covers, and which ones.
//
// Shared by everything that stands on the adventure map — a dwelling and a
// building answer this the same way — so it lives here rather than in whichever
// of them needed it first.

import { posix } from 'node:path';
import { readGeometryRefFromModelXdb } from '../scene/geometry.ts';

/** World units per map tile. Heights use the same scale. */
export const UNITS_PER_TILE = 2;

/** How many tiles an object covers. */
export interface Footprint {
  w: number;
  h: number;
}

export interface Tile {
  x: number;
  y: number;
}

/** The data path an href names: no fragment, no leading slash. */
export function refPath(href: string): string {
  return href.split('#')[0]!.replace(/^\/+/, '');
}

/**
 * The footprint a model needs, measured off its geometry's bounding box.
 *
 * A tile is two world units, so a 6.00 x 6.07 model is 3x3 tiles — which is
 * exactly what the shipped High Cabins declares, and the same arithmetic gets
 * the Sylvan Military Post's 4x4 from its 8.00 x 8.08. Measuring beats guessing
 * because a footprint that does not match the art is a building a hero walks
 * through, or an entrance nothing can reach.
 */
export function footprintOf(model: string, read: (rel: string) => string | null): Footprint | null {
  const path = refPath(model);
  const xml = read(path);
  if (!xml) return null;
  const got = readGeometryRefFromModelXdb(xml, (href) => read(
    href.startsWith('/') ? refPath(href) : posix.join(posix.dirname(path), refPath(href)),
  ));
  if (!got) return null;
  const tiles = (size: number): number => Math.max(1, Math.round(Math.abs(size) / UNITS_PER_TILE));
  return { w: tiles(got.bbox.sx), h: tiles(got.bbox.sy) };
}

/**
 * The tiles a footprint becomes, in the shipped objects' own convention.
 *
 * Both areas are CENTRED on the object's own origin, which is where its model's
 * centre sits: a run of n tiles starts at -floor((n-1)/2), so 3 covers -1..1,
 * 4 covers -1..2 and 8 covers -3..4. Getting that wrong does not merely misplace
 * a tile — the art and the tiles it blocks drift apart.
 *
 * The ENTRANCE, where the hero stands to visit, is the middle of the top row.
 * Which row depends on whether the art is bigger than the building:
 *
 *   all building (High Cabins: 3x3 art, 3x3 blocked) — the entrance is one of
 *     the building's own tiles, left unblocked. 8 blocked of 9, active (0,-1).
 *   art with a skirt (Dragon Utopia: 8x8 of rock, 4x4 blocked) — everything the
 *     building covers is blocked and the entrance is the tile above it, standing
 *     on the skirt. 16 blocked, 64 hole, and (0,-2) is one of its own entrances.
 *
 * The possession marker, the flag a captured object flies, sits at (0,0).
 */
export function tilesOf(blocked: Footprint, ground: Footprint = blocked): {
  blocked: Tile[]; hole: Tile[]; active: Tile[];
} {
  const from = (n: number): number => -Math.floor((n - 1) / 2);
  const area = (f: Footprint): Tile[] => {
    const out: Tile[] = [];
    for (let y = from(f.h); y < from(f.h) + f.h; y++) {
      for (let x = from(f.w); x < from(f.w) + f.w; x++) out.push({ x, y });
    }
    return out;
  };
  const hole = area(ground);
  const core = area(blocked);
  const top = from(blocked.h);
  const skirted = ground.w > blocked.w || ground.h > blocked.h;
  const active: Tile[] = [{ x: 0, y: skirted ? top - 1 : top }];
  const isActive = (t: Tile): boolean => active.some((a) => a.x === t.x && a.y === t.y);
  return { blocked: core.filter((t) => !isActive(t)), hole, active };
}
