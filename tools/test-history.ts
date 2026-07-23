// Tests for the undo/redo patch layer.
//
// This is the code that decides what a map looks like after Ctrl+Z, so the bar
// is round-trip equality on real bytes, not on toy strings: the interesting
// inputs are a multi-megabyte map.xdb where one attribute moved and a terrain
// buffer where a brush changed scattered floats.
//
//   node tools/test-history.ts

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { diff, apply, History, storeSteps, loadSteps } from '../src/history.ts';
import type { Step } from '../src/history.ts';

let failures = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail && !cond ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}
const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'latin1'));
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** A patch must carry each state exactly into the other, both ways. */
function roundTrip(name: string, a: Uint8Array, b: Uint8Array): void {
  const p = diff(a, b);
  if (!p) { ok(name, same(a, b), 'diff said identical but they are not'); return; }
  const forward = apply(a, p, 'redo');
  const back = apply(b, p, 'undo');
  ok(name, same(forward, b) && same(back, a),
    `forward ${same(forward, b) ? 'ok' : 'wrong'}, backward ${same(back, a) ? 'ok' : 'wrong'}`);
}

console.log('--- diff/apply, synthetic ---');
roundTrip('identical documents', bytes('hello'), bytes('hello'));
roundTrip('one byte changed', bytes('hello world'), bytes('hellp world'));
roundTrip('insertion', bytes('<a/><c/>'), bytes('<a/><b/><c/>'));
roundTrip('deletion', bytes('<a/><b/><c/>'), bytes('<a/><c/>'));
roundTrip('append', bytes('abc'), bytes('abcdef'));
roundTrip('truncate', bytes('abcdef'), bytes('abc'));
roundTrip('empty to full', bytes(''), bytes('abc'));
roundTrip('full to empty', bytes('abc'), bytes(''));
roundTrip('everything changed', bytes('aaaa'), bytes('bbbb'));

ok('identical documents produce no patch', diff(bytes('abc'), bytes('abc')) === null);

// Scattered single-byte changes, the shape a sculpt stroke makes.
{
  const a = new Uint8Array(50_000);
  for (let i = 0; i < a.length; i++) a[i] = i & 0xff;
  const b = Uint8Array.from(a);
  for (const at of [17, 40, 4_000, 4_004, 4_100, 33_333, 49_999]) b[at] = 0xee;
  roundTrip('scattered changes round-trip', a, b);
  const p = diff(a, b)!;
  ok('scattered changes stay compact', p.spans.length <= 6 && p.spans.reduce((n, s) => n + s.after.length, 0) < 1000,
    `${p.spans.length} spans, ${p.spans.reduce((n, s) => n + s.after.length, 0)} bytes`);
  ok('near neighbours coalesce', p.spans.length < 7, `${p.spans.length} spans for 7 changes`);
}

// A patch applied to the wrong document must fail loudly, not silently mangle.
{
  const p = diff(bytes('abcdef'), bytes('abXdef'))!;
  let threw = false;
  try { apply(bytes('much longer document'), p, 'redo'); } catch { threw = true; }
  ok('a patch refuses a document of the wrong length', threw);
}

console.log('\n--- diff/apply, real map bytes ---');
/** Every map.xdb under a root, nearest first. */
function mapFiles(dir: string, out: string[] = [], cap = 6): string[] {
  if (out.length >= cap) return out;
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    if (out.length >= cap) break;
    const full = join(dir, e);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) mapFiles(full, out, cap);
    else if (e === 'map.xdb') out.push(full);
  }
  return out;
}

