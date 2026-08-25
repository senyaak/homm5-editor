// Big statics — the surface CGameZone's vtable slot +0x34 (`0xEBBBD0`),
// first of the two virtual steps the statics driver `0xEA5450` runs per
// zone (template entry order, no prologue draw — the phase starts on the
// roads boundary exactly).
//
// THREE PARTS, in the order the code runs them:
//
// LAKES (`0xEBC260`) — surface zones of the lake races only ({HEAVEN,
// PRESERVE, NECROMANCY, INFERNO, DWARF, STRONGHOLD} by preset index).
// Room is recomputed with mask 0x3E (the 0x3C of the sweep plus the
// zone's `+0x5C` blocked list — no writer of `+0x5C` has been found in
// the RMG range, so this port treats the two masks as one and says so).
// A zone tile is a seed candidate when room > 5, border > 5 and it is a
// local maximum of room over its 8 in-bounds neighbours; each candidate
// costs ONE betweenFloat(0,1) and is accepted when the roll < 0.4 AND it
// sits >= 20.0 from every seed already accepted. Seeds join the zone's
// big-position ledger (`zone+0xB4`) — which is why craters later keep
// their distance from lake centres. The blob then grows drawlessly: the
// scratch grid starts at 1000, seeds get 0 and occupancy 2, and a
// chamfer wavefront (orthogonals +2, diagonals +3, occupancy 0x80 on
// write) spreads over free in-zone tiles with room > 2 and border > 2,
// while wave < 13 with an early exit when 0 < count(wave) < wave. Seed
// decorations (`0xEC3B30`, OverLakeCenterObjects) and the over-lake
// one-tilers (`0xEC3E00`, OverLakeOneTileRandomObjects) then draw per
// seed — no fit, no stamp, just mints at jittered/seed positions.
//
// PRESET MOUNTAINS (`0xEBCAF0`) — only when the preset's Mountains list
// is non-empty (it is empty for Inferno and Academy, so the reference
// map never runs it). Candidates are zone tiles with room > 4, each at
// least 4.0 from every previously placed mountain: below(len) type,
// below(4) quadrant, the statics fit; success mints and hand-stamps
// occupancy 0x100 per blocked tile — which an 8-bit grid stores as 0,
// exactly what the byte-wide fit reads (`0xEC39D0` tests one byte, so
// the engine's own statics can stamp over mountain footprints).
//
// THE SWEEP — recompute room with mask 0x3C (actives + all three road
// lists), collect the zone's tiles with room > 1 ONCE, then outer loop
// over the preset's BigStatics IN FILE ORDER (big->small in the shipped
// tables), inner loop over the candidates IN LIST ORDER — there is no
// tile draw. "Big" is blocked count n > 10. Per candidate: big craters
// keep 15.0 from every big-position ledger point ("Crater" tested on the
// shared's path); big entries try 4 free rotations (angle = attempt *
// pi/2), small entries ONE drawn below(4) quadrant — the below-dominated
// bulk of the phase. A passing fit costs one betweenFloat, accepted iff
// roll < 1/(n+1); acceptance mints (two below), records, stamps the
// standard three passes, appends big positions to the ledger, and a
// "Mountain"-named static with n > 15 raises the relief cone
// (`0xED1660`: height += 2*(3.5 - r) under each blocked offset with
// r < 3.5). Placed candidates are NOT struck from the list — later types
// simply fail the fit on their tiles.
//
// THE FIT (`0xEC39D0`, vtable +0x44, drawless): per rotated blocked
// offset — in bounds; on floor 1 only, five tiles from every map edge;
// occupancy byte & 0x3E == 0 (objects, guards and roads block; the
// lakes' 0x80 and the mountains' truncated 0x100 pass); room >= 2 — and
// NO zone test, which is where the stale room of neighbouring zones
// becomes load-bearing.

import type { DrawSource } from './armies.ts';
import { mintName } from './armies.ts';
import { EIGHT, recomputeRoom } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';
import { rotate } from './towns.ts';

const fl = Math.fround;

