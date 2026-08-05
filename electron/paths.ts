// Where everything is: the game, the unpacked data, our own scratch space.
//
// TOLD, NEVER GUESSED. Two places answer, and nothing else does:
//
//   1. the command line — `--game=…`, `--data=…`, `--editor=…`. About this one
//      launch, so it wins.
//   2. the environment — HOMM5_ROOT / HOMM5_DATA / HOMM5_EDITOR, which `.env`
//      beside this build fills in for whatever the shell did not already say.
//
// Nobody said → the setup window, which asks and writes the `.env`. An empty
// answer is a question, not a folder to try.
//
// WHY THERE IS NOTHING ELSE. There used to be two more: a settings.json in the
// user's app-data folder, and a pair of "the folder above this one" guesses —
// one of which outranked the settings. The settings file was shared by every
// checkout, every worktree and the packaged build at once, and no run ever said
// which answer it had used. A wrong one does not announce itself either: the
// map opens, everything a MOD supplies appears on it, the game's own objects do
// not, the tile list is empty. That reads as a broken map, a broken build, or
// deleted files, and it is a path. It also stood in the way of the thing this
// is for next — several mods side by side, and merging them — which needs the
// folders to be an argument, not a memory.
//
// `settings.json` still exists for what it is actually good at: remembering a
// choice about this MACHINE that has no path in it (software rendering, whether
// idles animate). No folder is ever read from it.
//
// Everything is resolved lazily and cached, because setup writes the `.env`
// after the process has started; reload() drops the cache once it has.

