// The gameplay archive — what the `pandora-box` flag installs.
//
// The box is CONTENT, not code: an object definition, a model, four glows and
// (later) the script that answers a hero touching one. All of it lives in one
// archive the game mounts at startup, and the archive FOLLOWS THE FLAG the way
// the health bar's does — written on apply when the box is asked for, deleted
// when it is not. An install that turned it off has no trace of it, and a map
// that places boxes says out loud that it needs this on.
//
// ITS OWN ARCHIVE, beside homm5-editor.h5u and homm5-editor-qol.h5u. The
// global mod is for content every project shares and for what the raised
// executable ceilings require; the qol archive is two interface files. This one
// is a gameplay OPT-IN: a person who wants the box and none of the rest — or
// the rest and no box — should be able to have exactly that, and deleting one
// file must take exactly one feature with it.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { writeArchive } from '../format/pak.ts';
import type { ZipEntry } from '../format/pak.ts';
import { buildPandora } from './pandora-files.ts';
import type { DataReader } from './mod-files.ts';

/** The archive in an install, relative to the game root. */
export const GAMEPLAY_ARCHIVE = 'H5E/homm5-editor-gameplay.h5u';

/** Every file the archive holds, from the game data the reader serves. */
export function buildGameplayArchive(read: DataReader): Buffer {
  const entries: ZipEntry[] = buildPandora(read).map((f) => ({ name: f.path, data: f.data }));
  return writeArchive(entries);
}

/**
 * Write the archive into the install.
 *
 * `dataRoot` is the unpacked-data cache, passed in rather than guessed — the
 * data root and the install are configured apart (HOMM5_DATA and HOMM5_ROOT),
 * same as the qol archive build.
 */
export function writeGameplayArchive(gameRoot: string, dataRoot: string): string {
  const read: DataReader = (rel) => {
    const at = join(dataRoot, rel);
    return existsSync(at) ? readFileSync(at) : null;
  };
  const built = buildGameplayArchive(read);
  const out = join(gameRoot, GAMEPLAY_ARCHIVE);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, built);
  return out;
}

/** And taken back out. True when there was one to take. */
export function removeGameplayArchive(gameRoot: string): boolean {
  const at = join(gameRoot, GAMEPLAY_ARCHIVE);
  if (!existsSync(at)) return false;
  rmSync(at);
  return true;
}
