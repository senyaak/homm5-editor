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

/**
 * The SECOND reference — the same seed ordered with an underground:
 * template S0-1P2Z2K3.1T, 72×72, 2 players, no water. It measures what the
 * surface run never enters: floor balancing, the underground terrain, the
 * prisons step, additional objects and the two-floor treasure blocks. Its
 * archive carries a floor-1 terrain, so three files instead of two.
 */
export const REFERENCE_UG_DIR = join('_tmp', 'oracle', 'reference-underground');
export const REFERENCE_UG_MAP = join(REFERENCE_UG_DIR, 'map.xdb');
export const REFERENCE_UG_TERRAIN = join(REFERENCE_UG_DIR, 'GroundTerrain.bin');
export const REFERENCE_UG_TERRAIN_1 = join(REFERENCE_UG_DIR, 'UndergroundTerrain.bin');

/** A one-line note a suite can print when the reference is missing. */
export const REFERENCE_MISSING =
  `no ${REFERENCE_DIR} — rebuild it with \`npm run rmg-reference -- <map.h5m>\`; skipping the comparison`;
export const REFERENCE_UG_MISSING =
  `no ${REFERENCE_UG_DIR} — rebuild it with \`npm run rmg-reference -- --underground <map.h5m>\`; skipping the comparison`;

export function hasReference(): boolean {
  return existsSync(REFERENCE_MAP) && existsSync(REFERENCE_TERRAIN);
}

export function hasUndergroundReference(): boolean {
  return existsSync(REFERENCE_UG_MAP) && existsSync(REFERENCE_UG_TERRAIN) && existsSync(REFERENCE_UG_TERRAIN_1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const cli = process.argv.slice(2);
  const underground = cli.includes('--underground');
  const archive = cli.find((a) => !a.startsWith('--'));
  if (!archive) {
    console.log(hasReference()
      ? `reference in place:\n  ${REFERENCE_MAP}\n  ${REFERENCE_TERRAIN}`
      : REFERENCE_MISSING);
    console.log(hasUndergroundReference()
      ? `underground reference in place:\n  ${REFERENCE_UG_MAP}\n  ${REFERENCE_UG_TERRAIN}\n  ${REFERENCE_UG_TERRAIN_1}`
      : REFERENCE_UG_MISSING);
    console.log(`\nboth references are seed ${REFERENCE_SEED}, 2 players, no water:`);
    console.log('the surface one S1P2Z2M1 small, the underground one S0-1P2Z2K3.1T tiny.');
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
      else if (entry === 'map.xdb' || entry === 'GroundTerrain.bin' || entry === 'UndergroundTerrain.bin') {
        found[entry] = path;
      }
    }
  };
  walk(staging);
  if (!found['map.xdb'] || !found['GroundTerrain.bin']) {
    console.error('that archive holds no map.xdb / GroundTerrain.bin — is it a generated map?');
    process.exit(1);
  }
  if (underground && !found['UndergroundTerrain.bin']) {
    console.error('--underground, but the archive holds no UndergroundTerrain.bin — a one-floor map?');
    process.exit(1);
  }
  const dir = underground ? REFERENCE_UG_DIR : REFERENCE_DIR;
  mkdirSync(dir, { recursive: true });
  const laid: string[] = [];
  for (const name of underground
    ? ['map.xdb', 'GroundTerrain.bin', 'UndergroundTerrain.bin']
    : ['map.xdb', 'GroundTerrain.bin']) {
    const target = join(dir, name);
    copyFileSync(found[name]!, target);
    laid.push(target);
  }
  console.log(`reference laid out from ${archive}:\n  ${laid.join('\n  ')}`);
}
