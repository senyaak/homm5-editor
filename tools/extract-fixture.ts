// Extract one shipped campaign mission — the reference a reconstruction is
// diffed against (docs/E2E_RECONSTRUCTION.md, step 1).
//
//   node tools/extract-fixture.ts C1M1 [--game <dir>] [--out <dir>]
//
// The missions live in UserMODs/All_campaigns.data.h5u under
// Maps/Scenario/<CxMy>/. That archive holds all thirty of them, so members are
// read one at a time and only the mission's own files are written; the fixture
// is regenerable and does not belong in git.

import { openSync, closeSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readIndex, readEntryFrom } from '../src/pak.ts';

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));
const mission = (positional[0] || '').toUpperCase();
if (!/^C\d+M\d+$/.test(mission)) {
  console.error('usage: node tools/extract-fixture.ts C1M1 [--game <dir>] [--out <dir>]');
  process.exit(1);
}

const gameDir = resolve(value('--game') || join(import.meta.dirname, '..', '..'));
const archive = join(gameDir, 'UserMODs', 'All_campaigns.data.h5u');
const outDir = resolve(value('--out') || join(import.meta.dirname, '..', '_tmp', 'fixtures', mission));

if (!existsSync(archive)) {
  console.error(`no campaign archive at ${archive} — pass the game directory with --game`);
  process.exit(1);
}

// Members are named by their in-game path; the fixture keeps the map folder's
// own files flat, the way the map project on disk holds them.
const prefix = `Maps/Scenario/${mission}/`;

const fd = openSync(archive, 'r');
try {
  const index = readIndex(fd, statSync(archive).size).filter((e) => e.name.startsWith(prefix));
  if (!index.length) {
    console.error(`${mission}: nothing under ${prefix} in ${archive}`);
    process.exit(1);
  }
  for (const e of index) {
    const dest = join(outDir, e.name.slice(prefix.length));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readEntryFrom(fd, e));
    console.log(`  ${String(e.size).padStart(9)}  ${e.name.slice(prefix.length)}`);
  }
  console.log(`\n${mission}: ${index.length} files → ${outDir}`);
} finally {
  closeSync(fd);
}

// The mission's TEXTS live in a different archive — a campaign takes its visible
// strings from the localized text pack, not from the map folder — so the data
// archive above carries none. Pull them into texts/ so the reconstruction has a
// reference for what the name, description and objectives actually say. Like the
// rest of the fixture, they are the game's own content: regenerable, not in git.
const textArchive = join(gameDir, 'UserMODs', 'All_campaigns.texts_en.h5u');
if (existsSync(textArchive)) {
  const tfd = openSync(textArchive, 'r');
  try {
    const tindex = readIndex(tfd, statSync(textArchive).size)
      .filter((e) => e.name.startsWith(prefix) && !e.name.endsWith('/'));
    for (const e of tindex) {
      const dest = join(outDir, 'texts', e.name.slice(prefix.length));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readEntryFrom(tfd, e));
    }
    console.log(`${mission}: ${tindex.length} text files → ${join(outDir, 'texts')}`);
  } finally {
    closeSync(tfd);
  }
} else {
  console.warn(`(no text archive at ${textArchive} — texts not extracted)`);
}
