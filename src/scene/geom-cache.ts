// Decoded models on disk, so a map opens from what was decoded last time.
//
// A scene is built one shared href at a time: the object's documents, its
// model's geometry, its textures, its effect's recordings, its idle clip —
// read, decoded, merged and baked into one GeomData (scene.ts
// createGeomResolver). That work depends on nothing but the files it read,
// so its result is kept here, one file per href and decode parameters, and
// the next open takes it from disk instead of doing it again.
//
// The entry remembers the files the decode READ, each with the path the asset
// chain resolved it to and that file's size and mtime; it is valid while every
// one of them resolves the same and stats the same, and a file that was
// missing stays missing. That is what a mod does when it mounts — a path
// resolves to another root — and what an edit does — the mtime moves — and it
// costs a stat per dependency, not a hash of anything. DECODER_VERSION is
// part of every entry's key: a change to the decode or the bake that leaves
// old entries readable would otherwise leave old entries in use.
//
// The file is the payload's own bytes laid out to be read back as views: a
// JSON header (the GeomData with every typed array replaced by a handle into
// the file) and the arrays back to back, aligned.
//
// What a model SHARES is not in its entry. A map wears one bark texture on
// fifty trees and plays one campfire two hundred times, and a payload keeps
// each as one object that every part and instance points at — an entry per
// href would hold fifty copies (the first cut read 340 MB where the payload
// was 92). So a picture and a baked recording are SHARED entries of their
// own, keyed by what already identifies them (a picture's key is its file
// and cap; a recording is its uid), and a model's entry holds references;
// the loader resolves a reference once per open, so the fifty trees share
// one object again. A shared entry has no dependencies of its own: every
// model entry that names it depends on the file it was made from.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Assets } from '../game/assets.ts';
import type { CompressedPicture, FxInstancePayload, GeomData, GeomPart, Picture } from './payload.ts';
import type { FxBaked } from './fx-bake.ts';
import { packBlobs, unpackBlobsSync, BLOB_ALIGN } from './blob-table.ts';

/** Bumped whenever what a decode or a bake writes changes shape or value. */
export const DECODER_VERSION = 1;

/** One file a decode read (or asked for and found missing), as it was then. */
export interface Dep {
  rel: string;
  /** Where the chain resolved it; null when no root had it. */
  path: string | null;
  size: number;
  mtime: number;
}

/**
 * The chain, watched: every path it resolves is remembered with the file's
 * size and mtime, so the decode that ran over it can say what it depends on.
 */
export function recordingAssets(chain: Assets): { assets: Assets; deps: () => Dep[] } {
  const seen = new Map<string, Dep>();
  const note = (rel: string): void => {
    if (seen.has(rel)) return;
    const path = chain.exists(rel) ? chain.path(rel) : null;
    let size = -1, mtime = -1;
    if (path) { try { const s = statSync(path); size = s.size; mtime = s.mtimeMs; } catch { /* vanished between exists and stat: recorded as missing */ }
    }
    seen.set(rel, { rel, path, size, mtime });
  };
  const assets: Assets = {
    roots: chain.roots,
    path: (rel) => { note(rel); return chain.path(rel); },
    exists: (rel) => { note(rel); return chain.exists(rel); },
    text: (rel, enc) => { note(rel); return chain.text(rel, enc); },
    bytes: (rel) => { note(rel); return chain.bytes(rel); },
    // Scans are not recorded: a decode does not list folders, and an entry
    // that depended on a folder's contents would have to stat every file in it.
    all: (rel) => chain.all(rel),
    dirs: (rel) => chain.dirs(rel),
  };
  return { assets, deps: () => [...seen.values()] };
}

/** Whether every dependency still resolves to the same file with the same size and date. */
export function depsValid(chain: Assets, deps: Dep[]): boolean {
  for (const d of deps) {
    const path = chain.exists(d.rel) ? chain.path(d.rel) : null;
    if (path !== d.path) return false;
    if (!path) continue;
    try {
      const s = statSync(path);
      if (s.size !== d.size || s.mtimeMs !== d.mtime) return false;
    } catch { return false; }
  }
  return true;
}

/** What a decode was asked to do — part of the entry's key with the href. */
export interface DecodeParams {
  texSize: number;
  animate: boolean;
  animationFps: number;
  /** Textures as DXT blocks (the window's GPU takes them) or as RGBA texels — two different pictures. */
  compressed: boolean;
}

