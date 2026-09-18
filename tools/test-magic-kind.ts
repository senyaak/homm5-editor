// The magic file — `src/mods/magic-kind.ts`:
//
//   one row per class and per town of warcries, by ordinal;
//   a mod with neither writes a file with no rows (the extension then does
//     nothing — the file is always whole);
//   the rows are the classes' numbers and the towns' types, nobody else's.
//
//   node tools/test-magic-kind.ts

import { MAGIC_FILE, magicFileText, magicRows } from '../src/mods/magic-kind.ts';

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

console.log('the file');
check('beside the executable', MAGIC_FILE.replace(/\\/g, '/') === 'bin/homm5-editor-magic.txt');
const rows = magicRows(
  [{ number: 9, magic: 'warcries' }, { number: 10 }, { number: 11, magic: 'spellbook' }],
  [{ ordinal: 11, magic: 'warcries' }, { ordinal: 12 }, { ordinal: 13, magic: 'guild' }],
);
check('one row per class and town of warcries', rows.length === 2);
const text = magicFileText(rows);
const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
check('the class row', lines[0] === 'class 9 warcries');
check('the town row', lines[1] === 'town 11 warcries');
check('comments say the shape', text.includes('class <ordinal> warcries') && text.includes('town <townType> warcries'));
check('nobody: a file of comments alone', magicFileText([]).split('\n').every((l) => !l || l.startsWith('#')));
throws('an ordinal is positive', () => magicFileText([{ what: 'class', ordinal: 0 }]), 'positive');

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
