// Validates buildNewMapProject() — the full New Map file set.
//
//   1. Self-contained (always runs): the expected files are present (map.xdb, the
//      surface terrain, an underground terrain only when two-level, and the 20
//      text files), and the text files are UTF-16-LE with a BOM.
//   2. Against the real thing (optional): for each pristine blank project found,
//      rebuild it from its own name/size/level plus the registry rosters and
//      compare every file byte-for-byte. Pass a dir (argv[2] / HOMM5_BLANKS);
//      game data via HOMM5_DATA or samples/paks/data.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildNewMapProject } from '../src/new-map.ts';
import { Registry } from '../src/registry.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function testSelfContained(): void {
  for (const twoLevel of [false, true]) {
    console.log(`\nPROJECT twoLevel=${twoLevel}`);
    const files = buildNewMapProject({ name: 'My Map', tiles: 96, twoLevel, spells: ['SPELL_NONE'], artifacts: ['ARTIFACT_NONE'] });
    const paths = new Set(files.map((f) => f.path));
    check('has map.xdb + GroundTerrain.bin', paths.has('map.xdb') && paths.has('GroundTerrain.bin'));
    check('underground terrain present iff two-level', paths.has('UndergroundTerrain.bin') === twoLevel);
    check('has all 20 text files', [...paths].filter((p) => p.endsWith('.txt')).length === 20);
    check('file count is right', files.length === (twoLevel ? 23 : 22), `${files.length}`);
    const name = files.find((f) => f.path === 'name.txt')!.data;
    check('name.txt is UTF-16-LE with a BOM', name[0] === 0xff && name[1] === 0xfe && name.toString('utf16le', 2) === 'My Map');
  }
}

// A pristine blank project = a folder with map.xdb whose object list and tile
// palette are empty and which carries the New Map default markers.
function findProjects(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'map.xdb') {
        const t = readFileSync(p, 'latin1');
        if (t.includes('<objects/>') && t.includes('<tiles/>') && t.includes('<MapScript/>')
          && t.includes('0_Default_AmbientLight.xdb') && t.includes('href="scenario-caption.txt"')) {
          out.push(dirname(p));
        }
      }
    }
  };
  walk(dir);
  return out;
}

function testAgainstOracles(dir: string, dataRoot: string): void {
  console.log(`\nORACLES ${dir}`);
  const dirs = findProjects(dir);
  if (!dirs.length) { console.log('  --    no pristine blank projects found (skipped)'); return; }
  const reg = new Registry(dataRoot);
  const spells = reg.spells().map((s) => s.id);
  const artifacts = reg.artifacts().map((a) => a.id);

  for (const d of dirs) {
    const xdb = readFileSync(join(d, 'map.xdb'), 'latin1');
    const tiles = Number(xdb.match(/<TileX>(\d+)<\/TileX>/)?.[1]);
    const twoLevel = xdb.includes('<HasUnderground>true');
    // The name is whatever the editor stored (UTF-16-LE, skip the BOM).
    const name = readFileSync(join(d, 'name.txt')).toString('utf16le', 2);

    const files = buildNewMapProject({ name, tiles, twoLevel, spells, artifacts });
    let ok = true;
    const onDisk = new Set(readdirSync(d));
    for (const f of files) {
      if (!onDisk.has(f.path)) { ok = false; break; }
      if (!f.data.equals(readFileSync(join(d, f.path)))) { ok = false; break; }
    }
    // Same file set both ways (ignore project.json if the editor adopted the dir).
    const generated = new Set(files.map((f) => f.path));
    for (const e of onDisk) if (!generated.has(e) && e !== 'project.json') ok = false;
    check(`${tiles} twoLevel=${twoLevel} "${name}" rebuilds byte-for-byte`, ok, d);
  }
}

testSelfContained();

const dir = process.argv[2] || process.env.HOMM5_BLANKS;
const dataRoot = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'samples', 'paks', 'data');
if (dir && existsSync(dir) && existsSync(join(dataRoot, 'GameMechanics'))) testAgainstOracles(dir, dataRoot);
else console.log('\n(no blank projects + game data — pass a dir and set HOMM5_DATA for the byte-exact check)');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
