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
//   readIndex(fd, size)         -> [{name, localOff, ...}]     an archive's directory, contents unread
//   readEntryFrom(fd, entry)    -> Buffer                       one member, decompressed on demand

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, readSync } from 'node:fs';
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
  /**
   * Modification time stamped on every member. Defaults to now, which is what makes
   * the game prefer this archive's files over the ones it shipped — see `dosStamp`.
   * Pin it only when byte-identical output matters more than that.
   */
  mtime?: Date;
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

/**
 * How many entries the central directory really holds.
 *
 * The end-of-central-directory record counts them in sixteen bits, and the
 * game's own archives overflow it: data.pak has 84,312 members and its EOCD
 * says 18,776 — the same number modulo 65536. There is no ZIP64 record to fall
 * back on (the archives predate the tools that write one), so the count is not
 * usable at all, and reading only what it claims silently returns a third of
 * the game. What IS reliable is the directory's own byte length, so the walk
 * runs to the end of it and the count is not consulted.
 *
 * Every reader below shares this: `while (moreEntries(cd, p, cdSize))`.
 */
function moreEntries(cd: Buffer, p: number, end: number): boolean {
  return p + 46 <= end && cd.readUInt32LE(p) === SIG_CENTRAL;
}

/**
 * DOS date and time for a member, as ZIP stores them: date is
 * `(year-1980)<<9 | month<<5 | day`, time is `hour<<11 | minute<<5 | second/2`.
 *
 * **The game reads these.** Given the same path in more than one mounted archive it
 * takes the newest member, so an archive stamped 1980-01-01 — the ZIP epoch, and what
 * this file used to write for everything — loses to the shipped `data.pak` on every
 * path it tries to override. A mod packed that way is read and then ignored, silently.
 * Proved on a mod that changed one creature: identical bytes, 1980 had no effect at
 * all, a real date took effect immediately.
 *
 * So members are stamped with the current time by default. `mtime` pins it for callers
 * that would rather have byte-identical output from an unchanged tree.
 *
 * Which archives are mounted, and why this rule reaches maps and not just mods:
 * docs/ARCHIVES.md.
 */
function dosStamp(when: Date): { time: number; date: number } {
  return {
    time: ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff,
    date: (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff,
  };
}

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
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16); // offset of first central-directory entry
  const cdEnd = p + cdSize;
  const out: ZipEntry[] = [];
  while (moreEntries(buf, p, cdEnd)) {
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

/** One member's location in an archive, without its contents. */
export interface ZipIndexEntry {
  name: string;
  /** Offset of the local file header. */
  localOff: number;
  /** Bytes on disk (compressed). */
  compSize: number;
  /** Uncompressed byte length. */
  size: number;
  method: number;
  /**
   * The member's own timestamp, as the DOS date and time it is stored as.
   *
   * Comparable as a number — bigger is newer — and that is what it is for: given
   * one path in several mounted archives the game takes the NEWEST member, so
   * anything gathering a file from more than one archive has to make the same
   * choice (docs/ARCHIVES.md).
   */
  stamp: number;
}

/**
 * Read an archive's central directory through a file descriptor, without
 * loading the archive.
 *
 * data.pak is 1.4 GB, and readEntries() decompresses every member up front —
 * fine for a map, hopeless for the game's own paks. This plus readEntryFrom()
 * walks an archive one member at a time.
 */
export function readIndex(fd: number, fileSize: number): ZipIndexEntry[] {
  // The EOCD sits within the last 64 KB + 22 bytes, after an optional comment.
  const tailLen = Math.min(fileSize, 0xffff + 22);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, fileSize - tailLen);
  const eocdInTail = findEOCD(tail);
  const cdOff = tail.readUInt32LE(eocdInTail + 16);
  const cdSize = tail.readUInt32LE(eocdInTail + 12);

  const cd = Buffer.alloc(cdSize);
  readSync(fd, cd, 0, cdSize, cdOff);

  const out: ZipIndexEntry[] = [];
  let p = 0;
  while (moreEntries(cd, p, cdSize)) {
    const at = p;
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOff = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // directory marker
    // Date in the high half, time in the low: one number that sorts by age.
    const stamp = cd.readUInt16LE(at + 14) * 0x10000 + cd.readUInt16LE(at + 12);
    out.push({ name, localOff, compSize, size, method, stamp });
  }
  return out;
}

/** Read and decompress one indexed member. */
export function readEntryFrom(fd: number, e: ZipIndexEntry): Buffer {
  // The local header's extra field can differ in length from the central one,
  // so the data offset has to come from the local header itself.
  const head = Buffer.alloc(30);
  readSync(fd, head, 0, 30, e.localOff);
  if (head.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`bad local header for ${e.name}`);
  const dataStart = e.localOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = Buffer.alloc(e.compSize);
  if (e.compSize) readSync(fd, raw, 0, e.compSize, dataStart);
  if (e.method === METHOD_DEFLATE) return inflateRawSync(raw);
  if (e.method === METHOD_STORE) return raw;
  throw new Error(`${e.name}: unsupported ZIP method ${e.method}`);
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

  const { time: dosTime, date: dosDate } = dosStamp(opt.mtime ?? new Date());

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
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
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
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
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
  // Sixteen bits for the count, so past 65535 the field cannot hold the truth.
  // Saturating is what ZIP readers expect (and better than the game's own
  // archives, which wrap: data.pak says 18,776 for 84,312 members). Ours read
  // the directory to its end and never consult this, which is the only way to
  // be right about either.
  const stated = Math.min(entries.length, 0xffff);
  eocd.writeUInt16LE(stated, 8);   // entries on this disk
  eocd.writeUInt16LE(stated, 10);  // total entries
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
