// First-run setup: where is the game, and where should its data be unpacked.
//
// Runs before the editor's window exists, because without a data root there is
// nothing to open — no models, no textures, no rosters, an empty map list. From
// the repo this never appears (the checkout's position answers both questions);
// it is the packaged editor, installed somewhere with no environment variables
// and no terminal, that has to ask.
//
// A window of its own rather than a panel in the editor: it has its own preload
// with its own three methods, so nothing here can reach the editor's IPC surface
// or disturb its UI.

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { unpackSteps, looksLikeDataRoot, looksLikeGameFolder } from '../src/unpack.ts';
import type { UnpackReport } from '../src/unpack.ts';
import { defaultDataRoot, gameRoot, gameData, preloadPath, reload, rendererFile, saveSettings } from './paths.ts';

/** What the setup window shows when it opens. */
export interface SetupState {
  gameRoot: string;
  dataRoot: string;
  /** The data root already holds an unpacked tree, so unpacking is optional. */
  dataReady: boolean;
  /** The game folder holds archives to unpack. */
  gameOk: boolean;
}

/** The answer to "pick a folder": empty path means the user cancelled. */
export interface PickResult {
  path: string;
  ok: boolean;
}

/** How far the unpack has got, as the window shows it. */
export interface SetupProgress {
  pak: string;
  pakIndex: number;
  pakCount: number;
  done: number;
  total: number;
}

/**
 * How long to stay in the unpack loop before letting the main process breathe.
 *
 * Counting members instead would be wrong in both directions: a slice of small
 * text entries goes by in no time, while one 100 MB video is a slice of its own.
 */
const SLICE_MS = 100;

const state = (): SetupState => {
  const g = gameRoot() || '';
  const d = gameData() || defaultDataRoot();
  return { gameRoot: g, dataRoot: d, dataReady: !!d && existsSync(d) && looksLikeDataRoot(d), gameOk: !!g && looksLikeGameFolder(g) };
};

/**
 * Show the setup window and resolve once the editor can start.
 *
 * `true` means there is a usable data root; `false` means the user closed the
 * window, and the caller quits — an editor with nothing to read is not worth
 * opening.
 */
export function runSetup(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const win = new BrowserWindow({
      width: 640, height: 520, center: true, resizable: false,
      backgroundColor: '#0d1014', title: 'homm5-editor — setup',
      webPreferences: { preload: preloadPath('setup-preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    win.setMenuBarVisibility(false);

    let done = false;
    const channels = ['setup:state', 'setup:check', 'setup:pick-game', 'setup:pick-data', 'setup:unpack', 'setup:finish'];
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      for (const c of channels) ipcMain.removeHandler(c);
      resolve(ok);
      if (!win.isDestroyed()) win.destroy();
    };

    ipcMain.handle('setup:state', async (): Promise<SetupState> => state());

    // Whether a folder holds a tree the editor can read — asked after picking one
    // and again after unpacking, so "Open the editor" is never enabled on a guess.
    ipcMain.handle('setup:check', async (_e, p: { dataRoot: string }): Promise<boolean> =>
      !!p.dataRoot && existsSync(p.dataRoot) && looksLikeDataRoot(p.dataRoot));

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
      return { path, ok: !!path };
    });

    // Unpacking is minutes of synchronous file work. Run flat out and the main
    // process stops pumping window messages, so Windows greys the window out and
    // calls the app hung — hence the slice-and-yield.
    ipcMain.handle('setup:unpack', async (_e, p: { gameRoot: string; dataRoot: string }): Promise<UnpackReport> => {
      mkdirSync(p.dataRoot, { recursive: true });
      const steps = unpackSteps(p.gameRoot, p.dataRoot);
      try {
        // Sent from the first member on, so the window says something even when
        // the whole archive goes by inside one slice.
        let due = 0;
        for (;;) {
          const s = steps.next();
          // The report is the handler's return value, so the window learns the
          // run finished by the invoke resolving — no "done" event.
          if (s.done) return s.value;
          const now = Date.now();
          if (now < due) continue;
          due = now + SLICE_MS;
          if (!win.isDestroyed()) win.webContents.send('setup:progress', s.value);
          await new Promise<void>((r) => { setImmediate(r); });
        }
      } finally {
        steps.return(undefined as never);   // closes the archive if we bailed out
      }
    });

    ipcMain.handle('setup:finish', async (_e, p: { gameRoot: string; dataRoot: string }): Promise<boolean> => {
      saveSettings({ gameRoot: p.gameRoot, dataRoot: p.dataRoot });
      reload();
      finish(true);
      return true;
    });

    win.on('closed', () => finish(false));
    win.loadFile(rendererFile('setup.html'));
  });
}
