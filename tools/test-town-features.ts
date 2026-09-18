// The town-feature table — `src/mods/town-features.ts` against the executable:
//
//   the forty-seven rows written down are the forty-seven rows compiled, in
//     order, at FEATURE_TABLE_RVA;
//   a grant resolves to that town's rows for that building, under our slot.
//
//   node tools/test-town-features.ts

// needs: game
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PEFile } from '../src/exe/pe.ts';
import { CLEAN_EXE } from '../src/exe/exe-unwrap.ts';
import { FEATURE_TABLE_RVA, SHIPPED_FEATURES, grantedFeatures } from '../src/mods/town-features.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('grants');
check("Stronghold's hall is three tiers", grantedFeatures('TB_SPECIAL_1', { like: 'TOWN_STRONGHOLD' }, 't').map((f) => `${f.minLevel}:${f.feature}`).join() === '1:39,2:40,3:41');
check("Sylvan's SPECIAL_0 is two levels, two features", grantedFeatures('TB_SPECIAL_3', { like: 'TOWN_PRESERVE', building: 'TB_SPECIAL_0' }, 't').map((f) => `${f.building}/${f.minLevel}:${f.feature}`).join() === '19/1:10,19/2:11');
check('the table has 47 rows and 47 distinct features', SHIPPED_FEATURES.length === 47 && new Set(SHIPPED_FEATURES.map((f) => f.feature)).size === 47);

console.log('the executable');
const game = gameDirIfAny();
const exePath = game ? join(game, CLEAN_EXE) : null;
if (!exePath || !existsSync(exePath)) {
  console.log(game ? `  (no ${CLEAN_EXE} — run \`npm run unwrap-exe\`; the table went unchecked)` : '  (nobody said where the game is — HOMM5_GAME or --game; the table went unchecked)');
} else {
  const exe = PEFile.read(exePath);
  const at = exe.offsetOf(0x400000 + FEATURE_TABLE_RVA)!;
  let same = 0;
  SHIPPED_FEATURES.forEach((row, i) => {
    const o = at + i * 16;
    const [feature, town, building, minLevel] = [0, 4, 8, 12].map((d) => exe.buf.readInt32LE(o + d));
    if (feature === row.feature && town === row.town && building === row.building && minLevel === row.minLevel) same++;
    else console.log(`  row ${i}: exe has {${feature}, ${town}, ${building}, ${minLevel}}, we wrote {${row.feature}, ${row.town}, ${row.building}, ${row.minLevel}}`);
  });
  check('every row as compiled', same === SHIPPED_FEATURES.length, `${same} of ${SHIPPED_FEATURES.length}`);
  const next = [0, 4, 8, 12].map((d) => exe.buf.readInt32LE(at + 47 * 16 + d));
  check('and nothing table-shaped after the last', !(next[1]! >= 2 && next[1]! <= 10 && next[2]! >= 0 && next[2]! <= 25 && next[3]! >= 1 && next[3]! <= 5), next.join(','));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