/** The entry file for `href` decoded with `params`, under `dir`. */
export function entryPath(dir: string, href: string, params: DecodeParams): string {
  const key = createHash('sha1').update(`${DECODER_VERSION}|${href}|${params.texSize}|${params.animate ? 1 : 0}|${params.animationFps}|${params.compressed ? 'dxt' : 'rgba'}`).digest('hex');
  return join(dir, `${key}.h5g`);
}

/** The header of an entry file: what it depends on, and the geom with its arrays as handles into the file. */
export interface GeomEntry {
  v: number;
  href: string;
  deps: Dep[];
  /** Null: the href does not decode to anything (remembered so it is not retried every open). */
  geom: GeomData | null;
}

/** The URL a handle inside an entry carries: relative to the entry's own arrays section. */
export const ENTRY_URL = 'entry';

/** A reference from a model's entry to a shared one. NUL-prefixed, like a blob handle. */
interface SharedRef { '\0ref': string }
const isRef = (v: unknown): v is SharedRef => !!v && typeof v === 'object' && typeof (v as SharedRef)['\0ref'] === 'string';
const ref = (id: string): SharedRef => ({ '\0ref': id });
const sharedDir = (entryFile: string): string => join(entryFile, '..', 'shared');
const sharedPath = (dir: string, id: string): string => join(dir, `${createHash('sha1').update(id).digest('hex')}.h5s`);
/** What a picture is shared by: its own key (file and cap). A recording: its uid. */
const pictureId = (p: Picture | CompressedPicture): string | null => (p.key ? `pic|${p.key}` : null);
const recordingId = (fx: FxInstancePayload): string => `fx|${fx.uid}`;

/** One object as a file: [u32 header bytes][JSON header][pad][arrays], the header being the object with handles. */
function writeBlobFile(file: string, header: object, object: unknown): void {
  const parts: Uint8Array[] = [];
  let bytes = 0;
  const sink = {
    url: ENTRY_URL,
    add(b: Uint8Array): number {
      const at = bytes;
      parts.push(b);
      bytes += b.byteLength;
      const pad = (BLOB_ALIGN - (bytes % BLOB_ALIGN)) % BLOB_ALIGN;
      if (pad) { parts.push(new Uint8Array(pad)); bytes += pad; }
      return at;
    },
  };
  const packed = object === null ? null : packBlobs(object, sink, 0).payload;
  const json = Buffer.from(JSON.stringify({ ...header, object: packed }), 'utf8');
  const arraysAt = 4 + json.byteLength + (BLOB_ALIGN - ((4 + json.byteLength) % BLOB_ALIGN)) % BLOB_ALIGN;
  const out = Buffer.alloc(arraysAt + bytes);
  out.writeUInt32LE(json.byteLength, 0);
  json.copy(out, 4);
  let at = arraysAt;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  mkdirSync(join(file, '..'), { recursive: true });
  // Beside and renamed into place, so a reader never sees half a file — and
  // two decoders writing the same shared entry both leave a whole one.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, out);
  try {
    renameSync(tmp, file);
  } catch (e) {
    // On Windows a rename over a file another process has just made (or is
    // reading) is refused. A shared entry is the same bytes whoever wrote it,
    // so one that is there is the one wanted; anything else is an error.
    try { unlinkSync(tmp); } catch { /* the tmp may have moved */ }
    if (!existsSync(file)) throw e;
  }
}

/** A blob file read back: its header, and its object with the arrays as views over the one read. */
function readBlobFile<H>(file: string): { header: H; object: unknown } | null {
  if (!existsSync(file)) return null;
  try {
    const buf = readFileSync(file);
    const len = buf.readUInt32LE(0);
    const header = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as H & { object: unknown };
    const arraysAt = 4 + len + (BLOB_ALIGN - ((4 + len) % BLOB_ALIGN)) % BLOB_ALIGN;
    const { object, ...rest } = header;
    if (object !== null) {
      const arrays = buf.buffer.slice(buf.byteOffset + arraysAt, buf.byteOffset + buf.byteLength);
      unpackBlobsSync(object, (url) => { if (url !== ENTRY_URL) throw new Error(`${file}: a handle into ${url}`); return arrays; });
    }
    return { header: rest as unknown as H, object };
  } catch { return null; }
}

