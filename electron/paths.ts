// Where everything is: the game, the unpacked data, our own scratch space.
//
// Running from the repo, all three are implied by the checkout's position —
// data-unpacked sits inside it and the game folder is its parent, which is what
// start-editor.bat encodes. A packaged editor has none of that: it can be
// installed anywhere, the game can be anywhere, and there is no terminal to set
// an environment variable in. So the answers come from three places, in order:
//
//   1. the environment — HOMM5_ROOT / HOMM5_DATA / HOMM5_EDITOR. Explicit beats
//      everything, and the e2e suite and the CLI tools rely on it.
//   2. the checkout's own data-unpacked, when running unpackaged and it is
//      really there.
//   3. settings.json in the user's app-data folder, written by the setup window.
//
// The checkout outranks the settings on purpose. Both worlds share one settings
// file (same app name, same app-data folder), so with the order the other way
// round a packaged build's setup silently redefined where the checkout reads
// from — and pointing that build at a folder that was later deleted left the
// whole e2e suite opening the setup window instead of the editor. Inside a
// checkout, the checkout is the answer.
//
// Everything is resolved lazily and cached, because setup writes the settings
// after the process has started; reload() drops the cache once it has.

import { app } from 'electron';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findEditorRoot } from '../src/map/objects.ts';
import { loadEnvFile } from '../src/game/env-file.ts';
import { isReady } from '../src/game/first-run.ts';
import { looksLikeDataRoot } from '../src/game/unpack.ts';
import { assets } from '../src/game/assets.ts';
import type { Assets } from '../src/game/assets.ts';
import { mountCreatureMods } from '../src/mods/mod-archive.ts';

/**
 * The folder holding `electron/` and `renderer/`.
 *
 * The packaged layout keeps those two subfolders, so every path below is the
 * same string in both worlds — the only difference is that main.js sits at the
 * app root while main.ts sits one level down in electron/.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = app.isPackaged ? HERE : join(HERE, '..');

// `.env` beside the checkout, before anything below is asked anything. It only
// fills in what the environment does not already say, and its whole job is to
// spare a developer the two folder walks in the setup window — nothing is
// decided by it (src/env-file.ts).
loadEnvFile(APP_ROOT);

/** The preload bridge for a window. Stays .cjs — see preload.cjs. */
export const preloadPath = (name: string): string => join(APP_ROOT, 'electron', name);

/** An HTML entry point of the UI. */
export const rendererFile = (name: string): string => join(APP_ROOT, 'renderer', name);

/** What setup remembers between runs. */
export interface Settings {
  /** The Heroes 5 install: holds data/*.pak and, beside them, Editor/. */
  gameRoot?: string;
  /** The unpacked union of those archives — the tree the editor reads. */
  dataRoot?: string;
  /**
   * Render through SwiftShader instead of the GPU.
   *
   * Remembered rather than passed as a switch because the machines that need it
   * are the ones running a packaged build, where there is no command line to put
   * a switch on — the editor is started by double-clicking it. The fatal-error
   * screen sets this and restarts; the editor says so while it is on, and offers
   * the way back, since it costs a lot of speed.
   */
  softwareRendering?: boolean;
  /**
   * Play the objects' idle animations on the map.
   *
   * Off by default, and the default is not timidity: a still map is what the
   * editor is for, and animation is not free at any layer. `off` means the
   * scene carries no bones, no binding and no clips at all — the payload of an
   * animated model roughly doubles when it does. `visible` builds them but
   * advances only what the camera can see. `all` keeps every creature moving,
   * on screen or not.
   *
   * It decides what map:load builds; a map already open when it turns on gets
   * its animation data grafted in place through map:idle-skins.
   */
  idleAnimation?: 'off' | 'visible' | 'all';
}

/** Where settings live. Same file in dev and packaged, on purpose: one setup. */
export const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

/** Read settings, treating anything unreadable as "nothing remembered yet". */
export function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? raw as Settings : {};
  } catch {
    return {};
  }
}

/** Merge into settings and write them back. */
export function saveSettings(patch: Settings): Settings {
  const next = { ...readSettings(), ...patch };
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = null;
  return next;
}

interface Roots {
  gameRoot: string | null;
  gameData: string;
  editorRoot: string | null;
  tmpRoot: string;
}

let cache: Roots | null = null;

