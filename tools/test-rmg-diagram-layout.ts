// The diagram's layout from the graph — the template editor's opening picture.
//
//   node tools/test-rmg-diagram-layout.ts [--png]
//
// Held on the shapes an author would recognise: Jebus Cross opens as a
// cross (the middle in the middle, the four starts around it, apart from one
// another), a chain opens as a chain with nothing on top of anything, and
// the same template opens the same way twice. `--png` is not drawn here —
// the picture is the editor's — but every template of the game's must at
// least come out with its boxes apart.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { layoutDiagram } from '../src/rmg/diagram-layout.ts';
import { readTemplate } from '../src/rmg/template-files.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest two boxes of a picture. */
function nearest(points: Map<number, { x: number; y: number }>): number {
  const list = [...points.values()];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) best = Math.min(best, dist(list[i]!, list[j]!));
  return best;
}

console.log('Jebus Cross');
const jebus = readTemplate(join(import.meta.dirname, '..', 'assets', 'rmg', 'RMG', 'Templates', 'Jebus Cross.h5et'));
const cross = layoutDiagram(jebus.zones, jebus.connections);
const middle = cross.get(1)!;
check('the middle zone sits in the middle', dist(middle, { x: 500, y: 500 }) < 60, `${middle.x},${middle.y}`);
const starts = [2, 3, 4, 5].map((i) => cross.get(i)!);
check('the four start zones are out at the edges', starts.every((p) => dist(p, { x: 500, y: 500 }) > 280), starts.map((p) => `${p.x},${p.y}`).join(' '));
check('and apart from one another', nearest(new Map(starts.map((p, i) => [i, p]))) > 280, `${Math.round(nearest(new Map(starts.map((p, i) => [i, p]))))}`);
check('the same template draws the same picture twice',
  JSON.stringify([...layoutDiagram(jebus.zones, jebus.connections)]) === JSON.stringify([...cross]));

console.log('\nthe edges');
check('no zones, no picture', layoutDiagram([], []).size === 0);
const one = layoutDiagram([{ index: 7, canBePlayerStart: false }], []);
check('one zone sits in the middle', one.get(7)!.x === 500 && one.get(7)!.y === 500);
const twoApart = layoutDiagram([{ index: 1, canBePlayerStart: true }, { index: 2, canBePlayerStart: true }], []);
check('two unjoined zones stay apart', dist(twoApart.get(1)!, twoApart.get(2)!) > 400);
const chain = layoutDiagram(
  [1, 2, 3, 4, 5].map((index) => ({ index, canBePlayerStart: index === 1 || index === 5 })),
  [[1, 2], [2, 3], [3, 4], [4, 5]].map(([a, b]) => ({ sourceZoneIndex: a!, destZoneIndex: b! })));
check('a chain of five keeps its boxes apart', nearest(chain) > 200, `${Math.round(nearest(chain))}`);
check('and its ends farther apart than its neighbours', dist(chain.get(1)!, chain.get(5)!) > dist(chain.get(1)!, chain.get(2)!) * 1.5);
check('a connection to a zone that is not there is ignored, not thrown',
  layoutDiagram([{ index: 1, canBePlayerStart: false }], [{ sourceZoneIndex: 1, destZoneIndex: 9 }]).size === 1);

const dir = join(dataDir(), 'RMG', 'Templates');
if (existsSync(dir)) {
  console.log('\nthe game\'s 22');
  let crowded = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.xdb'))) {
    const t = readTemplate(join(dir, file));
    const near = nearest(layoutDiagram(t.zones, t.connections));
    if (near < 110) { crowded++; console.log(`  ${file}: nearest boxes ${Math.round(near)} apart`); }
  }
  check('every shipped template opens with its boxes apart', crowded === 0, `${crowded} crowded`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
