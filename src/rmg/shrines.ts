// The shrines step of MainObjects — read from 0xEBE1C0, held to the traced
// run. It is the generic price-list placer (price-lists.ts) with three
// facts of its own, each one measured:
//
//   points     the template's ShrinePoints RAW (`zone params +0x54`) — no
//              tile scaling; under 6 the step returns before any draw
//   list       NOT the preset — a hardcoded three-entry table, mines-style:
//              Shrine_Of_Magic_1/2/3 at costs {6, 10, 12} (records at
//              0x121CA90, costs at 0xFF4C94). The preset's NewShrines
//              vector (`[zone+0x20]+0x174`) is read by NOBODY — the other
//              price-list workers sit at +0x144/+0x150/+0x15C/+0x168/+0x180
//              and skip straight over it.
//   the 6      the loop condition hardcodes 6 (`0xEBE4BF`) where the four
//              preset-vector steps read `list[0].Value` — the same number
//              for this list, so the generic placer serves
//
// No guard ever (SetMonster is called by none of the 0xEC1500 family), and
// no SpellID — the reference's SPELL_NONE is the shared document's default.
// The border >= 1 gate is the shared helper's and it is load-bearing:
// dropping it moves zone 1's boundary by 14 draws.

import type { DrawSource } from './armies.ts';
import type { Footprint } from './placement.ts';
import { placePriceList } from './price-lists.ts';
import type { PlacedPriced, PriceListInput } from './price-lists.ts';

/**
 * The engine's own table at 0x121CA90 (hrefs, static init 0x4D5B40) and
 * 0xFF4C94 (costs). The order is the table's — the prefix draw indexes it.
 */
export const SHRINE_TYPES: ReadonlyArray<{ name: string; cost: number }> = [
  { name: 'Shrine_Of_Magic_1', cost: 6 },
  { name: 'Shrine_Of_Magic_2', cost: 10 },
  { name: 'Shrine_Of_Magic_3', cost: 12 },
];

export type PlacedShrine = PlacedPriced;

export interface ShrineStepInput extends Omit<PriceListInput, 'budget' | 'list'> {
  /** The template's ShrinePoints, raw. */
  shrinePoints: number;
  /** Footprints for the three shrines, in SHRINE_TYPES order. */
  footprints: Footprint[];
}

/** One zone's shrines — `0xEBE1C0`, draws and all. */
export function placeZoneShrines(input: ShrineStepInput, rng: DrawSource): PlacedShrine[] {
  return placePriceList({
    ...input,
    budget: input.shrinePoints,
    list: SHRINE_TYPES.map((s, i) => ({ type: s.name, value: s.cost, foot: input.footprints[i]! })),
  }, rng);
}
