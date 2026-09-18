// The large-address mark: one bit of the COFF header, set and cleared on a
// copy — a header built here, so the test runs anywhere, and the install's
// own unwrapped executable when there is one (read into a throwaway install
// under _tmp; the real one is only read).
//
//   node tools/test-large-address.ts [--game <dir>]

// needs: game
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE } from '../src/exe/creature-limit.ts';
import { LARGE_ADDRESS_AWARE, isLargeAddressAware, setLargeAddressAware, withLargeAddressAware } from '../src/exe/large-address.ts';
import { gameDirIfAny } from './game-dir.ts';

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

/** A DOS stub, a PE signature at 0x80, a COFF header with `characteristics`. */
function tinyExe(characteristics: number): Buffer {
  const buf = Buffer.alloc(0x100);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write('PE\0\0', 0x80, 'latin1');
  buf.writeUInt16LE(0x14c, 0x84);            // i386
  buf.writeUInt16LE(3, 0x86);                // sections
  buf.writeUInt16LE(0xe0, 0x94);             // optional header size
  buf.writeUInt16LE(characteristics, 0x96);
  return buf;
}

console.log('the bit');
{
  const plain = tinyExe(0x102);              // executable, 32-bit — as the game ships
  check('not marked as shipped', !isLargeAddressAware(plain));
  const on = withLargeAddressAware(plain, true);
  check('marked after', isLargeAddressAware(on) && on.readUInt16LE(0x96) === (0x102 | LARGE_ADDRESS_AWARE));
  check('the rest of the header untouched', on.subarray(0, 0x96).equals(plain.subarray(0, 0x96)) && on.subarray(0x98).equals(plain.subarray(0x98)));
  check('the same bytes back when nothing changes', withLargeAddressAware(plain, false) === plain && withLargeAddressAware(on, true) === on);
  check('cleared again', !isLargeAddressAware(withLargeAddressAware(on, false)));
  throws('not an executable', () => isLargeAddressAware(Buffer.alloc(0x100)), 'no PE signature');
}

const game = gameDirIfAny();
if (game && existsSync(join(game, PATCHED_EXE))) {
  console.log('a copy of the install\'s executable');
  const dir = join(import.meta.dirname, '..', '_tmp', 'large-address-test');
  rmSync(dir, { recursive: true, force: true });
  check('nothing to mark in an install with no patched executable', setLargeAddressAware(dir, true) === null);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(join(game, PATCHED_EXE), join(dir, PATCHED_EXE));
  const was = isLargeAddressAware(readFileSync(join(dir, PATCHED_EXE)));
  const on = setLargeAddressAware(dir, true);
  check('set', !!on && on.on && on.changed === !was && isLargeAddressAware(readFileSync(join(dir, PATCHED_EXE))));
  const again = setLargeAddressAware(dir, true);
  check('set again changes nothing', !!again && !again.changed);
  const off = setLargeAddressAware(dir, false);
  check('cleared', !!off && off.changed && !isLargeAddressAware(readFileSync(join(dir, PATCHED_EXE))));
  rmSync(dir, { recursive: true, force: true });
} else {
  console.log('no unwrapped executable (HOMM5_GAME, bin/H5_Game_H5E.exe) — the header half only');
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
