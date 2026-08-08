// Does the reachability check know a way through from a wall?
//
// A check of this kind is worth nothing unless it is known to go red: a map
// where everything is reachable and one where nothing is look identical coming
// out of a function that always answers "fine". So every case here is a small
// board with an answer worked out by hand, and each wall is put up and taken
// down again.
//
// Two things this asserts that are easy to get backwards, and neither fails
// loudly in the app:
//
//   a GREEN tile is walkable — a hero crosses a doorway on his way past, and
//     treating one as solid makes half a map read as unreachable;
//   the floors are joined by portals and by nothing else.

import { reachFrom } from '../src/map/reach.ts';
import type { ReachObject } from '../src/map/reach.ts';
import { classifyTiles, PASS_BLOCKED, PASS_NAVIGABLE, PASS_WALK } from '../src/terrain/passability.ts';

let failures = 0;
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) { failures++; console.log(`FAIL ${what}${detail ? ` — ${detail}` : ''}`); }
};

const SIZE = 16;
const open = (): Uint8Array => new Uint8Array(SIZE * SIZE);
/** A wall down a column, with a gap at `gapY` when one is given. */
const wall = (grid: Uint8Array, x: number, gapY?: number): void => {
  for (let y = 0; y < SIZE; y++) if (y !== gapY) grid[y * SIZE + x] = 1;
};
/** A one-tile object entered through the tile it stands on. */
const thing = (id: string, x: number, y: number, floor = 0): ReachObject =>
  ({ id, label: id, floor, x, y, blocked: [], active: [{ x: 0, y: 0 }] });

const START = [{ x: 1, y: 8, floor: 0 }];

// --- a wall with a gap, and the same wall without one ---------------------------
{
  const terrain = open();
  wall(terrain, 6, 8);
  const objects = [thing('near', 2, 8), thing('far', 12, 8)];
  const through = reachFrom({ size: SIZE, terrain: [terrain], objects, starts: START });
  check('a gap in the wall is a way through', through.unreached.length === 0,
    through.unreached.map((u) => u.label).join(','));

  wall(terrain, 6);
  const shut = reachFrom({ size: SIZE, terrain: [terrain], objects, starts: START });
  check('and a wall without one is not', shut.unreached.length === 1);
  check('the check names what it cannot reach', shut.unreached[0]?.label === 'far');
  check('and says where it is', shut.unreached[0]?.x === 12 && shut.unreached[0]?.y === 8,
    `${shut.unreached[0]?.x},${shut.unreached[0]?.y}`);
  check('less ground is walked when it is shut', shut.visited < through.visited,
    `${shut.visited} vs ${through.visited}`);
}

// --- what you may walk over, and what you may only walk up to ---------------------
//
// A row of buildings across the map with a one-tile gap in it. What stands in
// the gap decides whether there is a way past: a monster is fought and gone, a
// mine is visited from its doorstep and the doorstep is as far as you get.
{
  const body: { x: number; y: number }[] = [];
  for (let y = 0; y < SIZE; y++) if (y !== 8) body.push({ x: 0, y: y - 8 });
  const row: ReachObject = { id: 'row', label: 'row of walls', floor: 0, x: 6, y: 8, blocked: body, active: [] };
  const inGap = (id: string, crossable: boolean): ReachObject =>
    ({ id, label: id, floor: 0, x: 6, y: 8, blocked: [], active: [{ x: 0, y: 0 }], crossable });

  const past = reachFrom({
    size: SIZE, terrain: [open()],
    objects: [row, inGap('monster', true), thing('far', 12, 8)], starts: START,
  });
  check('a monster in the gap is a way through', !past.unreached.length,
    past.unreached.map((u) => u.label).join(','));

  const stop = reachFrom({
    size: SIZE, terrain: [open()],
    objects: [row, inGap('mine', false), thing('far', 12, 8)], starts: START,
  });
  check('a mine in the gap is not', stop.unreached.some((u) => u.label === 'far'),
    stop.unreached.map((u) => u.label).join(','));
  check('but the mine itself is reached, from its doorstep',
    !stop.unreached.some((u) => u.label === 'mine'));
}

