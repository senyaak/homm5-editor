// The geom cache (src/scene/geom-cache.ts): what goes in comes out, shared
// stays shared, and an entry knows when the files it came from have moved.
//
//   node tools/test-geom-cache.ts
//
// On made-up data in a temp folder: a geom with two parts wearing one picture
// and two effect instances playing one recording is written and read back;
// the arrays must equal, the picture and the recording must be ONE object
// again (that is what keeps the payload's bytes from multiplying by the
// number of parts), and a second entry naming the same picture must resolve
// to the same object as the first within one loader. Then the dependency
// record: what a decode read through the recording chain, and that touching
// one of those files invalidates the entry while a file still missing keeps it.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { depsValid, entryPath, loadGeomEntry, pruneGeomCache, readCachedArrays, recordingAssets, sharedLoader, writeGeomEntry } from '../src/scene/geom-cache.ts';
import { isFileRef, packBlobs } from '../src/scene/blob-table.ts';
import type { GeomData, GeomPart, Picture, FxInstancePayload } from '../src/scene/payload.ts';
import type { FxBaked } from '../src/scene/fx-bake.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

const dir = mkdtempSync(join(tmpdir(), 'h5e-geom-cache-'));
try {
  // --- a geom, written and read back ---
  const pic: Picture = { width: 2, height: 1, rgba: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), key: 'C:/x/bark.dds|512|dxt' };
  const part = (start: number): GeomPart => ({ start, count: 3, tex: pic, alphaMode: 'AM_OPAQUE', projectOnTerrain: false, flat: false, opaque: true, terrainProjected: false, additive: false, selfIllum: false, twoSided: false });
  const baked: FxBaked = { duration: 1, rate: 30, maxAlive: 2, standing: false, table: { data: new Uint16Array([1, 2, 3, 4]), rows: 1, base: new Int32Array([0, 2]), count: new Int32Array([2]), frames: 1, entries: 2 } };
  const fx = (offset: number): FxInstancePayload => ({ uid: 'AAAA', baked, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1, speed: 1, offset, endCycle: 0, cycleCount: 0, lit: false, pivot: [0, 0], textures: [pic, null] });
  const geom: GeomData = {
    pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv: null, nrm: null, idx: new Uint32Array([0, 1, 2, 2, 1, 0]),
    parts: [part(0), part(3)], fx: [fx(0), fx(0.5)],
  };
  const params = { texSize: 512, animate: true, animationFps: 15, compressed: true };
  const file = entryPath(dir, '/MapObjects/Tree.xdb', params);
  writeGeomEntry(file, '/MapObjects/Tree.xdb', [], geom);
  const loader = sharedLoader();
  const back = loadGeomEntry(file, loader);
  console.log('a geom, written and read back');
  check('the entry reads back', !!back?.geom);
  const g = back!.geom!;
  check('positions and indices equal', same(g.pos, geom.pos) && same(g.idx, geom.idx) && g.uv === null);
  check('the picture equals', same((g.parts[0]!.tex as Picture).rgba, pic.rgba) && (g.parts[0]!.tex as Picture).key === pic.key);
  check('two parts wear ONE picture object', g.parts[0]!.tex === g.parts[1]!.tex);
  check('the effect frames are that same object', g.fx![0]!.textures[0] === g.parts[0]!.tex && g.fx![0]!.textures[1] === null);
  check('two instances play ONE baked recording', g.fx![0]!.baked === g.fx![1]!.baked && same(g.fx![0]!.baked.table.data, baked.table.data) && g.fx![0]!.baked.table.frames === 1);
  check('the instances keep their own fields', g.fx![1]!.offset === 0.5 && g.fx![0]!.offset === 0);
  // A second entry naming the same picture, read through the same loader.
  const file2 = entryPath(dir, '/MapObjects/Bush.xdb', params);
  writeGeomEntry(file2, '/MapObjects/Bush.xdb', [], { ...geom, fx: undefined, parts: [part(0)] });
  const back2 = loadGeomEntry(file2, loader);
  check('another entry\'s part wears the same picture object within one open', back2?.geom?.parts[0]!.tex === g.parts[0]!.tex);
  check('a fresh loader gets fresh objects', loadGeomEntry(file2, sharedLoader())?.geom?.parts[0]!.tex !== g.parts[0]!.tex);
  check('an href that does not decode is remembered as null', (() => { const f = entryPath(dir, '/nothing.xdb', params); writeGeomEntry(f, '/nothing.xdb', [], null); const r = loadGeomEntry(f, loader); return !!r && r.geom === null; })());
  check('different parameters are a different entry', entryPath(dir, '/MapObjects/Tree.xdb', { ...params, compressed: false }) !== file);

  // --- the header alone, the arrays as file references ---
  console.log('the header alone');
  const lazyLoader = sharedLoader();
  const lazy = loadGeomEntry(file, lazyLoader, false)!;
  const lg = lazy.geom!;
  check('the entry reads back from its header', !!lg && lazy.entry.href === '/MapObjects/Tree.xdb');
  check('positions are a file reference into the entry, with the length', isFileRef(lg.pos) && lg.pos.length === geom.pos.length && (lg.pos as unknown as { byteLength: number }).byteLength === geom.pos.byteLength && (lg.pos as unknown as Record<string, string>)['\0file'] === file);
  check('the picture is a file reference into the SHARED entry', isFileRef((lg.parts[0]!.tex as Picture).rgba) && ((lg.parts[0]!.tex as Picture).rgba as unknown as Record<string, string>)['\0file'] !== file);
  check('shared by the two parts and the effect', lg.parts[0]!.tex === lg.parts[1]!.tex && lg.fx![0]!.textures[0] === lg.parts[0]!.tex && lg.fx![0]!.baked === lg.fx![1]!.baked);
  check('a second lazy entry through the loader shares the picture object', loadGeomEntry(file2, lazyLoader, false)?.geom?.parts[0]!.tex === lg.parts[0]!.tex);
  // Packed into a blob by file range, and the ranges read back as the arrays.
  const ranges: { path: string; at: number; len: number }[] = [];
  let offset = 0;
  const sink = { url: 'blob', add: (_b: Uint8Array): number => { throw new Error('bytes offered where only file ranges were expected'); }, addFile: (path: string, at: number, len: number): number => { const o = offset; ranges.push({ path, at, len }); offset += len + (8 - (len % 8)) % 8; return o; } };
  const packed = packBlobs(lg, sink);
  check('every array packs as a file range, none as bytes', packed.count === 6 && ranges.length === 6, `${packed.count} handles, ${ranges.length} ranges`);
  const served = (r: { path: string; at: number; len: number }): Uint8Array => { const b = readFileSync(r.path); return b.subarray(r.at, r.at + r.len); };
  const posRange = ranges.find((r) => r.len === geom.pos.byteLength)!;
  check('the positions range holds the positions', same(new Float32Array(Uint8Array.from(served(posRange)).buffer), geom.pos));
  const picRange = ranges.find((r) => r.path !== file && r.len === pic.rgba.byteLength)!;
  check('the picture range, in the shared file, holds the texels', !!picRange && same(served(picRange), pic.rgba));
  // And read into this process when the numbers are wanted here.
  const filled = readCachedArrays(loadGeomEntry(file, sharedLoader(), false)!.geom!);
  check('readCachedArrays gives the arrays back', filled.pos instanceof Float32Array && same(filled.pos, geom.pos) && same(filled.idx, geom.idx) && same((filled.parts[1]!.tex as Picture).rgba, pic.rgba) && same(filled.fx![1]!.baked.table.data, baked.table.data));
  check('and keeps the sharing', filled.parts[0]!.tex === filled.parts[1]!.tex && (filled.parts[0]!.tex as Picture).rgba === (filled.fx![0]!.textures[0] as Picture).rgba);

  // --- dependencies ---
  console.log('dependencies');
  const root = join(dir, 'data');
  mkdirSync(join(root, 'Textures'), { recursive: true });
  writeFileSync(join(root, 'Textures', 'bark.xdb'), '<Texture/>');
  const chain = assets([root]);
  const rec = recordingAssets(chain);
  rec.assets.text('Textures/bark.xdb');
  rec.assets.exists('Textures/missing.xdb');
  const deps = rec.deps();
  check('the read and the miss are both recorded', deps.length === 2 && deps.some((d) => d.rel === 'Textures/bark.xdb' && d.path !== null) && deps.some((d) => d.rel === 'Textures/missing.xdb' && d.path === null));
  check('valid as written', depsValid(chain, deps));
  const then = new Date(Date.now() - 60_000);
  utimesSync(join(root, 'Textures', 'bark.xdb'), then, then);
  check('a touched file invalidates', !depsValid(chain, deps));
  const deps2 = recordingAssets(chain).deps(); // nothing read: nothing to depend on
  check('no reads, no dependencies', deps2.length === 0);
  writeFileSync(join(root, 'Textures', 'missing.xdb'), '<Texture/>');
  const rec3 = recordingAssets(chain); rec3.assets.exists('Textures/missing.xdb'); rec3.assets.text('Textures/bark.xdb');
  const deps3 = rec3.deps();
  check('valid again once re-recorded', depsValid(chain, deps3));
  const over = join(dir, 'mod'); mkdirSync(join(over, 'Textures'), { recursive: true }); writeFileSync(join(over, 'Textures', 'bark.xdb'), '<Texture/>');
  check('a mod that mounts over a file invalidates (it resolves elsewhere)', !depsValid(assets([over, root]), deps3));

  // --- the budget ---
  console.log('the budget');
  const old = new Date(Date.now() - 120_000);
  utimesSync(file, old, old); // the tree is the oldest written
  const removed = pruneGeomCache(dir, 1024);
  check('trimming to a budget removes the oldest written first', removed > 0 && loadGeomEntry(file, sharedLoader()) === null);
  check('and leaves the cache under it', pruneGeomCache(dir, 1024 * 1024 * 1024) === 0);
  // A file of another decoder version: gone at the next trim, whatever the budget.
  const stale = join(dir, 'stale.h5g');
  const json = Buffer.from(JSON.stringify({ v: 0, href: '/old.xdb', deps: [], object: null }));
  const head = Buffer.alloc(4); head.writeUInt32LE(json.byteLength, 0);
  writeFileSync(stale, Buffer.concat([head, json]));
  check('a file of another decoder version is removed under any budget', pruneGeomCache(dir, 1024 * 1024 * 1024) === 4 + json.byteLength && !existsSync(stale));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
