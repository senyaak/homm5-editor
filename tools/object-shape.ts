// What a mission's objects are actually made of.
//
// The terrain stage started by measuring the surface instead of guessing at it,
// and the answer decided the tools (force, tension, a vertex brush). This is the
// same question for the object stage: 2645 objects is a number, not a plan —
// how many DISTINCT things are there, how much of the work is one prop repeated,
// how far do they sit from what the palette places by default, and what does an
// object carry that nothing in the editor can set yet.
//
// Usage: npm run object-shape _tmp/fixtures/C1M1/C1M1.xdb
//        npm run object-shape <map.xdb> --props   (also list every field seen)

import { readFileSync } from 'node:fs';
import { loadMap } from '../src/map.ts';
import type { MapObject } from '../src/map.ts';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--')) ?? '_tmp/fixtures/C1M1/C1M1.xdb';
const withProps = args.includes('--props');

const map = loadMap(readFileSync(path, 'utf8'));
const objs = map.objects;

const pad = (s: string | number, n: number): string => String(s).padStart(n);
const bar = (n: number, total: number, width = 24): string =>
  '█'.repeat(Math.max(1, Math.round((n / total) * width)));

console.log(`file    ${path}`);
console.log(`map     ${map.tileX}×${map.tileY}, floors ${map.hasUnderground ? 2 : 1}`);
console.log(`objects ${objs.length}\n`);

// --- by type ---------------------------------------------------------------
const byType = new Map<string, MapObject[]>();
for (const o of objs) {
  if (!byType.has(o.type)) byType.set(o.type, []);
  byType.get(o.type)!.push(o);
}
console.log('BY TYPE');
for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${pad(list.length, 5)}  ${type.padEnd(22)} ${bar(list.length, objs.length)}`);
}

// --- by shared definition --------------------------------------------------
//
// The Shared href is what the palette actually picks: two AdvMapStatic objects
// with different Shared are a rock and a tree. This is the count that says how
// many trips to the catalogue the reconstruction makes.
const bySh = new Map<string, number>();
for (const o of objs) {
  const k = `${o.type} ${o.shared ?? '(none)'}`;
  bySh.set(k, (bySh.get(k) ?? 0) + 1);
}
const shared = [...bySh].sort((a, b) => b[1] - a[1]);
console.log(`\nBY SHARED DEFINITION — ${shared.length} distinct`);
for (const [k, n] of shared.slice(0, 15)) {
  console.log(`  ${pad(n, 5)}  ${k.replace('/MapObjects/', '')}`);
}
if (shared.length > 15) console.log(`  … ${shared.length - 15} more`);
const once = shared.filter(([, n]) => n === 1).length;
console.log(`  ${once} placed exactly once; the top 10 cover `
  + `${((100 * shared.slice(0, 10).reduce((a, [, n]) => a + n, 0)) / objs.length).toFixed(1)}% of all objects`);

// --- placement -------------------------------------------------------------
//
// Rotation matters for the harness: quarter turns are what the editor's buttons
// give, a free angle needs the slider.
let onGrid = 0, halfTile = 0, zeroRot = 0, quarterRot = 0, floor1 = 0, named = 0;
const rots = new Set<number>();
for (const o of objs) {
  const p = o.pos;
  if (p) {
    if (Number.isInteger(p.x) && Number.isInteger(p.y)) onGrid++;
    else if (Number.isInteger(p.x * 2) && Number.isInteger(p.y * 2)) halfTile++;
  }
  const r = o.rot;
  rots.add(+r.toFixed(4));
  if (r === 0) zeroRot++;
  else if (Math.abs((r % (Math.PI / 2))) < 1e-3) quarterRot++;
  if (o.floor === 1) floor1++;
  if (o.name) named++;
}
console.log('\nPLACEMENT');
console.log(`  ${pad(onGrid, 5)}  on whole tiles`);
console.log(`  ${pad(halfTile, 5)}  on half tiles`);
console.log(`  ${pad(objs.length - onGrid - halfTile, 5)}  at a free position`);
console.log(`  ${pad(zeroRot, 5)}  unrotated`);
console.log(`  ${pad(quarterRot, 5)}  at a quarter turn`);
console.log(`  ${pad(objs.length - zeroRot - quarterRot, 5)}  at a free angle (${rots.size} distinct angles in all)`);
console.log(`  ${pad(floor1, 5)}  underground`);
console.log(`  ${pad(named, 5)}  carry a <Name> handle (what Lua addresses)`);

// --- what has to be SET after placing --------------------------------------
//
// A placed object arrives at the type's defaults. Everything below is a field
// the reconstruction must go and change, so this is the size of the "object
// settings" stage — and the fields with children are the ones no editor of ours
// can touch yet.
const simpleVals = new Map<string, Map<string, number>>();
const structural = new Map<string, number>();
for (const o of objs) {
  for (const p of o.props()) {
    const key = `${o.type}.${p.name}`;
    if (!simpleVals.has(key)) simpleVals.set(key, new Map());
    const m = simpleVals.get(key)!;
    m.set(p.value, (m.get(p.value) ?? 0) + 1);
  }
  // Containers: the typed-editor territory (a hero's army, a town's buildings,
  // a seer hut's reward). Counted per type so the report says which types need
  // an editor at all. An element with only text in it is a value, not a
  // structure — the DOM keeps that text as a child node of its own.
  for (const child of o.el.children) {
    if (child.type !== 'element') continue;
    if (!child.children.some((c) => c.type === 'element')) continue;
    // Pos has x/y/z children and is a structure by that rule, but it is
    // placement, not a property: the editor sets it by dragging.
    if (child.name === 'Pos') continue;
    structural.set(`${o.type}.${child.name}`, (structural.get(`${o.type}.${child.name}`) ?? 0) + 1);
  }
}
console.log('\nFIELDS THAT VARY (a value the reconstruction has to set)');
const varying = [...simpleVals].filter(([, m]) => m.size > 1).sort((a, b) => b[1].size - a[1].size);
for (const [key, m] of varying.slice(0, withProps ? varying.length : 20)) {
  const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([v, n]) => `${v === '' ? '∅' : v}×${n}`).join(' ');
  console.log(`  ${pad(m.size, 4)} values  ${key.padEnd(34)} ${top}`);
}
if (!withProps && varying.length > 20) console.log(`  … ${varying.length - 20} more (--props for all)`);
console.log(`  ${[...simpleVals].length - varying.length} more fields are the same on every object of their type`);

console.log('\nSTRUCTURES (no editor for these yet — Phase 4 typed panels)');
for (const [key, n] of [...structural].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(n, 5)}  ${key}`);
}
