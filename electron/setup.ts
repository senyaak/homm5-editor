// First run: where the game is, and everything that has to be true before the
// editor can work in it.
//
// Runs before the editor's window exists, because an editor with nothing to read
// is not worth opening — no models, no textures, no rosters, an empty map list.
//
// THE PICKER DECIDES, and what it decides it WRITES: the two folders go into
// `.env` beside this build, which is where the editor reads them from on every
// later run (electron/paths.ts). There is no settings file behind it and no
// folder anybody guesses, so this window is not merely the first way an install
// is chosen — it is the only one, and its answer is a file a person can open.
//
// The fields arrive filled in from that same `.env` (or the environment, or
// `--game=`/`--data=`), so a re-run is one Enter. Nothing is taken as settled
// without the person in front of it saying so: an existing tree is unpacked
// over rather than trusted, which is what makes "the files are right" a fact
// instead of a hope.
//
// WHAT IT DOES ONCE THE PATHS ARE IN: src/first-run.ts, all four steps, with the
// window showing which are already true. It used to do only the first of them
// and leave the other three to npm commands nobody but the author ever ran.
//
// A window of its own rather than a panel in the editor: it has its own preload
// with its own methods, so nothing here can reach the editor's IPC surface or
// disturb its UI.

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';

import { firstRun, installState } from '../src/game/first-run.ts';
import type { FirstRunResult, Install, Progress, StepState } from '../src/game/first-run.ts';
import { looksLikeGameFolder } from '../src/game/unpack.ts';
import { writeEnvFile } from '../src/game/env-file.ts';
import { APP_ROOT, defaultDataRoot, envFileHome, gameData, gameRoot, preloadPath, reload, rendererFile } from './paths.ts';

/** What the setup window shows when it opens. */
export interface SetupState {
  gameRoot: string;
  dataRoot: string;
  /** The game folder holds archives to unpack. */
  gameOk: boolean;
  /** The four steps, and which of them this install already has. */
  steps: StepState[];
}

/** The answer to "pick a folder": empty path means the user cancelled. */
export interface PickResult {
  path: string;
  ok: boolean;
}

/** Kept alive after setup succeeds, until the editor's window exists. */
let setupWin: BrowserWindow | null = null;

/**
 * Close the setup window, now that something else is on screen.
 *
 * Setup cannot close itself. Destroying its window leaves the app with no
 * windows open, and Electron reads that as the app being finished — with no
 * `window-all-closed` listener the default is to quit, and with one it fires
 * before the editor's window exists either way. The editor was created and the
 * process went out from under it, so setup looked like it did nothing and the
 * answers only took effect on the next launch. So the window stays, hidden,
 * until the caller has a window of its own and calls this.
 */
export function closeSetup(): void {
  if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
  setupWin = null;
}

/** The install a pair of chosen folders describes. `editorRoot` is ours to know. */
const installOf = (gameDir: string, dataDir: string): Install =>
  ({ gameRoot: gameDir, dataRoot: dataDir, editorRoot: APP_ROOT });

/**
 * What the four steps say about a pair of folders.
 *
 * Asked after every pick and after every run, never guessed from what the last
 * answer was — the folder may have been chosen by hand and already hold a tree
 * from an earlier install, which is the difference between "unpack 3 GB again"
 * and "open the editor now".
 */
function stepsFor(gameDir: string, dataDir: string): StepState[] {
  return installState(installOf(gameDir, dataDir));
}

const state = (): SetupState => {
  const g = gameRoot() || '';
  const d = gameData() || defaultDataRoot();
  return { gameRoot: g, dataRoot: d, gameOk: !!g && looksLikeGameFolder(g), steps: stepsFor(g, d) };
};

/**
 * Show the setup window and resolve once the editor can start.
 *
 * `true` means the install is ready; `false` means the user closed the window,
 * and the caller quits.
 */
export function runSetup(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const win = new BrowserWindow({
      width: 660, height: 620, center: true, resizable: false,
      backgroundColor: '#0d1014', title: 'homm5-editor — setup',
      webPreferences: { preload: preloadPath('setup-preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    win.setMenuBarVisibility(false);
    setupWin = win;

    let done = false;
    const channels = ['setup:state', 'setup:steps', 'setup:pick-game', 'setup:pick-data', 'setup:prepare', 'setup:finish'];
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      for (const c of channels) ipcMain.removeHandler(c);
      // Out of sight, still open: the app must never be windowless between here
      // and the editor's window. closeSetup() finishes the job from the other
      // side. On the way out (ok === false) the window is already gone and the
      // caller is quitting, so there is nothing to hold on to.
      if (ok && !win.isDestroyed()) win.hide(); else setupWin = null;
      resolve(ok);
    };

    /** Send an event, unless the window went away while a step was running. */
    const send = (channel: string, payload: unknown): void => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };

    ipcMain.handle('setup:state', async (): Promise<SetupState> => state());

    ipcMain.handle('setup:steps', async (_e, p: { gameRoot: string; dataRoot: string }): Promise<StepState[]> =>
      stepsFor(p.gameRoot, p.dataRoot));

    ipcMain.handle('setup:pick-game', async (): Promise<PickResult> => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Where is Heroes of Might and Magic V installed?',
        properties: ['openDirectory'],
        defaultPath: gameRoot() || undefined,
      });
      const path = r.canceled ? '' : r.filePaths[0] || '';
      return { path, ok: !!path && looksLikeGameFolder(path) };
    });

    ipcMain.handle('setup:pick-data', async (): Promise<PickResult> => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Where should the unpacked game data go?',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: gameData() || defaultDataRoot(),
      });
      const path = r.canceled ? '' : r.filePaths[0] || '';
      return { path, ok: !!path && existsSync(path) };
    });

    // Minutes of work in the window's own process. `firstRun` yields inside the
    // unpack for exactly that reason — run it flat out and Windows stops getting
    // messages, greys the window and calls the app hung.
    ipcMain.handle('setup:prepare', async (_e, p: { gameRoot: string; dataRoot: string }): Promise<FirstRunResult> =>
      firstRun(installOf(p.gameRoot, p.dataRoot), {
        onStep: (s) => send('setup:step', { id: s.id, what: s.what }),
        note: (n: Progress) => send('setup:progress', n),
      }));

    ipcMain.handle('setup:finish', async (_e, p: { gameRoot: string; dataRoot: string }): Promise<boolean> => {
      // Into `.env` beside this build, which is the only place folders are read
      // from — see the head of electron/paths.ts. Written AND applied to this
      // process: the file is for the next run, and the variables are for this
      // one, since `reload()` re-reads the environment rather than the file.
      const path = writeEnvFile(envFileHome(), { HOMM5_ROOT: p.gameRoot, HOMM5_DATA: p.dataRoot });
      process.env.HOMM5_ROOT = p.gameRoot;
      process.env.HOMM5_DATA = p.dataRoot;
      console.log(`[setup] wrote ${path}`);
      reload();
      finish(true);
      return true;
    });

    win.on('closed', () => finish(false));
    win.loadFile(rendererFile('setup.html'));
  });
}
