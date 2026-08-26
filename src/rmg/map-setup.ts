// The "map created" step — six draws between CreateMap and LoadTemplate.
//
// Read from 0xE9FFC0 in the unwrapped game executable; the phase log calls
// its end "at %g map created", and run 1's counters bracket it exactly:
// CreateMap ends at 3, LoadTemplate begins at 9. Six draws, always, in this
// order:
//
//   1. monster strength   randomise ? below(3)      : next()   -> map+0x64
//   2. water              randomise ? below(2)      : next()   -> gen+0xA6
//   3. an angle           betweenFloat(0, 2*pi)                -> map+0x5C
//   4. a raw roll         next()                               -> map+0x88
//   5. ambient light      lights listed ? below(count) : next()
//   6. birds              below(10) > 6                          (30% chance)
//
// Draw four is the strangest and the most load-bearing: its PARITY (map+0x8C
// = map+0x88 & 1) is what later makes the underground Dwarven — the dwarven
// caves are a 50/50 of one raw roll. What reads the angle at map+0x5C is
// still open; the roll's own upper bits likewise.
//
// This is also where the floor vector is built: 1 + gen+0x1D elements of
// 0x120 bytes — the "two floors" bit from CreateMap IS the floor count,
// which pins the relation zones.ts used to take on faith. The map's tile
// dimensions both come from the size table entry (map+0xC = map+0x10).
//
// The supplied-parameter rule holds throughout: a value the operator fixed
// still costs its draw, discarded.

import type { RmgParams } from './params.ts';
import type { RmgRandom } from './random.ts';

const TWO_PI = Math.fround(6.2831853);

export interface MapSetupRequest {
  /** 0..2 to fix it; undefined lets the engine roll below(3). */
  monsterStrength?: number;
  /**
   * WaterAmount, fixed, or undefined for the engine's coin. TRI-state
   * (0 NONE / 1 PRESENT / 2 ISLAND_MAP), but the dialog's water control is
   * a checkbox that supplies 2 — the middle 1 only ever comes out of the
   * coin, so no ordered run can record it.
   */
  water?: number;
}

export interface MapSetup {
  monsterStrength: number;
  /** gen+0xA6 — the WaterAmount byte, 0/1/2. */
  water: number;
  /** map+0x5C — single-precision, in radians; its reader is unfound. */
  angle: number;
  /** map+0x88 — the raw roll, kept whole because only its parity is understood. */
  rawRoll: number;
  /** map+0x8C — the parity: an underground floor becomes the Dwarven caves. */
  dwarvenUnderground: boolean;
  /** Which of RMGParameters' GroundTerrainLights lights the surface. */
  ambientLightIndex: number;
  /** below(10) > 6 — whether the map gets its bird ambience. */
  birds: boolean;
}

export function mapSetup(params: RmgParams, request: MapSetupRequest, rng: RmgRandom): MapSetup {
  let monsterStrength: number;
  if (request.monsterStrength === undefined) {
    monsterStrength = rng.below(3);
  } else {
    rng.next();
    monsterStrength = request.monsterStrength;
  }

  let water: number;
  if (request.water === undefined) {
    water = rng.below(2);
  } else {
    rng.next();
    water = request.water;
  }

  const angle = rng.betweenFloat(0, TWO_PI);
  const rawRoll = rng.next();

  const lights = params.groundTerrainLights.length;
  const ambientLightIndex = lights > 0 ? rng.below(lights) : (rng.next(), 0);

  const birds = rng.below(10) > 6;

  return {
    monsterStrength,
    water,
    angle,
    rawRoll,
    dwarvenUnderground: (rawRoll & 1) !== 0,
    ambientLightIndex,
    birds,
  };
}
