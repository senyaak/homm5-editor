// HOW THE ZONES ARE LAID OUT — the one door the chain goes through.
//
// Everything after the zones takes two things and nothing else: a grid per
// floor saying which zone owns each tile, and a radius per zone (the town
// step keeps to the zone's deep core by it). Where those come from is the
// template's choice:
//
//   Engine   the engine's own two phases, `generateGameZones` and `fillZones`,
//            byte for byte — random start points, circles grown and jittered
//            into blobs. The default, and what every template the game ships
//            gets, so a template without the field is still the engine's map.
//   Voronoi  ours (`layout-voronoi.ts`): centres settled by the connections —
//            joined zones pull together, start zones push apart — and tiles
//            cut as weighted Voronoi cells. The template's graph decides the
//            picture, the way Heroes III's templates do; no coordinate is
//            written anywhere.
//
// A third way is a third case here and a new file; nothing downstream
// notices. The FillZones spy stays inside the Engine case — it hears jitter
// draws, and only the engine's fill has any.

import type { Arith } from './arith.ts';
import { DOUBLES } from './arith.ts';
import { fillZones } from './fill-zones.ts';
import type { FillZonesSpy } from './fill-zones.ts';
import { voronoiLayout } from './layout-voronoi.ts';
import type { RmgRandom } from './random.ts';
import type { RmgConnection, RmgZone } from './template.ts';
import { generateGameZones } from './zones.ts';
import type { PlacedZone, ZoneSeed } from './zones.ts';

/** The template's `<ZoneLayout>`; absent means `Engine`. */
export type ZoneLayoutKind = 'Engine' | 'Voronoi';

export const ZONE_LAYOUT_KINDS: readonly ZoneLayoutKind[] = ['Engine', 'Voronoi'];

export function zoneLayoutKind(text: string): ZoneLayoutKind {
  if (text === '') return 'Engine';
  const kind = ZONE_LAYOUT_KINDS.find((k) => k === text);
  if (!kind) throw new Error(`ZoneLayout "${text}" — one of ${ZONE_LAYOUT_KINDS.join(', ')}`);
  return kind;
}

export interface ZoneLayoutInput {
  /** The map's side; the engine has one dimension. */
  size: number;
  /** The zones as LoadTemplate made them — index, relative size, floor. */
  zones: ZoneSeed[];
  /** The template's zones, for what the layout reads of them beyond the seed. */
  templateZones: RmgZone[];
  connections: RmgConnection[];
  twoFloors: boolean;
  arith?: Arith;
  /** Engine only: the game build's transposed centre draws. */
  swapZoneAxes?: boolean;
  /** Engine only: the jitter listener. */
  spy?: FillZonesSpy;
  /** The chain's phase marker, so the draw ledger keeps its two engine labels. */
  phase?: (label: string) => void;
}

export interface ZoneLayout {
  /** Every zone with its centre and radius, in the layout's own order. */
  zones: PlacedZone[];
  /** Per floor: grid[a][b] = zone index, -1 where nothing claimed the tile. */
  floors: Int32Array[][];
}

export function layoutZones(kind: ZoneLayoutKind, input: ZoneLayoutInput, rng: RmgRandom): ZoneLayout {
  const { size, zones, twoFloors } = input;
  const ar = input.arith ?? DOUBLES;
  switch (kind) {
    case 'Engine': {
      const placed = generateGameZones(size, size, zones, twoFloors, rng, ar, input.swapZoneAxes);
      input.phase?.('placeZones');
      const filled = fillZones(size, size, placed.zones, twoFloors, rng, input.spy, ar);
      input.phase?.('fillZones');
      return { zones: placed.zones, floors: filled.floors };
    }
    case 'Voronoi': {
      const laid = voronoiLayout({
        size, zones, twoFloors, connections: input.connections,
        startZones: new Set(input.templateZones.filter((z) => z.canBePlayerStart).map((z) => z.index)),
      }, rng);
      input.phase?.('layoutZones');
      return laid;
    }
  }
}
