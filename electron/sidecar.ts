// The text files a map references — its name, its rumours, its Lua.
//
// They are documents of their own, not part of map.xdb, so they are read and
// written straight to disk rather than through the model. What is shared is
// where a reference lands (inside the map folder, never outside it) and which
// encoding the game expects back.

import { dirname, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Session } from '#electron/state.ts';

/**
 * Where a text reference lands inside the map folder.
 *
 * A ref is relative to the map document, and it is not always a bare name: a
 * mission keeps its objective texts in a subfolder (`objectives/prim1_name.txt`
 * on C1M1), and flattening that to the basename wrote the file next to map.xdb
 * while the ref went on pointing into a folder that did not exist — a reference
 * to nothing, which is worse than refusing.
 *
 * Refuses to leave the map folder: a `..` in a ref would otherwise write
 * anywhere on disk, and no legitimate map has one.
 */
export function sidecarPath(s: Session, href: string): string | null {
  if (!href) return null;
  const rel = href.split('#')[0]!.replace(/^[/\\]+/, '');
  if (!rel) return null;
  const file = resolve(s.mapDir, rel);
  const root = resolve(s.mapDir);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return file;
}

/**
 * Read a text file the map references (name.txt, description.txt), decoding the
 * BOM the game writes. Empty href or a missing file returns '' rather than
 * throwing — a map with no name is a display gap, not an error.
 */
export function readSidecarText(s: Session, href: string): string {
  const file = sidecarPath(s, href);
  if (!file || !existsSync(file)) return '';
  const buf = readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

/**
 * The `href` of a Script wrapper's `<FileName>` — the `.lua` it runs.
 *
 * A map script is always two files: the `.lua` the engine runs and the `.xdb`
 * wrapper that names it, and every reference — `MapScript`, a hero's
 * `CombatScript` — points at the wrapper. So anything that wants the source
 * goes through here rather than guessing that the names match.
 */
export function readScriptFileName(xml: string): string | null {
  return /<FileName\s+href="([^"]*)"/i.exec(xml)?.[1] ?? null;
}

/**
 * Write a text file of the map, keeping the encoding it already has.
 *
 * A NEW file's encoding follows what it is for: the game writes its display
 * texts (name.txt, an objective's caption) as UTF-16LE with a BOM, and reads
 * them back that way — but a .lua is source the engine's parser reads byte by
 * byte, and a UTF-16 script is a script it cannot run at all. So anything that
 * is not a .txt is written as plain UTF-8.
 *
 * Our own write is folded into the watcher baseline so it is not reported back
 * as somebody else's edit.
 */
export function writeSidecarText(s: Session, href: string, text: string): boolean {
  const file = sidecarPath(s, href);
  if (!file) return false;
  // A ref into a subfolder the map does not have yet is how the folder gets
  // made — the original's objective texts live in one.
  mkdirSync(dirname(file), { recursive: true });
  const isText = /\.txt$/i.test(file);
  let enc: 'utf16le' | 'utf8' = isText ? 'utf16le' : 'utf8';
  let bom = isText;
  if (existsSync(file)) {
    const b = readFileSync(file);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { enc = 'utf8'; bom = true; }
    else if (!(b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)) { enc = 'utf8'; bom = false; }
  }
  const head = enc === 'utf16le' ? Buffer.from([0xff, 0xfe]) : (bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0));
  writeFileSync(file, Buffer.concat([head, Buffer.from(text, enc)]));
  s.watch.resync();
  return true;
}