// --- masking the ground under a door -----------------------------------------------
//
// A designer who masks a doorway has closed the WAY THROUGH, and a hero can
// still walk up to the door from the open side and use it — arriving is
// standing beside it. Written down because it is a rule, not an accident: if
// the game turns out to want the hero ON the tile, this is the line to change,
// and the far side of the wall says which way round it was tested.
{
  const terrain = open();
  wall(terrain, 6);
  const gate: ReachObject = {
    id: 'gate', label: 'gate', floor: 0, x: 6, y: 8, blocked: [], active: [{ x: 0, y: 0 }], crossable: false,
  };
  const out = reachFrom({ size: SIZE, terrain: [terrain], objects: [gate, thing('far', 12, 8)], starts: START });
  check('a masked doorway is still visited from beside it', !out.unreached.some((u) => u.label === 'gate'),
    out.unreached.map((u) => u.label).join(','));
  check('and is no way through the mask', out.unreached.some((u) => u.label === 'far'));
}

// --- an object walled in on every side ----------------------------------------------
//
// The case the doorstep rule exists for and the one it must still catch: not a
// covered doorway — you can stand beside a covered doorway — but a doorway with
// nowhere beside it left to stand.
{
  const ring: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ring.push({ x: dx, y: dy });
  const objects: ReachObject[] = [
    { id: 'mine', label: 'mine', floor: 0, x: 8, y: 8, blocked: [], active: [{ x: 0, y: 0 }], crossable: false },
    { id: 'walls', label: 'walls', floor: 0, x: 8, y: 8, blocked: ring, active: [] },
  ];
  const out = reachFrom({ size: SIZE, terrain: [open()], objects, starts: START });
  check('a door with nowhere to stand is unreachable', out.unreached.some((u) => u.label === 'mine'),
    out.unreached.map((u) => u.label).join(','));
}

// --- two floors, joined only by a portal ------------------------------------------
{
  const terrain = [open(), open()];
  const up: ReachObject = { ...thing('gate up', 4, 4, 0), group: 'g1' };
  const down: ReachObject = { ...thing('gate down', 4, 4, 1), group: 'g1' };
  const below = thing('below', 8, 8, 1);

  const alone = reachFrom({ size: SIZE, terrain, objects: [up, below, { ...down, group: undefined }], starts: START });
  check('without a portal the lower floor is out of reach', alone.unreached.length === 2,
    `${alone.unreached.length} unreached`);

  const joined = reachFrom({ size: SIZE, terrain, objects: [up, down, below], starts: START });
  check('through the portal it is not', joined.unreached.length === 0,
    joined.unreached.map((u) => u.label).join(','));
}

// --- scenery is not a destination --------------------------------------------------
{
  const tree: ReachObject = { id: 'tree', label: 'tree', floor: 0, x: 12, y: 8, blocked: [{ x: 0, y: 0 }], active: [] };
  const terrain = open();
  wall(terrain, 6);
  const out = reachFrom({ size: SIZE, terrain: [terrain], objects: [tree], starts: START });
  check('a tree behind a wall is nobody\'s problem', out.unreached.length === 0);
}

// --- and the ground rule the wash draws with ----------------------------------------
//
// Same function, so the view and the check cannot drift apart. Asserted here
// because the check hands its answer to a wash, and a wash of the wrong tiles
// is worse than none.
{
  const V = 4;
  const flat = new Float32Array(V * V);
  const plain = classifyTiles({ V, heights: flat, flags: null, passable: null, river: () => false });
  check('flat open ground is walkable', [...plain].every((v) => v === PASS_WALK));

  const masked = new Uint8Array(V * V).fill(1);
  masked[1 * V + 1] = 0;
  const one = classifyTiles({ V, heights: flat, flags: null, passable: masked, river: () => false });
  check('a masked tile is blocked, and only that tile',
    one[1 * (V - 1) + 1] === PASS_BLOCKED && [...one].filter((v) => v === PASS_BLOCKED).length === 1,
    [...one].join(''));

  const sea = new Uint8Array(V * V); // flag 0 everywhere: navigable, not blocked
  const wet = classifyTiles({ V, heights: flat, flags: sea, passable: null, river: () => false });
  check('sea is navigable rather than blocked', [...wet].every((v) => v === PASS_NAVIGABLE));

  const cliff = new Float32Array(V * V);
  for (let y = 0; y < V; y++) cliff[y * V + 2] = 4;
  const steep = classifyTiles({ V, heights: cliff, flags: null, passable: null, river: () => false });
  check('a step too tall to climb is blocked', steep[1 * (V - 1) + 1] === PASS_BLOCKED, [...steep].join(''));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
