// Checks the generic reference-table ceiling patcher.
//
// The same bargain test-artifact-limit.ts makes: a miniature executable built
// here, so the test runs anywhere, carrying the one shape the patcher searches
// for — a table's path string, a reference to it, and the `push <count>` that
// registers the table's size. If the game is present it is read too, and only
// read.
//
// Two tables are exercised because they differ in the one way that matters: the
// hero class count is a `push imm8` (nine fits in a byte) and the skill count is
// a `push imm32` (221 does not).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HERO_CLASS_TABLE, HERO_SKILL_TABLE, MAX_IMM8, SPELL_TABLE, TOWN_TYPE_TABLE, findCountAccessor, findLoadSite, patchTableLimit, readTableLimit,
} from '../src/exe/table-limit.ts';
import type { TableSpec } from '../src/exe/table-limit.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/**
 * A miniature executable: PE header, one section, the string, and the push.
 *
 * `accessors` adds out-of-line `mov eax,count; ret` functions, `called` says how
 * many of them something calls. A table's second number is only its own when
 * exactly one live one returns it, so both halves have to be forgeable here.
 */
function tinyExe(
  table: TableSpec,
  o: { count?: number; noPush?: boolean; decoy?: boolean; accessors?: number; called?: number } = {},
): Buffer {
  const count = o.count ?? table.shipped;
  const BASE = 0x400000;
  const SECTION_VA = 0x1000;
  const HEADER = 0x200;

  const body: number[] = [];
  // A decoy first: another table's registration, with its own count. The search
  // must not drift onto it — which is what anchoring on the path buys.
  if (o.decoy) body.push(0x6a, 0x7b, 0x68, 0x63, 0, 0, 0);

  // The accessors come first, before anything that ends in a call: the tail
  // below is `call <the next byte>`, and with the accessors after it that call
  // landed on one of them and made a fixture that meant to have none live.
  const accessors: number[] = [];
  for (let i = 0; i < (o.accessors ?? 0); i++) {
    const imm = Buffer.alloc(4);
    imm.writeUInt32LE(count);
    accessors.push(BASE + SECTION_VA + body.length);
    body.push(0xb8, ...imm, 0xc3, 0x90, 0x90, 0x90, 0x90);   // mov eax,count; ret
  }

  const name = Buffer.from(`${table.path}\0`, 'latin1');
  const nameAt = body.length;
  const address = BASE + SECTION_VA + nameAt;
  body.push(...name);
  const literal = Buffer.alloc(4);
  literal.writeUInt32LE(address);
  body.push(0xba, ...literal);                    // mov edx, <the path>
  // The real one copies the string onto the heap in between; any distance under
  // sixty-four bytes is the same to the search.
  body.push(0x8d, 0x48, 0x27, 0x90, 0x90, 0x90);
  if (!o.noPush) {
    if (count > MAX_IMM8) {
      const imm = Buffer.alloc(4);
      imm.writeUInt32LE(count);
      body.push(0x68, ...imm);                    // push imm32
    } else {
      body.push(0x6a, count);                     // push imm8
    }
  }
  body.push(0x50, 0xe8, 0, 0, 0, 0);              // push eax; call

  // And the calls that make some of the accessors live.
  for (let i = 0; i < (o.called ?? 0); i++) {
    const from = BASE + SECTION_VA + body.length;
    const rel = Buffer.alloc(4);
    rel.writeInt32LE(accessors[i]! - (from + 5));
    body.push(0xe8, ...rel);                                 // call the i-th one
  }

  const buf = Buffer.alloc(HEADER + Math.max(0x200, body.length));
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write('PE\0\0', 0x80, 'latin1');
  buf.writeUInt16LE(1, 0x86);
  buf.writeUInt16LE(0xe0, 0x94);
  buf.writeUInt32LE(BASE, 0x80 + 0x34);
  const table_ = 0x80 + 24 + 0xe0;
  buf.write('.text\0\0\0', table_, 'latin1');
  buf.writeUInt32LE(body.length, table_ + 16);
  buf.writeUInt32LE(SECTION_VA, table_ + 12);
  buf.writeUInt32LE(HEADER, table_ + 20);
  Buffer.from(body).copy(buf, HEADER);
  return buf;
}

