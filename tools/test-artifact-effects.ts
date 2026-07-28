// The file the native extension reads.
//
// It is the whole contract between the editor and the extension: the editor
// writes it, a C parser with no library behind it reads it, and nothing checks
// that the two agree except this. So the checks are about the FORMAT — the
// exact shape those forty lines of C expect — rather than about the numbers.

import { EFFECTS_FILE, effectsOf, readEffects, writeEffects } from '../src/artifact-effects.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

check('it lands beside the executable, not in the mod',
  EFFECTS_FILE.replace(/\\/g, '/') === 'bin/homm5-editor-effects.txt', EFFECTS_FILE);

// --- the shape the C parser expects -----------------------------------------

const text = writeEffects([
  { stat: 'necromancy', artifact: 97, amount: 5, name: 'ARTIFACT_H3_UNDERTAKERS_AMULET' },
  { stat: 'necromancy', artifact: 98, amount: 10 },
  { stat: 'necromancy', artifact: 99, amount: -3 },
]);
const lines = text.split('\r\n');

// The parser matches `necromancy artifact ` literally, then reads two decimals.
check('a row is stat, kind, id, amount', lines.includes('necromancy artifact 98 10'),
  lines.find((l) => l.includes('98')) ?? '(none)');
check('a name becomes a trailing comment, not another field',
  /^necromancy artifact 97 5 {3}# ARTIFACT_H3_UNDERTAKERS_AMULET$/.test(lines.find((l) => l.startsWith('necromancy artifact 97')) ?? ''),
  lines.find((l) => l.startsWith('necromancy artifact 97')) ?? '(none)');
check('a negative amount survives', lines.includes('necromancy artifact 99 -3'));
// The C reads the file into a fixed buffer line by line and splits on \n; CRLF
// is what every other file the game and the editor write uses.
check('lines end CRLF', text.includes('\r\n') && !/[^\r]\n/.test(text));
check('the header is commented out', lines[0]!.startsWith('#'));

// A row that adds nothing must not be written: in game it is indistinguishable
// from a row that was never read, so leaving it in makes the file lie.
const withZero = writeEffects([
  { stat: 'necromancy', artifact: 97, amount: 0 },
  { stat: 'necromancy', artifact: 98, amount: 4 },
]);
check('a zero amount is dropped', !withZero.includes('97') && withZero.includes('98 4'));

// --- round trip --------------------------------------------------------------

const back = readEffects(text);
check('it reads back to what was written', back.length === 3
  && back[0]!.artifact === 97 && back[0]!.amount === 5 && back[2]!.amount === -3,
  JSON.stringify(back));
check('comments are not rows', readEffects('# necromancy artifact 1 5\n').length === 0);
check('an unknown stat is ignored', readEffects('luck artifact 1 5\n').length === 0);

// --- from a mod's artifacts --------------------------------------------------

const rows = effectsOf([
  { id: 'ARTIFACT_A', number: 97, effects: { necromancy: 5 } },
  { id: 'ARTIFACT_B', number: 98 },
  { id: 'ARTIFACT_C', number: 99, effects: { necromancy: 0 } },
]);
check('only artifacts with an effect produce a row', rows.length === 1 && rows[0]!.artifact === 97,
  JSON.stringify(rows));
check('and the row carries the id as its comment', rows[0]!.name === 'ARTIFACT_A');

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
