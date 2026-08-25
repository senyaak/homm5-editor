// The roads phase — 0xEBA690, one call per zone between "main objects
// set" and "roads created". Two loops over the ported router (road.ts),
// nothing else: every one of the phase's draws is the router's one
// below(2) per walked tile.
//
// THE SEED. With the zone's town flag (`zone+0xF8`, set by PlaceTown) the
// town ENTRY (`zone+0xC` — the same point FillDistToTownsTable grows
// from) is pushed into the 0x08 list (`zone+0x74`); otherwise the FIRST
// connection point is. No town and no connections means nothing is seeded
// and the phase does nothing for the zone.
//
// LOOP 1 — connections, kind 0x08. Each point of `zone+0xC0` — the
// passage mouths and adopted tiles ZoneConnections pushed, in push order
// (the teleport placer feeds it too; not ported, no template reaches it)
// — is routed to its nearest point of the GROWING 0x08 list: every
// element is scanned, strict <, best starts at 1000.0f, argmin at 0. A
// route whose either endpoint truncates outside the map is silently
// skipped (0xEBA7FE — this gate exists here and not in loop 2). The wave
// grows FROM the network, the walk descends from the connection point,
// and the walked tiles join the 0x08 list — so later connections attach
// to earlier roads. A zone seeded from its own first connection point
// routes it to itself for zero draws.
//
// LOOP 2 — mines, kind 0x10. Each point of `zone+0x11C` — every mine
// stamp's active tiles, in stamp order — finds its nearest road tile by a
// SAMPLED scan: the 0x08 list at indices 5, 18, 31, … (index % 13 == 5,
// 0xEBA8D5), then the same best continued over the 0x10 list at indices
// 7, 18, 29, … (index % 11 == 7, 0xEBA967). The route runs REVERSED —
// the wave grows from the mine, the walk descends from the road — and
// its tiles join the 0x10 list. When no sampled index exists at all,
// argmin is still 0 and the route goes to road08[0], the seed, no
// distance ever measured — the engine's own reachable quirk, kept.
//
// The phase writes nothing but the router's marks: occupancy |= 0x08/0x10
// along the walks. No border dents, no room points, no template reads —
// the 0x08/0x10 split is hardwired by loop, not decided by data.

import type { DrawSource } from './armies.ts';
import type { Tile } from './placement.ts';
import { routeRoad } from './road.ts';

const fl = Math.fround;

export interface RoadsPhaseZoneInput {
  size: number;
  /** The zone grid, `[a][b]` with `b` the map x. */
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: 0x08/0x10 are OR'd along the walks. */
  occupancy: Uint8Array;
  zoneIndex: number;
  /** `zone+0xC` under the `zone+0xF8` flag — the town ENTRY, else null. */
  townEntry: Tile | null;
  /** `zone+0xC0` in push order — passage mouths and adopted tiles. */
  connectionPoints: Tile[];
  /** `zone+0x11C` — every mine stamp's active tiles, in stamp order. */
  mineActives: Tile[];
}

export interface ZoneRoads {
  /** `zone+0x74` — the seed plus every 0x08-walked tile, in append order. */
  road08: Tile[];
  /** `zone+0x80` — every 0x10-walked tile, in append order. */
  road10: Tile[];
}

/** Single-precision point distance, the road code's own arithmetic. */
function dist([ax, ay]: Tile, [bx, by]: Tile): number {
  return fl(Math.sqrt(fl((ax - bx) * (ax - bx) + (ay - by) * (ay - by))));
}

/** One zone of `0xEBA690`; the caller loops zones in floor-hash order. */
export function buildZoneRoadsPhase(input: RoadsPhaseZoneInput, rng: DrawSource): ZoneRoads {
  const { size, grid, border, occupancy, zoneIndex } = input;
  const route = (from: Tile, to: Tile, kindBit: number): Tile[] =>
    routeRoad({ size, grid, border, occupancy, zoneIndex, points: [], kindBit }, from, to, rng);

  const road08: Tile[] = [];
  const road10: Tile[] = [];

  if (input.townEntry) road08.push(input.townEntry);
  else if (input.connectionPoints.length) road08.push(input.connectionPoints[0]!);

  const inMap = ([x, y]: Tile): boolean =>
    Math.trunc(x) >= 0 && Math.trunc(x) < size && Math.trunc(y) >= 0 && Math.trunc(y) < size;

  for (const c of input.connectionPoints) {
    let best = fl(1000);
    let argmin = 0;
    for (let j = 0; j < road08.length; j++) {
      const d = dist(road08[j]!, c);
      if (d < best) {
        best = d;
        argmin = j;
      }
    }
    const from = road08[argmin];
    if (!from || !inMap(from) || !inMap(c)) continue;
    road08.push(...route(from, c, 0x08));
  }

  for (const m of input.mineActives) {
    let best = fl(1000);
    let argmin = 0;
    let from10 = false;
    for (let j = 5; j < road08.length; j += 13) {
      const d = dist(road08[j]!, m);
      if (d < best) {
        best = d;
        argmin = j;
      }
    }
    for (let j = 7; j < road10.length; j += 11) {
      const d = dist(road10[j]!, m);
      if (d < best) {
        best = d;
        argmin = j;
        from10 = true;
      }
    }
    if (from10 && argmin < road10.length) {
      road10.push(...route(m, road10[argmin]!, 0x10));
    } else if (argmin < road08.length) {
      road10.push(...route(m, road08[argmin]!, 0x10));
    }
  }

  return { road08, road10 };
}
