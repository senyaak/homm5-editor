// The extension's logging switches — that every file has one, and that a file
// nobody asked for really is not in the built DLL.
//
//   node tools/test-native-log.ts
//
// WHAT THIS CATCHES, and why it is worth a compile.
//
// The switch is `#define LOG_UNIT` in each source and `-DH5E_LOG_<unit>` on the
// command line, and the whole promise is that a unit set to 0 costs the DLL
// NOTHING — no call, no format string, no sentence about a spell sitting in the
// bytes of a build meant for playing. That promise is the compiler's to keep,
// not ours: it rests on `if (LOG_ON)` folding to `if (0)` and the literal
// behind it going unreferenced. Nothing in the source says whether that
// happened. So this builds the thing and looks.
//
// AND IT LOOKS BOTH WAYS. A check that can only ever say "the string is not
// there" would pass just as happily if the build were broken, if the string had
// been renamed, or if the search were looking in the wrong file. So every
// absence here is paired with a presence: the same sentence, from a build that
// DID ask for that unit, has to be found. One half proves the cut, the other
// proves the check can fail.
//
// The cheap half — every file naming exactly one unit, and naming it after
// itself — runs first and needs no compiler. A file that forgets the line does
// not fail to compile: it inherits whichever unit the file above it set, and
// then it logs, or goes quiet, with somebody else's switch.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  LOG_UNITS_BY_DEFAULT, asLogUnit, buildExtension, logDefines, logUnits,
} from '../src/mods/extension.ts';

const here = join(import.meta.dirname, '..');
const NATIVE = join(here, 'native');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith('.c')) out.push(path);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
console.log('\nevery source names its own switch');

const files = sources(NATIVE);
check('there are sources to check', files.length > 10, `${files.length} files`);

const seen = new Map<string, string>();
for (const file of files) {
  const rel = relative(NATIVE, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const defines = [...text.matchAll(/^#define LOG_UNIT (\w+)/gm)].map((m) => m[1]!);

  if (defines.length !== 1) {
    check(rel, false, `${defines.length} "#define LOG_UNIT" lines, want exactly one`);
    continue;
  }
  const unit = defines[0]!;

  // The name IS the path — that is the whole vocabulary a person types at
  // `--log`, so a unit that does not match its file is a name nobody can guess.
  const wanted = asLogUnit(rel);
  if (unit !== wanted) {
    check(rel, false, `names itself ${unit}, but its path says ${wanted}`);
    continue;
  }

  // Without the `#undef` the compiler warns on every one of these, and a build
  // that prints forty-five warnings is a build whose warnings nobody reads.
  if (!new RegExp(`^#undef LOG_UNIT\\r?\\n#define LOG_UNIT ${unit}$`, 'm').test(text)) {
    check(rel, false, 'the "#define LOG_UNIT" has no "#undef LOG_UNIT" directly above it');
    continue;
  }

  const already = seen.get(unit);
  if (already) {
    check(rel, false, `shares the unit ${unit} with ${already}`);
    continue;
  }
  seen.set(unit, rel);
  check(rel, true, unit);
}

// ---------------------------------------------------------------------------
console.log('\nwhat a build can be asked for');

const units = logUnits(here);
check('the sources are the register', units.length === files.length,
  `${units.length} units for ${files.length} files`);

// `--list-log` prints each file's own first line as what it is about. That is
// the only summary of these files anybody maintains, so a file that loses its
// opening comment does not get a blank column — it gets caught here.
const mute = units.filter((u) => u.about.length < 10);
check('every file opens with a line saying what it is for', mute.length === 0,
  mute.map((u) => u.file).join(', '));

// The default list is the one thing here written by hand rather than read out
// of the sources, so it is the one thing that can name something that is gone.
let defaultsOk = true;
try { logDefines(here, []); } catch (e) { defaultsOk = false; check('defaults', false, String(e)); }
if (defaultsOk) {
  check('every default unit exists', true, LOG_UNITS_BY_DEFAULT.join(', '));
}

for (const typed of ['combat/spell-resolve', 'combat/spell-resolve.c', 'native/combat/spell-resolve.c',
                     'combat\\spell-resolve', 'combat_spell_resolve']) {
  check(`"${typed}" is understood`, asLogUnit(typed) === 'combat_spell_resolve');
}

let refused = false;
try { logDefines(here, ['combat/no-such-file']); } catch { refused = true; }
check('a file that does not exist is refused', refused);

const off = logDefines(here, []);
check('every unit gets a -D, on or off', off.length === units.length, `${off.length} defines`);
check('the ones not asked for are 0',
  off.filter((d) => d.endsWith('=0')).length === units.length - LOG_UNITS_BY_DEFAULT.length);

// ---------------------------------------------------------------------------
console.log('\nand a unit that was not asked for is not in the DLL');

/**
 * A sentence from a file, and the unit that would print it.
 *
 * Chosen from the files that log most — if the cut works anywhere it works
 * here, and if it silently stopped working these are the strings that would
 * bloat a shipped DLL first.
 */
const SAMPLES = [
  { unit: 'combat/spell-resolve', text: 'the whole cast came to ' },
  { unit: 'lua/adv-cast', text: 'GATE >>> asked about a spell of ours' },
  { unit: 'qol/stack-plates', text: 'stack plates: ' },
];

function has(dll: string, text: string): boolean {
  return readFileSync(dll).includes(Buffer.from(text, 'latin1'));
}

const quiet = buildExtension(here, () => {}, ['none']);
const quietBytes = readFileSync(quiet).length;
for (const { unit, text } of SAMPLES) {
  check(`"${text.trim()}" is gone with --log none`, !has(quiet, text), unit);
}

// The other half: the same sentences, from a build that asked for them. Without
// this the check above would pass on a typo.
const loud = buildExtension(here, () => {}, SAMPLES.map((s) => s.unit));
for (const { unit, text } of SAMPLES) {
  check(`"${text.trim()}" is there when asked for`, has(loud, text), unit);
}

const loudBytes = readFileSync(loud).length;
check('asking for them costs bytes', loudBytes > quietBytes,
  `${quietBytes} silent, ${loudBytes} with three files speaking`);

// Left as the ordinary build, so a run of this does not leave a DLL behind that
// says either more or less than a plain `npm run build-native` would.
buildExtension(here, () => {});

console.log(failures ? `\n${failures} FAILED\n` : '\nall ok\n');
process.exit(failures ? 1 : 0);
