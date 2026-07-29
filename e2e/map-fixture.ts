// A map for a spec that needs one to point at, rather than to build.
//
// It is made the way the app makes one — a blank project written under the data
// root, packed into `<game>/H5E/<name>.h5m` — because that pair is what a map IS
// now: a file in the install, plus the folder it is worked on in. A mission can
// only name a map the game will have, so a fixture that is a folder and nothing
// else is a fixture the campaign dialog will not offer.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { buildNewMapProject } from '../src/new-map.ts';
import { ensureModDir, modFile } from '../src/mod-paths.ts';
import { initProject, packProject } from '../src/project.ts';
import { E2E_GAME, REPO_ROOT } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

/**
 * Make a blank map at `mapDir` and pack it into the suite's install.
 *
 * Idempotent: a run that already has both leaves them alone, so a spec can call
 * this in `beforeAll` and Playwright's worker restarts cost nothing.
 */
export function buildMapFixture(mapDir: string, name = basename(mapDir), tiles = 96): string {
  const archive = modFile(E2E_GAME, 'map', name);
  if (existsSync(join(mapDir, 'map.xdb')) && existsSync(archive)) return archive;

  mkdirSync(mapDir, { recursive: true });
  for (const f of buildNewMapProject({
    name, tiles, twoLevel: false, spells: ['SPELL_NONE'], artifacts: ['ARTIFACT_NONE'],
  })) {
    writeFileSync(join(mapDir, f.path), f.data);
  }
  initProject(mapDir);
  ensureModDir(E2E_GAME);
  // Its path under the data root is its path inside the archive — that is how
  // the game addresses a map, and what a mission names.
  packProject(mapDir, archive, { prefix: relative(DATA, mapDir).split(sep).join('/') });
  return archive;
}
