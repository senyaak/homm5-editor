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
//   openProject(archivePath, projectDir)      -> { manifest, files }
//   packProject(projectDir, outPath, opt)     -> { entries, bytes, manifest }
//   status(projectDir)                        -> { dirty, added, removed, modified,
//                                                  versionMismatch, neverPacked }
//   readManifest(projectDir) / writeManifest(projectDir, manifest)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extract, writeArchive, listDirFiles } from './pak.js';

export const MANIFEST_NAME = 'project.json';

// Editor version, read from the package.json next to src/. Single source of truth
// so the manifest records exactly what the running build reports.
export function editorVersion() {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try { return JSON.parse(readFileSync(pkg, 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const sha1File = (p) => sha1(readFileSync(p));

// A stable timestamp source. `now` is injectable so tests get reproducible
// manifests; production passes nothing and gets the wall clock.
function nowISO(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

// Snapshot every file in the tree (excluding the manifest itself) as {hash,size}.
function snapshotTree(projectDir) {
  const snap = {};
  for (const rel of listDirFiles(projectDir)) {
    if (rel === MANIFEST_NAME) continue;
    const buf = readFileSync(join(projectDir, rel));
    snap[rel] = { hash: sha1(buf), size: buf.length };
  }
  return snap;
}

export function readManifest(projectDir) {
  const p = join(projectDir, MANIFEST_NAME);
  if (!existsSync(p)) throw new Error(`no ${MANIFEST_NAME} in ${projectDir} — not a project`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function writeManifest(projectDir, manifest) {
  writeFileSync(join(projectDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
}

/**
 * Open an archive (.pak/.h5m/.h5c/.h5u) as a new project: unpack it into
 * `projectDir` and write a fresh manifest. lastPack is null (nothing built yet),
 * so the project reads as "never packed" until the first pack.
 */
export function openProject(archivePath, projectDir, opt = {}) {
  mkdirSync(projectDir, { recursive: true });
  const files = extract(archivePath, projectDir);
  const manifest = {
    editorVersion: editorVersion(),
    source: { path: archivePath, hash: sha1File(archivePath) },
    createdAt: nowISO(opt.now),
    lastPack: null,
  };
  writeManifest(projectDir, manifest);
  return { manifest, files };
}

/**
 * Adopt an already-unpacked directory as a project: write a fresh manifest if
 * one isn't there yet, otherwise leave the existing one untouched. Used when the
 * editor opens a loose map folder (samples, or a hand-extracted map) rather than
 * an archive. Returns the manifest.
 */
export function initProject(projectDir, opt = {}) {
  const p = join(projectDir, MANIFEST_NAME);
  if (existsSync(p)) return readManifest(projectDir);
  const manifest = {
    editorVersion: editorVersion(),
    source: null,
    createdAt: nowISO(opt.now),
    lastPack: null,
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
export function packProject(projectDir, outPath, opt = {}) {
  const rels = listDirFiles(projectDir).filter((r) => r !== MANIFEST_NAME).sort();
  const entries = rels.map((rel) => ({ name: rel, data: readFileSync(join(projectDir, rel)) }));
  const buf = writeArchive(entries, opt);
  writeFileSync(outPath, buf);

  const manifest = readManifest(projectDir);
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
export function status(projectDir) {
  const manifest = readManifest(projectDir);
  const current = snapshotTree(projectDir);

  if (!manifest.lastPack) {
    return {
      neverPacked: true,
      dirty: true,
      added: Object.keys(current).sort(),
      removed: [], modified: [],
      versionMismatch: false,
      editorVersion: editorVersion(),
    };
  }

  const prev = manifest.lastPack.files || {};
  const added = [], removed = [], modified = [];
  for (const rel of Object.keys(current)) {
    if (!(rel in prev)) added.push(rel);
    else if (current[rel].hash !== prev[rel].hash) modified.push(rel);
  }
  for (const rel of Object.keys(prev)) if (!(rel in current)) removed.push(rel);

  const versionMismatch = manifest.lastPack.editorVersion !== editorVersion();
  return {
    neverPacked: false,
    dirty: added.length + removed.length + modified.length > 0,
    added: added.sort(), removed: removed.sort(), modified: modified.sort(),
    versionMismatch,
    packedBy: manifest.lastPack.editorVersion,
    editorVersion: editorVersion(),
  };
}
