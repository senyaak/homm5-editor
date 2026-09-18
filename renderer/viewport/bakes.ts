// What the bakes have cost since the map opened: the idle bone tables, the
// effect recording tables, and the effect atlases — each counted and timed
// where it is made, so a load's stall can be laid at the right door. Its own
// module, small as it is, because perf.ts reads the makers and the makers
// report here.

const bakes = { idle: { n: 0, ms: 0 }, fx: { n: 0, ms: 0 }, atlas: { n: 0, ms: 0 } };
export type Bake = keyof typeof bakes;
/** Bakes handed to the workers and not back yet (bakery.ts). */
let pending = 0;
export function countBake(kind: Bake, ms: number): void { bakes[kind].n++; bakes[kind].ms += ms; }
export function bakePending(delta: number): void { pending += delta; }
export function bakeStats(): typeof bakes & { pending: number } { return { ...structuredClone(bakes), pending }; }
export function resetBakes(): void { for (const b of Object.values(bakes)) { b.n = 0; b.ms = 0; } }
