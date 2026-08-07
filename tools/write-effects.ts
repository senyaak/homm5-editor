// Rewrite the extension's config from the mod that is already installed.
//
//   node tools/write-effects.ts [--game <dir>]
//
// The archive holds the manifest; `bin/homm5-editor-effects.txt` holds the part
// of it the game's own data cannot express — a percentage on a skill, a term on
// a specialization, the creature kinds a spell of ours passes over. The app
// writes the file whenever it installs, so this is only for the case where the
// manifest did not change and its READING did: a row that has just been given a
// new kind, a number retuned in the source. Rebuilding and reinstalling the
// whole archive to move one line is a slower way to be less sure.
//
// It never touches the archive, and it writes exactly what the app writes —
// the same function, from the same manifest.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameDir, dataDir } from './game-dir.ts';
import { readCreatureMod } from '../src/mods/mod-archive.ts';
import { findCreatureMods } from '../src/mods/mod-archive.ts';
import { writeModEffectsFile } from '../src/mods/extension.ts';
import { readEffects, readSkillEffects, readSpecializations, readSpellRows } from '../src/mods/artifact-effects.ts';

const game = gameDir();
const ours = findCreatureMods(game).filter((f) => !f.reconstructed);
if (!ours.length) {
  console.log(`no mod of ours installed in ${game} — nothing to write from`);
  process.exit(1);
}
if (ours.length > 1) {
  console.log(`more than one creature mod installed: ${ours.map((f) => f.path).join(', ')}`);
  process.exit(1);
}
const mod = readCreatureMod(ours[0]!.path)?.mod;
if (!mod) {
  console.log(`${ours[0]!.path} carries no manifest`);
  process.exit(1);
}

const types = join(dataDir(), 'types.xml');
if (!existsSync(types)) {
  console.log(`no unpacked data at ${types} — a set's shipped members and a spell's abilities are named there`);
  process.exit(1);
}

const path = writeModEffectsFile(game, mod, readFileSync(types, 'latin1'));
const text = readFileSync(path, 'latin1');
console.log(`${path}`);
console.log(`  ${readEffects(text).length} artifact row(s), ${readSkillEffects(text).length} skill,`
  + ` ${readSpecializations(text).length} specialization, ${readSpellRows(text).length} spell`);
for (const line of text.split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) console.log(`    ${line}`);
