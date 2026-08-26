// Where the reference run's files are, and how to lay them out again.
//
//   node tools/rmg-reference.ts                  say what is there
//   node tools/rmg-reference.ts <map.h5m>        unpack one into place
//     --underground / --water                    which reference slot it is
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

/**
 * The THIRD reference — the surface run re-ordered with the ONE setting the
 * others turned off: water (same seed, same S1P2Z2M1, same everything else).
 * The dialog's water control is a CHECKBOX and checking it records
 * WaterAmount = WATER_ISLAND_MAP — the middle WATER_PRESENT cannot be
 * ordered at all; it only arises when water is left to the below(2) coin.
 * The run measures what neither no-water run enters: the WaterBordered
 * zones and whatever reads them — shipyards, WaterTreasures, the sea
 * itself. One floor, so two files.
 */
export const REFERENCE_WATER_DIR = join('_tmp', 'oracle', 'reference-water');
export const REFERENCE_WATER_MAP = join(REFERENCE_WATER_DIR, 'map.xdb');
export const REFERENCE_WATER_TERRAIN = join(REFERENCE_WATER_DIR, 'GroundTerrain.bin');

/** A one-line note a suite can print when the reference is missing. */
export const REFERENCE_MISSING =
  `no ${REFERENCE_DIR} — rebuild it with \`npm run rmg-reference -- <map.h5m>\`; skipping the comparison`;
export const REFERENCE_UG_MISSING =
  `no ${REFERENCE_UG_DIR} — rebuild it with \`npm run rmg-reference -- --underground <map.h5m>\`; skipping the comparison`;
export const REFERENCE_WATER_MISSING =
  `no ${REFERENCE_WATER_DIR} — rebuild it with \`npm run rmg-reference -- --water <map.h5m>\`; skipping the comparison`;

export function hasReference(): boolean {
  return existsSync(REFERENCE_MAP) && existsSync(REFERENCE_TERRAIN);
}

export function hasUndergroundReference(): boolean {
  return existsSync(REFERENCE_UG_MAP) && existsSync(REFERENCE_UG_TERRAIN) && existsSync(REFERENCE_UG_TERRAIN_1);
}

export function hasWaterReference(): boolean {
  return existsSync(REFERENCE_WATER_MAP) && existsSync(REFERENCE_WATER_TERRAIN);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const cli = process.argv.slice(2);
  const underground = cli.includes('--underground');
  const water = cli.includes('--water');
  if (underground && water) {
    console.error('no such run — the references change one setting at a time; pick one flag');
    process.exit(1);
  }
  const archive = cli.find((a) => !a.startsWith('--'));
  if (!archive) {
    console.log(hasReference()
      ? `reference in place:\n  ${REFERENCE_MAP}\n  ${REFERENCE_TERRAIN}`
      : REFERENCE_MISSING);
    console.log(hasUndergroundReference()
      ? `underground reference in place:\n  ${REFERENCE_UG_MAP}\n  ${REFERENCE_UG_TERRAIN}\n  ${REFERENCE_UG_TERRAIN_1}`
      : REFERENCE_UG_MISSING);
    console.log(hasWaterReference()
      ? `water reference in place:\n  ${REFERENCE_WATER_MAP}\n  ${REFERENCE_WATER_TERRAIN}`
      : REFERENCE_WATER_MISSING);
    console.log(`\nall references are seed ${REFERENCE_SEED}, 2 players:`);
    console.log('the surface one S1P2Z2M1 small, the underground one S0-1P2Z2K3.1T tiny (both no water),');
    console.log('the water one S1P2Z2M1 small again with the water checkbox on (WATER_ISLAND_MAP) —');
    console.log('the only changed setting, and the only water the dialog can order.');
    process.exit(0);
  }

  // The archive is opened by the editor's own pak tool; this only moves the
  // two files the suites read out of wherever it landed. The staging dir is
  // wiped first: every run unpacks under its own GUID, so leftovers from a
  // previous unpack survive the next one and the walk below would pick up a
  // STALE map — which map won depended on GUID order.
  const { execFileSync } = await import('node:child_process');
  const { rmSync } = await import('node:fs');
  const staging = join('_tmp', 'oracle', 'staging');
  rmSync(staging, { recursive: true, force: true });
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

  // The map records the order's WaterAmount, so a water run cannot land in a
  // no-water slot by a forgotten flag — laying it out would silently replace
  // the reference the whole port is written against.
  const { readFileSync } = await import('node:fs');
  const recordedWater = /<WaterAmount>WATER_(\w+)</.exec(readFileSync(found['map.xdb']!, 'latin1'))?.[1];
  if (water && recordedWater === 'NONE') {
    console.error('--water, but the map records WATER_NONE — not the water run');
    process.exit(1);
  }
  if (!water && recordedWater !== undefined && recordedWater !== 'NONE') {
    console.error(`the map records WATER_${recordedWater} — a water run; pass --water so it lands in its own slot`);
    process.exit(1);
  }

  const dir = water ? REFERENCE_WATER_DIR : underground ? REFERENCE_UG_DIR : REFERENCE_DIR;
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
