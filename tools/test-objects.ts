// Tests for the placeable-object catalogue (src/objects.ts).
//
// Runs against the game install when one is reachable, since the catalogue is
// assembled from three things that ship with the game and not with the repo:
// the link files, Editor/MapFilters.xml and Editor/IconCache. Without an
// install the checks that need it are skipped rather than failed — the repo's
// bundled samples deliberately carry no Editor folder.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  listPlaceable, readObjectGroups, findEditorRoot, iconPathFor, readIconFile,
} from '../src/objects.ts';

let failures = 0;
function ok(cond: unknown, msg: string): void {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}
function skip(msg: string): void { console.log(`skip  ${msg}`); }

const DATA = process.env.HOMM5_DATA
  || 'C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East/data';
const SAMPLES = join(import.meta.dirname, '..', 'samples', 'paks', 'data');

// The link files ship in the paks, so the bundled samples have them even
// though they have no Editor folder.
if (existsSync(join(SAMPLES, 'MapObjects', '_(AdvMapObjectLink)'))) {
  const { objects } = listPlaceable(SAMPLES, '');
  ok(objects.length > 1400, `catalogue found (${objects.length} entries)`);

  // Every entry must be placeable: without a shared href there is nothing to
  // point a new map object at.
  ok(objects.every((o) => o.shared), 'every entry carries a shared reference');

  // The "Random ..." entries have an empty <Link/> and a <RndGroup href>.
  // Requiring a direct link silently dropped all 53 of them.
  const rnd = objects.filter((o) => o.random);
  ok(rnd.length > 40, `random-group entries are included (${rnd.length})`);
  ok(rnd.every((o) => o.shared.includes('AdvMapSharedGroup')),
    'random entries point at a shared group');

  // Hidden entries are kept, so the UI can offer to show them.
  ok(objects.some((o) => o.hidden), 'hidden entries are kept, not dropped');

  // Types come from the xpointer, so they match the element a placed object
  // uses. Statics dominate; a wrong derivation would show up as a type nobody
  // has ever seen.
  const statics = objects.filter((o) => o.type === 'AdvMapStatic');
  ok(statics.length > 700, `statics resolve their type (${statics.length})`);
  ok(objects.every((o) => !o.type || /^AdvMap\w+$/.test(o.type)),
    'derived types look like element names');
} else {
  skip('no bundled link files');
}

// The Editor folder sits beside the game's data dir, so it is reachable from
// the install path even when the catalogue itself comes from an unpacked root.
const editorRoot = process.env.HOMM5_EDITOR || findEditorRoot(DATA);
if (editorRoot) {
  const groups = readObjectGroups(editorRoot);
  ok(groups.length > 20, `filter groups parsed (${groups.length})`);
  ok(groups.filter((g) => g.separator).length === 3,
    'the three ==== heading rows are marked as separators');
  ok(groups.some((g) => g.prefixes.some((p) => p.includes('_(AdvMapObjectLink)'))),
    'groups carry link-folder prefixes');

  // Note the two different roots. In a real install the link files are still
  // inside data.pak, so the catalogue is read from an UNPACKED data root while
  // the filter list and icons come from the install's loose Editor folder.
  const { objects } = listPlaceable(SAMPLES, editorRoot);
  ok(objects.length > 1400, `catalogue grouped by the install's filters (${objects.length})`);
  const grouped = objects.filter((o) => o.group !== 'Other');
  ok(grouped.length > 1000, `most entries land in a named group (${grouped.length})`);
  // Entries no filter covers are kept under Other rather than hidden: the
  // filter list is loose on disk and unreachable by mods, so dropping them
  // would make a mod's own folder invisible.
  ok(objects.some((o) => o.group === 'Other'), 'unmatched entries survive as Other');

  // Icons: the same container the terrain uses, BGRA, several sizes per file.
  //
  // A few entries carry a real file whose image is declared 0x0 — a placeholder
  // with no picture in it, four across the whole catalogue. Those decode to
  // null by design, so they are counted separately rather than treated as a
  // parse failure; the UI shows its own placeholder for them.
  let decoded = 0, empty = 0, tried = 0;
  for (const o of objects.slice(0, 200)) {
    const p = iconPathFor(editorRoot, o.path);
    if (!p) continue;
    tried++;
    const buf = readFileSync(p);
    const ic = readIconFile(buf);
    if (ic && ic.w > 0 && ic.rgba.length === ic.w * ic.h * 4) decoded++;
    // A 0x0 image is written as width and height records holding zero.
    else if (buf.includes(Buffer.from('010800000000020800000000', 'hex'))) empty++;
  }
  ok(tried > 0 && decoded + empty === tried,
    `icons decode (${decoded} images, ${empty} declared empty, of ${tried})`);
  ok(decoded > tried * 0.9, `almost every icon has a picture (${decoded}/${tried})`);
} else {
  skip('no game install reachable (set HOMM5_DATA) — filters and icons not checked');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall object-catalogue tests passed');
process.exit(failures ? 1 : 0);
