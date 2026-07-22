// Round-trip + project-lifecycle tests for the archive and project layers.
// Uses the real GEmaps.pak sample. Run: npm run test-pak
//
// Covers:
//   1. ZIP round-trip: unpack -> repack -> unpack, content identical.
//   2. Project lifecycle: open -> pack -> status(clean) -> edit -> status(dirty).
//   3. Version divergence: a manifest packed by an older editor version is flagged.

import { readEntries, writeArchive } from '../src/pak.ts';
import { openProject, packProject, status, readManifest, writeManifest } from '../src/project.ts';
import { readFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const PAK = '../data/GEmaps.pak';
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

// --- 1. ZIP round-trip ---
const orig = readEntries(readFileSync(PAK));
const rebuilt = readEntries(writeArchive(orig));
ok(rebuilt.length === orig.length, `round-trip entry count (${orig.length})`);
const om = new Map(orig.map((e) => [e.name, sha1(e.data)]));
ok(rebuilt.every((e) => om.get(e.name) === sha1(e.data)), 'round-trip content identical for every file');

// --- 2 & 3. Project lifecycle ---
const dir = join(tmpdir(), 'homm5_test_project');
rmSync(dir, { recursive: true, force: true });
const now = new Date('2026-07-17T12:00:00Z');

const opened = openProject(PAK, dir, { now });
ok(opened.files.length === orig.length, `openProject unpacked ${orig.length} files`);
ok(status(dir).neverPacked === true, 'status: neverPacked before first pack');

const out = join(tmpdir(), 'homm5_test.h5m');
packProject(dir, out, { now });
const afterPack = status(dir);
ok(afterPack.dirty === false, 'status: clean immediately after pack');
ok(afterPack.versionMismatch === false, 'status: no version mismatch after pack');

appendFileSync(join(dir, 'Maps/Multiplayer/A2M3/name.txt'), 'X');
const afterEdit = status(dir);
ok(afterEdit.dirty === true, 'status: dirty after editing a file');
ok(afterEdit.modified.length === 1 && afterEdit.modified[0] === 'Maps/Multiplayer/A2M3/name.txt',
   'status: reports exactly the edited file as modified');

// Simulate a pack made by an older editor version, then check divergence flag.
const m = readManifest(dir);
m.lastPack.editorVersion = '0.0.0';
writeManifest(dir, m);
ok(status(dir).versionMismatch === true, 'status: flags editor-version divergence');

// --- 4. A map archive keeps the map at its in-game path ---
//
// Archive members are named by their path under the game's data root, which is
// how the game finds a map inside a .h5m at all. Packing a project without
// putting that path back produces an archive the game cannot see — this shipped
// broken, and the map.xdb at the root of our own .h5m was the symptom.
const mdir = join(tmpdir(), 'homm5_test_map_project');
rmSync(mdir, { recursive: true, force: true });
const asMap = openProject(PAK, mdir, { now, mapProject: true });
ok(asMap.projectDir !== mdir, `mapProject reports the inner folder (${asMap.projectDir.slice(mdir.length)})`);
ok(asMap.manifest.archivePrefix === 'Maps/Multiplayer/A2M3',
   `archivePrefix records the in-game path (${asMap.manifest.archivePrefix})`);

const mout = join(tmpdir(), 'homm5_test_map.h5m');
packProject(asMap.projectDir, mout, { now });
const repacked = readEntries(readFileSync(mout)).map((e) => e.name).sort();
// Same names the archive came with — that is the whole claim.
ok(repacked.every((n) => n.startsWith('Maps/Multiplayer/A2M3/')), 'repacked entries keep the prefix');
ok(repacked.includes('Maps/Multiplayer/A2M3/map.xdb'), 'map.xdb is at its in-game path, not the root');
const origMapNames = orig.map((e) => e.name).filter((n) => n.startsWith('Maps/Multiplayer/A2M3/')).sort();
ok(JSON.stringify(repacked) === JSON.stringify(origMapNames),
   `every entry name survives the round trip (${repacked.length})`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall pak/project tests passed');
process.exit(failures ? 1 : 0);
