// The channels that are about the editor rather than about a map: launching the
// game, what the graphics stack is doing, and the switch that comes back up in
// software rendering.

import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { LaunchGameResult } from '#electron/ipc.ts';
import { gameRoot, readSettings, saveSettings } from '#electron/paths.ts';
import { state } from '#electron/state.ts';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PATCHED_EXE } from '#src/creature-limit.ts';

/** The graphics answer behind `gpuReport` — see EditorApi. */
async function gpuReport(): Promise<string> {
  const lines: string[] = [`electron ${process.versions.electron} · chrome ${process.versions.chrome} · ${process.platform}`];
  // Only the features Chromium turned off. The enabled ones are noise here, and
  // this block is meant to be pasted into a message by someone with a problem.
  const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  const off = Object.entries(status).filter(([, v]) => !v.startsWith('enabled'));
  lines.push(off.length ? `disabled GPU features:\n  ${off.map(([k, v]) => `${k}: ${v}`).join('\n  ')}`
    : 'GPU features: all enabled');
  try {
    // 'basic' rather than 'complete': the complete report is hundreds of lines
    // of driver detail, and the adapter's identity is what actually names the
    // cause. A blocked driver and a session with no GPU at all read differently
    // here even though both end as "no WebGL".
    const info = await app.getGPUInfo('basic') as Record<string, unknown>;
    lines.push(`gpu: ${JSON.stringify(info)}`);
  } catch (e) {
    lines.push(`gpu: unavailable (${e instanceof Error ? e.message : String(e)})`);
  }
  const switches = process.argv.filter((a) => a.startsWith('--'));
  if (switches.length) lines.push(`switches: ${switches.join(' ')}`);
  return lines.join('\n');
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerApp(): void {
  /**
   * Launch the game — OUR copy of it, and only ever ours.
   *
   * `bin/H5_Game_H5E.exe` is the one that reads `H5E/`, so it is the one that can
   * see what the editor makes; the shipped executable beside it reads none of it
   * and is the off switch, which is not a thing a button in here should offer.
   *
   * Detached and its streams let go of, because the game outlives this: closing
   * the editor while a mission is being played must not take the game with it, and
   * a 2007 executable writing to a pipe nobody drains would eventually block on it.
   *
   * Nothing is saved first. The map lives in an archive the game reads at startup,
   * so what it will show is what was last packed — and quietly packing on the way
   * out would make a Launch button a Save button with a surprise in it. Whether
   * there are unsaved edits is on screen already.
   */
  ipcMain.handle('app:launch-game', (): LaunchGameResult => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    const exe = join(g, PATCHED_EXE);
    if (!existsSync(exe)) {
      throw new Error(`no ${PATCHED_EXE} — this install has not been prepared yet`
        + ' (start the editor with --setup, or delete nothing and press Prepare there)');
    }
    // `bin/`, the executable's OWN folder. This is not a detail: started with the
    // install root as its working directory the game came up and played, and broke
    // creature models in the middle of it — so it resolves at least some of its
    // content relative to the working directory and not to its own path. `bin/` is
    // what a double-click gives it, a double-click is the launch that has always
    // worked, and so it is the only working directory this may use.
    //
    // The install root was the reasonable-looking choice: `data/`, `H5E/` and
    // `profiles/` are all there, and it looked verified — the game found its
    // archives and a generated map still landed in `H5E/`. It got that far and was
    // still wrong, which is why this line carries a comment.
    const child = spawn(exe, [], { cwd: dirname(exe), detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, exe };
  });

  ipcMain.handle('app:gpu-report', gpuReport);

  ipcMain.handle('app:open-devtools', () => { state.win?.webContents.openDevTools({ mode: 'detach' }); });

  ipcMain.handle('app:gpu-software', (): boolean => !!readSettings().softwareRendering);

  // Remember, then come back up with the switches applied. A restart is the whole
  // mechanism, not an inconvenience of it: the backend is chosen before the app is
  // ready, so this is the only moment the choice can be made.
  ipcMain.handle('app:set-gpu-software', (_e: IpcMainInvokeEvent, { on }: { on: boolean }) => {
    saveSettings({ softwareRendering: on });
    app.relaunch();
    app.exit(0);
  });
}
