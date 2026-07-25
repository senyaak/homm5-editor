// Validates the Heroes III campaign reader against real .h3c files.
//
// The header has no scenario count and a variable-length tail, so the test that
// matters is structural: parsing the header must land the cursor exactly on the
// first .h3m signature, and the scenario count must equal the number of maps in
// the container. Any field width read wrong desynchronizes everything after it
// and fails that check — which makes one assertion cover the whole format.
//
// Point at a folder of campaigns with H3_CAMPAIGNS; defaults to "герои 3".

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCampaign, mapFormat, playedScenarios } from '../src/h3c.ts';

const dir = process.env.H3_CAMPAIGNS ?? join(import.meta.dirname, '..', 'герои 3');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!existsSync(dir)) {
  console.log(`no campaign folder at ${dir} — set H3_CAMPAIGNS to run this`);
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.h3c')).sort();
check('campaigns found', files.length > 0, `${files.length} in ${dir}`);

let totalMaps = 0;
const formats = new Map<string, number>();

for (const file of files) {
  let ok = true;
  let detail = '';
  try {
    const c = readCampaign(readFileSync(join(dir, file)));
    const played = playedScenarios(c);
    totalMaps += played.length;

    // Contiguity: the maps must tile the tail with no gap and no overlap.
    let cursor = played[0]!.mapOffset;
    for (const s of played) {
      if (s.mapOffset !== cursor) { ok = false; detail = `gap before ${s.mapName}`; break; }
      if (s.mapSize <= 0) { ok = false; detail = `empty chunk for ${s.mapName}`; break; }
      cursor += s.mapSize;
    }
    if (ok && cursor !== c.data.length) { ok = false; detail = `maps end at ${cursor}, container is ${c.data.length}`; }

    // Every played region names a .h3m and its chunk declares a known map format.
    for (let i = 0; i < c.scenarios.length && ok; i++) {
      const s = c.scenarios[i]!;
      if (s.mapName === '') continue;
      if (!s.mapName.toLowerCase().endsWith('.h3m')) { ok = false; detail = `odd map name ${JSON.stringify(s.mapName)}`; }
      const fmt = mapFormat(c, i);
      if (fmt.startsWith('unknown')) { ok = false; detail = `${s.mapName}: ${fmt}`; }
      else formats.set(fmt, (formats.get(fmt) ?? 0) + 1);
      if (s.difficulty > 4) { ok = false; detail = `${s.mapName}: difficulty ${s.difficulty}`; }
    }

    if (ok) detail = `v${c.version} id=${c.campaignId} ${played.length} maps` + (played.length < c.scenarios.length ? ` (+${c.scenarios.length - played.length} empty regions)` : '');
  } catch (e) {
    ok = false;
    detail = (e as Error).message;
  }
  check(file, ok, detail);
}

check('maps read', totalMaps > 0, `${totalMaps} total · ${[...formats].map(([k, v]) => `${k}=${v}`).join(' ')}`);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
