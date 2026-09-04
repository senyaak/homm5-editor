// Big statics — the surface CGameZone's vtable slot +0x34 (`0xEBBBD0`),
// first of the two virtual steps the statics driver `0xEA5450` runs per
// zone (template entry order, no prologue draw — the phase starts on the
// roads boundary exactly).
//
// THREE PARTS, in the order the code runs them:
//
// The underground run opened the lakes for real (its zone 2 resolves to
// HEAVEN) and rewrote most of this file's first reading; every claim
// below is now held by that run's lockstep and by-name checks.
//
// LAKES (`0xEBC260`) — surface zones of the lake races only ({HEAVEN,
// PRESERVE, NECROMANCY, INFERNO, DWARF, STRONGHOLD}), by the RESOLVED
// race (`zone+0x18`): the surface reference's Inferno zone simply had
// zero seed candidates, which a closed gate and an empty scan spell
// identically. Room is recomputed with mask 0x3E = 0x3C plus the zone's
// `+0x5C` stamped-blocked ledger (its writer is the stamp `0xEC2F90`
// itself — every mine, dwelling, building, town and teleport feeds it;
// a mine's piles and the treasures don't, they write their 2s directly).
// A zone tile is a seed candidate when room > 5, border > 5 and it is a
// local maximum of room over its 8 in-bounds neighbours (ties pass);
// each candidate costs ONE betweenFloat(0,1) and is accepted when the
// roll < 0.4 AND it sits >= 20.0 from every seed already accepted.
// Seeds join `zone+0xB4` — never the room masks. The blob then grows
// drawlessly: the scratch grid starts at 1000, seeds get 0 and
// occupancy 2, and a chamfer wavefront (orthogonals +2, diagonals +3,
// occupancy 0x80 on write) spreads over free in-zone tiles with
// room > 2 and border > 2, while wave < 13 with an early exit when
// 0 < count(wave) < wave; collection keeps room > 3. The lake painter's
// tail then converts the DEEP WATER (see below), and the seed
// decorations (`0xEC3B30`, OverLakeCenterObjects — jitter: the first
// below(5) moves the pair's a field, the map file's Y) and the
// over-lake one-tilers (`0xEC3E00`, OverLakeOneTileRandomObjects — a
// self-closed <Item/> is a HOLE: picked for three draws, creates
// nothing) mint without fit, stamp or occupancy.
//
// DEEP WATER (`0xECE680` → 0xecee65, drawless, two-phase): every level
// cell in 1..dim-2 with at least three of its eight neighbours at
// EXACTLY 0x80 turns 0x82 — which the fit's & 0x3E refuses. Statics may
// stand on a lake's rim, never in its interior.
//
// PRESET MOUNTAINS (`0xEBCAF0`) — only when the preset's Mountains list
// is non-empty. NO recompute: candidates are zone tiles with room > 4
// on the grid the LAKES HEAD left (stale room when the lakes gate never
// opened). Per candidate: at least 4.0 from every previously placed
// mountain (local done-list), below(len) type FIRST, below(4) quadrant,
// the fit (vt+0x44); success mints (two below), writes 0x100 per
// blocked cell (invisible to the byte-wide fit — mountains overlap
// freely within the pass) and raises the relief cone unconditionally.
// AFTER the whole pass every accumulated blocked cell turns 2 — the
// sweep behind it fails its fits over mountain footprints.
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
// THE FIT (`0xEC39D0`, vtable +0x44 for every zone class, drawless):
// per rotated blocked offset — in bounds; on floor 1 only, five tiles
// from every map edge; occupancy byte & 0x3E == 0 (objects, guards,
// roads and DEEP WATER 0x82 block; the rim's 0x80 and the mountains'
// transient 0x100 pass); room >= 2 SIGNED — and NO zone test, which is
// where the stale room of neighbouring zones becomes load-bearing.