const root = 'data-unpacked/Maps';
const maps = existsSync(root) ? mapFiles(root) : [];
if (!maps.length) {
  console.log('  (no sample maps unpacked — skipping; unpack under data-unpacked to run these)');
} else {
  for (const f of maps) {
    const orig = new Uint8Array(readFileSync(f));
    // The three shapes a map edit takes: a value changes, an object is added,
    // an object is removed.
    const at = orig.indexOf(bytes('<Pos>')[0]!, 1000);
    const edited = Uint8Array.from(orig);
    for (let i = at; i < at + 5 && i < edited.length; i++) edited[i] = 0x20;
    roundTrip(`value edit round-trips (${f.split(/[\\/]/).slice(-2)[0]})`, orig, edited);

    const inserted = new Uint8Array(orig.length + 40);
    inserted.set(orig.slice(0, at), 0);
    inserted.set(bytes('<Item><AdvMapStatic/></Item>            '), at);
    inserted.set(orig.slice(at), at + 40);
    roundTrip(`insert round-trips (${f.split(/[\\/]/).slice(-2)[0]})`, orig, inserted);

    const removed = new Uint8Array(orig.length - 40);
    removed.set(orig.slice(0, at), 0);
    removed.set(orig.slice(at + 40), at);
    roundTrip(`delete round-trips (${f.split(/[\\/]/).slice(-2)[0]})`, orig, removed);

    const p = diff(orig, edited)!;
    ok(`a small edit makes a small patch (${(orig.length / 1024).toFixed(0)}kB map)`,
      p.spans.reduce((n, s) => n + s.after.length, 0) < 4096,
      `${p.spans.reduce((n, s) => n + s.after.length, 0)} bytes`);
  }
}

console.log('\n--- storage round-trip ---');
{
  const p = diff(bytes('the quick brown fox'), bytes('the quick brawn fox'))!;
  const steps: Step[] = [{ label: 'test', docs: { '': p } }];
  const back = loadSteps(storeSteps(steps));
  const q = back[0]!.docs['']!;
  ok('a stored patch still applies',
    same(apply(bytes('the quick brown fox'), q, 'redo'), bytes('the quick brawn fox')));
}

console.log('\n--- the stack ---');
{
  const h = new History();
  const mk = (label: string, a: string, b: string): Step =>
    ({ label, docs: { '': diff(bytes(a), bytes(b))! } });
  ok('nothing to undo when empty', !h.canUndo && !h.canRedo);
  h.push(mk('one', 'a', 'b'));
  h.push(mk('two', 'b', 'c'));
  ok('two steps are undoable', h.canUndo && h.undoLabel === 'two' && !h.canRedo);
  h.takeUndo();
  ok('after one undo, one is redoable', h.redoLabel === 'two' && h.undoLabel === 'one');
  h.takeUndo();
  ok('after two undos there is nothing left', !h.canUndo && h.canRedo);
  h.takeRedo(); h.takeRedo();
  ok('redo walks back to the top', !h.canRedo && h.undoLabel === 'two');
  h.takeUndo();
  h.push(mk('three', 'b', 'd'));
  ok('a new edit discards the redo tail', !h.canRedo && h.undoLabel === 'three');

  const h2 = new History();
  ok('a history restores under a matching hash', h2.restore(h.save('HASH'), 'HASH') && h2.undoLabel === 'three');
  const h3 = new History();
  ok('a history is refused under a different hash', !h3.restore(h.save('HASH'), 'OTHER') && !h3.canUndo);

  const small = new History(3);
  for (const n of ['a', 'b', 'c', 'd', 'e']) small.push(mk(n, 'x', 'y'));
  ok('the stack drops its oldest beyond the limit', small.depth === 3 && small.undoLabel === 'e');

  const noop = new History();
  noop.push({ label: 'nothing', docs: {} });
  ok('an edit that changed nothing is not recorded', !noop.canUndo);
}

