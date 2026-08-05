// Finding dialog scenes in a file the user points at.
//
// NOT a catalogue of the install. Sweeping every archive for every scene was
// the first shape of this and it was the wrong one: 253 entries, most of them
// campaign material nobody was looking for, and the one scene somebody had just
// written buried among them. A scene is opened the way a map is — you say which
// file, and the editor says what is in it.
//
// Two kinds of file answer that:
//
//   an archive     .h5m .h5u .h5c .h5p .pak — read its central DIRECTORY, the
//                  names only, and every `…/DialogScene.xdb` in it is a scene.
//                  Nothing is unpacked to list them, so a 1.3 GB `data.pak`
//                  costs a seek.
//   a scene itself a `DialogScene.xdb` on disk, which is one scene: its folder.
//
// WHERE A SCENE SITS. 250 of the 251 shipped ones are under `DialogScenes/` in
// the shared data tree, which a map merely NAMES from its script — but that is
// convention, not a rule, and the search here is for the FILE rather than for
// that tree. The 251st is `Maps/SmallSpecialArenas/SmallSpecialArena_Grass_
// Custom/DialogScene.xdb`, shipped inside an arena's own folder; and a map
// archive carries scenes happily — `Maps/12.h5m` holds two of them under
// `Maps/SingleMissions/12/`, beside the original editor's
// `Editor/Builder/DialogSceneBuilder.xdb`. A finder that knew only one tree
// would be blind to exactly the case somebody authoring a scene is in.

import { closeSync, openSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readIndex } from '../format/pak.ts';
import type { ZipIndexEntry } from '../format/pak.ts';
import { modDir } from '../game/mod-paths.ts';

/** One scene found in a file. */
export interface SceneSource {
  /** The folder holding `DialogScene.xdb`, as the archive spells it. */
  inner: string;
  /** What it is called in the list — the folder, minus the tree they all share. */
  name: string;
}

/** The tree the game keeps scenes in — the prefix a name drops, when it has it. */
const TREE = 'DialogScenes/';

/** `<anything>/DialogScene.xdb`, in either slash. */
const SCENE_IN_ARCHIVE = /^(.+)[\\/]DialogScene\.xdb$/i;

/** The document that makes a folder a scene. */
export const SCENE_FILE = 'DialogScene.xdb';

/** Anything the game mounts, which is anything worth looking inside. */
export const ARCHIVE_EXT = ['h5m', 'h5u', 'h5c', 'h5p', 'pak', 'zip'] as const;

const MOUNTABLE = new RegExp(`\\.(${ARCHIVE_EXT.join('|')})$`, 'i');

/** The name a scene is listed under: its folder, minus the tree everything is in. */
const nameOf = (inner: string): string => (inner.startsWith(TREE) ? inner.slice(TREE.length) : inner);

/** True when this path is a file worth opening as a container of scenes. */
export const isArchive = (path: string): boolean => MOUNTABLE.test(path);

/**
 * Every scene inside one archive, from its listing alone.
 *
 * Throws only if the file cannot be read as an archive at all — a mountable
 * file with no scene in it is an empty list, which is a normal answer for a map
 * that has none.
 */
export function listScenesIn(file: string): SceneSource[] {
  let index: ZipIndexEntry[];
  const fd = openSync(file, 'r');
  try { index = readIndex(fd, statSync(file).size); } finally { closeSync(fd); }
  const byInner = new Map<string, SceneSource>();
  for (const e of index) {
    const m = SCENE_IN_ARCHIVE.exec(e.name);
    if (!m) continue;
    const inner = m[1]!.replace(/\\/g, '/');
    // One entry per folder: an archive that carries a scene twice over (a patch
    // built on top of an older member) still offers it once.
    if (!byInner.has(inner.toLowerCase())) byInner.set(inner.toLowerCase(), { inner, name: nameOf(inner) });
  }
  return [...byInner.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const archivesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => MOUNTABLE.test(f)).sort().map((f) => join(dir, f));
  } catch { return []; }
};

/** Where the game keeps its own archives, relative to the install. */
const PAK_DIR = 'data';
/** …and where the shipped campaigns' scenes are, which is a mod folder. */
const MODS_DIR = 'UserMODs';

/**
 * Every archive the install mounts, in mount order.
 *
 * This is not for listing — it is what a scene is UNPACKED through once one has
 * been picked: a campaign scene keeps half its cameras in the shared
 * `Dialogs/` library, which lives in a different archive from the scene itself,
 * and the stage is a map in a third. Our own folder is in the list because our
 * build reads it and nothing else of its own (src/game/mod-paths.ts).
 */
export function sceneArchives(gameRoot: string): string[] {
  return [
    ...archivesIn(join(gameRoot, PAK_DIR)),
    ...archivesIn(join(gameRoot, MODS_DIR)),
    ...archivesIn(join(gameRoot, 'Maps')),
    ...archivesIn(join(gameRoot, 'UserCampaigns')),
    ...archivesIn(modDir(gameRoot)),
  ];
}