import type { DrawSource } from './armies.ts';
import { mintName } from './armies.ts';
import { coneRelief } from './heights.ts';
import type { HeightPlane } from './heights.ts';
import { carveMassif } from './massif-carve.ts';
import type { VertexHeights } from './massif-carve.ts';
import { EIGHT, recomputeRoom, zoneTiles } from './placement.ts';
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
  /**
   * The subterranean point light (`vt+0x3C`) — two draws when the
   * resource path matches the class's substrings ("Crystal" for
   * Subterra/SubInferno, "Fakel"/"FireColumn" for Dwarven). The colour
   * costs no draw: preset `PointLightParams.Colors[zoneId % count]`.
   */
  light?: { z: number; radius: number };
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
   * `zone+0x18` — the RESOLVED race. The surface reference's Inferno
   * zone showed no lake draws not because the gate was closed but
   * because its seed scan had zero candidates; the underground run's
   * HEAVEN zone opened the gate for real and pinned the reading.
   */
  settingRace: number;
  /** The three road lists the roads phase built — the 0x3C room mask. */
  roads: Tile[];
  /**
   * The zone's `+0x5C` stamped-blocked ledger — 0x3E's extra bit over
   * 0x3C, read by the LAKES recompute alone; the sweep's own accepted
   * stamps append to it. Measured on the underground run's zone-2 lakes:
   * without it 27 seed candidates, the engine counts 14.
   */
  blockedList: Tile[];
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
  /** MUTATED when given: the floor's vertex height plane, for the relief cones. */
  heightPlane?: HeightPlane;
  /**
   * The subterranean override (`0xEC4A70`, shared by Subterra, Dwarven's
   * vt+0x40 and SubInferno's `0xEC92D0`): the massif carve replaces the
   * lakes and mountains, and the accept path drops the relief cone and
   * the "Mountain" test. The sweep itself is the base sweep verbatim.
   */
  subterranean?: boolean;
  /** The floor's vertex height grids — required when `subterranean`. */
  vertexHeights?: VertexHeights;
  /**
   * A water-bordered zone: the fit is the `+0x44` override (`0xECD840`,
   * border >= 3 on every blocked tile) and the candidates come from
   * `tiles` — the carve's rebuilt `+0xCC`, rim included (room 1000).
   */
  water?: boolean;
  /** The rebuilt `+0xCC` when `water` — the grid no longer derives it. */
  tiles?: Tile[];
}

export interface BigStaticsResult {
  placed: PlacedStatic[];
  /** The accepted lake seeds, in acceptance order. */
  lakeSeeds: Tile[];
  /** Every tile the lake blobs flooded (occupancy 0x80), for the painter. */
  lakeTiles: Tile[];
  /**
   * Per lake tile, what the terrain painter reads AT THAT MOMENT — the
   * room grid as the head left it and the border table. Snapshotted here
   * because the layers the paints land on only exist once fillTerrain has
   * been replayed, by which time every zone behind this one has recomputed
   * the room grid. `paintLakes` / `stampZoneLakeRiver` in terrain.ts.
   */
  lakeRoom: Int32Array;
  lakeBorder: Int32Array;
}

/** `0xED1660` — the mountain relief cone; drawless. */
function raiseRelief(input: BigStaticsInput, at: Tile, q: number, blocked: readonly Tile[]): void {
  if (!input.heightPlane) return;
  coneRelief(input.heightPlane, at[0], at[1], q, blocked);
}

/**
 * `0xEC39D0` — the statics fit: blocked tiles only, byte-wide, no zone test.
 * The fit is the zone vtable's `+0x44`, and CGameWaterBorderedZone overrides
 * it (`0xECD840`) with one more gate: **border >= 3** — the statics keep off
 * the coast — and no floor margin (a water zone is floor 0 by construction).
 */
export function staticFits(
  input: Pick<BigStaticsInput, 'size' | 'occupancy' | 'room' | 'floor' | 'water' | 'border'>,
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
    if (input.water && input.border[y]![x]! < 3) return false;
    if ((occupancy[y * size + x]! & 0x3e) !== 0) return false;
    if (room[y]![x]! < 2) return false;
  }
  return true;
}

const dist = ([ax, ay]: Tile, [bx, by]: Tile): number =>
  fl(Math.sqrt(fl((ax - bx) * (ax - bx) + (ay - by) * (ay - by))));

interface GrownLakes {
  seeds: Tile[];
  blob: Tile[];
  /** The blob's room and border readings, for the terrain painter. */
  blobRoom: Int32Array;
  blobBorder: Int32Array;
  placed: PlacedStatic[];
}

