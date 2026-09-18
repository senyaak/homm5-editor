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

import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { depsValid, entryPath, loadGeomEntry, pruneGeomCache, recordingAssets, sharedLoader, writeGeomEntry } from '../src/scene/geom-cache.ts';
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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
