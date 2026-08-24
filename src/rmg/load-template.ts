// `LoadTemplate` — the zones come into being: each gets a floor, a race, a
// class and its constructor's one draw; the players get their towns.
//
// Read from 0xEA1D40 in the unwrapped game executable. The reading
// reconciles against run 1 exactly: 1 coin + 7 random-race zones at two
// draws + 7 constructor draws = 22, the counters' 31 − 9. The budget:
//
//   draws = [twoFloors: one per zone]        floor balancing
//         + 1                                the subterra/sub-inferno coin,
//                                            spent even with one floor
//         + per zone: 2 when its Setting is SPECIAL/RANDOM/NO_TYPE, else 1
//         + one per zone                     the base constructor's next()
//         + [twoFloors: 2 * (W*H / R^2)]     the light grid's DISCARDED points
//
// Zones are created in ASCENDING INDEX order — the engine sorts twice, first
// by Size descending to deal floors, then by Index ascending to build — and
// both sorts are the same odd gap-halving strided merge, modelled exactly in
// engineSort below because its tie order decides which floor a zone gets.
//
// The races: a zone with a concrete Setting keeps it (one draw, discarded).
// SPECIAL / RANDOM_TYPE / NO_TYPE draw from a hardcoded list — surface
// [HEAVEN, PRESERVE, ACADEMY, DWARF, INFERNO, NECROMANCY, STRONGHOLD], plus
// DUNGEON only when the map has no underground; underground [DUNGEON,
// INFERNO, DWARF, NECROMANCY] — and then spend one more draw either way. A
// player-start zone hands its race to the next player slot; a slot the
// operator filled with a CONCRETE race wins over the drawn one, a slot left
// RANDOM takes it.
//
// The underground's flavour: Dwarven when the map-setup roll's parity said
// so, otherwise one unconditional coin decides Subterra against SubInferno —
// for the whole map, not per zone. Water makes floor-0 zones WaterBordered
// and copies the template's Shipyard bit. No subclass constructor draws more
// than the base one's single next() into zone+0x13C — the roll FillTerrain
// later reads to pick the zone's ground tile.
//
// Named holes: the tie order of the Size sort is exact by construction but
// no oracle has held a two-floor run to it yet; the concrete-race branch
// appends a player entry without checking the operator's (nothing shipped
// exercises it — port copies the reading); who pre-fills the player vector
// upstream is unread.

import type { RmgRandom } from './random.ts';
import type { RmgTemplate, RmgZone } from './template.ts';

/** The Setting enum as the executable numbers it (strings at 0xFBD4D4). */
export const RACE = {
  SPECIAL: 0, RANDOM: 1, NO_TYPE: 2, HEAVEN: 3, PRESERVE: 4, ACADEMY: 5,
  DUNGEON: 6, NECROMANCY: 7, INFERNO: 8, DWARF: 9, STRONGHOLD: 10,
} as const;

export const RACE_BY_NAME: Record<string, number> = {
  RACE_SPECIAL: 0, RACE_RANDOM_TYPE: 1, RACE_NO_TYPE: 2, RACE_HEAVEN: 3,
  RACE_PRESERVE: 4, RACE_ACADEMY: 5, RACE_DUNGEON: 6, RACE_NECROMANCY: 7,
  RACE_INFERNO: 8, RACE_DWARF: 9, RACE_STRONGHOLD: 10,
};

/**
 * The engine's own sort (0xEAEDA0 / 0xEAEB30): a gap-halving strided merge
 * over a pointer array. gap starts at the largest power of two BELOW n; each
 * pass merges the chain at o, o+2g, … with the chain at o+g, o+3g, … into
 * positions o, o+g, o+2g, …, and a chain with no partner is copied through.
 * Ties emit the RIGHT element — the one property a plain stable sort would
 * get wrong, and the one that decides floor deals between equal-Size zones.
 */
export function engineSort<T>(items: readonly T[], before: (a: T, b: T) => boolean): T[] {
  const n = items.length;
  if (n < 2) return items.slice();
  let gap = 1;
  while (gap * 2 < n) gap *= 2;
  let src = items.slice();
  while (gap >= 1) {
    const dst: T[] = new Array<T>(n);
    for (let o = 0; o < gap; o++) {
      let ia = o;
      let ib = o + gap;
      let out = o;
      while (ia < n && ib < n) {
        if (before(src[ia]!, src[ib]!)) { dst[out] = src[ia]!; ia += 2 * gap; }
        else { dst[out] = src[ib]!; ib += 2 * gap; }
        out += gap;
      }
      for (; ia < n; ia += 2 * gap, out += gap) dst[out] = src[ia]!;
      for (; ib < n; ib += 2 * gap, out += gap) dst[out] = src[ib]!;
    }
    src = dst;
    gap = Math.trunc(gap / 2);
  }
  return src;
}

export type ZoneKind = 'zone' | 'waterBordered' | 'dwarven' | 'subterra' | 'subInferno';

export interface LoadedZone {
  index: number;
  size: number;
  floor: number;
  race: number;
  /**
   * Which race's preset paints this zone's ground — the entry the engine
   * stores at zone+0x20 (vt+0x28 after construction): the zone's own race,
   * except Dungeon ON THE SURFACE borrows Haven's, and the underground
   * flavours override wholesale — Subterra paints as Dungeon, Dwarven as
   * entry 2, SubInferno as entry 0.
   */
  terrainRace: number;
  /** 1-based player number when this is a start zone, 0 otherwise (+0xF0). */
  playerNo: number;
  kind: ZoneKind;
  /** Water zones only: the template's Shipyard bit, copied to +0x164. */
  shipyard: boolean;
  /**
   * The base constructor's draw (+0x13C). Its reader turned out to be
   * FillTerrain: an odd roll (or an empty pool) paints the preset's
   * DefaultTile, an even one paints OtherTiles[roll % n].
   */
  ctorRoll: number;
}

