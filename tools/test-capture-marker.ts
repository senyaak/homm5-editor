// The sign over a captured town of ours, in every player's colour —
// `src/mods/capture-marker.ts`:
//
//   eight colours, each a crest, a flag, and the five documents between the
//     table and the pictures;
//   the player colour table takes our item NINTH in every record, before the
//     grey one that RaceCount() indexes; neutral copies its own;
//   a table already carrying us is refused.
//
//   node tools/test-capture-marker.ts [dataRoot]

// needs: data
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataReader } from '../src/mods/mod-files.ts';
import { CAPTURE_COLOURS, PLAYER_COLOUR_SCHEMES, captureMarkerFiles, patchColourSchemes } from '../src/mods/capture-marker.ts';
import { BONE_ON_PLUM } from '../src/mods/faction-icons.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function throws(name: string, f: () => unknown, mentions: string): void {
  try { f(); check(name, false, 'did not throw'); } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mentions), msg);
  }
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);
const faction = { file: 'Test' };

console.log('the capture marker');
{
  const b = captureMarkerFiles(faction, BONE_ON_PLUM, read);
  check('nine files per colour, eight colours', b.files.length === 9 * CAPTURE_COLOURS.length, String(b.files.length));
  check('all under the faction', b.files.every((f) => f.path.startsWith('Factions/Test/capture/')));
  const sign = b.files.find((f) => f.path === 'Factions/Test/capture/02Red/Sign.(Texture).dds')!;
  const flag = b.files.find((f) => f.path === 'Factions/Test/capture/02Red/Flag.(Texture).dds')!;
  const s = decodeDDSBuffer(sign.data), fl = decodeDDSBuffer(flag.data);
  check('the crest is 128, cut out', s.width === 128 && s.height === 128 && s.rgba[3] === 0);
  check('the flag is 55', fl.width === 55 && fl.height === 55);
  const red = (img: { rgba: Uint8Array }): number => {
    let n = 0;
    for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i + 3]! > 200 && img.rgba[i]! > 180 && img.rgba[i + 1]! < 90) n++;
    return n;
  };
  check('and both are painted red', red(s) > 2000 && red(fl) > 100, `${red(s)} ${red(fl)}`);
  const effect = b.files.find((f) => f.path.endsWith('02Red/Marker.(Effect).xdb'))!.data.toString('latin1');
  check('the effect names our glow and our sign', effect.includes('/Factions/Test/capture/02Red/Glow.(ParticleInstance).xdb') && effect.includes('/Factions/Test/capture/02Red/Sign.(ModelInstance).xdb'));
  const model = b.files.find((f) => f.path.endsWith('02Red/Sign.(Model).xdb'))!.data.toString('latin1');
  check("the model borrows Academy's geometry and our material", model.includes('/_(Model)/Effects/Buildings/Capture/Academy/02Red-geom.xdb') && model.includes('/Factions/Test/capture/02Red/Sign.(Material).xdb'));
  check('the items name the flag and the effect', b.items['07Blue'].flag === '/Factions/Test/capture/07Blue/Flag.(Texture).xdb#xpointer(/Texture)' && b.items['07Blue'].marker === '/Factions/Test/capture/07Blue/Marker.(Effect).xdb#xpointer(/Effect)');

  const shipped = read(PLAYER_COLOUR_SCHEMES)!.toString('latin1');
  const table = patchColourSchemes(shipped, faction, b);
  const records = [...table.matchAll(/<ID>(\w+)<\/ID>[\s\S]*?<schemes>([\s\S]*?)<\/schemes>/g)].map((m) => ({ id: m[1]!, items: [...m[2]!.matchAll(/<Item>[\s\S]*?<\/Item>/g)].map((i) => i[0]) }));
  check('nine records, ten items each', records.length === 9 && records.every((r) => r.items.length === 10), records.map((r) => r.items.length).join(' '));
  const redRecord = records.find((r) => r.id === 'PCOLOR_RED')!;
  check('ours is the ninth item of red', redRecord.items[8]!.includes('/Factions/Test/capture/02Red/Marker.(Effect).xdb'));
  check('the grey one is still last', redRecord.items[9]!.includes('_BuildingFree_S') && redRecord.items[9]!.includes('NoPicture'));
  check('the eight before are the shipped ones, in order', redRecord.items.slice(0, 8).join('') === [...shipped.matchAll(/<ID>PCOLOR_RED<\/ID>[\s\S]*?<schemes>([\s\S]*?)<\/schemes>/g)][0]![1]!.match(/<Item>[\s\S]*?<\/Item>/g)!.slice(0, 8).join(''));
  const neutral = records.find((r) => r.id === 'PCOLOR_NEUTRAL')!;
  check('neutral got another grey', neutral.items.every((i) => i.includes('_BuildingFree_S')));
  check('every colour got its own', records.filter((r) => r.id !== 'PCOLOR_NEUTRAL').every((r) => /\/Factions\/Test\/capture\/\d\d\w+\/Marker/.test(r.items[8]!)));
  throws('a table already carrying us', () => patchColourSchemes(table, faction, b), 'already carries');
}

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