/** Preset indices whose surface zones grow lakes (`0xEBC260`'s gate). */
const LAKE_RACES = new Set([3, 4, 7, 8, 9, 10]);

export interface PlacedStatic {
  /** The shared document's href path — the map file's identity. */
  type: string;
  name: string;
  x: number;
  y: number;
  /** Radians — a quadrant multiple, or the map angle for FireDots. */
  angle: number;
}

export interface BigStaticsInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: stamps, lake seeds (2), lake blobs (0x80). */
  occupancy: Uint8Array;
  /** MUTATED IN PLACE — the level's persistent room grid. */
  room: Int32Array[];
  /** MUTATED: stamped actives join the zone's `+0x68` points. */
  points: Tile[];
  zoneIndex: number;
  /** 0 surface, 1 underground — gates the lakes and the fit's edge margin. */
  floor: number;
  /**
   * `zone+0x18` — the TEMPLATE'S Setting race, not the resolved one: the
   * reference template says RACE_RANDOM_TYPE in every zone, its resolved
   * Inferno zone is in the lake set, and the trace shows the lakes never
   * ran — so the gate reads the unresolved value. (The write site of
   * `+0x18` has not been chased; this is the one reading consistent with
   * the measurement. A fixed-race template is where to re-verify.)
   */
  settingRace: number;
  /** The three road lists the roads phase built — the 0x3C room mask. */
  roads: Tile[];
  /** MUTATED: `zone+0xB4` — lake seeds and big-static positions. */
  bigPositions: Tile[];
  /** The preset's BigStatics, resolved, in file order. */
  bigStatics: Footprint[];
  /** The preset's Mountains, resolved, in file order. */
  mountains: Footprint[];
  /** The preset's OverLakeCenterObjects, resolved. */
  overLakeCenterObjects: Footprint[];
  /** The preset's OverLakeOneTileRandomObjects, resolved (holes kept null). */
  overLakeOneTileRandomObjects: Array<Footprint | null>;
  /** `world+0x5C` — mapSetup's one betweenFloat(0, 2pi). */
  mapAngle: number;
  /** MUTATED when given: the level's height grid, for the relief cones. */
  heights?: Float32Array;
}

export interface BigStaticsResult {
  placed: PlacedStatic[];
  /** The accepted lake seeds, in acceptance order. */
  lakeSeeds: Tile[];
  /** Every tile the lake blobs flooded (occupancy 0x80), for the painter. */
  lakeTiles: Tile[];
}

/** `0xED1660` — the mountain relief cone; drawless. */
function raiseRelief(input: BigStaticsInput, at: Tile, q: number, blocked: readonly Tile[]): void {
  if (!input.heights) return;
  for (const off of blocked) {
    const [dx, dy] = rotate(q, off);
    const r = fl(Math.sqrt(fl(dx * dx + dy * dy)));
    if (r >= fl(3.5)) continue;
    const x = at[0] + dx;
    const y = at[1] + dy;
    if (x < 0 || x >= input.size || y < 0 || y >= input.size) continue;
    input.heights[y * input.size + x] = fl(input.heights[y * input.size + x]! + fl(2 * fl(fl(3.5) - r)));
  }
}

/** `0xEC39D0` — the statics fit: blocked tiles only, byte-wide, no zone test. */
export function staticFits(
  input: Pick<BigStaticsInput, 'size' | 'occupancy' | 'room' | 'floor'>,
  blocked: readonly Tile[],
  at: Tile,
  q: number,
): boolean {
  const { size, occupancy, room } = input;
  for (const off of blocked) {
    const [dx, dy] = rotate(q, off);
    const x = at[0] + dx;
    const y = at[1] + dy;
    if (x < 0 || x >= size || y < 0 || y >= size) return false;
    if (input.floor === 1 && (x < 5 || x >= size - 5 || y < 5 || y >= size - 5)) return false;
    if ((occupancy[y * size + x]! & 0x3e) !== 0) return false;
    if (room[y]![x]! < 2) return false;
  }
  return true;
}

