// Project layer — the editor works on an UNPACKED tree of files, and "Pack" is
// an explicit build step. This module owns the project manifest that ties the two
// together and tracks versions, so the editor can always answer:
//   * which files changed since the last pack (is the built archive stale?), and
//   * was the last pack built by a different editor version?
//
// A project is a directory containing the unpacked game files plus one metadata
// file, `project.json`:
//
//   {
//     editorVersion: "0.0.1",              // current editor (from package.json)
//     source:   { path, hash },            // archive it was opened from
//     lastPack: {                          // null until first pack
//       time, editorVersion, output,       // when/what produced the archive
//       archiveHash,                       // sha1 of the produced archive
//       files: { "<rel>": {hash, size} }   // snapshot of the tree at pack time
//     }
//   }
//
// "Divergence" is a pure comparison of the current tree against lastPack.files:
// added / removed / modified paths. No file watching, no daemon — status() just
// re-hashes the tree on demand (hashing is cheap next to (de)compression).
//
// Exports:
//   openProject(archivePath, projectDir)      -> { manifest, files, projectDir }
//   packProject(projectDir, outPath, opt)     -> { entries, bytes, manifest }
//   status(projectDir)                        -> { dirty, added, removed, modified,
//                                                  versionMismatch, neverPacked }
//   readManifest(projectDir) / writeManifest(projectDir, manifest)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extract, writeArchive, listDirFiles, readEntries } from './pak.ts';
import type { ExtractedFile, PackResult, WriteOptions, ZipEntry } from './pak.ts';

export const MANIFEST_NAME = 'project.json';

/**
 * Which of an archive's files is THE map.
 *
 * An `.h5m` saved by the original editor can carry more than one `map.xdb`: a
 * map built through the scene-property builder ships a copy of the builder's
 * own template under `Editor/Builder/…`. Taking the first one found opened a
 * 42 KB stub instead of the user's 136 KB map — and, worse, made that stub the
 * project, so Save would have packed the stub over the map.
 *
 * The map the game loads is the one under `Maps/`, which is also what the
 * archive's entry names mean (see archivePrefix). Among several, the shallowest
 * wins; anything else is an asset that came along for the ride.
 */
