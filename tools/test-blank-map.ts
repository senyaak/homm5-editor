// Validates buildBlankMap() — the from-scratch map.xdb (<AdvMapDesc>) generator.
//
//   1. Self-contained (always runs): the generated document parses as a map,
//      carries the requested size/level, has an empty object list, and
//      round-trips through the loss-less XML layer unchanged.
//   2. Against the real thing (optional): with a registry (game data) to supply
//      the spell/artifact rosters, the output is compared byte-for-byte to the
//      original editor's pristine blanks. Pass a dir of blanks as argv[2] (or set
//      HOMM5_BLANKS); the registry uses HOMM5_DATA or data-unpacked.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildBlankMap } from '../src/blank-map.ts';
import { loadMap } from '../src/map.ts';
import { Registry } from '../src/registry.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function testSelfContained(): void {
  // Minimal placeholder rosters — structure, not roster content, is under test.
  const spells = ['SPELL_NONE', 'SPELL_MAGIC_ARROW'];
  const artifacts = ['ARTIFACT_NONE'];
  for (const [tiles, twoLevel] of [[72, false], [136, true], [320, false]] as [number, boolean][]) {
    console.log(`\nSIZE ${tiles} twoLevel=${twoLevel}`);
    const text = buildBlankMap({ tiles, twoLevel, spells, artifacts });
    check('uses CRLF line endings', text.includes('\r\n') && !/[^\r]\n/.test(text));

    const map = loadMap(text);
    check('parses as a map', !!map);
    check('TileX/TileY match', map.tileX === tiles && map.tileY === tiles, `${map.tileX}x${map.tileY}`);
    check('HasUnderground matches', map.hasUnderground === twoLevel);
    check('object list is empty', map.objects.length === 0);
    check('has the eight player slots', map.desc && countChildren(text, 'players') === 8);
    check('terrain ref is GroundTerrain.bin', map.terrainFile === 'GroundTerrain.bin');
    check('round-trips through the XML layer', map.save() === text);
  }
}

// Count <Item> directly under the first <tag>…</tag> block (rough, for players).
function countChildren(text: string, tag: string): number {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? (m[1].match(/^\t\t<Item>$/gm) || []).length : 0;
}

function findBlanks(dir: string): Array<{ tiles: number; twoLevel: boolean; path: string }> {
  const out: Array<{ tiles: number; twoLevel: boolean; path: string }> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'map.xdb') {
        const t = readFileSync(p, 'latin1');
        const tiles = Number(t.match(/<TileX>(\d+)<\/TileX>/)?.[1]);
        // Only unedited New Map blanks: empty object list and tile palette, no
        // script, and the New Map defaults (the standard ambient light and the
        // scenario-caption text ref) — enough to exclude editor scratch/authored
        // files that also happen to have no objects.
        const blank = t.includes('<objects/>') && t.includes('<tiles/>')
          && t.includes('<MapScript/>') && t.includes('<MapRumours/>')
          && t.includes('0_Default_AmbientLight.xdb')
          && t.includes('href="scenario-caption.txt"');
        if (blank && Number.isFinite(tiles)) {
          out.push({ tiles, twoLevel: t.includes('<HasUnderground>true'), path: p });
        }
      }
    }
  };
  walk(dir);
  return out;
}

function testAgainstOracles(dir: string, dataRoot: string): void {
  console.log(`\nORACLES ${dir}`);
  const blanks = findBlanks(dir);
  if (!blanks.length) { console.log('  --    no pristine blank map.xdb found (skipped)'); return; }
  const reg = new Registry(dataRoot);
  const spells = reg.spells().map((s) => s.id);
  const artifacts = reg.artifacts().map((a) => a.id);
  for (const b of blanks) {
    const mine = buildBlankMap({ tiles: b.tiles, twoLevel: b.twoLevel, spells, artifacts });
    const ok = mine === readFileSync(b.path, 'latin1');
    check(`${b.tiles} twoLevel=${b.twoLevel} is byte-identical to the editor's blank`, ok, b.path);
  }
}

testSelfContained();

const dir = process.argv[2] || process.env.HOMM5_BLANKS;
const dataRoot = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'data-unpacked');
if (dir && existsSync(dir) && existsSync(join(dataRoot, 'GameMechanics'))) testAgainstOracles(dir, dataRoot);
else console.log('\n(no blank oracles + game data — pass a blanks dir and set HOMM5_DATA for the byte-exact check)');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
