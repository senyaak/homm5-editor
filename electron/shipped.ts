// The game's own data, read once: its rosters and its files.
//
// The unpacked data root is the game as shipped: nothing the editor does writes
// into it — a mod is mounted over it (`mountedAssets`), never into it — and it
// is filled only by setup, before anything reads it. So its creatures, heroes
// and spells, and the bytes of its files, are the same for the whole run.
// Built per ask, the rosters were half a second of every mod form's opening
// (the hero roster alone reads 300 ms of documents), and the files half a
// second of every install's build.
//
// Keyed by the root, so a data root changed in settings gets its own.

import { Registry } from '#src/schema/registry.ts';
import { dataReader, keptReader } from '#src/mods/mod-files.ts';
import type { DataReader } from '#src/mods/mod-files.ts';
import { gameData } from '#electron/paths.ts';

let shipped: { root: string; registry: Registry; read: DataReader } | null = null;

function forRoot(): NonNullable<typeof shipped> {
  const root = gameData();
  if (shipped?.root !== root) shipped = { root, registry: new Registry(root), read: keptReader(dataReader(root)) };
  return shipped;
}

/** The registry over the shipped data root — see the head of this file. */
export const shippedRegistry = (): Registry => forRoot().registry;

/** A reader of the shipped data root that keeps what it read — see the head of this file. */
export const shippedReader = (): DataReader => forRoot().read;
