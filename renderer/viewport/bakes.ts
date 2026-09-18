// What the window still bakes since the map opened: the effect atlases —
// counted and timed where they are made, so a load's stall can be laid at the
// right door. The idle bone tables and the effect recording tables come baked
// with the scene now (src/scene/bone-table.ts, fx-bake.ts); `pending` stays
// in the readout, at zero, for the harnesses that wait on it.

const bakes = { atlas: { n: 0, ms: 0 } };
export type Bake = keyof typeof bakes;
export function countBake(kind: Bake, ms: number): void { bakes[kind].n++; bakes[kind].ms += ms; }
export function bakeStats(): typeof bakes & { pending: number } { return { ...structuredClone(bakes), pending: 0 }; }
export function resetBakes(): void { for (const b of Object.values(bakes)) { b.n = 0; b.ms = 0; } }
