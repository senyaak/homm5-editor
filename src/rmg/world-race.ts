// Which real town a RANDOM town stands as in the engine's world — the one
// thing about random towns the map record does not hold.
//
// The record keeps the placeholder (`/MapObjects/RandomTown.xdb`), but the
// object the world builds for it is a real town of one race — the minimap's
// mask registers that object's lists and the icon anchors on them — and the
// race is decided in `0xB553A0 (world, record)`, read out of the game's image
// and held to its own log (three hooks, twelve draws, twelve agreements):
//
//   1. the OWNER's race, when the record has a PlayerID (`+0x84`) — the world's
//      player answers `vt+0x34`;
//   2. else the LINKED player's or town's (`RndSource` at `+0x11C`: 1 a player,
//      2 a town — the town's own answer, recursively), which is how a dwelling
//      bound to a town takes the town's race;
//   3. and when that is still RANDOM or NO_TYPE — every neutral town of a
//      generated map — a SEEDED DRAW with no state behind it:
//
//        h    = hash of "/RMGTemp/CurrentMap/map.xdb#xpointer(id(<name>)/AdvMapTown)"
//               — the record's own path in the generator's temp world, case-
//               folded, `h = h * 5 + c` over the bytes (0x983915; the fold table
//               at 0x1182300 lowers A..Z and turns '\' into '/')
//        seed = adler32(0x12345678, [FIRST, trunc(pos.x), trunc(pos.y), h]) + 16
//               (0xB4E4C0: the four ints as little-endian bytes through zlib's
//               adler32, plus the byte count)
//        race = between(seed, 0, 7) + TOWN_HEAVEN
//               (0xB4E610: one two-step LCG on the MSVC constants, the state
//               being the seed itself; 0xB4E730 maps 0..7 onto the eight)
//
//      FIRST is the world's `+0x50`, read through `vt+0x124`: 0x89E3D3BD in the
//      game across two sessions and two maps, and the editor's neutral towns
//      come out the same with it — so a constant of the build, measured, not
//      derived.
//
// DWELLINGS have their own resolver, `0xB53D30`, with the same three arms over
// the record's `RndSource` (+0xAC): the owner's race, the linked player's, the
// linked TOWN's (0xB553A0 on the town record — which is how a dwelling bound to
// a town takes its race), and otherwise the draw — but the dwelling's seed is
// TWO ints, `adler32(0x12345678, [FIRST, h]) + 8` (0xB4E2D0), with the name
// path ending in `/AdvMapDwelling)` and NO position in it. The race then
// picks the `DWELLINGS_<RACE>` list and the tier's document. Four townless
// dwellings of one map said which: three not Dwarven and one Dwarven, and the
// four-int seed with either tag gets the Dwarven one wrong.
//
// No generator state, no order dependence: two builds agree on every town and
// two maps disagree, because the name and the tile are in the seed. Which is
// exactly what the fits had shown before the code was read.
//
// THE PLAYERS' RACES are the part the record does not hold either: in the
// worlds measured so far player 1 is Fortress, player 2 Heaven and player 4
// Dungeon on every map, players 3 and 5 one of the six the picture cannot
// tell apart. Where they come from is not read — they are an INPUT here
// (`WorldRaceInput.playerRaces`), with the measured ones as the default.

import { RACE } from './load-template.ts';

/** The world's `+0x50` in the game build — the seed vector's first word. */
export const WORLD_SEED_FIRST = -1981557827;

/** The path every record of the generator's temp world is addressed by. */
const TEMP_MAP_PATH = '/RMGTemp/CurrentMap/map.xdb';

/** `0x983915` — the case-folded multiply-by-five string hash. */
export function nameHash(s: string): number {
  let h = 0;
  for (const c of Buffer.from(s, 'latin1')) {
    const folded = c >= 65 && c <= 90 ? c + 32 : c === 92 ? 47 : c;
    h = (Math.imul(h, 5) + ((folded << 24) >> 24)) | 0;
  }
  return h;
}

/** zlib's adler32 over `buf`, continuing from `adler`. */
export function adler32(adler: number, buf: readonly number[]): number {
  let a = adler & 0xffff;
  let b = (adler >>> 16) & 0xffff;
  for (const c of buf) {
    a = (a + c) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** `0xB4E610` — one draw of the two-step LCG from an explicit state. */
export function seededBetween(seed: number, lo: number, hi: number): number {
  const a = (Math.imul(seed, 0x343fd) + 0x269ec3) | 0;
  const b = (Math.imul(a, 0x343fd) + 0x269ec3) | 0;
  const r = ((a >> 7) ^ (b << 6)) >>> 0;
  return (r % (hi - lo + 1)) + lo;
}

const le = (v: number): number[] => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v | 0);
  return [...b];
};

/** The race the seeded draw gives a TOWN record — the third arm above. */
export function drawnTownRace(name: string, x: number, y: number, first = WORLD_SEED_FIRST): number {
  const h = nameHash(`${TEMP_MAP_PATH}#xpointer(id(${name})/AdvMapTown)`);
  const seed = (adler32(0x12345678, [first, x, y, h].flatMap(le)) + 16) | 0;
  return seededBetween(seed, 0, 7) + RACE.HEAVEN;
}

/** The race the seeded draw gives a DWELLING record — `0xB4E2D0`, two ints. */
export function drawnDwellingRace(name: string, first = WORLD_SEED_FIRST): number {
  const h = nameHash(`${TEMP_MAP_PATH}#xpointer(id(${name})/AdvMapDwelling)`);
  const seed = (adler32(0x12345678, [first, h].flatMap(le)) + 8) | 0;
  return seededBetween(seed, 0, 7) + RACE.HEAVEN;
}

/**
 * The players' races in the world, 1-based slot — measured, see the header.
 * Players 3 and 5 are Heaven only because the picture cannot tell the six
 * apart; the other slots have never had a random town on a measured map.
 */
export const MEASURED_PLAYER_RACES: ReadonlyMap<number, number> = new Map([
  [1, RACE.DWARF], [2, RACE.HEAVEN], [3, RACE.HEAVEN], [4, RACE.DUNGEON], [5, RACE.HEAVEN],
]);

export interface WorldRaceInput {
  /** The town's minted name and record position, and its owner (0 neutral). */
  name: string;
  x: number;
  y: number;
  playerNo: number;
  playerRaces?: ReadonlyMap<number, number>;
  first?: number;
}

/** A random TOWN's race in the world — arms 1 and 3. */
export function townWorldRace(t: WorldRaceInput): number {
  const owner = t.playerNo ? (t.playerRaces ?? MEASURED_PLAYER_RACES).get(t.playerNo) : undefined;
  if (owner !== undefined && owner !== RACE.RANDOM && owner !== RACE.NO_TYPE) return owner;
  return drawnTownRace(t.name, t.x, t.y, t.first);
}

/**
 * A random DWELLING's race in the world: its town's when it is bound to one
 * (arm 2), else its own draw (arm 3) — its own name, no tile.
 */
export function dwellingWorldRace(d: { name: string; first?: number }, townRace: number | undefined): number {
  if (townRace !== undefined) return townRace;
  return drawnDwellingRace(d.name, d.first);
}
