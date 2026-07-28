// Checks the artifact ceiling patcher.
//
// Against a miniature executable built here, so it runs anywhere: a real PE
// header with one section, the artifact table's name in it, and the two shapes
// the ceiling is kept in — a `push 97` after the code that names the table, and
// a lone `mov eax, 97; ret`. That is enough to exercise everything that can go
// wrong, because the patcher finds its sites BY THOSE SHAPES and not by address.
//
// Which is the point of the test. Offsets differ between the retail and Steam
// compilations of the game — a lesson the creature patch learned the hard way —
// so a patcher that searches is the only kind worth having, and a search is
// exactly the thing that can quietly match the wrong place.
//
// If the game is present it is read too, but only read.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_IMM8, ORIGINAL_ARTIFACTS, SITES_FILE, findArtifactSites, patchArtifactLimit, readArtifactLimit,
} from '../src/artifact-limit.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/**
 * A miniature executable: PE header, one section, and inside it the table's
 * name, a reference to that name followed by `push 97`, and the accessor.
 */
function tinyExe(o: { count?: number; imm32?: boolean; accessor?: boolean } = {}): Buffer {
  const count = o.count ?? ORIGINAL_ARTIFACTS;
  const BASE = 0x400000;
  const SECTION_VA = 0x1000;
  const HEADER = 0x200;                       // the file offset the section starts at
  const name = Buffer.from('/GameMechanics/RefTables/Artifacts.xdb\0', 'latin1');

  const body: number[] = [];
  const nameAt = 0;                           // the string goes first in the section
  const address = BASE + SECTION_VA + nameAt;
  body.push(...name);
  // Something that mentions the string's address, then the push.
  const literal = Buffer.alloc(4);
  literal.writeUInt32LE(address);
  body.push(0xba, ...literal);                // mov edx, <address>
  body.push(0x90, 0x90, 0x90);                // a little distance, as the real one has
  if (o.imm32) {
    const imm = Buffer.alloc(4);
    imm.writeUInt32LE(count);
    body.push(0x68, ...imm);                  // push imm32
  } else {
    body.push(0x6a, count);                   // push imm8
  }
  body.push(0x50, 0xe8, 0, 0, 0, 0);          // push eax; call
  if (o.accessor !== false) {
    const imm = Buffer.alloc(4);
    imm.writeUInt32LE(count);
    body.push(0xcc, 0xcc, 0xb8, ...imm, 0xc3); // mov eax, count; ret
  }

  const buf = Buffer.alloc(HEADER + Math.max(0x200, body.length));
  buf.writeUInt32LE(0x80, 0x3c);              // e_lfanew
  buf.write('PE\0\0', 0x80, 'latin1');
  buf.writeUInt16LE(1, 0x86);                 // one section
  buf.writeUInt16LE(0xe0, 0x94);              // size of the optional header
  buf.writeUInt32LE(BASE, 0x80 + 0x34);       // image base
  const table = 0x80 + 24 + 0xe0;
  buf.write('.text\0\0\0', table, 'latin1');
  buf.writeUInt32LE(body.length, table + 16); // virtual size
  buf.writeUInt32LE(SECTION_VA, table + 12);
  buf.writeUInt32LE(HEADER, table + 20);      // raw offset
  Buffer.from(body).copy(buf, HEADER);
  return buf;
}

{
  const buf = tinyExe();
  const sites = findArtifactSites(buf);
  check('both places are found', sites.length === 2, sites.map((s) => s.what).join(', '));
  check('one is the load, one the accessor',
    sites.some((s) => s.what === 'load') && sites.some((s) => s.what === 'accessor'));
  check('and they agree', readArtifactLimit(buf).limit === ORIGINAL_ARTIFACTS,
    String(readArtifactLimit(buf).limit));
}

{
  const patched = patchArtifactLimit(tinyExe(), 100);
  check('a patch writes both', patched.written === 2, `${patched.written} written`);
  check('and reads back as what was asked', readArtifactLimit(patched.data).limit === 100);
  // Nothing else may move: the file is code, and a stray byte is a game that
  // does not start.
  const before = tinyExe();
  let differing = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== patched.data[i]) differing++;
  check('and touches nothing else', differing === 2, `${differing} bytes differ`);
}

{
  const already = patchArtifactLimit(tinyExe({ count: 100 }), 100);
  check('patching to what it already says writes nothing', already.written === 0);
}

{
  // A one-byte push cannot hold more than 127, and saying so is better than
  // truncating: 100 fits, 200 does not.
  let refused = false;
  try { patchArtifactLimit(tinyExe(), MAX_IMM8 + 1); } catch { refused = true; }
  check('a ceiling too big for a one-byte push is refused', refused);
  // The same executable with a four-byte push takes it.
  const wide = patchArtifactLimit(tinyExe({ imm32: true }), 300);
  check('but a four-byte push takes it', readArtifactLimit(wide.data).limit === 300);
}

{
  let refused = false;
  try { patchArtifactLimit(tinyExe({ accessor: false }), 100); } catch { refused = true; }
  check('an executable missing one of the two is refused', refused);
  let low = false;
  try { patchArtifactLimit(tinyExe(), ORIGINAL_ARTIFACTS - 1); } catch { low = true; }
  check('and so is a ceiling below what the game ships with', low);
}

// --- the real thing, read only ------------------------------------------------

const gameRoot = join(import.meta.dirname, '..', '..');
for (const exe of ['bin/H5_Game_H5E.exe', 'bin/H5_Game.exe']) {
  const path = join(gameRoot, exe);
  if (!existsSync(path)) continue;
  const r = readArtifactLimit(readFileSync(path));
  if (r.wrapped) {
    // The shipped Steam executable is encrypted, and reporting that is right.
    check(`${exe} is reported as wrapped, not as unknown`, r.sites.length === 0);
  } else if (r.sites.length === 2) {
    check(`${exe} has both places and they agree`, r.limit !== null, `limit ${r.limit}`);
  } else {
    // An executable already patched to a round number can no longer find its own
    // accessor — `mov eax,100; ret` occurs four times in the real one — which is
    // the whole reason the offsets are noted beside it when they ARE found.
    const noted = join(gameRoot, SITES_FILE);
    check(`${exe} is patched, so its places are in the note beside it`, existsSync(noted),
      `the search found ${r.sites.length} of 2, and ${SITES_FILE} is missing`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
