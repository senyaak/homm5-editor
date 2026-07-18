// HoMM5 archive layer — read and write the game's package files.
//
// `.pak` (game data), `.h5m` (single map), `.h5c` (campaign) and `.h5u` (user
// mod) are all plain ZIP archives (local-file-header + central-directory + EOCD,
// entries stored raw or DEFLATE-compressed). We implement a small, dependency-free
// ZIP reader/writer on top of Node's zlib so the editor has no native deps.
//
// The editor's working model (see ROADMAP "Project model"): a project is a tree
// of UNPACKED files on disk. `extract()` opens an archive into that tree; `pack()`
// builds the tree back into an archive. Nothing edits the ZIP in place.
//
// Exports:
//   readEntries(buf)            -> [{name, data:Buffer}]        parse an archive in memory
//   extract(archivePath, dir)   -> [{name, size}]              unpack archive to a directory
//   pack(dir, archivePath, opt) -> {entries, bytes}            pack a directory into an archive
//   writeArchive(entries, opt)  -> Buffer                       build a ZIP from {name,data} list
//   listDirFiles(dir)           -> [relPathPosix]              recursively list a tree (posix paths)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** One archive member: a ZIP-style forward-slash path plus its raw bytes. */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** One extracted member as reported by `extract()`: path written and its byte size. */
export interface ExtractedFile {
  name: string;
  size: number;
}

/** Options shared by `writeArchive()` and `pack()`. */
export interface WriteOptions {
  /** Force STORE (no compression) for the matching entry names. */
  store?: Set<string> | ((name: string) => boolean);
}

/** Result of `pack()`: how many entries were written and the archive size in bytes. */
export interface PackResult {
  entries: number;
  bytes: number;
}

// ---- CRC-32 (IEEE, as ZIP requires) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP signatures.
const SIG_LOCAL = 0x04034b50;   // PK\x03\x04  local file header
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02  central directory entry
const SIG_EOCD = 0x06054b50;    // PK\x05\x06  end of central directory

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// A fixed DOS timestamp keeps packing reproducible (same tree -> same bytes ->
// stable content hash). 1980-01-01 00:00:00, the ZIP epoch. Callers that want
// real mtimes can pass them through the entry list (not needed by the editor).
const DOS_TIME = 0;
const DOS_DATE = 0x21; // (1980-1980)<<9 | 1<<5 | 1

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Parse a ZIP archive held in a Buffer into a flat list of entries with their
 * decompressed contents. Directory entries (names ending in '/') are skipped —
 * directories are implied by file paths.
 *
 * We read the central directory (authoritative) rather than scanning local
 * headers, so we get the correct sizes and offsets even for odd archives.
 */
export function readEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of first central-directory entry
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`bad central dir entry #${i} @${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory marker

    // Jump to the local header to find where the compressed data actually starts
    // (local extra field length can differ from the central one).
    if (buf.readUInt32LE(localOff) !== SIG_LOCAL) throw new Error(`bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === METHOD_DEFLATE ? inflateRawSync(raw)
      : method === METHOD_STORE ? Buffer.from(raw)
      : (() => { throw new Error(`${name}: unsupported ZIP method ${method}`); })();
    out.push({ name, data });
  }
  return out;
}

// Locate the End Of Central Directory record by scanning backwards for its
// signature (it sits near the end, after an optional variable-length comment).
function findEOCD(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('not a ZIP archive (no EOCD found)');
}

/**
 * Unpack an archive file into a directory tree on disk.
 * Returns the list of written files with their sizes.
 */
export function extract(archivePath: string, destDir: string): ExtractedFile[] {
  const entries = readEntries(readFileSync(archivePath));
  const written: ExtractedFile[] = [];
  for (const e of entries) {
    const dest = join(destDir, e.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
    written.push({ name: e.name, size: e.data.length });
  }
  return written;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Build a ZIP archive Buffer from a list of { name, data } entries.
 * `name` uses forward slashes (ZIP convention); `data` is a Buffer.
 *
 * Options:
 *   store: Set<string> | (name)=>bool  — force STORE (no compression) for matches.
 *          Already-compressed payloads (.dds textures) don't shrink; storing them
 *          is faster and smaller than a failed deflate. By default we deflate and
 *          fall back to STORE whenever deflate wouldn't help.
 */
export function writeArchive(entries: readonly ZipEntry[], opt: WriteOptions = {}): Buffer {
  const store = opt.store;
  const forceStore: (name: string) => boolean =
    typeof store === 'function' ? store
    : store instanceof Set ? (n: string) => store.has(n)
    : () => false;

  const locals: Buffer[] = [];   // local-header + data chunks, in file order
  const centrals: Buffer[] = []; // central-directory records
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const uSize = e.data.length;

    // Decide compression: STORE if forced, empty, or deflate doesn't pay off.
    let method = METHOD_STORE, payload = e.data;
    if (!forceStore(e.name) && uSize > 0) {
      const def = deflateRawSync(e.data, { level: 9 });
      if (def.length < uSize) { method = METHOD_DEFLATE; payload = def; }
    }
    const cSize = payload.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0, 6);         // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cSize, 18);
    local.writeUInt32LE(uSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);        // extra len
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);      // version made by
    central.writeUInt16LE(20, 6);      // version needed
    central.writeUInt16LE(0, 8);       // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(cSize, 20);
    central.writeUInt32LE(uSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // local header offset
    // fields 30/32/34/36/38 (extra, comment, disk, attrs) left zero
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);   // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);  // total entries
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(offset, 16);          // central dir offset
  return Buffer.concat([...locals, centralBlock, eocd]);
}

/**
 * Pack a directory tree into an archive file on disk.
 * Returns { entries, bytes }. Entry order is sorted for reproducible output.
 */
export function pack(srcDir: string, archivePath: string, opt: WriteOptions = {}): PackResult {
  const files = listDirFiles(srcDir).sort();
  const entries: ZipEntry[] = files.map((rel) => ({ name: rel, data: readFileSync(join(srcDir, rel)) }));
  const buf = writeArchive(entries, opt);
  writeFileSync(archivePath, buf);
  return { entries: entries.length, bytes: buf.length };
}

/**
 * Recursively list every file under `dir`, returning paths relative to `dir`
 * with forward slashes (ZIP/posix convention regardless of host OS).
 */
export function listDirFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}
