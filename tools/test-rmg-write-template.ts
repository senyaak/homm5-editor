// The template writer, held to the game's files.
//
//   node tools/test-rmg-write-template.ts
//
// Read each of the 22 shipped templates and write it back: the bytes must be
// the bytes. That is the only proof that the shape the writer makes is the
// serialiser's — the tag order, the tabs, the CRLF, the two optional tags
// (`NameFileRef` in nineteen, `Shipyard` in two). Then `Jebus Cross.h5et`,
// which carries every field of ours: it holds comments and one-line items the
// model does not keep, so the round trip there is by MEANING — the written
// file reads back to the same template — and the writer is fixed on its own
// output. Skips itself when there is no unpacked data, the way the rest do.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTemplate, readTemplate } from '../src/rmg/template.ts';
import type { RmgTemplate } from '../src/rmg/template.ts';
import { usesOwnFields, writeTemplate } from '../src/rmg/write-template.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** The first line that differs, for a failure worth reading. */
function firstDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: ${JSON.stringify(la[i])} vs ${JSON.stringify(lb[i])}`;
  }
  return 'same lines, different bytes';
}

const dir = join(dataDir(), 'RMG', 'Templates');
if (!existsSync(dir)) {
  console.log('no unpacked RMG templates — run `npm run unpack-data`; skipping');
  process.exit(0);
}

console.log("the game's templates, byte for byte");
const files = readdirSync(dir).filter((f) => f.endsWith('.xdb'));
check('all 22 are there', files.length === 22, `${files.length}`);
let identical = 0;
for (const file of files) {
  const original = readFileSync(join(dir, file), 'utf8');
  const written = writeTemplate(parseTemplate(original));
  if (written === original) identical++;
  else check(`${file} comes back as it went`, false, firstDiff(original, written));
}
check('every shipped template round-trips byte for byte', identical === files.length, `${identical}/${files.length}`);
check('and none of them needs the .h5et spelling',
  files.every((f) => !usesOwnFields(readTemplate(join(dir, f)))));

// The two optional tags, seen rather than assumed: the writer emits each
// only where the reader saw it.
const withShipyard = readTemplate(join(dir, 'S0-1P2Z2K3.2T.xdb'));
check('S0-1P2Z2K3.2T reads Shipyard as written, not defaulted', withShipyard.zones.every((z) => z.shipyard === true));
check('and carries no NameFileRef', withShipyard.nameFileRef === null);
const plain = readTemplate(join(dir, 'S1P2Z2M1.xdb'));
check('S1P2Z2M1 reads Shipyard as absent', plain.zones.every((z) => z.shipyard === null));
check('and names its text file', plain.nameFileRef === 'S1P2Z2M1.txt');

console.log('\nJebus Cross, by meaning');
const jebusPath = join(import.meta.dirname, '..', 'assets', 'rmg', 'RMG', 'Templates', 'Jebus Cross.h5et');
const jebus = readTemplate(jebusPath);
check('it uses fields of ours', usesOwnFields(jebus));
const once = writeTemplate(jebus);
const again = parseTemplate(once);
check('written and read back, it is the same template', JSON.stringify(again) === JSON.stringify(jebus));
check('and the writer is fixed on its own output', writeTemplate(again) === once);
// Each field of ours, present in the output where Jebus has it — the
// meaning check above would pass a writer that dropped them all only if the
// reader defaulted them the same way, so name them.
check('ZoneLayout is written', once.includes('\t<ZoneLayout>Voronoi</ZoneLayout>\r\n'));
check('UniqueRaces is written', once.includes('\t<UniqueRaces>true</UniqueRaces>\r\n'));
check('GuardMultiplier is written with its fraction', once.includes('<GuardMultiplier>0.5</GuardMultiplier>'));
check('TreasureBlocks are written', (once.match(/<TreasureBlocks>/g) ?? []).length === jebus.zones.filter((z) => z.treasureBlocks.length).length);
check('Objects are written with a ceiling and a guard',
  once.includes('<Href>/MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb</Href>') && once.includes('<Max>1</Max>') && once.includes('<GuardStrenght>30</GuardStrenght>'));
check('Road false is written on the back ways', (once.match(/<Road>false<\/Road>/g) ?? []).length === jebus.connections.filter((c) => !c.road).length);
check('and no comment survives — the file is the model, nothing else', !once.includes('<!--'));

console.log('\nthe edges');
{
  // An empty template: the serialiser's spelling for an empty list, and the
  // fields of ours at their defaults write nothing.
  const empty: RmgTemplate = { ...plain, name: '', nameFileRef: null, zones: [], connections: [] };
  const text = writeTemplate(empty);
  check('empty lists are self-closed', text.includes('\t<Zones/>\r\n\t<Connections/>\r\n'));
  check('an empty name is self-closed', text.includes('\t<Name/>\r\n'));
  const back = parseTemplate(text);
  check('and it reads back empty', back.zones.length === 0 && back.connections.length === 0 && back.name === '');

  // A tier list is written as long as it is held — its length is the file's
  // (fifteen shipped templates stop Dwellings short) — and an empty one is
  // self-closed the way `S1-3P2Z7V3` writes three of its zones.
  const short = { ...plain, zones: [{ ...plain.zones[0]!, mines: [1, 2], dwellings: [] }] };
  const shortText = writeTemplate(short);
  const shortBack = parseTemplate(shortText);
  check('a short tier list is written as it is held', shortBack.zones[0]!.mines.join(',') === '1,2'
    && shortText.includes('\t\t\t<Dwellings/>\r\n') && shortBack.zones[0]!.dwellings.length === 0);

  // An object with no ceiling writes no Max and reads back unbounded.
  const open = { ...plain, zones: [{ ...plain.zones[0]!, objects: [{ href: '/MapObjects/X.xdb', min: 0, max: Number.POSITIVE_INFINITY, guardStrenght: 0 }] }] };
  const openText = writeTemplate(open);
  check('no ceiling writes no Max', !openText.includes('<Max>') && !openText.includes('<GuardStrenght>0<'));
  check('and reads back unbounded', parseTemplate(openText).zones[0]!.objects[0]!.max === Number.POSITIVE_INFINITY);

  // The characters XML cannot carry bare.
  const odd = { ...plain, name: 'A & B <C>', nameFileRef: 'say "hi".txt' };
  const oddBack = parseTemplate(writeTemplate(odd));
  check('a name with &, < and > survives', oddBack.name === 'A & B <C>', oddBack.name);
  check('a quote in an href survives', oddBack.nameFileRef === 'say "hi".txt', String(oddBack.nameFileRef));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
