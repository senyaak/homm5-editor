// A zone's NAMED objects — ours, from a template's `<Objects>` (`.h5et`).
//
// The engine's zone has counts by tier and budgets by category, and which
// building a budget buys is the draw's business; a template of Heroes III's
// can say "this zone has a Dragon Utopia" (`+95 0 d d d 3 d`), and now so can
// ours. The floor of each line (`Min`) is placed here, BEFORE the budget
// steps, through the same placer the budgets use — the shared candidate
// helper, the fit, the stamp, the mint — with a one-entry list priced at 1
// and a budget of `Min`, so it lands exactly `Min` times or runs out of
// room the way the step it borrows from does. A guard, when the line asks
// for one, seats the way an upgrade building's does (`seatGuard`, the
// 0xED3200 wrapper), at `GuardStrenght × BasicLeverGuardPower`.
//
// The ceilings (`Max`) are not placed here; they come back as CAPS — how
// many more of each document the budget steps may take, the forced ones
// subtracted — which `placePriceList` and `placeZoneUpgradeBuildings`
// honour. Nothing of this runs for a template of the game's: its zones
// carry no `<Objects>`, and an empty list places nothing and caps nothing.

import type { DrawSource, GuardTables } from './armies.ts';
import type { Footprint } from './placement.ts';
import { capKey, placePriceList } from './price-lists.ts';
import type { PlacedPriced, PriceListInput } from './price-lists.ts';
import type { RmgZoneObject } from './template.ts';
import { seatGuard } from './upgrade-buildings.ts';
import type { SeatedGuard } from './upgrade-buildings.ts';

export interface PlacedZoneObject extends PlacedPriced {
  guard: SeatedGuard | null;
}

export interface ZoneObjectsInput extends Omit<PriceListInput, 'budget' | 'list' | 'caps'> {
  objects: RmgZoneObject[];
  footprint: (href: string) => Footprint;
  basicLeverGuardPower: number;
  monsterStrength: number;
  tables: GuardTables;
}

export interface ZoneObjectsResult {
  placed: PlacedZoneObject[];
  /** For the budget steps that follow: the ceilings, forced ones subtracted. */
  caps: Map<string, number>;
  /**
   * Lines the zone had no room to honour — a warning for the run's list,
   * not a refusal: a template asking for more than fits gets what fits and
   * a line saying so.
   */
  short: Array<{ href: string; min: number; placed: number }>;
}

export function placeZoneObjects(input: ZoneObjectsInput, rng: DrawSource): ZoneObjectsResult {
  const placed: PlacedZoneObject[] = [];
  const caps = new Map<string, number>();
  const short: ZoneObjectsResult['short'] = [];
  for (const line of input.objects) {
    const foot = input.footprint(line.href);
    const landed = line.min > 0
      ? placePriceList({ ...input, budget: line.min, list: [{ type: line.href, value: 1, foot }] }, rng)
      : [];
    for (const p of landed) {
      const guard = line.guardStrenght > 0
        ? seatGuard({
          size: input.size, occupancy: input.occupancy, at: [p.x, p.y], q: p.q, foot,
          power: Math.trunc(input.basicLeverGuardPower * line.guardStrenght),
          monsterStrength: input.monsterStrength, tables: input.tables,
        }, rng)
        : null;
      placed.push({ ...p, guard });
    }
    if (landed.length < line.min) short.push({ href: line.href, min: line.min, placed: landed.length });
    if (Number.isFinite(line.max)) {
      caps.set(capKey(line.href), Math.max(0, line.max - landed.length));
    }
  }
  return { placed, caps, short };
}