/** The lakes prologue — `0xEBC260`; seeds, blob, decorations, one-tilers. */
function growLakes(input: BigStaticsInput, rng: DrawSource): GrownLakes {
  const { size, grid, border, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];

  // Mask 0x3E — 0x3C plus the zone's stamped-blocked ledger (+0x5C).
  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads, ...input.blockedList]);

  // The scan walks the zone's `+0xCC` (0xebc2c9 loads it and converts each
  // float pair with `cvttss2si`), and its first test is the room — there is
  // no zone test at all, so a tile the grid has since disowned is scanned
  // like any other.
  const seeds: Tile[] = [];
  for (const [x, y] of input.tiles ?? zoneTiles(size, grid, zoneIndex)) {
    const r = room[y]![x]!;
    if (r <= 5 || border[y]![x]! <= 5) continue;
    let localMax = true;
    for (const [dx, dy] of EIGHT) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      // Only a STRICTLY greater neighbour disqualifies (`jg` at
      // 0xebc380) — a plateau is all maxima. Confirmed live by the
      // underground run's zone 2 (ties-lose leaves 1 candidate of the
      // measured 14).
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

  // What the terrain painter reads before anything behind it moves on.
  const blobRoom = new Int32Array(blob.length);
  const blobBorder = new Int32Array(blob.length);
  for (let i = 0; i < blob.length; i++) {
    const [bx, by] = blob[i]!;
    blobRoom[i] = room[by]![bx]!;
    blobBorder[i] = border[by]![bx]!;
  }

  // The lake painter's tail (`0xECE680` → 0xecee65): DEEP WATER. Every
  // cell of the level (1..dim−2, own occupancy never tested) with at
  // least THREE of its eight neighbours at EXACTLY 0x80 turns 0x82 in a
  // second phase — and 0x82 & 0x3E = 2, so the fit that lets statics
  // stand on the lake's rim refuses its interior. The two phases are
  // load-bearing: converted cells no longer count as 0x80 for later
  // scans, and a non-lake cell (roads included) surrounded by the blob
  // is swallowed whole.
  const deep: Tile[] = [];
  for (let x = 1; x < size - 1; x++) {
    for (let y = 1; y < size - 1; y++) {
      let n80 = 0;
      for (const [dx, dy] of EIGHT) {
        if (occupancy[(y + dy) * size + (x + dx)] === 0x80) n80++;
      }
      if (n80 > 2) deep.push([x, y]);
    }
  }
  for (const [x, y] of deep) occupancy[y * size + x] = 0x82;

  // Seed decorations — `0xEC3B30`, gated on OverLakeCenterObjects: no
  // fit, no stamp, no occupancy — just mints at jittered positions.
  if (input.overLakeCenterObjects.length) {
    for (const [sx, sy] of seeds) {
      const n = rng.below(3) + 1;
      for (let i = 0; i < n; i++) {
        const q = rng.below(4);
        // The first below(5) jitters the pair's FIRST field — the a
        // axis, the map file's Y — the second the b/x axis (the port's
        // decos landed transposed around their seeds until the
        // reference said otherwise).
        const ja = rng.below(5) - 2;
        const jb = rng.below(5) - 2;
        const entry = input.overLakeCenterObjects[rng.below(input.overLakeCenterObjects.length)]!;
        placed.push({
          type: entry.path, name: mintName(rng),
          x: sx + jb, y: sy + ja, angle: q * (Math.PI / 2),
        });
      }
    }
  }

  // The over-lake one-tilers — `0xEC3E00`, iterating the COLLECTED LAKE
  // TILES (the blob, room > 3), not the seeds; one below(10) per tile.
  if (input.overLakeOneTileRandomObjects.length) {
    for (const [tx, ty] of blob) {
      // Three draws per rolled tile; a null href (a list hole) skips the
      // creation and its mint. No occupancy is written here at all.
      if (rng.below(10) > 5) continue;
      const q = rng.below(4);
      const entry = input.overLakeOneTileRandomObjects[rng.below(input.overLakeOneTileRandomObjects.length)];
      if (!entry) continue;
      placed.push({ type: entry.path, name: mintName(rng), x: tx, y: ty, angle: q * (Math.PI / 2) });
    }
  }

  return { seeds, blob, blobRoom, blobBorder, placed };
}