const dist = ([ax, ay]: Tile, [bx, by]: Tile): number =>
  fl(Math.sqrt(fl((ax - bx) * (ax - bx) + (ay - by) * (ay - by))));

/** The lakes prologue — `0xEBC260`; seeds, blob, decorations, one-tilers. */
function growLakes(input: BigStaticsInput, rng: DrawSource): { seeds: Tile[]; blob: Tile[]; placed: PlacedStatic[] } {
  const { size, grid, border, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];

  // Mask 0x3E — 0x3C plus the unwritten `+0x5C` list, so the same points.
  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);

  const seeds: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      const r = room[y]![x]!;
      if (r <= 5 || border[y]![x]! <= 5) continue;
      let localMax = true;
      for (const [dx, dy] of EIGHT) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        // Only a STRICTLY greater neighbour disqualifies (`jg` at
        // 0xebc380) — a plateau is all maxima. The reference never runs
        // this scan (the gate above is closed for RANDOM_TYPE zones), so
        // the tie rule is held by the reading alone.
        if (room[ny]![nx]! > r) {
          localMax = false;
          break;
        }
      }
      if (!localMax) continue;
      const roll = rng.betweenFloat(0, 1);
      if (roll >= fl(0.4)) continue;
      if (seeds.some((s) => dist(s, [x, y]) < fl(20))) continue;
      seeds.push([x, y]);
      input.bigPositions.push([x, y]);
    }
  }

  // The blob — drawless. Scratch 1000, seeds 0 + occupancy 2, chamfer
  // wavefront marking 0x80.
  const scratch = new Float32Array(size * size).fill(1000);
  for (const [sx, sy] of seeds) {
    scratch[sy * size + sx] = 0;
    occupancy[sy * size + sx] = 2;
  }
  for (let wave = 0; wave < 13; wave++) {
    let count = 0;
    for (let x = 1; x < size - 1; x++) {
      for (let y = 1; y < size - 1; y++) {
        if (grid[y]![x] !== zoneIndex) continue;
        if (scratch[y * size + x] !== wave) continue;
        count++;
        for (let k = 0; k < 8; k++) {
          const [dx, dy] = EIGHT[k]!;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          if (occupancy[ny * size + nx] !== 0) continue;
          if (room[ny]![nx]! <= 2 || border[ny]![nx]! <= 2) continue;
          scratch[ny * size + nx] = wave + (k < 4 ? 2 : 3);
          occupancy[ny * size + nx] = 0x80;
        }
      }
    }
    if (count > 0 && count < wave) break;
  }
  const blob: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (scratch[y * size + x] !== 1000 && room[y]![x]! > 3) blob.push([x, y]);
    }
  }

  // Seed decorations — `0xEC3B30`, gated on OverLakeCenterObjects.
  if (input.overLakeCenterObjects.length) {
    for (const [sx, sy] of seeds) {
      const n = rng.below(3) + 1;
      for (let i = 0; i < n; i++) {
        const q = rng.below(4);
        const jx = rng.below(5) - 2;
        const jy = rng.below(5) - 2;
        const entry = input.overLakeCenterObjects[rng.below(input.overLakeCenterObjects.length)]!;
        placed.push({
          type: entry.path, name: mintName(rng),
          x: sx + jx, y: sy + jy, angle: q * (Math.PI / 2),
        });
      }
    }
  }

  // The over-lake one-tilers — `0xEC3E00`, iterating the COLLECTED LAKE
  // TILES (the blob, room > 3), not the seeds; one below(10) per tile.
  if (input.overLakeOneTileRandomObjects.length) {
    for (const [tx, ty] of blob) {
      if (rng.below(10) > 5) continue;
      const q = rng.below(4);
      const entry = input.overLakeOneTileRandomObjects[rng.below(input.overLakeOneTileRandomObjects.length)];
      if (!entry) continue; // a null href skips creation, draws spent
      placed.push({ type: entry.path, name: mintName(rng), x: tx, y: ty, angle: q * (Math.PI / 2) });
    }
  }

  return { seeds, blob, placed };
}

