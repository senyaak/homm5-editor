// The garrison a town NOBODY OWNS is given — `SetMonster` at 0xed2330, which
// names itself in its own refusal ("no monster set at town, power: %d").
//
// NOT the guard setter in `armies.ts`. That one opens with a `betweenFloat`
// and can spend `10 + below(30)`; this one spends `below(20)` and
// `below(candidates)` per tier and no float at all, and the two were told
// apart only by bracketing the call — a trace of values cannot, because both
// draw `below(20)` where the town's specialisation also does.
//
// WHO GETS ONE. `PlaceTown` asks for it at 0xeb577f — `cmp dword ptr
// [edi+0F0h],0` and skip when the zone has an owner — so exactly the towns
// with `playerNo` 0. The power is the caller's: the template zone's
// `TownGuardStrenght` times `BasicLeverGuardPower`, which on the shipped
// templates is 1 or 20 against a parameter of 1000.
//
// WHAT IT BUILDS. One stack per tier from 1 up, stopping at 7 or when the
// power runs out:
//
//   spread = below(20)
//   count  = ((spread + 20) * (9 - tier)) >> 1
//   pool   = every creature of THIS tier and THIS race, in table order,
//            minus the three the table never places
//   count  = min(count, power / creature.power)   -- and this is the last tier
//   power -= creature.power * count
//
// The reference for the reading is `S1P2Z3K5.1`'s third town, an Academy zone
// with a guard strength of 20: draws 13 and 15 of twenty, and the map the
// engine wrote holds Gremlin Saboteur x132 and Marble Gargoyle x34.
// (13+20)*8/2 is 132 exactly; 20000 - 105*132 is 6140, and 6140/180 is 34.

import type { CreatureInfo } from './creatures.ts';
import { UNPLACEABLE_CREATURES } from './creatures.ts';

/** Below this the engine logs "no monster set at town" and draws nothing. */
export const MIN_TOWN_GUARD_POWER = 100;

/** The highest tier a stack can be built from — the loop's own `cmp edi,7`. */
export const MAX_TOWN_GUARD_TIER = 7;

export interface TownGuardStack {
  creature: string;
  amount: number;
}

/** Only what this needs from the RNG, so a test can hand it a script. */
export interface DrawSource {
  below(limit: number): number;
}

/**
 * The garrison, in slot order — empty when the power is too small to buy one,
 * and empty when a tier the loop reaches has no creature of that race (the
 * engine returns false there, having already spent the tier's spread draw).
 */
export function setTownGuard(
  power: number,
  race: number,
  creatures: readonly CreatureInfo[],
  rng: DrawSource,
): TownGuardStack[] {
  if (power < MIN_TOWN_GUARD_POWER) return []; // no draws on this path
  const stacks: TownGuardStack[] = [];
  let left = power;
  for (let tier = 1; tier <= MAX_TOWN_GUARD_TIER; tier++) {
    const spread = rng.below(20);
    // `(9 - tier)` and then a shift, so an odd product loses its half — the
    // engine's `shr`, not a rounded division.
    let count = ((spread + 20) * (9 - tier)) >> 1;
    const pool = creatures.filter((c) =>
      !UNPLACEABLE_CREATURES.has(c.id) && c.tier === tier && c.town === race);
    if (!pool.length) return stacks; // the engine's own `xor al,al` exit
    const chosen = pool[rng.below(pool.length)]!;
    const unit = chosen.power;
    // The last tier is the one whose full count the power cannot pay for.
    const last = unit > 0 && left < unit * count;
    if (last) count = unit > 0 ? Math.trunc(left / unit) : 0;
    stacks.push({ creature: chosen.name, amount: count });
    left -= unit * count;
    if (last) break;
  }
  return stacks;
}