export interface LoadTemplateOptions {
  /** gen+0x1D from CreateMap. */
  twoFloors: boolean;
  /** map+0x8C from the map-created step: the underground is the Dwarven caves. */
  dwarvenUnderground: boolean;
  /** gen+0xA6 — floor-0 zones become WaterBordered. */
  water: boolean;
  /** gen+0x28 — how many players CreateMap settled on. */
  playerCount: number;
  /** gen+0x64 as the operator left it: a race per slot, RACE.RANDOM to defer. */
  players?: number[];
  /** Map tiles (square) — the light grid draws scale with its area. */
  mapSize: number;
  /** RMGParameters.PointLightParams.ZoneRadius — 40 in the shipped file. */
  pointLightZoneRadius: number;
}

export interface LoadedTemplate {
  /** Creation order: ascending Index. */
  zones: LoadedZone[];
  /** The player races as the phase left them. */
  players: number[];
}

export function loadTemplate(template: RmgTemplate, options: LoadTemplateOptions, rng: RmgRandom): LoadedTemplate {
  interface Triple { item: RmgZone; size: number; floor: number }
  const triples: Triple[] = template.zones.map((item) => ({ item, size: item.size, floor: 0 }));

  // Deal floors in Size-descending order — biggest zones first, the classic
  // balance heuristic — with a coin only when the floors are within a tile
  // of each other, and the mandatory discarded draw otherwise.
  const bySize = engineSort(triples, (a, b) => a.size > b.size);
  if (options.twoFloors) {
    const sum = [0, 0];
    for (const t of bySize) {
      if (Math.abs(sum[0]! - sum[1]!) < 2) {
        t.floor = rng.below(2);
      } else {
        t.floor = sum[0]! > sum[1]! ? 1 : 0;
        rng.next();
      }
      sum[t.floor] += t.size;
    }
  }

  const byIndex = engineSort(triples, (a, b) => a.item.index < b.item.index);

  // One coin for the whole map, spent even when there is no underground to
  // flavour — run 1 proved it by arithmetic.
  const subterra = rng.below(2) !== 0;

  const surface: number[] = [RACE.HEAVEN, RACE.PRESERVE, RACE.ACADEMY, RACE.DWARF, RACE.INFERNO, RACE.NECROMANCY, RACE.STRONGHOLD];
  if (!options.twoFloors) surface.push(RACE.DUNGEON);
  const underground: number[] = [RACE.DUNGEON, RACE.INFERNO, RACE.DWARF, RACE.NECROMANCY];

  const players = options.players ? [...options.players] : [];
  let playerNo = 1;
  let slot = 0;

  const zones: LoadedZone[] = [];
  for (const t of byIndex) {
    const setting = RACE_BY_NAME[t.item.setting];
    if (setting === undefined) throw new Error(`loadTemplate: unknown Setting "${t.item.setting}"`);

    let race: number;
    let assignedPlayer = 0;
    if (setting > RACE.NO_TYPE) {
      // A concrete race from the template. The append here ignores any entry
      // the operator made — the engine's own asymmetry against the random
      // branch, unreachable by shipped templates and copied as read.
      race = setting;
      rng.next();
      if (t.item.canBePlayerStart) {
        if (slot < options.playerCount) {
          players.push(race);
          assignedPlayer = playerNo;
        }
        slot++;
        playerNo++;
      }
    } else {
      const list = t.floor === 0 ? surface : underground;
      race = list[rng.below(list.length)]!;
      if (t.item.canBePlayerStart) {
        // Against the vector's LIVE count — an entry a concrete-race zone
        // appended above would be seen here, the way the engine sees it.
        if (slot < players.length) {
          rng.next();
          if (players[slot] !== RACE.RANDOM) race = players[slot]!;
          else players[slot] = race;
          assignedPlayer = playerNo;
          slot++;
          playerNo++;
        } else {
          rng.next();
          if (slot < options.playerCount) {
            players.push(race);
            assignedPlayer = playerNo;
          }
          slot++;
          playerNo++;
        }
      } else {
        rng.next();
      }
    }

    const kind: ZoneKind = t.floor === 0
      ? (options.water ? 'waterBordered' : 'zone')
      : (options.dwarvenUnderground ? 'dwarven' : subterra ? 'subterra' : 'subInferno');

    const terrainRace = kind === 'subterra' ? RACE.DUNGEON
      : kind === 'dwarven' ? 2
      : kind === 'subInferno' ? 0
      : race === RACE.DUNGEON ? RACE.HEAVEN
      : race;

    zones.push({
      index: t.item.index,
      size: t.item.size,
      floor: t.floor,
      race,
      terrainRace,
      playerNo: assignedPlayer,
      kind,
      shipyard: t.item.shipyard,
      ctorRoll: rng.next(),
    });
  }

  // The underground light grid draws 2 * (W*H / R^2) candidate points and
  // then throws the whole vector away — the lights end up on a deterministic
  // diagonal stripe pattern instead. Dead work, but the draws are spent, so
  // the port spends them.
  if (options.twoFloors) {
    const r = options.pointLightZoneRadius;
    const n = Math.trunc((options.mapSize * options.mapSize) / (r * r));
    for (let i = 0; i < n; i++) {
      rng.below(options.mapSize);
      rng.below(options.mapSize);
    }
  }

  return { zones, players };
}