/** The preset-Mountains pass — `0xEBCAF0`; empty list means zero draws. */
function placePresetMountains(input: BigStaticsInput, rng: DrawSource): PlacedStatic[] {
  const placed: PlacedStatic[] = [];
  if (!input.mountains.length) return placed;
  const { size, grid, room, occupancy, zoneIndex } = input;
  const done: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (room[y]![x]! <= 4) continue;
      if (done.some((d) => dist(d, [x, y]) < fl(4))) continue;
      const entry = input.mountains[rng.below(input.mountains.length)]!;
      const q = rng.below(4);
      if (!staticFits(input, entry.blocked, [x, y], q)) continue;
      const name = mintName(rng);
      for (const off of entry.blocked) {
        const [dx, dy] = rotate(q, off);
        const bx = x + dx;
        const by = y + dy;
        if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
        // The engine writes 0x100 into a wider cell; the byte-wide fit
        // reads 0 there, and so does this grid.
        occupancy[by * size + bx] = 0;
      }
      done.push([x, y]);
      placed.push({ type: entry.path, name, x, y, angle: q * (Math.PI / 2) });
      raiseRelief(input, [x, y], q, entry.blocked);
    }
  }
  return placed;
}

/** The whole slot-+0x34 step for one surface-class zone. */
export function placeZoneBigStatics(input: BigStaticsInput, rng: DrawSource): BigStaticsResult {
  const { size, grid, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];
  let lakeSeeds: Tile[] = [];
  let lakeTiles: Tile[] = [];

  if (input.floor !== 1) {
    if (LAKE_RACES.has(input.settingRace) && input.floor === 0) {
      const lakes = growLakes(input, rng);
      lakeSeeds = lakes.seeds;
      lakeTiles = lakes.blob;
      placed.push(...lakes.placed);
    }
    placed.push(...placePresetMountains(input, rng));
  }

  // The sweep. Room with mask 0x3C, candidates once, types in file order.
  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);
  const candidates: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] === zoneIndex && room[y]![x]! > 1) candidates.push([x, y]);
    }
  }

  for (const entry of input.bigStatics) {
    const n = entry.blocked.length;
    const big = n > 10;
    const isCrater = big && entry.path.includes('Crater');
    for (const cand of candidates) {
      if (isCrater && input.bigPositions.some((p) => dist(p, cand) < fl(15))) continue;
      let q = -1;
      for (let attempt = 0; attempt < (big ? 4 : 1); attempt++) {
        const angle = big ? attempt : rng.below(4);
        if (staticFits(input, entry.blocked, cand, angle)) {
          q = angle;
          break;
        }
      }
      if (q < 0) continue;
      const dbgDraws = (rng as unknown as { draws?: number }).draws ?? 0;
      if (process.env['RMG_DBG'] && dbgDraws >= 45310 && dbgDraws <= 45330) {
        console.log(`    fitpass ${dbgDraws} zone ${zoneIndex} ${entry.path.split('/').pop()} at ${cand[0]}:${cand[1]}`);
      }
      const roll = rng.betweenFloat(0, 1);
      if (roll >= fl(1 / (n + 1))) continue;

      const name = mintName(rng);
      if (big) input.bigPositions.push(cand);
      // The standard stamp — statics carry no actives and a (0,0) marker,
      // so in practice only the blocked pass writes.
      for (const off of entry.blocked) {
        const [dx, dy] = rotate(q, off);
        const bx = cand[0] + dx;
        const by = cand[1] + dy;
        if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
        occupancy[by * size + bx] = 2;
      }
      for (const off of entry.active) {
        const [dx, dy] = rotate(q, off);
        const bx = cand[0] + dx;
        const by = cand[1] + dy;
        if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
        occupancy[by * size + bx] = 4;
        input.points.push([bx, by]);
      }
      placed.push({ type: entry.path, name, x: cand[0], y: cand[1], angle: q * (Math.PI / 2) });
      if (entry.path.includes('Mountain') && n > 15) raiseRelief(input, cand, q, entry.blocked);
    }
  }

  return { placed, lakeSeeds, lakeTiles };
}