/** The preset-Mountains pass — `0xEBCAF0`; empty list means zero draws. */
function placePresetMountains(input: BigStaticsInput, rng: DrawSource): PlacedStatic[] {
  const placed: PlacedStatic[] = [];
  if (!input.mountains.length) return placed;
  const { size, grid, room, occupancy, zoneIndex } = input;
  // NO recompute here — the pass reads the room grid exactly as the
  // LAKES HEAD left it (`0xEC28E0(0x3E,0)` before any seed existed);
  // seeds, decorations and one-tilers never touch room.
  const done: Tile[] = [];
  const blockedCells: Tile[] = [];
  // Two loops in the engine, and the first walks `+0xCC` (0xebcb18) keeping
  // every entry whose room is above 4 — again with no zone test. The second
  // is the one below: spacing, the two draws, the fit.
  for (const [x, y] of input.tiles ?? zoneTiles(size, grid, zoneIndex)) {
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
      // The engine writes rows[x][y] with NO bounds check, and the
      // grid's rows live in one contiguous x-major buffer — an
      // out-of-range y WRAPS into the neighbouring row (buf[x*size+y]),
      // while an out-of-range x leaves the buffer and is dropped here.
      const flat = bx * size + by;
      if (bx < 0 || bx >= size || flat < 0 || flat >= size * size) continue;
      const xw = Math.floor(flat / size);
      const yw = flat - xw * size;
      // DURING the pass the engine writes 0x100 — invisible to the
      // byte-wide fit, so mountains overlap freely and only the 4.0
      // rule separates them. This grid's byte reads the same 0.
      occupancy[yw * size + xw] = 0;
      blockedCells.push([xw, yw]);
    }
    done.push([x, y]);
    placed.push({ type: entry.path, name, x, y, angle: q * (Math.PI / 2) });
    raiseRelief(input, [x, y], q, entry.blocked);
  }
  // AFTER the candidate loop (`0xebd114..0xebd169`) every accumulated
  // blocked cell turns to 2 — the sweep behind this pass fails its fits
  // over mountain footprints (and over any lake cell beneath them).
  for (const [bx, by] of blockedCells) occupancy[by * size + bx] = 2;
  return placed;
}

/** The whole slot-+0x34 step for one surface-class zone. */
export function placeZoneBigStatics(input: BigStaticsInput, rng: DrawSource): BigStaticsResult {
  const { size, grid, occupancy, room, zoneIndex } = input;
  const placed: PlacedStatic[] = [];
  let lakeSeeds: Tile[] = [];
  let lakeTiles: Tile[] = [];
  let lakeRoom: Int32Array = new Int32Array(0);
  let lakeBorder: Int32Array = new Int32Array(0);

  if (input.subterranean) {
    // vt+0x40: recomputeRoom(0x3C, all=1) then the carve, then
    // recomputeRoom(0x3C, 0) — all drawless. The all=1 flavour walks the
    // ZONE'S OWN LEVEL against the zone's own lists (`0xEC28E0` reads
    // `ecx`'s vectors throughout), so with one zone on the floor both
    // recomputes write what the sweep's own recompute below writes, and
    // neither is materialised here. The carve is called by EVERY
    // subterranean zone and no-ops after the first (its conversion pass
    // turns the clean patches to blocked).
    carveMassif(size, occupancy, input.vertexHeights!);
  } else if (input.floor !== 1) {
    if (LAKE_RACES.has(input.settingRace) && input.floor === 0) {
      const lakes = growLakes(input, rng);
      lakeSeeds = lakes.seeds;
      lakeTiles = lakes.blob;
      lakeRoom = lakes.blobRoom;
      lakeBorder = lakes.blobBorder;
      placed.push(...lakes.placed);
    }
    if (process.env['H5E_DEBUG_STATICS']) {
      console.log(`  [big z${zoneIndex}] lakes done at ${(rng as { draws?: number }).draws}, seeds ${lakeSeeds.length}, blob ${lakeTiles.length}`);
    }
    placed.push(...placePresetMountains(input, rng));
    if (process.env['H5E_DEBUG_STATICS']) {
      console.log(`  [big z${zoneIndex}] mountains done at ${(rng as { draws?: number }).draws}`);
    }
  }

  // The sweep. Room with mask 0x3C, candidates once, types in file order.
  recomputeRoom(room, size, grid, zoneIndex, [...input.points, ...input.roads]);
  const candidates: Tile[] = [];
  for (const [x, y] of input.tiles ?? zoneTiles(size, grid, zoneIndex)) {
    if (room[y]![x]! > 1) candidates.push([x, y]);
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
      if (process.env['RMG_DBG']
        && dbgDraws >= Number(process.env['RMG_DBG_FROM'] ?? 45310)
        && dbgDraws <= Number(process.env['RMG_DBG_TO'] ?? 45330)) {
        console.log(`    fitpass ${dbgDraws} zone ${zoneIndex} ${entry.path.split('/').pop()} n=${n} at ${cand[0]}:${cand[1]}`);
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
        input.blockedList.push([bx, by]);
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
      // The subterranean sweep (`0xEC4A70`) has no relief cone and no
      // "Mountain" test on its accept path.
      if (!input.subterranean && entry.path.includes('Mountain') && n > 15) raiseRelief(input, cand, q, entry.blocked);
    }
  }

  return { placed, lakeSeeds, lakeTiles, lakeRoom, lakeBorder };
}
