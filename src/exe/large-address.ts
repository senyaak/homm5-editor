// The one bit that lets a 32-bit game see more than 2 GB.
//
// `H5_Game.exe` is not marked LARGEADDRESSAWARE, so on a 64-bit Windows its
// process gets the 2 GB it would have had on a 32-bit one, and a faction's
// copied town plus a row of creatures' art leaves a few hundred megabytes free
// in the menu. The mark is one bit of the COFF header's Characteristics
// (IMAGE_FILE_LARGE_ADDRESS_AWARE, 0x20); with it set, a 64-bit kernel gives
// the process 4 GB. Nothing in the code changes; whether the code copes with
// a pointer above 2 GB is the game's business — which is why this is a fix
// somebody TURNS ON rather than something the install does by itself.
//
// Set on the PATCHED executable, the one every other patch lives in and the
// one the extension is imported into: it is created once from the shipped
// one and kept, so the bit stays set across every ceiling moved after it.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE } from './creature-limit.ts';
import { refuseIfRunning } from '../game/running.ts';

export const LARGE_ADDRESS_AWARE = 0x20;

/** Where the COFF header's Characteristics field sits: after the PE signature, machine, section count, timestamp, symbol table, symbol count, optional header size. */
function characteristicsAt(buf: Buffer): number {
  if (buf.length < 0x40) throw new Error('not an executable: no DOS header');
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not an executable: no PE signature');
  return pe + 22;
}

/** Whether the image is marked large-address aware. */
export function isLargeAddressAware(buf: Buffer): boolean {
  return (buf.readUInt16LE(characteristicsAt(buf)) & LARGE_ADDRESS_AWARE) !== 0;
}

/** The image with the mark set or cleared. The same bytes back when nothing changes. */
export function withLargeAddressAware(buf: Buffer, on: boolean): Buffer {
  const at = characteristicsAt(buf);
  const was = buf.readUInt16LE(at);
  const now = on ? (was | LARGE_ADDRESS_AWARE) : (was & ~LARGE_ADDRESS_AWARE);
  if (now === was) return buf;
  const out = Buffer.from(buf);
  out.writeUInt16LE(now, at);
  return out;
}

export interface LargeAddressResult {
  path: string;
  on: boolean;
  changed: boolean;
}

/**
 * Set or clear the mark on the install's patched executable. Null when there
 * is no patched executable to mark — an install nothing has patched is left
 * alone, and the mark is nothing without the extension anyway.
 */
export function setLargeAddressAware(gameRoot: string, on: boolean): LargeAddressResult | null {
  const target = join(gameRoot, PATCHED_EXE);
  if (!existsSync(target)) return null;
  const buf = readFileSync(target);
  const patched = withLargeAddressAware(buf, on);
  if (patched === buf) return { path: target, on, changed: false };
  refuseIfRunning(gameRoot, 'cannot mark the executable large-address aware');
  const temp = `${target}.new`;
  writeFileSync(temp, patched);
  try {
    renameSync(temp, target);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, on, changed: true };
}