import { app } from 'electron';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Where the `.env` this build reads and writes lives.
 *
 * Beside the build, which is the point of it: one file per checkout, in the
 * checkout, so a worktree works against its own copy of the game and anyone can
 * open the file and see the answer.
 *
 * A PACKAGED editor may be installed somewhere it cannot write — Program Files
 * is the ordinary case — and there the file goes to the per-user folder instead.
 * Both are read (the build's first), so an installation-wide answer and a
 * per-user one can coexist; neither is a guess, both are files someone wrote.
 */
export function envFileHome(): string {
  if (!app.isPackaged) return APP_ROOT;
  try {
    accessSync(APP_ROOT, constants.W_OK);
    return APP_ROOT;
  } catch { return app.getPath('userData'); }
}

// Before anything below is asked anything. It fills in whatever the shell did
// not already say, and — with the command line — is the whole of the answer
// now; there is nothing behind it (src/game/env-file.ts).
loadEnvFile(APP_ROOT);
if (app.isPackaged) loadEnvFile(app.getPath('userData'));

// A userData of one's own, before anything asks for it. Everything the app
// remembers between runs — settings.json above all — lives under this path,
// shared by every way of opening the editor on this machine. The cold-start
// spec walks the real setup window to the end, and its "Open the editor"
// SAVES; without this override that save would repoint the editor somebody
// actually uses at a sandbox that is deleted a second later.
if (process.env.HOMM5_USERDATA) app.setPath('userData', process.env.HOMM5_USERDATA);

/** The preload bridge for a window. Stays .cjs — see preload.cjs. */
export const preloadPath = (name: string): string => join(APP_ROOT, 'electron', name);

/** An HTML entry point of the UI. */
export const rendererFile = (name: string): string => join(APP_ROOT, 'renderer', name);

/**
 * What this machine remembers between runs — and deliberately NO FOLDERS.
 *
 * Where the game and the data are is answered by `.env`, the environment or the
 * command line, and by nothing else (see the head of this file). What is left
 * here is the two answers that are about the machine rather than about a
 * checkout, and that a person would be annoyed to give twice.
 */
export interface Settings {
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
  /** Which of the candidates below answered, per root — see `reportRoots`. */
  from: { gameRoot: string; gameData: string; editorRoot: string };
}

/**
 * `--game=…` and friends, off this launch's command line.
 *
 * Electron hands the app its own argv, so a flag has to be recognised by name
 * rather than by position — `electron . --data=D:/h5` and a packaged
 * `homm5-editor.exe --data=D:/h5` both land here the same way.
 */
function fromArgv(flag: string): string | null {
  const prefix = `--${flag}=`;
  for (const arg of process.argv.slice(1)) if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return null;
}

/**
 * The first candidate that has an answer, and the name of where it came from.
 *
 * Named, because four fallbacks with no way to see which one won is how an
 * editor comes to read a folder nobody meant it to. A map then opens with
 * every object the mod supplies and none of the game's, the tile list is empty,
 * and nothing anywhere says why — the whole of an afternoon, and the answer was
 * a path.
 */
function first<T extends string>(...cands: Array<[string, T | null | undefined | '']>): [T | null, string] {
  for (const [where, value] of cands) if (value) return [value, where];
  return [null, 'nothing'];
}

let cache: Roots | null = null;

function resolveRoots(): Roots {
  const dev = !app.isPackaged;

  const [gameRoot, gameRootFrom] = first(
    ['--game= on the command line', fromArgv('game')],
    ['HOMM5_ROOT (the environment, or .env beside this build)', process.env.HOMM5_ROOT],
  );

  // The data root: what models, textures, tiles and rosters resolve against. A
  // .h5m map archive does NOT contain these — they ship in the game's paks — so
  // assets always resolve here, never against the map folder.
  const [gameDataOrNull, gameDataFrom] = first(
    ['--data= on the command line', fromArgv('data')],
    ['HOMM5_DATA (the environment, or .env beside this build)', process.env.HOMM5_DATA],
  );
  const gameData = gameDataOrNull ?? '';

  // The editor's own config — MapFilters.xml and IconCache — is NOT under the
  // data root: those files are loose beside the game install while the object
  // catalogue's link files ship inside the paks. Two roots, neither implying
  // the other. Looking beside the game is not a guess about WHICH install —
  // the install has already been named by then — only about where inside it a
  // folder called Editor sits, which differs between releases.
  const [editorRoot, editorRootFrom] = first(
    ['--editor= on the command line', fromArgv('editor')],
    ['HOMM5_EDITOR (the environment, or .env beside this build)', process.env.HOMM5_EDITOR],
    ['beside the game named above', gameRoot ? findEditorRoot(gameRoot) : null],
    ['beside the data named above', gameData ? findEditorRoot(gameData) : null],
  );

  // Scratch space: unpacked archives, undo history — everything the editor
  // keeps for itself. In the repo it goes in the checkout, where it is findable
  // and deletable without hunting; a packaged app has no writable folder of its
  // own, so there it goes where the OS says. Nothing in here is precious.
  const tmpRoot = dev ? join(APP_ROOT, '_tmp') : join(app.getPath('userData'), '_tmp');

  return {
    gameRoot, gameData, editorRoot, tmpRoot,
    from: { gameRoot: gameRootFrom, gameData: gameDataFrom, editorRoot: editorRootFrom },
  };
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

/**
 * Say out loud which folders this run settled on, and which candidate answered.
 *
 * Printed once at startup because the editor had no way of telling anyone. Four
 * candidates decide the data root, three the game, and a wrong answer does not
 * announce itself: the map opens, the objects the MOD supplies appear, the
 * game's own do not, and the tile list is empty. That reads as a broken map or
 * a broken build, and it is a path.
 */
export function reportRoots(): void {
  const r = roots();
  const say = (what: string, value: string | null, where: string): void =>
    console.log(`[roots] ${what.padEnd(6)} ${value ?? '(none)'}   ← ${where}`);
  say('game', r.gameRoot, r.from.gameRoot);
  say('data', r.gameData || null, r.from.gameData);
  say('editor', r.editorRoot, r.from.editorRoot);
  say('tmp', r.tmpRoot, 'this build');
  if (r.gameData && !looksLikeDataRoot(r.gameData)) {
    console.error(`[roots] ${r.gameData} holds no MapObjects/ and no bin/Geometries — `
      + 'nothing of the game will resolve out of it, so a map will show only what a mod supplies');
  }
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
