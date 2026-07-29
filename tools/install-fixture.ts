// Put the specs' own artifacts into a real game, so what a person sees on the
// hero screen is what the suite says they are.
//
//   node tools/install-fixture.ts             # into the install this checkout sits in
//   node tools/install-fixture.ts <gameRoot>  # or another one
//
// The three pieces of the Cloak of the Undead King are DEFINED in e2e/mods.ts,
// because that is where the specs that prove artifacts work build them from.
// They are also the artifacts we actually play with, and until this existed the
// only way to move a corrected description into a game was to retype it in the
// dialog — three times, by hand, off a screen.
//
// IT UPDATES, IT DOES NOT REPLACE. The installed archive is read first and the
// fixture is merged into it, so anything else it carries survives — today that
// is nine dwellings the port authored before the editor became the mod's only
// writer, which no dialog can yet recreate. Replacing the archive from the
// fixture alone would delete them silently, and "the mod got smaller" is not a
// thing anyone notices until a map is missing a building.
//
// The dialog remains the way to author something NEW. This is for keeping a
// game in step with the fixture.

import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../e2e/launch.ts';
import { AMULET, BOOTS, CLOAK, PIECES, UNDEAD_KING } from '../e2e/mods.ts';
import {
  addArtifact, addArtifactSet, buildCreatureMod, dataReader, installCreatureMod, MOD_STEM,
  newCreatureMod, packCreatureMod, readCreatureMod, updateArtifact, updateArtifactSet,
} from '../src/creature-mod.ts';
import { modFile } from '../src/mod-paths.ts';

const gameRoot = process.argv[2] ?? join(REPO_ROOT, '..');
const dataRoot = process.env.HOMM5_DATA ?? join(REPO_ROOT, 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.error(`no unpacked game data at ${dataRoot} — point HOMM5_DATA at one`);
  process.exit(1);
}

const archive = modFile(gameRoot, 'mod', MOD_STEM);
const found = existsSync(archive) ? readCreatureMod(archive) : null;
const mod = found?.mod ?? newCreatureMod(MOD_STEM);
if (found) {
  // A copy of what was there, because this rewrites it and the artifacts in it
  // are not reproducible from anywhere else if the fixture is wrong.
  copyFileSync(archive, `${archive}.bak`);
  console.log(`read ${archive} — ${mod.creatures.length} creature(s), `
    + `${mod.dwellings.length} dwelling(s), ${(mod.artifacts ?? []).length} artifact(s)`);
} else {
  console.log(`no archive at ${archive} — building a fresh one`);
}

for (const p of PIECES) {
  const spec = {
    id: p.id, file: p.file, name: p.name, description: p.description,
    slot: p.slot, rank: 'ARTF_CLASS_MINOR' as const, cost: 5000, aiValue: 700,
    effects: { necromancy: p.necromancy },
    picture: p.picturePath,
    board: { tiles: 1 },
  };
  const had = (mod.artifacts ?? []).some((a) => a.id === p.id);
  const a = had ? updateArtifact(mod, p.id, spec) : addArtifact(mod, spec);
  console.log(`  ${had ? 'updated' : 'added  '} ${a.number}  ${p.id}  "${p.description}"`);
}

{
  const spec = {
    effect: UNDEAD_KING.effect, file: UNDEAD_KING.file,
    name: UNDEAD_KING.name, description: UNDEAD_KING.description,
    artifacts: [AMULET.id, CLOAK.id, BOOTS.id],
    perCount: UNDEAD_KING.perCount,
  };
  const had = (mod.sets ?? []).some((s) => s.effect === UNDEAD_KING.effect);
  const s = had ? updateArtifactSet(mod, UNDEAD_KING.effect, spec) : addArtifactSet(mod, spec);
  console.log(`  ${had ? 'updated' : 'added  '} set ${s.number}  ${s.effect}`);
}

const report = buildCreatureMod(mod, dataReader(dataRoot));
const done = installCreatureMod(gameRoot, mod, packCreatureMod(report));
console.log(`\ninstalled ${done.archive} — ${report.files.length} files`);
if (done.exe) console.log(`  creature ceiling ${done.exe.to}`);
if (done.artifacts) console.log(`  artifact ceiling ${done.artifacts.to}`);
console.log('  the effects the extension reads are NOT written here — that is the app\'s'
  + ' Artifacts dialog, or bin/homm5-editor-effects.txt by hand.');
