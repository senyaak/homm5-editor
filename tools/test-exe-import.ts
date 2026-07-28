// Naming our extension in the executable's import table.
//
// The real proof is the game starting with the extension loaded, and that
// cannot happen here. What can: that the file still parses as a PE, that it now
// names our library alongside every one it named before, and that a second run
// changes nothing — an installer that grows the executable each time it is run
// would look like it worked.
//
// Runs against the game's own `H5_Game_NCF.exe` when there is one, because a
// synthetic PE proves the code agrees with itself and nothing more.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { addImport, imports } from '../src/exe-import.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const gameRoot = process.env.HOMM5_GAME ?? resolve(import.meta.dirname, '..', '..');
const exe = join(gameRoot, 'bin', 'H5_Game_NCF.exe');
if (!existsSync(exe)) {
  console.log(`no ${exe} — run npm run unwrap-exe first; skipping`);
  process.exit(0);
}

const original = readFileSync(exe);
const before = imports(original);
check('the shipped executable names its imports', before.length > 5, `${before.length}: ${before.slice(0, 4).join(', ')}…`);
check('and does not name ours yet', !before.includes('homm5-editor.dll'));

const first = addImport(original, 'homm5-editor.dll', 'homm5_editor_present');
check('adding it reports a change', first.added);
check('it lands past the old image', (first.rva ?? 0) >= original.readUInt32LE(original.readUInt32LE(0x3c) + 24 + 56),
  `rva 0x${(first.rva ?? 0).toString(16)}`);

const after = imports(first.buf);
check('ours is now imported', after.includes('homm5-editor.dll'));
// The point of copying the descriptors rather than editing in place: every
// library the game already needed has to still be there, in order.
check('and every library it already imported still is',
  before.every((d) => after.includes(d)) && after.length === before.length + 1,
  `${before.length} → ${after.length}`);

// Section bookkeeping. A wrong SizeOfImage is the classic way to make a file
// that looks right in a hex editor and refuses to start.
const pe = first.buf.readUInt32LE(0x3c);
const opt = pe + 24;
check('the section count went up by one',
  first.buf.readUInt16LE(pe + 6) === original.readUInt16LE(original.readUInt32LE(0x3c) + 6) + 1);
check('SizeOfImage covers the new section',
  first.buf.readUInt32LE(opt + 56) > (first.rva ?? 0),
  `0x${first.buf.readUInt32LE(opt + 56).toString(16)} > 0x${(first.rva ?? 0).toString(16)}`);
const sectionAlignment = first.buf.readUInt32LE(opt + 32);
check('and is a whole number of pages', first.buf.readUInt32LE(opt + 56) % sectionAlignment === 0);

// Idempotent. Running the installer twice is a thing people do.
const second = addImport(first.buf, 'homm5-editor.dll', 'homm5_editor_present');
check('a second run adds nothing', !second.added);
check('and returns the same bytes', second.buf.equals(first.buf), `${second.buf.length} vs ${first.buf.length}`);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