export function pickMapRel(names: string[]): string | undefined {
  const maps = names.filter((n) => /(^|\/)map\.xdb$/i.test(n));
  const inMaps = maps.filter((n) => /^maps\//i.test(n));
  const pool = inMaps.length ? inMaps : maps;
  return pool.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

/** One file in a pack-time snapshot: its sha1 and byte size. */
export interface FileStamp {
  hash: string;
  size: number;
}

/** Snapshot of a whole tree, keyed by posix-style path relative to the project dir. */
export type TreeSnapshot = Record<string, FileStamp>;

/** The archive a project was opened from, with its sha1 at open time. */
export interface ProjectSource {
  path: string;
  hash: string;
}

/** Record of the last successful pack — what was built, by whom, and from what. */
export interface LastPack {
  /** ISO timestamp of the pack. */
  time: string;
  /** Editor version that produced the archive. */
  editorVersion: string;
  /** Path the archive was written to. */
  output: string;
  /** sha1 of the produced archive. */
  archiveHash: string;
  /** Snapshot of the working tree at pack time; status() diffs against this. */
  files: TreeSnapshot;
}

/** Contents of `project.json` — the on-disk project manifest. */
export interface ProjectManifest {
  /** Editor version that last wrote this manifest. */
  editorVersion: string;
  /** Archive the project was opened from, or null for an adopted loose folder. */
  source: ProjectSource | null;
  /** ISO timestamp of project creation. */
  createdAt: string;
  /** Last pack record, or null when nothing has been built yet. */
  lastPack: LastPack | null;
  /**
   * Folder the map sits at INSIDE the archive, posix-style and without a
   * trailing slash — 'Maps/SingleMissions/foo' for a map the original editor
   * packed from <data>/Maps/SingleMissions/foo.
   *
   * Archive members are paths relative to the game's data root, not to the map
   * folder: that is how the game finds a map inside a .h5m at all. Packing a
   * project without putting the prefix back produces an archive the game cannot
   * see. Absent on manifests written before this was understood, and '' for a
   * project whose archive genuinely had the map at its root.
   */
  archivePrefix?: string | null;
}

/** Result of comparing the working tree against the last pack. */
export interface ProjectStatus {
  /** True when nothing has been packed yet — everything counts as added. */
  neverPacked: boolean;
  /** True when the tree has drifted from the last pack. */
  dirty: boolean;
  /** Paths present now but not in the last pack (sorted). */
  added: string[];
  /** Paths in the last pack but gone now (sorted). */
  removed: string[];
  /** Paths whose content hash changed since the last pack (sorted). */
  modified: string[];
  /** True when the last pack was built by a different editor version. */
  versionMismatch: boolean;
  /** Editor version that built the last pack; absent when never packed. */
  packedBy?: string;
  /** Editor version currently running. */
  editorVersion: string;
}

/** Options accepted by openProject()/initProject(): an injectable clock. */
export interface ProjectOptions {
  /** Fixed timestamp source, so tests get reproducible manifests. */
  now?: Date;
  /**
   * The archive holds one map at its in-game path — treat the folder containing
   * map.xdb as the project, and remember the path above it as archivePrefix.
   *
   * Off by default, because an archive is not necessarily one map: unpacking a
   * data pak that happens to carry several would otherwise pick one of them at
   * random and call it the project.
   */
  mapProject?: boolean;
}

/** Options accepted by packProject(): pak's write options plus the clock. */
export interface PackProjectOptions extends WriteOptions, ProjectOptions {
  /**
   * Folder to place the map at inside the archive, overriding what the manifest
   * remembers — the map's path relative to the game's data root, e.g.
   * 'Maps/SingleMissions/foo'. '' packs at the archive root.
   */
  prefix?: string;
  /**
   * Archive to carry non-project entries over from — the one being written over,
   * when the project is only part of it. Without this, packing a map project
   * back into its `.h5m` drops everything the archive held outside the map
   * folder.
   */
  preserveFrom?: string;
}

/** What openProject() returns: the fresh manifest and the files unpacked. */
export interface OpenProjectResult {
  manifest: ProjectManifest;
  files: ExtractedFile[];
  /**
   * Where the project actually is. Usually the dir passed in, but deeper when
   * the archive carried the map at its in-game path — that inner folder is what
   * holds map.xdb and the manifest, and what packProject() takes back.
   */
  projectDir: string;
}

/** What packProject() returns: pak's counters plus the updated manifest. */
export interface PackProjectResult extends PackResult {
  manifest: ProjectManifest;
}

// Editor version, read from the package.json next to src/. Single source of truth
// so the manifest records exactly what the running build reports.
export function editorVersion(): string {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try {
    const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string };
    return parsed.version || '0.0.0';
  }
  catch { return '0.0.0'; }
}

const sha1 = (buf: Buffer): string => createHash('sha1').update(buf).digest('hex');
const sha1File = (p: string): string => sha1(readFileSync(p));

// A stable timestamp source. `now` is injectable so tests get reproducible
// manifests; production passes nothing and gets the wall clock.
function nowISO(now?: Date): string {
  return (now instanceof Date ? now : new Date()).toISOString();
}

// Snapshot every file in the tree (excluding the manifest itself) as {hash,size}.
function snapshotTree(projectDir: string): TreeSnapshot {
  const snap: TreeSnapshot = {};
  for (const rel of listDirFiles(projectDir)) {
    if (rel === MANIFEST_NAME) continue;
    const buf = readFileSync(join(projectDir, rel));
    snap[rel] = { hash: sha1(buf), size: buf.length };
  }
  return snap;
}

export function readManifest(projectDir: string): ProjectManifest {
  const p = join(projectDir, MANIFEST_NAME);
  if (!existsSync(p)) throw new Error(`no ${MANIFEST_NAME} in ${projectDir} — not a project`);
  return JSON.parse(readFileSync(p, 'utf8')) as ProjectManifest;
}

export function writeManifest(projectDir: string, manifest: ProjectManifest): void {
  writeFileSync(join(projectDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
}

/**
 * Open an archive (.pak/.h5m/.h5c/.h5u) as a new project: unpack it into
 * `projectDir` and write a fresh manifest. lastPack is null (nothing built yet),
 * so the project reads as "never packed" until the first pack.
 */
export function openProject(archivePath: string, projectDir: string, opt: ProjectOptions = {}): OpenProjectResult {
  mkdirSync(projectDir, { recursive: true });
  const files = extract(archivePath, projectDir);
  // A map archive holds its files under the path the game reads them from
  // ('Maps/SingleMissions/foo/map.xdb'), so the project is that inner folder and
  // the prefix is what has to go back on when it is packed again.
  const inner = opt.mapProject ? pickMapRel(files.map((f) => f.name)) : undefined;
  const prefix = inner ? inner.split('/').slice(0, -1).join('/') : '';
  const dir = prefix ? join(projectDir, ...prefix.split('/')) : projectDir;
  const manifest: ProjectManifest = {
    editorVersion: editorVersion(),
    source: { path: archivePath, hash: sha1File(archivePath) },
    createdAt: nowISO(opt.now),
    lastPack: null,
    archivePrefix: prefix,
  };
  writeManifest(dir, manifest);
  return { manifest, files, projectDir: dir };
}

/**
 * Adopt an already-unpacked directory as a project: write a fresh manifest if
 * one isn't there yet, otherwise leave the existing one untouched. Used when the
 * editor opens a loose map folder (unpacked data, or a hand-extracted map) rather than
 * an archive. Returns the manifest.
 */
export function initProject(projectDir: string, opt: ProjectOptions = {}): ProjectManifest {
  const p = join(projectDir, MANIFEST_NAME);
  if (existsSync(p)) return readManifest(projectDir);
  const manifest: ProjectManifest = {
    editorVersion: editorVersion(),
    source: null,
    createdAt: nowISO(opt.now),
    lastPack: null,
    // Unknown until it is packed: a loose folder carries no record of where it
    // would sit inside an archive. The caller works it out from the folder's
    // place under the game's data root.
    archivePrefix: null,
  };
  writeManifest(projectDir, manifest);
  return manifest;
}

/**
 * Pack the working tree into `outPath` and record the build in the manifest:
 * the archive hash, the editor version that built it, and a snapshot of the tree.
 * That snapshot is what status() later diffs against to detect drift.
 *
 * The manifest (`project.json`) is editor metadata and is never included in the
 * game archive — we build from an explicit file list that omits it.
 */
export function packProject(projectDir: string, outPath: string, opt: PackProjectOptions = {}): PackProjectResult {
  const manifest = readManifest(projectDir);
  // Entries are named by where the game expects the files, not by where we keep
  // them: an archive whose map.xdb sits at the root is a map the game cannot
  // find. `prefix` overrides what the manifest remembers, for a project whose
  // folder has moved since it was opened.
  const prefix = (opt.prefix ?? manifest.archivePrefix ?? '').replace(/^\/+|\/+$/g, '');
  const rels = listDirFiles(projectDir).filter((r) => r !== MANIFEST_NAME).sort();
  // An empty pack is never something anyone meant, and packing over the archive
  // the project came from is normal — so the two together silently destroy the
  // map. It happened: a project dir holding nothing but its manifest wrote a
  // 22-byte archive over a 300 KB one. Whatever left the tree empty is a bug of
  // its own; this makes sure the damage stops at the tree.
  if (!rels.length) throw new Error(`refusing to pack an empty archive: ${projectDir} holds no files`);
  const entries: ZipEntry[] = rels.map((rel) => ({
    name: prefix ? `${prefix}/${rel}` : rel,
    data: readFileSync(join(projectDir, rel)),
  }));
  // The project is the map folder, but the archive may hold more than the map:
  // the original editor packs its scene-property template alongside. Those files
  // are below no project we opened, so packing only the project would quietly
  // drop them from the archive it is written over. Carry them across untouched.
  if (opt.preserveFrom && existsSync(opt.preserveFrom)) {
    const own = new Set(entries.map((e) => e.name));
    const here = prefix ? `${prefix}/` : null;
    for (const e of readEntries(readFileSync(opt.preserveFrom))) {
      if (own.has(e.name)) continue;
      // Anything under our prefix IS the project: gone from the tree means deleted.
      if (here && e.name.startsWith(here)) continue;
      if (!here) continue; // packing at the root — the project is the whole archive
      entries.push({ name: e.name, data: e.data });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }
  const buf = writeArchive(entries, opt);
  writeFileSync(outPath, buf);

  manifest.archivePrefix = prefix;
  manifest.editorVersion = editorVersion();
  manifest.lastPack = {
    time: nowISO(opt.now),
    editorVersion: editorVersion(),
    output: outPath,
    archiveHash: sha1(buf),
    files: snapshotTree(projectDir),
  };
  writeManifest(projectDir, manifest);
  return { entries: entries.length, bytes: buf.length, manifest };
}

/**
 * Compare the working tree against the last pack.
 * Returns which files drifted and whether the editor version changed since then.
 */
export function status(projectDir: string): ProjectStatus {
  const manifest = readManifest(projectDir);
  const current = snapshotTree(projectDir);
  const lastPack = manifest.lastPack;

  if (!lastPack) {
    return {
      neverPacked: true,
      dirty: true,
      added: Object.keys(current).sort(),
      removed: [], modified: [],
      versionMismatch: false,
      editorVersion: editorVersion(),
    };
  }

  const prev: TreeSnapshot = lastPack.files || {};
  const added: string[] = [], removed: string[] = [], modified: string[] = [];
  for (const rel of Object.keys(current)) {
    if (!(rel in prev)) added.push(rel);
    else if (current[rel].hash !== prev[rel].hash) modified.push(rel);
  }
  for (const rel of Object.keys(prev)) if (!(rel in current)) removed.push(rel);

  const versionMismatch = lastPack.editorVersion !== editorVersion();
  return {
    neverPacked: false,
    dirty: added.length + removed.length + modified.length > 0,
    added: added.sort(), removed: removed.sort(), modified: modified.sort(),
    versionMismatch,
    packedBy: lastPack.editorVersion,
    editorVersion: editorVersion(),
  };
}
