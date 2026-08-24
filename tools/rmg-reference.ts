// Where the reference run's files are, and how to lay them out again.
//
//   node tools/rmg-reference.ts                  say what is there
//   node tools/rmg-reference.ts <map.h5m>        unpack one into place
//
// The port's sharpest checks compare against a map the ENGINE wrote — the
// ordered editor run of seed 1785351845 (S1P2Z2M1, small, 2 players, no
// underground, no water). That map is game content, so it is not committed;
// it lives under `_tmp/oracle/reference/` and is rebuilt from the `.h5m` the
// editor saved:
//
//   npm run rmg-reference -- "game/Maps/<the run>.h5m"
//
// Without it the suites that need it say so and skip, rather than passing
// quietly on nothing.

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Everything the reference-backed suites read. */
export const REFERENCE_DIR = join('_tmp', 'oracle', 'reference');
export const REFERENCE_MAP = join(REFERENCE_DIR, 'map.xdb');
export const REFERENCE_TERRAIN = join(REFERENCE_DIR, 'GroundTerrain.bin');

/** The seed the reference was ordered with — every suite replays it. */
export const REFERENCE_SEED = 1785351845;

/** A one-line note a suite can print when the reference is missing. */
export const REFERENCE_MISSING =
  `no ${REFERENCE_DIR} — rebuild it with \`npm run rmg-reference -- <map.h5m>\`; skipping the comparison`;

export function hasReference(): boolean {
  return existsSync(REFERENCE_MAP) && existsSync(REFERENCE_TERRAIN);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const archive = process.argv[2];
  if (!archive) {
    console.log(hasReference()
      ? `reference in place:\n  ${REFERENCE_MAP}\n  ${REFERENCE_TERRAIN}`
      : REFERENCE_MISSING);
    console.log(`\nthe reference is seed ${REFERENCE_SEED}, template S1P2Z2M1, small, 2 players,`);
    console.log('no underground, no water — the settings every suite replays.');
    process.exit(0);
  }

  // The archive is opened by the editor's own pak tool; this only moves the
  // two files the suites read out of wherever it landed.
  const { execFileSync } = await import('node:child_process');
  const staging = join('_tmp', 'oracle', 'staging');
  mkdirSync(staging, { recursive: true });
  execFileSync(process.execPath, ['tools/pak-cli.js', 'open', archive, staging], { stdio: 'inherit' });

  const found: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'map.xdb' || entry === 'GroundTerrain.bin') found[entry] = path;
    }
  };
  walk(staging);
  if (!found['map.xdb'] || !found['GroundTerrain.bin']) {
    console.error('that archive holds no map.xdb / GroundTerrain.bin — is it a generated map?');
    process.exit(1);
  }
  mkdirSync(REFERENCE_DIR, { recursive: true });
  copyFileSync(found['map.xdb'], REFERENCE_MAP);
  copyFileSync(found['GroundTerrain.bin'], REFERENCE_TERRAIN);
  console.log(`reference laid out from ${archive}:\n  ${REFERENCE_MAP}\n  ${REFERENCE_TERRAIN}`);
}
