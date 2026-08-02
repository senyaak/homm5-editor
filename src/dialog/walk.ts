// A walk across the stage: the path, and where along it an actor is.
//
// Its own module because the RENDERER reads it. `src/dialog/play.ts` builds the
// paths, and building needs the mounted asset chain — node's fs and path come
// with it, which cannot be bundled for a browser. The arithmetic below has no
// dependencies at all, so both sides can share the one copy instead of the
// viewport keeping a second, drifting version of "where is he now".

/**
 * A walk, resolved: where the actor goes, when they get there, and facing what.
 *
 * `MovePoints` on a `CustomAnimation` is a list of TILES, and 922 of the
 * shipped scenes' cues carry one — the armies marching on, a hero riding up to
 * parley. What the file does NOT carry is a pace: every one of the 922 writes
 * `MovementSpeed` 0 and leaves it to the `move` clip, which declares its own
 * (see `ActorRig.clipSpeed`). Nor does it carry a starting point — that is
 * wherever the actor is standing when the walk begins, which is where the walk
 * before it left them, so the whole scene's walks are resolved in time order in
 * `buildScenePlay` rather than by whoever draws them.
 */
export interface WalkPath {
  /** Waypoints in world units; the first is where the walk starts from. */
  path: Array<[number, number, number]>;
  /** Seconds from the cue at which each waypoint is reached; `times[0]` is 0. */
  times: number[];
  /** Facing along each leg, radians about Z — one per leg. */
  headings: number[];
  /** Facing to hold on arrival, from `FinalAngle` (which is in DEGREES). */
  rot: number;
}

/** Where a walk has got to `t` seconds in, and which way its actor faces there. */
export function walkAt(w: WalkPath, t: number): { pos: [number, number, number]; rot: number } {
  const n = w.path.length;
  if (t <= 0) return { pos: w.path[0]!, rot: w.headings[0] ?? w.rot };
  if (t >= w.times[n - 1]!) return { pos: w.path[n - 1]!, rot: w.rot };
  let i = 1;
  while (i < n - 1 && w.times[i]! <= t) i++;
  const t0 = w.times[i - 1]!, t1 = w.times[i]!;
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = w.path[i - 1]!, b = w.path[i]!;
  return {
    pos: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
    rot: w.headings[i - 1] ?? w.rot,
  };
}