console.log('\n--- against the real map model ---');
//
// The end the user sees: make an edit through HommMap exactly as the IPC
// handlers do, record it the way main.ts records it, then undo and demand the
// document be byte-identical to what it was. Anything less than byte-identical
// is a map that drifts every time somebody presses Ctrl+Z.
if (!maps.length) {
  console.log('  (no sample maps unpacked — skipping)');
} else {
  const { loadMap } = await import('../src/map.ts');
  const { donorFor } = await import('../src/donors.ts');

  for (const f of maps.slice(0, 3)) {
    const name = f.split(/[\\/]/).slice(-2)[0];
    const original = readFileSync(f, 'latin1');
    let map = loadMap(original);
    const h = new History();

    /** Snapshot, run, snapshot, diff — main.ts's record(), inlined. */
    const edit = (label: string, fn: () => void): void => {
      const before = new Uint8Array(Buffer.from(map.save(), 'latin1'));
      fn();
      const after = new Uint8Array(Buffer.from(map.save(), 'latin1'));
      const p = diff(before, after);
      h.push({ label, docs: p ? { '': p } : {} });
    };
    /** applyStep(), inlined: patch the bytes and re-parse. */
    const step = (dir: 'undo' | 'redo'): void => {
      const s = dir === 'undo' ? h.takeUndo() : h.takeRedo();
      if (!s) return;
      const now = new Uint8Array(Buffer.from(map.save(), 'latin1'));
      map = loadMap(Buffer.from(apply(now, s.docs['']!, dir)).toString('latin1'));
    };

    const first = map.objects.find((o) => o.pos);
    if (!first) { console.log(`  (${name} has no positioned objects — skipping)`); continue; }
    const id = first.id;

    edit('move object', () => { map.objects.find((o) => o.id === id)!.setPos(7, 9); });
    ok(`${name}: a move changes the document`, map.save() !== original);
    step('undo');
    ok(`${name}: undoing a move restores it byte for byte`, map.save() === original);
    step('redo');
    const moved = map.objects.find((o) => o.id === id)!;
    ok(`${name}: redo puts the move back`, moved.pos?.x === 7 && moved.pos?.y === 9);
    step('undo');

    // Delete: the hardest one, since it takes out a whole <Item> and the
    // whitespace around it.
    edit('delete object', () => { map.remove(map.objects.find((o) => o.id === id)!); });
    const after = map.save();
    ok(`${name}: a delete removes the object`, !map.objects.some((o) => o.id === id));
    step('undo');
    ok(`${name}: undoing a delete restores it byte for byte`, map.save() === original);
    ok(`${name}: the restored object is in the model again`, map.objects.some((o) => o.id === id));
    step('redo');
    ok(`${name}: redoing a delete removes it again`, map.save() === after);
    step('undo');

    // Add: the reverse shape, and the one whose donor XML is largest.
    const type = 'AdvMapStatic';
    const donor = donorFor('data-unpacked', type);
    edit('add object', () => {
      map.addObject({
        type, shared: '/MapObjects/Spruce.(AdvMapStaticShared).xdb#xpointer(/AdvMapStaticShared)',
        x: 3, y: 4, floor: 0, r: 0, ...(donor ? { donor } : {}),
      });
    });
    const grew = map.objects.length;
    ok(`${name}: an add lands in the model`, map.save() !== original);
    step('undo');
    ok(`${name}: undoing an add restores it byte for byte`, map.save() === original);
    step('redo');
    ok(`${name}: redoing an add brings it back`, map.objects.length === grew);

    // A run of edits unwound in one go must land exactly on the start.
    map = loadMap(original);
    h.clear();
    for (let i = 0; i < 8; i++) {
      const o = map.objects.filter((x) => x.pos)[i % 3];
      if (!o) break;
      const oid = o.id;
      edit(`edit ${i}`, () => { map.objects.find((x) => x.id === oid)!.setPos(i + 1, i + 2); });
    }
    while (h.canUndo) step('undo');
    ok(`${name}: eight edits undone in sequence land on the original`, map.save() === original);
    while (h.canRedo) step('redo');
    while (h.canUndo) step('undo');
    ok(`${name}: and again after a full redo pass`, map.save() === original);
  }
}