/**
 * Write a model's entry: its dependencies and the geom, the geom's pictures
 * and baked recordings written as shared entries (once — one that exists is
 * left alone) and referenced.
 */
export function writeGeomEntry(file: string, href: string, deps: Dep[], geom: GeomData | null): void {
  const shared = sharedDir(file);
  const share = (obj: object, id: string): SharedRef => {
    const p = sharedPath(shared, id);
    if (!existsSync(p)) writeBlobFile(p, { v: DECODER_VERSION, id }, obj);
    return ref(id);
  };
  const picture = (p: Picture | CompressedPicture | null): unknown => {
    const id = p ? pictureId(p) : null;
    return id ? share(p!, id) : p;
  };
  const slim = geom && {
    ...geom,
    parts: geom.parts.map((p): GeomPart => ({ ...p, tex: picture(p.tex) as GeomPart['tex'] })),
    ...(geom.fx ? { fx: geom.fx.map((f) => ({ ...f, textures: f.textures.map((t) => picture(t) as Picture | null), baked: share(f.baked, recordingId(f)) as unknown as FxBaked })) } : {}),
  };
  writeBlobFile(file, { v: DECODER_VERSION, href, deps }, slim);
}

/**
 * The shared entries one open has resolved so far, by id — what makes fifty
 * trees one bark texture again. Make one per open and hand it to every
 * `loadGeomEntry` of that open.
 */
export type SharedLoader = Map<string, unknown>;
export const sharedLoader = (): SharedLoader => new Map();

/**
 * A model's entry read back: its header, and its geom with real arrays and
 * its shared objects resolved. Null when there is no readable entry at `file`,
 * it was written by another decoder version, or a shared entry it names is
 * gone — the caller decodes afresh then. Whether it is still VALID against the
 * files it was made from is the caller's question (depsValid).
 */
export function loadGeomEntry(file: string, shared: SharedLoader): { entry: GeomEntry; geom: GeomData | null } | null {
  const read = readBlobFile<Omit<GeomEntry, 'geom'>>(file);
  if (!read || read.header.v !== DECODER_VERSION) return null;
  const geom = read.object as GeomData | null;
  const dir = sharedDir(file);
  const resolve = (v: unknown): unknown => {
    if (!isRef(v)) return v;
    const id = v['\0ref'];
    let obj = shared.get(id);
    if (obj === undefined) {
      const got = readBlobFile<{ v: number; id: string }>(sharedPath(dir, id));
      if (!got || got.header.v !== DECODER_VERSION || got.object === null) throw new Error(`shared entry ${id} is missing`);
      obj = got.object;
      shared.set(id, obj);
    }
    return obj;
  };
  try {
    if (geom) {
      for (const p of geom.parts) p.tex = resolve(p.tex) as GeomPart['tex'];
      for (const f of geom.fx ?? []) {
        f.textures = f.textures.map((t) => resolve(t) as Picture | null);
        f.baked = resolve(f.baked) as FxBaked;
      }
    }
  } catch { return null; }
  return { entry: { ...read.header, geom }, geom };
}

/**
 * Keep the cache under `budget` bytes: the oldest-written files go first,
 * model entries and shared ones alike. A shared entry taken from under a
 * model entry that still names it makes that entry unreadable, which its
 * next load answers by decoding afresh — so nothing here has to know who
 * references what. Returns the bytes removed.
 */
export function pruneGeomCache(dir: string, budget: number): number {
  const files: { path: string; size: number; mtime: number }[] = [];
  for (const sub of [dir, join(dir, 'shared')]) {
    let names: string[];
    try { names = readdirSync(sub); } catch { continue; }
    for (const n of names) {
      if (!/\.h5[gs]$/.test(n)) continue;
      try { const s = statSync(join(sub, n)); files.push({ path: join(sub, n), size: s.size, mtime: s.mtimeMs }); } catch { /* gone */ }
    }
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= budget) return 0;
  files.sort((a, b) => a.mtime - b.mtime);
  let removed = 0;
  for (const f of files) {
    if (total <= budget) break;
    try { unlinkSync(f.path); total -= f.size; removed += f.size; } catch { /* in use: next time */ }
  }
  return removed;
}
