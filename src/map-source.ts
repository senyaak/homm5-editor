// Where maps come from — ours, and the game's own.
//
// TWO SOURCES, AND THE UNPACKED DATA IS NEITHER. `data-unpacked` is an asset
// root: models, textures, tables, the things a map REFERS to. It also happens to
// hold a copy of every shipped map, and listing those as if they were the
// editor's own maps meant the picker was a mirror of a mirror — worse, a map
// opened from there was edited in place, in a tree nothing ships from.
//
//   ours    <game>/H5E/*.mod     packed, exactly what our build reads
//   stock   <game>/data/*.pak    the shipped maps, read where the game keeps them
//
// Both are archives, so both open the same way: unpack into a workspace and edit
// there. A stock map has no source to save back into — the game's own archive is
// never written — so saving it writes the workspace and packing it offers our
// folder, which turns "open a shipped map" into "start from one".

import { closeSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readEntryFrom, readIndex } from './pak.ts';
import type { ZipIndexEntry } from './pak.ts';
import { MOD_EXT, modDir } from './mod-paths.ts';

/** A map the picker can offer. */
export interface MapSource {
  /** What it is called in the list. */
  name: string;
  /** What is shown beside the name, and what search matches on. */
  rel: string;
  /** The archive holding it: our `.mod`, or the game's `.pak`. */
  path: string;
  /** The folder inside that archive, for an archive that holds many maps. */
  inner?: string;
  /** The game's own, and never written to. */
  stock?: boolean;
}

/** Where the game keeps its archives, relative to the install. */
const PAK_DIR = 'data';

/** `Maps/<tree>/<name>/map.xdb`, in either slash. */
const MAP_IN_ARCHIVE = /^Maps[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]map\.xdb$/i;

/** Trees worth offering: the shipped arenas and duel presets are not maps to edit. */
const PLAYABLE = /^(SingleMissions|Multiplayer|Scenario)$/i;

/**
 * Our packed maps, as the picker shows them.
 *
 * The folder inside is read too, not just the file name: it is the path the game
 * addresses the map by, and a campaign mission names exactly that. Only the
 * archive's list of names is read, never its contents.
 */
export function listOurMaps(gameRoot: string | null): MapSource[] {
  if (!gameRoot) return [];
  const dir = modDir(gameRoot);
  const out: MapSource[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(`.${MOD_EXT.map}`)) continue;
    const path = join(dir, name);
    out.push({
      name: name.slice(0, -(MOD_EXT.map.length + 1)),
      rel: name,
      path,
      inner: mapFolderIn(path) ?? undefined,
    });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** The `Maps/<tree>/<name>` an archive holds its map at, when it holds one. */
export function mapFolderIn(archive: string): string | null {
  let index: ZipIndexEntry[];
  const fd = openSync(archive, 'r');
  try { index = readIndex(fd, statSync(archive).size); } catch { return null; } finally { closeSync(fd); }
  for (const e of index) {
    const m = MAP_IN_ARCHIVE.exec(e.name);
    if (m) return `Maps/${m[1]}/${m[2]}`;
  }
  return null;
}

/**
 * The game's own maps, read out of the archives it ships them in.
 *
 * Only the central directory of each `.pak` is read — the names, not the bytes —
 * so this costs a seek and a few hundred kilobytes even on the 1.4 GB one.
 */
export function listStockMaps(gameRoot: string | null): MapSource[] {
  if (!gameRoot) return [];
  const out: MapSource[] = [];
  for (const path of gameArchives(gameRoot)) {
    let index: ZipIndexEntry[];
    const fd = openSync(path, 'r');
    try { index = readIndex(fd, statSync(path).size); } catch { continue; } finally { closeSync(fd); }
    for (const e of index) {
      const m = MAP_IN_ARCHIVE.exec(e.name);
      if (!m || !PLAYABLE.test(m[1]!)) continue;
      const rel = `${m[1]}/${m[2]}`;
      // The addon ships patched copies of maps the base game already has; the
      // same map from two archives is one entry, and the first is as good as the
      // second for opening it.
      if (out.some((x) => x.rel === rel)) continue;
      out.push({ name: m[2]!, rel, path, inner: `Maps/${m[1]}/${m[2]}`, stock: true });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Every archive the game mounts from `data/`, in the order it finds them. */
export function gameArchives(gameRoot: string): string[] {
  const dir = join(gameRoot, PAK_DIR);
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pak')).sort().map((f) => join(dir, f));
  } catch { return []; }
}

/**
 * Unpack one map's folder out of the archives into `dir`, keeping its own path.
 *
 * SEVERAL archives, because one shipped map is spread across them: A2S1's
 * `map.xdb` is in `data.pak`, its terrain and texts in the addon's and the text
 * paks. Where the same path is in more than one, the NEWEST member wins — the
 * rule the game itself follows (docs/ARCHIVES.md), so what lands here is what it
 * would have read.
 *
 * The path inside matters: the game addresses a map by where it sits under the
 * data root, so a folder that keeps `Maps/<tree>/<name>/…` is one that can be
 * packed straight back into something loadable.
 */
export function extractMapFolder(archives: readonly string[], inner: string, dir: string): number {
  const prefix = `${inner.replace(/\\/g, '/').replace(/\/+$/, '')}/`.toLowerCase();
  /** path → where the newest copy of it is. */
  const best = new Map<string, { archive: string; entry: ZipIndexEntry }>();
  for (const archive of archives) {
    let index: ZipIndexEntry[];
    const fd = openSync(archive, 'r');
    try { index = readIndex(fd, statSync(archive).size); } catch { continue; } finally { closeSync(fd); }
    for (const entry of index) {
      const name = entry.name.replace(/\\/g, '/');
      if (!name.toLowerCase().startsWith(prefix) || name.endsWith('/')) continue;
      const had = best.get(name.toLowerCase());
      if (!had || entry.stamp >= had.entry.stamp) best.set(name.toLowerCase(), { archive, entry });
    }
  }
  if (!best.size) throw new Error(`${archives.length} archive(s) hold nothing under ${inner}`);

  // Grouped by archive so each is opened once, however the members fell out.
  const byArchive = new Map<string, ZipIndexEntry[]>();
  for (const { archive, entry } of best.values()) {
    const list = byArchive.get(archive) ?? [];
    list.push(entry);
    byArchive.set(archive, list);
  }
  let written = 0;
  for (const [archive, entries] of byArchive) {
    const fd = openSync(archive, 'r');
    try {
      for (const e of entries) {
        const dest = join(dir, e.name.replace(/\\/g, '/'));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readEntryFrom(fd, e));
        written++;
      }
    } finally { closeSync(fd); }
  }
  return written;
}
