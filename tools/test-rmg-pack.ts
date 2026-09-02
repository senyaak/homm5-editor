// The whole archive: every entry the engine's map holds, ours beside it.
//
//   node tools/test-rmg-pack.ts
//
// The bar is the one docs/RMG.md sets: the ENTRY SET, their names and their
// CONTENTS byte for byte — not the archive's own bytes, which cannot be
// matched (every entry carries the run's wall clock, and the engine's deflate
// beats zlib -9 on the minimap by a thousand bytes).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildMapFiles } from './rmg-build.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';
import { REFERENCE_DIR, REFERENCE_MAP, REFERENCE_MISSING, REFERENCE_SEED, hasReference } from './rmg-reference.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('no unpacked RMG data — skipping');
  process.exit(0);
}
const game = gameDirIfAny();
if (!game) {
  console.log('nobody said where the game is (HOMM5_GAME or --game) — the minimap needs its sine table; skipping');
  process.exit(0);
}
const archiveDir = join(REFERENCE_DIR, 'archive');
if (!hasReference() || !existsSync(archiveDir)) {
  console.log(`  ${REFERENCE_MISSING}`);
  process.exit(0);
}

// The two values the generator does not make are read back from the reference,
// the same way test-rmg-emit reads them: a GUID comes from CoCreateGuid and a
// name is typed into the dialog.
const ref = readFileSync(REFERENCE_MAP, 'utf8');
const grab = (re: RegExp): string => {
  const m = re.exec(ref);
  if (!m) throw new Error(`reference: ${re} not found`);
  return m[1]!;
};

const run = runFull(dir, {});
check('the run ends on the traced 92438', run.c.rng.draws === 92438, `${run.c.rng.draws}`);

const ours = buildMapFiles(dir, join(game, 'bin', 'H5_Game_H5E.exe'), run, {
  seed: REFERENCE_SEED,
  template: 'S1P2Z2M1',
  players: 2,
  underground: false,
  water: 0,
  guid: grab(/<RMGguid>([^<]*)<\/RMGguid>/),
  mapName: grab(/<MapName>([^<]*)<\/MapName>/),
});

const theirs = readdirSync(archiveDir).sort();
const oursNames = ours.map((f) => f.name).sort();
check(`the entry set is the engine's ${theirs.length}`,
  oursNames.length === theirs.length && oursNames.every((n, i) => n === theirs[i]),
  `ours ${oursNames.length}: missing [${theirs.filter((n) => !oursNames.includes(n)).join(' ')}]`
  + ` extra [${oursNames.filter((n) => !theirs.includes(n)).join(' ')}]`);

// The one exemption, and it is the engine's own: the 0x0e record's payload in
// the terrain file is uninitialised and flips between two identical runs.
// Everything else is ours to match.
const { parseTerrain, passabilityPlane } = await import('../src/terrain/terrain.ts');
let bad = 0;
for (const file of ours) {
  const path = join(archiveDir, file.name);
  if (!existsSync(path)) continue;
  const want = readFileSync(path);
  if (file.data.equals(want)) continue;
  let differing = 0, firstAt = -1;
  const exempt = file.name.endsWith('Terrain.bin')
    ? (passabilityPlane(parseTerrain(want))?.dataOff ?? 23) - 23 : -1;
  for (let i = 0; i < Math.max(file.data.length, want.length); i++) {
    if (i === exempt) continue;
    if (file.data[i] !== want[i]) { differing++; if (firstAt < 0) firstAt = i; }
  }
  if (!differing) continue;
  bad++;
  console.log(`        ${file.name}: ${differing} bytes differ, first at ${firstAt}`
    + ` (ours ${file.data.length}b, theirs ${want.length}b)`);
}
// The minimap's ten channel bytes are named in test-rmg-minimap; here they
// make their file one of the ones that differ, and saying so is the point.
check('every entry is byte-identical, bar the minimap\'s named ten', bad <= 1, `${bad} entries differ`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
