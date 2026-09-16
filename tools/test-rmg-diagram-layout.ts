// The diagram's layout from the graph — the template editor's opening picture.
//
//   node tools/test-rmg-diagram-layout.ts
//
// Held on the shapes an author would recognise: Jebus Cross opens as a
// cross (the middle in the middle of its four starts, apart from one
// another), a chain opens as a chain with nothing on top of anything, tall
// boxes get the room they need, and the same template opens the same way
// twice. Every template of the game's must come out with no box covering
// another.

// needs: data
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BARE_BOX, boxesOverlap, layoutDiagram } from '../src/rmg/diagram-layout.ts';
import type { DiagramPoint, DiagramSize } from '../src/rmg/diagram-layout.ts';
import { readTemplate } from '../src/rmg/template-files.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dist = (a: DiagramPoint, b: DiagramPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** How many pairs of boxes cover each other in a picture. */
function overlaps(points: Map<number, DiagramPoint>, sizes?: ReadonlyMap<number, DiagramSize>): number {
  const list = [...points];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [ia, a] = list[i]!;
      const [ib, b] = list[j]!;
      if (boxesOverlap(a, sizes?.get(ia) ?? BARE_BOX, b, sizes?.get(ib) ?? BARE_BOX)) n++;
    }
  }
  return n;
}

console.log('Jebus Cross');
const jebus = readTemplate(join(import.meta.dirname, '..', 'assets', 'rmg', 'RMG', 'Templates', 'Jebus Cross.h5et'));
const cross = layoutDiagram(jebus.zones, jebus.connections);
const middle = cross.get(1)!;
const starts = [2, 3, 4, 5].map((i) => cross.get(i)!);
const centroid = { x: starts.reduce((s, p) => s + p.x, 0) / 4, y: starts.reduce((s, p) => s + p.y, 0) / 4 };
check('the middle zone sits in the middle of its four starts', dist(middle, centroid) < 30, `${middle.x},${middle.y} vs ${Math.round(centroid.x)},${Math.round(centroid.y)}`);
check('the four start zones are out from it', starts.every((p) => dist(p, middle) > 350), starts.map((p) => `${p.x},${p.y}`).join(' '));
check('and none covers another', overlaps(cross) === 0);
check('the picture starts at the margin, not off it', Math.min(...[...cross.values()].map((p) => p.x)) > 100 && Math.min(...[...cross.values()].map((p) => p.y)) > 60);
check('the same template draws the same picture twice',
  JSON.stringify([...layoutDiagram(jebus.zones, jebus.connections)]) === JSON.stringify([...cross]));

console.log('\ntall boxes');
{
  // A start zone with a dozen named objects is a box three times as tall as
  // a bare one; the picture must open up for it.
  const tall = new Map<number, DiagramSize>([[2, { w: 330, h: 430 }], [3, { w: 330, h: 430 }], [4, { w: 330, h: 430 }], [5, { w: 330, h: 430 }], [1, { w: 330, h: 380 }]]);
  const wide = layoutDiagram(jebus.zones, jebus.connections, tall);
  check('tall boxes cover nothing either', overlaps(wide, tall) === 0);
  check('and the picture grew for them', dist(wide.get(2)!, wide.get(4)!) > dist(cross.get(2)!, cross.get(4)!));
}

console.log('\nthe edges');
check('no zones, no picture', layoutDiagram([], []).size === 0);
const one = layoutDiagram([{ index: 7, canBePlayerStart: false }], []);
check('one zone sits at the margin', one.get(7)!.x === 40 + BARE_BOX.w / 2 && one.get(7)!.y === 40 + BARE_BOX.h / 2, `${one.get(7)!.x},${one.get(7)!.y}`);
const twoApart = layoutDiagram([{ index: 1, canBePlayerStart: true }, { index: 2, canBePlayerStart: true }], []);
check('two unjoined zones stay apart', overlaps(twoApart) === 0 && dist(twoApart.get(1)!, twoApart.get(2)!) > 300);
const chain = layoutDiagram(
  [1, 2, 3, 4, 5].map((index) => ({ index, canBePlayerStart: index === 1 || index === 5 })),
  [[1, 2], [2, 3], [3, 4], [4, 5]].map(([a, b]) => ({ sourceZoneIndex: a!, destZoneIndex: b! })));
check('a chain of five covers nothing', overlaps(chain) === 0);
check('and its ends are farther apart than its neighbours', dist(chain.get(1)!, chain.get(5)!) > dist(chain.get(1)!, chain.get(2)!) * 1.5);
check('a connection to a zone that is not there is ignored, not thrown',
  layoutDiagram([{ index: 1, canBePlayerStart: false }], [{ sourceZoneIndex: 1, destZoneIndex: 9 }]).size === 1);

const dir = join(dataDir(), 'RMG', 'Templates');
if (existsSync(dir)) {
  console.log('\nthe game\'s 22');
  let crowded = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.xdb'))) {
    const t = readTemplate(join(dir, file));
    const n = overlaps(layoutDiagram(t.zones, t.connections));
    if (n) { crowded++; console.log(`  ${file}: ${n} pairs of boxes cover each other`); }
  }
  check('every shipped template opens with no box over another', crowded === 0, `${crowded} crowded`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
