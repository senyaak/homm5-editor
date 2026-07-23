// Compare a reconstruction's objects against the original's — the object
// stage's gap report, the counterpart of `npm run diff-terrain`.
//
// Objects cannot be compared by id or by file order: ours get fresh GUIDs and
// are written in the order they were placed. What identifies an object is what a
// player would see — WHAT it is (type + shared definition), WHERE it stands
// (position, floor) and WHICH WAY it faces. So both sides are keyed on that, and
// everything else is reported as a difference on the matched pair.
//
// Positions are matched at a tolerance: they are floats written by a UI, and an
// object a thousandth of a tile off is the same object. A whole tile off is not.
//
// Usage: npm run diff-objects _tmp/fixtures/C1M1/C1M1.xdb <ours>/map.xdb

import { readFileSync } from 'node:fs';
import { loadMap } from '../src/map.ts';
import type { HommMap, MapObject } from '../src/map.ts';

const [refPath, ourPath] = process.argv.slice(2);
if (!refPath || !ourPath) {
  console.error('usage: node tools/diff-objects.ts <original map.xdb> <ours map.xdb>');
  process.exit(2);
}

const A = loadMap(readFileSync(refPath, 'utf8'));
const B = loadMap(readFileSync(ourPath, 'utf8'));

let diffs = 0;
const ok = (name: string, detail = ''): void =>
  console.log(`  ok    ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name: string, detail = ''): void => {
  diffs++;
  console.log(`  DIFF  ${name}${detail ? ' — ' + detail : ''}`);
};

/** Case and spelling of an href vary between editor versions; the target does not. */
const href = (s: string | null): string => (s ?? '').toLowerCase().replace(/^\/+/, '');

/** How far apart two placements may be and still be the same object, in tiles. */
const POS_EPS = 0.01;
/** The same for a rotation, in radians — a hundredth of a degree. */
const ROT_EPS = 2e-4;

interface Keyed { obj: MapObject; what: string; x: number; y: number; rot: number; floor: number }

const keyed = (m: HommMap): Keyed[] => m.objects.map((o) => ({
  obj: o,
  what: `${o.type} ${href(o.shared)}`,
  x: o.pos?.x ?? NaN, y: o.pos?.y ?? NaN, rot: o.rot, floor: o.floor,
}));

const ref = keyed(A), ours = keyed(B);

console.log(`ref  ${refPath}  (${ref.length} objects)`);
console.log(`ours ${ourPath}  (${ours.length} objects)\n`);

// --- what is on the map ----------------------------------------------------
console.log('WHAT IS PLACED');
const tally = (list: Keyed[], by: (k: Keyed) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const k of list) m.set(by(k), (m.get(by(k)) ?? 0) + 1);
  return m;
};
const byType = [tally(ref, (k) => k.obj.type), tally(ours, (k) => k.obj.type)];
const types = [...new Set([...byType[0]!.keys(), ...byType[1]!.keys()])].sort();
for (const t of types) {
  const a = byType[0]!.get(t) ?? 0, b = byType[1]!.get(t) ?? 0;
  if (a === b) ok(t, `${a}`);
  else fail(t, `${a} in the original, ${b} in ours`);
}
const byWhat = [tally(ref, (k) => k.what), tally(ours, (k) => k.what)];
const missingKind = [...byWhat[0]!].filter(([w]) => !byWhat[1]!.has(w));
const extraKind = [...byWhat[1]!].filter(([w]) => !byWhat[0]!.has(w));
if (missingKind.length) {
  fail('shared definitions ours never places', `${missingKind.length} of ${byWhat[0]!.size}`);
  for (const [w, n] of missingKind.slice(0, 8)) console.log(`          ${w} ×${n}`);
  if (missingKind.length > 8) console.log(`          … ${missingKind.length - 8} more`);
} else ok('every shared definition the original uses', `${byWhat[0]!.size} distinct`);
if (extraKind.length) fail('shared definitions the original does not have', extraKind.map(([w]) => w).join(', '));

// --- placement -------------------------------------------------------------
//
// Greedy nearest match within one kind: the original repeats a bush 373 times,
// so "which of them is which" only has an answer by position anyway.
console.log('\nPLACEMENT');
const pool = new Map<string, Keyed[]>();
for (const k of ours) {
  if (!pool.has(k.what)) pool.set(k.what, []);
  pool.get(k.what)!.push(k);
}
const pairs: [Keyed, Keyed][] = [];
const unmatched: Keyed[] = [];
for (const a of ref) {
  const cands = pool.get(a.what);
  let best = -1, bestD = Infinity;
  for (let i = 0; cands && i < cands.length; i++) {
    const c = cands[i]!;
    if (c.floor !== a.floor) continue;
    const d = Math.hypot(c.x - a.x, c.y - a.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0 || bestD > 0.5) { unmatched.push(a); continue; }
  pairs.push([a, cands!.splice(best, 1)[0]!]);
}
const leftover = [...pool.values()].flat();

if (unmatched.length) {
  fail('objects of the original with no counterpart', `${unmatched.length}/${ref.length}`);
  for (const k of unmatched.slice(0, 6)) {
    console.log(`          ${k.what} at (${k.x}, ${k.y})`);
  }
  if (unmatched.length > 6) console.log(`          … ${unmatched.length - 6} more`);
} else ok('every object of the original is matched', `${pairs.length}`);
if (leftover.length) fail('objects ours has and the original does not', `${leftover.length}`);

let posOff = 0, rotOff = 0, maxPos = 0, maxRot = 0;
const posWorst: string[] = [];
for (const [a, b] of pairs) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d > POS_EPS) {
    posOff++;
    if (d > maxPos) maxPos = d;
    if (posWorst.length < 6) posWorst.push(`${a.what.split(' ')[0]} at (${a.x}, ${a.y}) vs (${b.x}, ${b.y})`);
  }
  // Rotation is an angle: 0 and 2π are the same way round.
  const TAU = Math.PI * 2;
  const r = Math.abs(((b.rot - a.rot) % TAU + TAU + Math.PI) % TAU - Math.PI);
  if (r > ROT_EPS) { rotOff++; if (r > maxRot) maxRot = r; }
}
if (posOff) {
  fail('positions that differ', `${posOff}/${pairs.length}, worst ${maxPos.toFixed(3)} tiles`);
  for (const s of posWorst) console.log(`          ${s}`);
} else if (pairs.length) ok('positions', `${pairs.length} within ${POS_EPS} tiles`);
if (rotOff) fail('rotations that differ', `${rotOff}/${pairs.length}, worst ${(maxRot * 180 / Math.PI).toFixed(2)}°`);
else if (pairs.length) ok('rotations', `${pairs.length} matched`);

// --- fields ----------------------------------------------------------------
//
// Everything a matched pair carries beyond its placement: amounts, moods,
// owners, names, message refs. Reported per field name rather than per object,
// because "13 monsters have the wrong Amount" is one gap, not thirteen.
console.log('\nFIELDS');
const fieldDiffs = new Map<string, { n: number; sample: string }>();
for (const [a, b] of pairs) {
  const av = new Map(a.obj.props().map((p) => [p.name, p.value]));
  const bv = new Map(b.obj.props().map((p) => [p.name, p.value]));
  for (const [name, v] of av) {
    const w = bv.get(name);
    const same = name.toLowerCase().includes('ref') || name === 'Shared'
      ? href(v) === href(w ?? null)
      : v === w;
    if (same) continue;
    const key = `${a.obj.type}.${name}`;
    const cur = fieldDiffs.get(key);
    fieldDiffs.set(key, {
      n: (cur?.n ?? 0) + 1,
      sample: cur?.sample ?? `"${v}" vs ${w === undefined ? '(absent)' : `"${w}"`}`,
    });
  }
  for (const name of bv.keys()) {
    if (av.has(name)) continue;
    const key = `${a.obj.type}.${name}`;
    const cur = fieldDiffs.get(key);
    fieldDiffs.set(key, { n: (cur?.n ?? 0) + 1, sample: cur?.sample ?? `(absent) vs "${bv.get(name)}"` });
  }
}
if (!fieldDiffs.size && pairs.length) ok('every field of every matched object');
for (const [key, d] of [...fieldDiffs].sort((a, b) => b[1].n - a[1].n)) {
  fail(key, `${d.n} object(s), e.g. ${d.sample}`);
}

console.log(`\n${diffs} difference(s)`);
process.exit(diffs ? 1 : 0);
