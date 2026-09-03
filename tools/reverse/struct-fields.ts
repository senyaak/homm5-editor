// PRINT THE FIELD MAP OF AN XDB-SERIALISED STRUCTURE.
//
// The reading itself is `xdb-fields.ts`, which `struct-use.ts` shares; this is
// the way to look at one on its own.
//
//   node tools/reverse/struct-fields.ts --at 0xb9e5d0        SRMGParameters
//   node tools/reverse/struct-fields.ts --at 0xb9b520        one template zone
//   node tools/reverse/struct-fields.ts --at 0xb9c1a0        SRMGTemplate
//   node tools/reverse/struct-fields.ts --at 0xb9e5d0 --exe <other exe>
//
// A field whose name is pushed with no `lea` to pair with is printed too, with
// no offset: that is the shape of a nested block the pairing could not settle,
// and leaving it out silently would make the listing look complete when it is
// not. There are two serialisers for most structures — one that READS the file
// into the object and one that WRITES it back — and only the reader has real
// offsets; the writer builds each value in a temporary and gives every field
// the same `[esp+0Ch]`. A listing where every offset is equal is that one.

import { resolve } from 'node:path';

import { PEFile } from '../../src/exe/pe.ts';
import { gameDir } from '../game-dir.ts';
import { xdbFields } from './xdb-fields.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const exeSaid = flag('exe');
const pe = PEFile.read(exeSaid ? resolve(exeSaid) : resolve(gameDir(), 'bin', 'H5_Game_H5E.exe'));

const at = Number.parseInt(flag('at') ?? '', 16);
if (!Number.isFinite(at)) {
  console.error('say which serialiser to read: --at 0xb9e5d0');
  process.exit(2);
}

const fields = xdbFields(pe, at, Number(flag('bytes') ?? 0x2000));
console.log(`0x${at.toString(16)} — ${fields.length} field(s)`);
for (const f of fields) {
  const off = f.offset === null ? '   ?  ' : `+0x${f.offset.toString(16).toUpperCase().padStart(3, '0')}`;
  console.log(`  ${off}  ${f.name}`);
}
