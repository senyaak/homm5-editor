// Tests the external-change watcher: it must report edits made by another
// process, stay silent about our own writes, and survive files being replaced
// rather than modified in place (which is how most editors save).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchMapDir } from '../src/watch.ts';
import type { DirChange } from '../src/watch.ts';

const DEBOUNCE = 60;
const SETTLE = 400; // comfortably past debounce, even on a loaded machine

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'homm5-watch-'));
writeFileSync(join(dir, 'map.xdb'), '<AdvMapDesc/>');
writeFileSync(join(dir, 'GroundTerrain.bin'), Buffer.alloc(64));
mkdirSync(join(dir, 'sub'));
writeFileSync(join(dir, 'sub', 'nested.xdb'), 'a');

const seen: DirChange[] = [];
const w = watchMapDir(dir, (c) => seen.push(c), { debounceMs: DEBOUNCE });

/** Wait for the watcher to settle, then take and clear whatever it reported. */
async function drain(): Promise<DirChange[]> {
  await sleep(SETTLE);
  return seen.splice(0, seen.length);
}

try {
  // 1. A quiet folder reports nothing.
  check('quiet folder is silent', (await drain()).length === 0);

  // 2. Someone else rewrites a file.
  writeFileSync(join(dir, 'GroundTerrain.bin'), Buffer.alloc(64, 7));
  let got = await drain();
  check('external write is reported', got.length === 1 && got[0]?.changed.includes('GroundTerrain.bin'),
    JSON.stringify(got));

  // 3. Our own write, followed by resync, must not be reported.
  writeFileSync(join(dir, 'map.xdb'), '<AdvMapDesc>edited</AdvMapDesc>');
  w.resync();
  check('own write after resync is silent', (await drain()).length === 0);

  // 4. Rewriting a file with identical content is not a change.
  writeFileSync(join(dir, 'map.xdb'), '<AdvMapDesc>edited</AdvMapDesc>');
  check('same-content rewrite is silent', (await drain()).length === 0);

  // 5. Save-by-rename, the way real editors write.
  writeFileSync(join(dir, 'map.tmp'), '<AdvMapDesc>from the other editor</AdvMapDesc>');
  renameSync(join(dir, 'map.tmp'), join(dir, 'map.xdb'));
  got = await drain();
  check('save-by-rename is reported once', got.length === 1 && got[0]?.changed.includes('map.xdb'),
    JSON.stringify(got));

  // 6. Nested files count too — a map folder has subdirectories.
  writeFileSync(join(dir, 'sub', 'nested.xdb'), 'b');
  got = await drain();
  check('nested change is reported', got.length === 1 && got[0]?.changed.includes('sub/nested.xdb'),
    JSON.stringify(got));

  // 7. Additions and removals are distinguished from edits.
  writeFileSync(join(dir, 'added.xdb'), 'new');
  unlinkSync(join(dir, 'sub', 'nested.xdb'));
  got = await drain();
  const c = got[0];
  check('add and remove are classified',
    got.length === 1 && !!c && c.added.includes('added.xdb') && c.removed.includes('sub/nested.xdb') && !c.changed.length,
    JSON.stringify(got));

  // 8. project.json is ours; the watcher must ignore it.
  writeFileSync(join(dir, 'project.json'), '{"lastPack":1}');
  check('project.json is ignored', (await drain()).length === 0);

  // 9. A burst of writes settles into one report, not one per file.
  for (let i = 0; i < 6; i++) writeFileSync(join(dir, `burst${i}.xdb`), String(i));
  got = await drain();
  check('a burst collapses into one report', got.length === 1 && got[0]?.added.length === 6,
    `reports=${got.length}`);

  // 10. After stop() nothing more arrives.
  w.stop();
  writeFileSync(join(dir, 'after-stop.xdb'), 'x');
  check('stopped watcher is silent', (await drain()).length === 0);
} finally {
  w.stop();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
