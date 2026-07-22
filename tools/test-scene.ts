// Tests for the scene builder's href following (src/scene.ts).
//
//   1. Self-contained (always runs): listItems splits a list into its own
//      <Item> elements, which is what makes an INLINE item readable. An href of
//      "#n:inline(X)" means "the thing is written in here", and the "here" that
//      matters is the item — not the file. Reading the file instead silently
//      takes the first matching field anywhere in it.
//   2. Against the real thing (optional, needs game data): the Mystical Garden's
//      gnome. It is an animated model inside the object's EFFECT, and the effect
//      also holds particle instances with a <Scale> of 10. Reading the effect
//      file rather than the item picked up that 10 and drew a knee-high gnome
//      seventeen units tall — taller than a town, across half a dozen tiles.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene, listItems } from '../src/scene.ts';
import type { GeomData } from '../src/scene.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function testListItems(): void {
  console.log('\nLIST ITEMS');

  const two = listItems('<Item href="#a" id="x"><A>1</A></Item><Item href="/b.xdb"/>');
  check('splits a list into its items', two.length === 2, `${two.length}`);
  check('keeps each item’s attributes', two[0]!.attrs.includes('href="#a"') && two[1]!.attrs.includes('/b.xdb'));
  check('gives an inline item its own body', two[0]!.body === '<A>1</A>');
  check('a self-closing item has no body', two[1]!.body === '');

  // The trap this exists for: an item whose body carries a list of its own.
  // Matching non-greedily would end the first item at the inner </Item>.
  const nested = listItems('<Item href="#a"><L><Item>1</Item><Item>2</Item></L><Scale>3</Scale></Item><Item href="#b"><Scale>9</Scale></Item>');
  check('nested item lists do not end the outer item', nested.length === 2, `${nested.length}`);
  check('the outer body is whole', nested[0]!.body.includes('<Scale>3</Scale>') && !nested[0]!.body.includes('<Scale>9'));

  // And what the bug looked like: reading a field from the whole block hands
  // back the first one in the file, whoever it belongs to.
  const block = '<Item href="#p"><Scale>10</Scale></Item><Item href="#m"><Scale>1</Scale></Item>';
  const wrong = block.match(/<Scale>([\d.]+)<\/Scale>/)?.[1];
  const right = listItems(block)[1]!.body.match(/<Scale>([\d.]+)<\/Scale>/)?.[1];
  check('per-item reads beat whole-block reads', wrong === '10' && right === '1', `block ${wrong}, item ${right}`);
}

/** Extent of one part of a geom, in world units. */
function partSize(g: GeomData, part: number): [number, number, number] {
  const p = g.parts[part]!;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = p.start; i < p.start + p.count; i++) {
    const v = g.idx[i]! * 3;
    for (let a = 0; a < 3; a++) {
      const c = g.pos[v + a]!;
      if (c < mn[a]!) mn[a] = c;
      if (c > mx[a]!) mx[a] = c;
    }
  }
  return [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!];
}

function testEffectModelScale(root: string, mapPath: string): void {
  console.log(`\nEFFECT MODELS ${mapPath}`);
  const { scene } = buildScene(root, mapPath);
  const inst = scene.floors.flatMap((f) => f.instances).find((i) => i.shared.includes('Mystical_Garden'));
  if (!inst) { console.log('  --    no Mystical Garden on this map (skipped)'); return; }

  // Its geom is the building's meshes plus the effect's gnome plus a particle
  // card. The gnome is the one with by far the most triangles: an animated
  // character against a few flat building shapes.
  const g = scene.geoms[inst.g]!;
  const biggest = g.parts.map((p, i) => ({ i, tris: p.count / 3 })).sort((a, b) => b.tris - a.tris)[0]!;
  const [sx, sy, sz] = partSize(g, biggest.i);
  // The model declares 0.96 x 0.62 x 1.77 — knee high, under a tile across.
  const ok = sz > 1.5 && sz < 2.1 && sx < 1.5;
  check(`the garden's gnome is its own size, not the particles'`, ok,
    `${sx.toFixed(2)} x ${sy.toFixed(2)} x ${sz.toFixed(2)} (declared 0.96 x 0.62 x 1.77)`);
}

testListItems();

const root = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'samples', 'paks', 'data');
const mapPath = process.argv[2] || process.env.HOMM5_SCENE_MAP;
if (mapPath && existsSync(mapPath) && existsSync(join(root, 'MapObjects'))) testEffectModelScale(root, mapPath);
else console.log('\n(pass a map.xdb with a Mystical Garden on it, plus game data, for the effect-model check)');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