for (const table of [HERO_CLASS_TABLE, HERO_SKILL_TABLE, SPELL_TABLE, TOWN_TYPE_TABLE]) {
  console.log(`\n${table.what}:`);
  {
    const buf = tinyExe(table, { decoy: true });
    const site = findLoadSite(buf, table);
    check('the count is found past a decoy', site !== null);
    check('and it reads what the game ships', readTableLimit(buf, table).limit === table.shipped,
      String(readTableLimit(buf, table).limit));
    check('as the right width', site?.width === (table.shipped > MAX_IMM8 ? 4 : 1), `${site?.width} bytes`);
  }
  {
    const want = table.shipped + 4;
    const patched = patchTableLimit(tinyExe(table), table, want);
    check('a patch takes', patched.written && readTableLimit(patched.data, table).limit === want);
    const before = tinyExe(table);
    check('and touches nothing else', differing(before, patched.data) <= 4,
      `${differing(before, patched.data)} bytes differ`);
    const again = patchTableLimit(patched.data, table, want);
    check('patching to what it already says writes nothing', !again.written);
  }
  {
    let refused = false;
    try { patchTableLimit(tinyExe(table), table, table.shipped - 1); } catch { refused = true; }
    check('a ceiling below the shipped one is refused', refused);
    let missing = false;
    try { patchTableLimit(tinyExe(table, { noPush: true }), table, table.shipped + 1); } catch { missing = true; }
    check('an executable without the count is refused', missing);
  }
  if (table.shipped <= MAX_IMM8) {
    let refused = false;
    try { patchTableLimit(tinyExe(table), table, MAX_IMM8 + 1); } catch { refused = true; }
    check('a ceiling too big for a one-byte push is refused', refused);
  }

  // --- the second number ---------------------------------------------------
  {
    const want = table.shipped + 4;
    const dead = tinyExe(table, { accessors: 2, called: 0 });
    check('an accessor nothing calls is not this table\'s', findCountAccessor(dead, table, want) === null);
    const p = patchTableLimit(dead, table, want);
    check('and a patch leaves both of them alone', differing(dead, p.data) <= 4,
      `${differing(dead, p.data)} bytes differ`);

    const live = tinyExe(table, { accessors: 2, called: 1 });
    const found = findCountAccessor(live, table, want);
    check('the one that is called is', found !== null && found.callers === 1);
    const q = patchTableLimit(live, table, want);
    check('and a patch moves both numbers',
      q.written && readTableLimit(q.data, table).limit === want
      && q.accessor !== null && q.data.readUInt32LE(q.accessor.at) === want);
    check('while the dead one is still where it was', differing(live, q.data) <= 8,
      `${differing(live, q.data)} bytes differ`);

    // Raising it again: the accessor no longer says the shipped number, and has
    // to be found by what the registration says instead.
    const r = patchTableLimit(q.data, table, want + 1);
    check('and raising it again finds the accessor by what it now says',
      r.accessor !== null && r.data.readUInt32LE(r.accessor.at) === want + 1);

    let refused = false;
    try { findCountAccessor(tinyExe(table, { accessors: 2, called: 2 }), table, want); } catch { refused = true; }
    check('two live accessors returning the same number are refused, not guessed', refused);
  }
}

/** How many bytes moved — this is code, and a stray byte is a game that dies. */
function differing(before: Buffer, after: Buffer): number {
  let n = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) n++;
  return n;
}

// --- the real thing, read only ------------------------------------------------

// Said, never guessed from the checkout's position (tools/game-dir.ts); with
// nothing said, the real executables are skipped in so many words.
const gameRoot = gameDirIfAny();
if (!gameRoot) console.log('  skip  the real executables — pass --game <dir> or set HOMM5_GAME');
for (const exe of gameRoot ? ['bin/H5_Game_H5E.exe', 'bin/H5_Game.exe'] : []) {
  const path = join(gameRoot!, exe);
  if (!existsSync(path)) continue;
  const buf = readFileSync(path);
  console.log(`\n${exe}:`);
  for (const table of [HERO_CLASS_TABLE, HERO_SKILL_TABLE, SPELL_TABLE, TOWN_TYPE_TABLE]) {
    const r = readTableLimit(buf, table);
    if (r.wrapped) { check(`${table.what}: reported as wrapped, not as unknown`, true); continue; }
    check(`${table.what}: the count is found`, r.limit !== null, `${r.limit}`);
    // Said out loud because it is the thing that was missed once: the skill
    // table has a second number and the class table does not.
    const a = findCountAccessor(buf, table, r.limit ?? table.shipped);
    console.log(`        accessor: ${a ? `0x${a.address.toString(16)}, ${a.callers} caller(s)` : 'none'}`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
