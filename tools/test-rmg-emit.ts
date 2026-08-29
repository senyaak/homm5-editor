// The map.xdb emitter against the surface reference — the whole document,
// byte for byte.
//
//   node tools/test-rmg-emit.ts
//
// Three inputs are not the generator's own and are read back from the
// reference: the GUID (CoCreateGuid at run time), the MapName (typed into
// the order dialog) and the dialogs camera (its derivation is unread —
// docs/RMG.md names the hole). Everything else is the run's.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildRmgMapDesc } from '../src/rmg/emit.ts';
import { RACE } from '../src/rmg/load-template.ts';
import { runFull } from './rmg-run.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_MAP, REFERENCE_SEED, hasReference } from './rmg-reference.ts';

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
if (!hasReference()) {
  console.log('no reference map.xdb — skipping');
  process.exit(0);
}

const ref = readFileSync(REFERENCE_MAP, 'utf8');
const grab = (re: RegExp): string => {
  const m = re.exec(ref);
  if (!m) throw new Error(`reference: ${re} not found`);
  return m[1]!;
};

const r = runFull(dir);
const c = r.c;
check('the run ends on the traced 92438', c.rng.draws === 92438, `${c.rng.draws}`);

const TOWN_BY_RACE: Record<number, string> = {
  [RACE.HEAVEN]: 'TOWN_HEAVEN', [RACE.PRESERVE]: 'TOWN_PRESERVE', [RACE.ACADEMY]: 'TOWN_ACADEMY',
  [RACE.DUNGEON]: 'TOWN_DUNGEON', [RACE.NECROMANCY]: 'TOWN_NECROMANCY', [RACE.INFERNO]: 'TOWN_INFERNO',
  [RACE.DWARF]: 'TOWN_FORTRESS', [RACE.STRONGHOLD]: 'TOWN_STRONGHOLD',
};
const players = 2;
const races = Array.from({ length: players }, (_, i) =>
  TOWN_BY_RACE[c.loaded.zones.find((z) => z.playerNo === i + 1)!.race]!);

const camBlock = /<dialogs>[^]*?<\/dialogs>/.exec(ref)![0];
const cam = (tag: string): string => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(camBlock)![1]!;

const ours = buildRmgMapDesc({
  tiles: c.size,
  twoLevel: false,
  objects: r.objects,
  groundAmbientLight: c.params.groundTerrainLights[c.setup.ambientLightIndex]!,
  players,
  sRMG: {
    version: 34,
    seed: REFERENCE_SEED,
    guid: grab(/<RMGguid>([^<]*)<\/RMGguid>/),
    mapSize: 'MAP_SIZE_SMALL',
    template: '/RMG/Templates/S1P2Z2M1.xdb#xpointer(/RMGTemplate)',
    waterAmount: 'WATER_NONE',
    monsterLevel: 'MONSTER_LEVEL_MEDIUM',
    hasUnderground: false,
    races,
    mapName: grab(/<MapName>([^<]*)<\/MapName>/),
  },
  camera: {
    rod: cam('Rod'), pitch: cam('Pitch'), yaw: cam('Yaw'), fov: cam('FOV'),
    anchor: [cam('x'), cam('y'), cam('z')],
  },
});

if (ours === ref) {
  check('map.xdb is byte-identical to the reference', true, `${ours.length} bytes`);
} else {
  const a = ours.split('\r\n');
  const b = ref.split('\r\n');
  let firstDiff = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { firstDiff = i; break; }
  }
  let diffLines = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffLines++;
  check('map.xdb is byte-identical to the reference', false,
    `${diffLines} differing lines of ${b.length}; first at ${firstDiff + 1}`);
  for (let i = Math.max(0, firstDiff - 2); i < Math.min(firstDiff + 6, Math.max(a.length, b.length)); i++) {
    console.log(`    ${i + 1} ref  ${b[i] ?? '<eof>'}`);
    console.log(`    ${' '.repeat(String(i + 1).length)} ours ${a[i] ?? '<eof>'}`);
  }
  if (process.env['H5E_DBG_EMIT']) {
    writeFileSync(join('_tmp', 'ours-map.xdb'), ours);
    console.log('  (ours dumped to _tmp/ours-map.xdb)');
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
