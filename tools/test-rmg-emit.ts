// The map.xdb emitter against all three references — each document whole,
// byte for byte.
//
//   node tools/test-rmg-emit.ts
//
// Inputs that are not the generator's own are read back from each
// reference: the GUID (CoCreateGuid at run time), the MapName (typed into
// the order dialog), the dialogs camera and the shipyards' ShipTile
// (their derivations are unread — docs/RMG.md names the holes).
// Everything else is the run's.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildMinimapXdb, buildRmgMapDesc, buildRmgMapTag } from '../src/rmg/emit.ts';
import { buildRmgTexts } from '../src/rmg/emit-texts.ts';
import { RACE } from '../src/rmg/load-template.ts';
import type { ChainOptions } from './rmg-chain.ts';
import { runFull } from './rmg-run.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_MAP, REFERENCE_SEED, REFERENCE_UG_MAP, REFERENCE_WATER_MAP } from './rmg-reference.ts';

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

const TOWN_BY_RACE: Record<number, string> = {
  [RACE.HEAVEN]: 'TOWN_HEAVEN', [RACE.PRESERVE]: 'TOWN_PRESERVE', [RACE.ACADEMY]: 'TOWN_ACADEMY',
  [RACE.DUNGEON]: 'TOWN_DUNGEON', [RACE.NECROMANCY]: 'TOWN_NECROMANCY', [RACE.INFERNO]: 'TOWN_INFERNO',
  [RACE.DWARF]: 'TOWN_FORTRESS', [RACE.STRONGHOLD]: 'TOWN_STRONGHOLD',
};

interface RunSpec {
  label: string;
  options: ChainOptions;
  endDraws: number;
  refPath: string;
  template: string;
  mapSize: string;
  waterAmount: string;
  twoLevel: boolean;
}

const RUNS: RunSpec[] = [
  {
    label: 'surface', options: {}, endDraws: 92438, refPath: REFERENCE_MAP,
    template: 'S1P2Z2M1', mapSize: 'MAP_SIZE_SMALL', waterAmount: 'WATER_NONE', twoLevel: false,
  },
  {
    label: 'water', options: { water: 2 }, endDraws: 65421, refPath: REFERENCE_WATER_MAP,
    template: 'S1P2Z2M1', mapSize: 'MAP_SIZE_SMALL', waterAmount: 'WATER_ISLAND_MAP', twoLevel: false,
  },
  {
    label: 'underground', options: { template: 'S0-1P2Z2K3.1T', size: 72, underground: true },
    endDraws: 70799, refPath: REFERENCE_UG_MAP,
    template: 'S0-1P2Z2K3.1T', mapSize: 'MAP_SIZE_TINY', waterAmount: 'WATER_NONE', twoLevel: true,
  },
];

for (const spec of RUNS) {
  console.log(`\nthe ${spec.label} run`);
  if (!existsSync(spec.refPath)) {
    console.log(`  (no ${spec.refPath} — skipped)`);
    continue;
  }
  const ref = readFileSync(spec.refPath, 'utf8');
  const grab = (re: RegExp): string => {
    const m = re.exec(ref);
    if (!m) throw new Error(`reference: ${re} not found`);
    return m[1]!;
  };

  const r = runFull(dir, spec.options);
  const c = r.c;
  check(`the run ends on the traced ${spec.endDraws}`, c.rng.draws === spec.endDraws, `${c.rng.draws}`);

  // The shipyards' ShipTile is engine-computed and unread — take each from
  // the reference by minted name.
  for (const o of r.objects) {
    if (o.kind !== 'shipyard') continue;
    const i = ref.indexOf(`id="${o.name}"`);
    const m = /<ShipTile>\s*<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/.exec(ref.slice(i, i + 800));
    if (m) o.shipTile = [Number(m[1]), Number(m[2])];
  }

  const players = 2;
  const races = Array.from({ length: players }, (_, i) =>
    TOWN_BY_RACE[c.loaded.zones.find((z) => z.playerNo === i + 1)!.race]!);
  const camBlock = /<dialogs>[^]*?<\/dialogs>/.exec(ref)![0];
  const cam = (tag: string): string => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(camBlock)![1]!;

  const ours = buildRmgMapDesc({
    tiles: c.size,
    twoLevel: spec.twoLevel,
    objects: r.objects,
    groundAmbientLight: c.params.groundTerrainLights[c.setup.ambientLightIndex]!,
    players,
    sRMG: {
      version: 34,
      seed: REFERENCE_SEED,
      guid: grab(/<RMGguid>([^<]*)<\/RMGguid>/),
      mapSize: spec.mapSize,
      template: `/RMG/Templates/${spec.template}.xdb#xpointer(/RMGTemplate)`,
      waterAmount: spec.waterAmount,
      monsterLevel: 'MONSTER_LEVEL_MEDIUM',
      hasUnderground: spec.twoLevel,
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
      writeFileSync(join('_tmp', `ours-map-${spec.label}.xdb`), ours);
      console.log(`  (ours dumped to _tmp/ours-map-${spec.label}.xdb)`);
    }
  }

  // The text files, against the fully unpacked archive when it is laid out.
  const fullBase = join('_tmp', 'oracle', `full-${spec.label}`, 'Maps', 'RMG');
  if (existsSync(fullBase)) {
    const guidDir = join(fullBase, readdirSync(fullBase)[0]!);
    const texts = buildRmgTexts(dir, {
      mapName: grab(/<MapName>([^<]*)<\/MapName>/),
      template: spec.template,
      sizeIndex: [72, 96, 136, 176, 216, 256, 320].indexOf(c.size),
      underground: spec.twoLevel,
      water: Boolean(c.water),
      monsterStrength: c.setup.monsterStrength,
      players,
      seed: REFERENCE_SEED,
    });
    let bad = 0;
    for (const t of texts) {
      const refFile = join(guidDir, t.name);
      if (!existsSync(refFile)) { bad++; console.log(`    ${t.name}: not in the archive`); continue; }
      if (!readFileSync(refFile).equals(t.data)) { bad++; console.log(`    ${t.name}: differs`); }
    }
    check(`the ${texts.length} text files are byte-identical`, bad === 0, `${bad} differ`);

    const tag = buildRmgMapTag({ tiles: c.size, twoLevel: spec.twoLevel, players });
    check('map-tag.xdb is byte-identical',
      readFileSync(join(guidDir, 'map-tag.xdb'), 'utf8') === tag);
    let miniBad = 0;
    for (let f = 0; f < (spec.twoLevel ? 2 : 1); f++) {
      if (readFileSync(join(guidDir, `minimap_floor_0${f + 1}.xdb`), 'utf8') !== buildMinimapXdb(f)) miniBad++;
    }
    check('the minimap Texture documents are byte-identical', miniBad === 0, `${miniBad} differ`);
  } else {
    console.log(`  (no ${fullBase} — the text half is skipped)`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
