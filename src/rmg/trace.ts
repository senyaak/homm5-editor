// What a run says as it goes — every listener a tool can attach, in one place.
//
// The generator itself needs none of these: a map comes out the same whether
// anyone is listening or not. They exist for the instruments that hold the
// port to the engine — `tools/rmg-diff-draws.ts` wants every draw and the
// phase each one fell in, and for a FillZones jitter draw the tile it was
// deciding; `tools/rmg-diff-field.ts` wants every road cost field as the
// router hands it to the walk. They used to be six separate fields of the
// chain's options, next to the order's own; a listener is not an option, and
// six of them side by side with the order made it hard to see which fields
// change the map and which only watch it being made.
//
// Every method is optional. Attach the ones the question needs.

import type { FillZonesSpy } from './fill-zones.ts';
import type { Tile } from './placement.ts';

export interface ChainTrace extends FillZonesSpy {
  /**
   * Every draw as it is taken. It has to be attached here rather than by the
   * caller: the RNG is made inside the chain, and by the time a caller holds
   * `c.rng` the chain has run.
   */
  draw?(kind: string, value: number, limit?: number): void;
  /**
   * The draw counter as each phase ends. "The 13807th draw disagrees" is a
   * number; "the 13807th draw is in zoneConnections, which starts at 13798"
   * is a place to read, and the difference between the two is this callback.
   */
  phase?(label: string, draws: number): void;
  /**
   * Every converged road cost field, as the router hands it to the walk —
   * see `RoadInput.field`. `kindBit` is 0x20 for the zone road, 0x08/0x10
   * for the roads phase.
   */
  roadField?(zone: number, kindBit: number, cost: Float32Array, from: Tile, to: Tile): void;
}