console.log('\n--- against the real terrain document ---');
//
// Terrain is the other document, and it fails differently: the map is text with
// one edited region, a .bin is fixed-length with scattered floats. A brush
// stroke has to come back exactly, including the ground flags that travel with
// the heights.
{
  const { TerrainDoc } = await import('../src/terrain-edit.ts');
  const { copyFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const src = maps.map((m) => join(m, '..', 'GroundTerrain.bin')).find((p) => existsSync(p));
  if (!src) {
    console.log('  (no sample GroundTerrain.bin — skipping)');
  } else {
    // Copied, because TerrainDoc opens a path and we must not touch a sample.
    const dir = mkdtempSync(join(tmpdir(), 'homm5-hist-'));
    const path = join(dir, 'GroundTerrain.bin');
    copyFileSync(src, path);
    const doc = TerrainDoc.open(path);
    const original = new Uint8Array(doc.buffer());
    const h = new History();

    const edit = (label: string, fn: () => void): void => {
      const before = new Uint8Array(doc.buffer());
      fn();
      const p = diff(before, new Uint8Array(doc.buffer()));
      h.push({ label, docs: p ? { '0': p } : {} });
    };
    const step = (dir2: 'undo' | 'redo'): void => {
      const s = dir2 === 'undo' ? h.takeUndo() : h.takeRedo();
      if (!s) return;
      doc.restore(Buffer.from(apply(new Uint8Array(doc.buffer()), s.docs['0']!, dir2)));
    };

    const verts = [100, 101, 102, 340, 341, 900];
    const flags = doc.flagsCopy();
    edit('sculpt', () => doc.setVertices(
      verts, verts.map((_, i) => 6 + i), flags ? verts.map((v) => flags[v]!) : null));
    const sculpted = new Uint8Array(doc.buffer());
    ok('a sculpt changes the terrain', !same(original, sculpted));
    const p = diff(original, sculpted)!;
    ok('a sculpt patch stays small',
      p.spans.reduce((n, s) => n + s.after.length, 0) < 4096,
      `${p.spans.reduce((n, s) => n + s.after.length, 0)} bytes for ${verts.length} vertices`);
    step('undo');
    ok('undoing a sculpt restores the terrain byte for byte', same(original, new Uint8Array(doc.buffer())));
    step('redo');
    ok('redoing a sculpt puts it back byte for byte', same(sculpted, new Uint8Array(doc.buffer())));

    // A mask stroke, which writes a different plane.
    step('undo');
    edit('block tiles', () => doc.setPassable([10, 11, 12], false));
    ok('a mask stroke changes the terrain', !same(original, new Uint8Array(doc.buffer())));
    step('undo');
    ok('undoing a mask stroke restores the terrain byte for byte', same(original, new Uint8Array(doc.buffer())));

    // Adding a layer changes the file's LENGTH, the case a run-diff cannot do.
    const have = doc.layerPaths().filter((x) => x);
    const other = ['/MapObjects/_(AdvMapTile)/Snow.xdb', '/MapObjects/_(AdvMapTile)/Sand.xdb',
      '/MapObjects/_(AdvMapTile)/Dirt.xdb'].find((t) => !have.includes(t));
    let added = false;
    try { edit('add layer', () => doc.addLayer(other!)); added = true; } catch { /* reported below */ }
    ok('a layer can be added at all', added, `layers already present: ${have.length}`);
    if (added) {
      const grown = new Uint8Array(doc.buffer());
      ok('adding a layer grows the file', grown.length !== original.length,
        `${original.length} -> ${grown.length}`);
      step('undo');
      ok('undoing a layer restores the terrain byte for byte', same(original, new Uint8Array(doc.buffer())));
      step('redo');
      ok('redoing a layer grows it again', same(grown, new Uint8Array(doc.buffer())));
    }
  }

  // The first mask stroke on a FRESH map is the other length-changing edit: the
  // plane does not exist yet and gets filled in, so undo has to walk back over
  // a file that grew — the case a run-diff of equal-length buffers cannot do.
  {
    const { buildBlankTerrain } = await import('../src/terrain-blank.ts');
    const { writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'homm5-hist-blank-'));
    const path = join(dir, 'GroundTerrain.bin');
    writeFileSync(path, buildBlankTerrain(72));
    const doc = TerrainDoc.open(path);
    const blank = new Uint8Array(doc.buffer());
    const h = new History();
    const before = new Uint8Array(doc.buffer());
    doc.setPassable([10, 11, 12], false);
    const masked = new Uint8Array(doc.buffer());
    const p = diff(before, masked);
    h.push({ label: 'block tiles', docs: p ? { '0': p } : {} });
    ok('a mask stroke on a blank map adds the plane', masked.length > blank.length,
      `${blank.length} -> ${masked.length}`);
    ok('the mask reached the plane', doc.isBlocked(11));
    const s = h.takeUndo();
    if (s) doc.restore(Buffer.from(apply(new Uint8Array(doc.buffer()), s.docs['0']!, 'undo')));
    ok('undoing it restores the blank byte for byte', same(blank, new Uint8Array(doc.buffer())));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall history tests passed');
process.exit(failures ? 1 : 0);
