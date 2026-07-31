// What a wrapped executable is, and that an existing copy is never replaced.
//
// The download and Steamless itself are not exercised — that would need the
// network and a .NET runtime on every run. What is checked here is the part
// that decides whether to reach for either.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CLEAN_EXE, SHIPPED_EXE, classify, ensureCleanExe } from '../src/exe/exe-unwrap.ts';

let failures = 0;
const check = (what: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A minimal PE with the named sections. Enough for the section table reader. */
function fakePe(sections: readonly string[]): Buffer {
  const peAt = 0x80;
  const optSize = 0xe0;
  const buf = Buffer.alloc(peAt + 24 + optSize + sections.length * 40 + 16);
  buf.writeUInt16LE(0x5a4d, 0);          // MZ
  buf.writeUInt32LE(peAt, 0x3c);
  buf.writeUInt32LE(0x4550, peAt);       // PE\0\0
  buf.writeUInt16LE(sections.length, peAt + 6);
  buf.writeUInt16LE(optSize, peAt + 20);
  sections.forEach((name, i) => {
    buf.write(name.padEnd(8, '\0'), peAt + 24 + optSize + i * 40, 8, 'latin1');
  });
  return buf;
}

check('a PE with .text and .bind reads as wrapped',
  classify(fakePe(['.text', '.rdata', '.data', '.bind'])) === 'wrapped');
check('a PE without .bind reads as clean',
  classify(fakePe(['.text', '.rdata', '.data', '.reloc'])) === 'clean');
check('".bind" as loose text is not enough', (() => {
  const pe = fakePe(['.text', '.rdata']);
  return classify(Buffer.concat([pe, Buffer.from('.bind', 'latin1')])) === 'clean';
})(), 'the section table is the tell, not a string search');
check('something that is not a PE reads as clean',
  classify(Buffer.from('not an executable at all')) === 'clean');

// The install this editor sits in, when it sits in one — the real files are the
// only place the two states can be seen together.
const game = resolve(import.meta.dirname, '..', '..');
const shipped = join(game, SHIPPED_EXE);
const clean = join(game, CLEAN_EXE);
if (existsSync(shipped) && existsSync(clean)) {
  check('this install\'s shipped executable is wrapped',
    classify(readFileSync(shipped)) === 'wrapped', 'a Steam copy');
  check('this install\'s _H5E copy is clean',
    classify(readFileSync(clean)) === 'clean', 'what the patchers read');
} else {
  console.log('skip  no game executables beside this editor');
}

// An existing copy is left alone, whatever it holds. Getting this wrong would
// throw away a patched ceiling, which is the one failure worth a test of its own.
{
  const dir = mkdtempSync(join(tmpdir(), 'unwrap-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, SHIPPED_EXE), fakePe(['.text', '.bind']));
    const mine = Buffer.concat([fakePe(['.text', '.rdata']), Buffer.from('PATCHED CEILING')]);
    writeFileSync(join(dir, CLEAN_EXE), mine);
    const r = await ensureCleanExe(dir);
    check('an existing clean copy is kept', r.action === 'kept');
    check('...and not a byte of it is touched',
      readFileSync(join(dir, CLEAN_EXE)).equals(mine));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A clean shipped executable needs no Steamless at all: copy and done.
{
  const dir = mkdtempSync(join(tmpdir(), 'unwrap-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, SHIPPED_EXE), fakePe(['.text', '.rdata']));
    const r = await ensureCleanExe(dir);
    check('a clean shipped executable is copied, not downloaded for',
      r.action === 'copied' && existsSync(join(dir, CLEAN_EXE)), 'the GOG and retail case');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A wrapped file under the _H5E name is somebody's plain copy; it cannot be
// patched and must not be mistaken for a finished job.
{
  const dir = mkdtempSync(join(tmpdir(), 'unwrap-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, SHIPPED_EXE), fakePe(['.text', '.bind']));
    writeFileSync(join(dir, CLEAN_EXE), fakePe(['.text', '.bind']));
    let said = '';
    try { await ensureCleanExe(dir); } catch (e) { said = e instanceof Error ? e.message : String(e); }
    check('a wrapped _H5E copy is refused, and the message says to delete it',
      said.includes('itself wrapped') && said.includes('delete'), said);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