function resolveRoots(): Roots {
  const s = readSettings();
  const dev = !app.isPackaged;

  // The checkout's own tree, when there is a checkout and it holds one.
  const inRepo = dev && looksLikeDataRoot(join(APP_ROOT, 'data-unpacked')) ? join(APP_ROOT, 'data-unpacked') : '';

  const gameRoot = process.env.HOMM5_ROOT || (inRepo ? join(APP_ROOT, '..') : null) || s.gameRoot
    || (dev ? join(APP_ROOT, '..') : null);

  // The data root: what models, textures, tiles and rosters resolve against. A
  // .h5m map archive does NOT contain these — they ship in the game's paks — so
  // assets always resolve here, never against the map folder.
  const gameData = process.env.HOMM5_DATA || inRepo || s.dataRoot || (dev ? join(APP_ROOT, 'data-unpacked') : '');

  // The editor's own config — MapFilters.xml and IconCache — is NOT under the
  // data root: those files are loose beside the game install while the object
  // catalogue's link files ship inside the paks. Two roots, neither implying
  // the other. The walk upwards is the fallback for when nobody said.
  const editorRoot = process.env.HOMM5_EDITOR
    || (gameRoot ? findEditorRoot(gameRoot) : null)
    || (gameData ? findEditorRoot(gameData) : null);

  // Scratch space: unpacked archives, undo history — everything the editor
  // keeps for itself. In the repo it goes in the checkout, where it is findable
  // and deletable without hunting; a packaged app has no writable folder of its
  // own, so there it goes where the OS says. Nothing in here is precious.
  const tmpRoot = dev ? join(APP_ROOT, '_tmp') : join(app.getPath('userData'), '_tmp');

  return { gameRoot, gameData, editorRoot, tmpRoot };
}

function roots(): Roots {
  if (!cache) cache = resolveRoots();
  return cache;
}

/** Forget the resolved roots — call after settings change. */
export const reload = (): void => { cache = null; };

/**
 * The MOUNTED asset chain — what the game will read, not what one folder holds.
 *
 * The unpacked data with the installed creature mods layered over it, so a
 * creature a mod adds is in the army picker, a dwelling it adds is in the object
 * palette, and a map that places one shows it instead of dropping it. Nothing
 * else in `UserMODs` is mounted: see `mountCreatureMods`, and docs/ARCHIVES.md
 * for the rule this mirrors.
 *
 * Deliberately NOT cached across calls. The expensive part — unpacking — is
 * cached per archive by its size and date, so re-scanning costs a directory
 * listing and one seek per archive. Holding the chain instead would mean a mod
 * rebuilt while the editor is open stayed invisible until a restart, which is
 * exactly what happens while a creature is being worked on.
 */
export function mountedAssets(base: string): Assets {
  const g = gameRoot();
  const over: string[] = [];
  if (g) {
    try {
      for (const m of mountCreatureMods(g, join(tmpRoot(), 'mods'))) {
        over.push(m.root);
        console.log(`[mods] ${basename(m.path)} · ${m.mod.creatures.length} creature(s)`
          + `, ${m.mod.dwellings.length} dwelling(s), ceiling ${m.limit}`);
      }
    } catch (e) {
      // A mod we cannot read must not stop the editor opening a map.
      console.warn('[mods] not mounted:', e instanceof Error ? e.message : String(e));
    }
  }
  return assets([...over, base]);
}

/** The Heroes 5 install, when it is known. */
export const gameRoot = (): string | null => roots().gameRoot;

/** The unpacked data root. Empty string when nothing is configured yet. */
export const gameData = (): string => roots().gameData;

/** The game's Editor folder (MapFilters.xml, IconCache), when found. */
export const editorRoot = (): string | null => roots().editorRoot;

/** The editor's scratch space. */
export const tmpRoot = (): string => roots().tmpRoot;

/**
 * Is there a usable data root?
 *
 * This is the one question that decides whether the editor can open anything at
 * all, so it is what setup gates on — not "did someone pick a game folder",
 * which can be answered and still leave nothing to read.
 *
 * DELIBERATELY NOT the whole first run. The other three steps (a readable copy
 * of the executable, our extension in it, our mod folder) are what it takes to
 * PLAY with what you made; editing a map needs none of them. Gating the editor
 * on them would open the setup window in front of every e2e spec, each of which
 * runs against a throwaway install with no `bin/` at all — and would refuse to
 * open a perfectly good map because the game could not have loaded it yet.
 * `installReady()` is the stricter question, and the setup window asks it.
 */
export const isConfigured = (): boolean => {
  const d = gameData();
  return !!d && existsSync(d) && looksLikeDataRoot(d);
};

/**
 * Is every one of the first run's four steps done in this install?
 *
 * What the setup window's "Open the editor" waits for, and what a caller asks
 * before promising that something will work in the game rather than merely in
 * the editor.
 */
export const installReady = (): boolean => {
  const g = gameRoot();
  const d = gameData();
  return !!g && !!d && isReady({ gameRoot: g, dataRoot: d, editorRoot: APP_ROOT });
};

/** Where an unpacked tree should go when the user has no opinion. */
export const defaultDataRoot = (): string =>
  app.isPackaged ? join(app.getPath('userData'), 'data-unpacked') : join(APP_ROOT, 'data-unpacked');
