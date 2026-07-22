// Unpack the game's archives into one data root — the tree the editor reads.
//
//   node tools/unpack-data.ts [<game dir>] [--out <dir>] [--dry] [--force]
//
// The editor resolves models, textures, tiles and rosters against a single
// unpacked folder. The game keeps them in half a dozen .pak archives that
// overlay each other, so the folder has to be their union, applied in the
// order the game applies them: the addon's files win over the base game's.
//
// Why unpack rather than read the paks directly: unpacked IS the working form.
// Modding means editing these files and shipping only what you changed, so the
// tree you edit against is the tree you diff against.
//
// Members are decompressed one at a time (data.pak alone is 1.4 GB), and a file
// whose bytes are already on disk is left alone, so re-running is cheap and
// only reports what actually moved.

import { openSync, closeSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readIndex, readEntryFrom } from '../src/pak.ts';

/**
 * Archive priority, lowest first — later archives overwrite earlier ones.
 *
 * The ToE addon's paks (a2p1-*) go last: they carry the expansion's own content
 * (the random-map generator's tiles, its UI, its campaigns) and updated versions
 * of what the base game shipped. Anything the list does not name is applied
 * before them, alphabetically, so a mod pak dropped into data/ still lands.
 */
const LAST = /^a2p1-/i;

function order(names: string[]): string[] {
  const base = names.filter((n) => !LAST.test(n)).sort();
  const addon = names.filter((n) => LAST.test(n)).sort();
  return [...base, ...addon];
}

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));

// Default to the install this repo sits inside, which is how the editor's own
// launcher finds the game.
const gameDir = resolve(positional[0] || join(import.meta.dirname, '..', '..'));
const dataDir = join(gameDir, 'data');
const outDir = resolve(value('--out') || join(import.meta.dirname, '..', 'data-unpacked'));
const dry = flag('--dry');
const force = flag('--force');

if (!existsSync(dataDir)) {
  console.error(`no data folder at ${dataDir} — pass the game directory as the first argument`);
  process.exit(1);
}

const { readdirSync } = await import('node:fs');
const paks = order(readdirSync(dataDir).filter((f) => /\.pak$/i.test(f)));
if (!paks.length) { console.error(`no .pak files in ${dataDir}`); process.exit(1); }

console.log(`from ${dataDir}`);
console.log(`into ${outDir}${dry ? '  (dry run — nothing will be written)' : ''}`);
console.log(`order: ${paks.join(' → ')}\n`);

let written = 0, replaced = 0, unchanged = 0, failed = 0;

for (const pak of paks) {
  const path = join(dataDir, pak);
  const fd = openSync(path, 'r');
  try {
    const index = readIndex(fd, statSync(path).size);
    let w = 0, r = 0, u = 0, f = 0;
    for (const e of index) {
      const dest = join(outDir, e.name);
      try {
        const had = existsSync(dest);
        // Comparing before writing keeps a re-run quiet and, more usefully, makes
        // the report say what an archive actually changed rather than how many
        // files it contains.
        if (had && !force && statSync(dest).size === e.size) {
          const cur = readFileSync(dest);
          if (cur.equals(readEntryFrom(fd, e))) { u++; continue; }
        }
        if (!dry) {
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, readEntryFrom(fd, e));
        }
        if (had) r++; else w++;
      } catch (err) {
        f++;
        if (f <= 3) console.log(`  ! ${e.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    written += w; replaced += r; unchanged += u; failed += f;
    console.log(`${pak.padEnd(18)} ${String(index.length).padStart(6)} members · ${w} new, ${r} replaced, ${u} unchanged${f ? `, ${f} FAILED` : ''}`);
  } finally {
    closeSync(fd);
  }
}

console.log(`\ntotal: ${written} new, ${replaced} replaced, ${unchanged} already current${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
