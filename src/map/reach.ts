// Can one hero get to everything?
//
// A map can load, look right and be unplayable: a wood closed over the pass, a
// mine walled in by the town that grew next to it, a whole valley behind a rock
// field nobody meant to seal. Nothing complains. The game does not mind a mine
// no hero can reach, and neither does the editor — until somebody plays it.
//
// So the question is asked directly, from ONE hero, the way it is actually
// played:
//
//   RED tiles are an object's body and nobody crosses them.
//   GREEN tiles are where a hero stands to use it. Whether he can walk ON and
//     THROUGH one depends on what it belongs to: a monster, another hero and
//     anything you pick up leave the ground behind them free, and a building
//     does not — you step to its door and stop there. So a mine's doorway is a
//     place to arrive at, not a corridor through the mine.
//   The ground says the rest: the mask, the rivers, the cliffs, the sea. See
//     src/terrain/passability.ts, which is the same rule the viewport washes
//     the ground with.
//
// Reached, then, means a hero can put himself at the door: standing ON the
// green tile where that is possible, and on any tile beside it where it is not.
// An object with no green tiles is scenery — there is nothing to reach.
//
// Diagonal steps count: heroes move diagonally, so a gap of one tile on the
// diagonal is a way through.
//
// Portals and the floors. The two floors are joined by NOTHING but portals, so
// walking alone reads an underground as unreachable — true of walking and false
// of playing. Portals are grouped (a gate and its opposite number, a monolith
// and its fellows); reaching any end of a group reaches all of them, and that
// is iterated to a fixed point since a portal can land on ground holding
// another portal.

/** A tile offset from an object's own tile. */
export interface Offset { x: number; y: number }

/** One object, as the walk sees it. */
export interface ReachObject {
  /** The map's own id, so a caller can select what this reports. */
  id: string;
  /** What to call it in a report. */
  label: string;
  floor: number;
  /** The tile it stands on. */
  x: number;
  y: number;
  /** Tiles nobody may cross. */
  blocked: Offset[];
  /** Tiles a hero stands on to use it. */
  active: Offset[];
  /**
   * Does walking onto its green tile leave the ground free behind you?
   *
   * True of a monster, a hero and anything you pick up — they are gone, or you
   * are past them. False of everything built: you arrive at the door and that
   * is where the move ends, so a doorway is not a way through a wall of
   * buildings. Which types are which is the caller's to say.
   */
  crossable?: boolean;
  /** Portal group, where the object belongs to one. */
  group?: string;
}

export interface ReachInput {
  /** Tiles per side. */
  size: number;
  /** Per floor, 1 where the GROUND stops a hero. Length size² each. */
  terrain: Uint8Array[];
  objects: ReachObject[];
  starts: { x: number; y: number; floor: number }[];
}

export interface ReachResult {
  /** Per floor, 1 where a hero may stand at all. */
  walkable: Uint8Array[];
  /** Per floor, 1 where he can actually get to. */
  seen: Uint8Array[];
  /** Objects with a green tile he can stand on, and those without. */
  reached: string[];
  unreached: { id: string; label: string; x: number; y: number; floor: number }[];
  /** Tiles walkable at all, and tiles walked to. */
  walkableTiles: number;
  visited: number;
}

/** Ground a hero may stand on: not the terrain's, not an object's body. */
function walkableGrid(input: ReachInput): Uint8Array[] {
  const { size, terrain, objects } = input;
  const grids = terrain.map((wall) => {
    const grid = new Uint8Array(size * size);
    for (let i = 0; i < grid.length; i++) grid[i] = wall[i] ? 0 : 1;
    return grid;
  });
  // An object's body, laid down once. A doorway another object has been built
  // over stays shut — that object is exactly the one worth reporting — but a
  // tile the SAME object calls both body and doorway is a doorway, since that
  // is the tile it is entered through.
  //
  // And a doorway that is not crossable is ground too: you may end a move on
  // it and you may not walk on. For the flood that is the same as a wall — what
  // makes it different is that standing NEXT to it counts as arriving, which is
  // reached() below rather than anything here.
  for (const o of objects) {
    const grid = grids[o.floor];
    if (!grid) continue;
    const shut = o.crossable
      ? o.blocked.filter((t) => !o.active.some((d) => d.x === t.x && d.y === t.y))
      : [...o.blocked, ...o.active];
    for (const t of shut) {
      const x = o.x + t.x, y = o.y + t.y;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      grid[y * size + x] = 0;
    }
  }
  return grids;
}

/** Flood from every start, eight ways. */
function flood(size: number, grid: Uint8Array, starts: readonly { x: number; y: number }[]): Uint8Array {
  const seen = new Uint8Array(size * size);
  const queue: number[] = [];
  for (const s of starts) {
    if (s.x < 0 || s.y < 0 || s.x >= size || s.y >= size) continue;
    const i = s.y * size + s.x;
    if (seen[i] || !grid[i]) continue;
    seen[i] = 1;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % size, y = (i - x) / size;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (seen[j] || !grid[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  return seen;
}

/**
 * Can a hero put himself at this object's door, on the flood already computed?
 *
 * On the green tile where he may stand on it, and on any tile beside it where
 * he may not — a mine is used from its doorstep, and a doorstep is a tile like
 * any other. Diagonals count here as they do everywhere else.
 */
function atDoor(size: number, seen: readonly Uint8Array[], o: ReachObject): boolean {
  const grid = seen[o.floor];
  if (!grid) return false;
  return o.active.some((t) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = o.x + t.x + dx, y = o.y + t.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (grid[y * size + x]) return true;
      }
    }
    return false;
  });
}

/** What a hero starting at `starts` can walk to. */
export function reachFrom(input: ReachInput): ReachResult {
  const { size, objects } = input;
  const walkable = walkableGrid(input);
  const from = input.starts.map((s) => ({ ...s }));
  const run = (): Uint8Array[] =>
    walkable.map((grid, z) => flood(size, grid, from.filter((s) => s.floor === z)));
  let seen = run();

  const groups = new Map<string, ReachObject[]>();
  for (const o of objects) if (o.group) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  const portals = [...groups.values()].filter((g) => g.length > 1);
  for (let pass = 0; pass < portals.length + 1; pass++) {
    let grew = false;
    for (const group of portals) {
      const open = group.filter((o) => atDoor(size, seen, o));
      if (!open.length || open.length === group.length) continue;
      for (const end of group) {
        if (atDoor(size, seen, end)) continue;
        // A hero comes out AT the portal — on its own tile if that is ground he
        // may stand on, and beside it otherwise, which is how he leaves a gate
        // built like a building. flood() drops whichever of these is not
        // walkable, so both can simply be offered.
        for (const t of end.active) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              from.push({ x: end.x + t.x + dx, y: end.y + t.y + dy, floor: end.floor });
            }
          }
        }
        grew = true;
      }
    }
    if (!grew) break;
    seen = run();
  }

  const reached: string[] = [];
  const unreached: ReachResult['unreached'] = [];
  for (const o of objects) {
    if (!o.active.length) continue; // scenery: nothing to reach
    if (atDoor(size, seen, o)) reached.push(o.id);
    else unreached.push({ id: o.id, label: o.label, x: o.x, y: o.y, floor: o.floor });
  }

  let walkableTiles = 0, visited = 0;
  for (const grid of walkable) for (const v of grid) if (v) walkableTiles++;
  for (const grid of seen) for (const v of grid) if (v) visited++;
  return { walkable, seen, reached, unreached, walkableTiles, visited };
}
