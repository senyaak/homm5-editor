// The quality of life panel's two calls: what is on, and make it so.
//
// The whole feature is game-global and has nothing to do with an open map,
// which is why it is a channel of its own rather than one more mod channel:
// mods build an archive and patch ceilings, and none of that happens here. What
// happens is a config file beside the executable and, for borderless, one
// variable in the user's game profile.

import { app, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { QolApplyResult, QolState } from '#electron/ipc.ts';
import { APP_ROOT, gameRoot } from '#electron/paths.ts';
import { isQolName } from '#src/mods/qol.ts';
import type { QolSettings } from '#src/mods/qol.ts';
import { qolPath, readQol, writeQolFile } from '#src/mods/qol-file.ts';
import { removeQolArchive, writeQolArchive } from '#src/mods/qol-ui.ts';
import { profilesRoot, setResolution, setWindowed } from '#src/game/video-config.ts';
import { extensionState, installExtension } from '#src/mods/extension.ts';
import { MOD_DIR } from '#src/game/mod-paths.ts';
import { PATCHED_EXE } from '#src/exe/creature-limit.ts';

/** The install, or a refusal that says what is missing rather than throwing null. */
function install(): string {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  return g;
}

/** Only flags this build knows, and only as booleans. Anything else is dropped. */
function clean(raw: Record<string, unknown> | undefined): QolSettings {
  const out: QolSettings = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (isQolName(name)) out[name] = !!value;
  }
  return out;
}

export function registerQol(): void {
  /**
   * What the game is set to do — read from the file the extension reads, not
   * from anything the editor remembers.
   *
   * The file IS the state: it survives a reinstall of the editor, it can be
   * edited by hand, and a panel that showed its own memory instead would
   * disagree with the game the first time either happened.
   */
  ipcMain.handle('qol:get', (): QolState => {
    const g = install();
    const ext = extensionState(g);
    return {
      settings: readQol(g),
      file: qolPath(g),
      install: g,
      // Whether any of this can take effect at all. The panel needs to say so
      // up front: ticking a box in an install with no extension in it writes a
      // file nothing will ever read.
      extension: ext.installed,
      patchedExe: existsSync(join(g, PATCHED_EXE)),
    };
  });

  /**
   * Write the settings, and do the parts that are not in that file.
   *
   * Installing the extension is part of applying, not a separate step: the file
   * is only meaningful to something that reads it, and `installExtension` is
   * safe to run twice — a second call finds the import already there and writes
   * nothing.
   */
  ipcMain.handle('qol:apply', (_e: IpcMainInvokeEvent, { settings }: { settings: Record<string, unknown> }): QolApplyResult => {
    const g = install();
    const wanted = clean(settings);

    // THE SETTINGS FIRST, and on their own. They are what the person asked for,
    // and an install that cannot take the extension yet is a reason to say so
    // — not a reason to throw their answers away. The file is harmless in an
    // install with nothing to read it.
    const file = writeQolFile(g, wanted);

    let extension = false;
    const notes: string[] = [];
    try {
      extension = installExtension(g, APP_ROOT).installed;
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }

    // The health bar is half archive: the strips it sizes are child windows,
    // and the engine draws them at their declared size whether or not any
    // extension runs. So the archive FOLLOWS THE FLAG — written when the bar is
    // asked for, deleted when it is not — or a switch turned off would leave a
    // bar of fixed width on the screen. See src/mods/qol-ui.ts.
    try {
      if (wanted['stack-health-bar']) writeQolArchive(g);
      else removeQolArchive(g);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
    const note = notes.join('; ');

    // Borderless without windowed mode is a switch that does nothing: with
    // exclusive fullscreen the display belongs to Direct3D and there is no
    // frame to take off. The profiles are the user's own, under Documents —
    // shared by every install on the machine, which the panel says out loud.
    //
    // WHICH Documents, though. With a user folder of our own the extension
    // answers the game's question itself, and the profile to edit is the one
    // under the install — writing the shared one would set windowed mode for a
    // game this build no longer reads.
    //
    // Otherwise the environment beats Electron's answer, the same order
    // paths.ts uses for every other root: it is what lets the e2e suite point
    // this at a tree of its own instead of rewriting the profile of whoever
    // happened to run the suite.
    const documents = wanted['own-profile']
      ? join(g, MOD_DIR, 'user')
      : process.env.HOMM5_DOCUMENTS || app.getPath('documents');
    const profiles = wanted.borderless ? profilesRoot(documents) : null;
    const windowed = profiles ? setWindowed(profiles, true) : null;

    // And what it renders at. A borderless window is the size of the screen
    // whatever the engine draws into it, so the shipped 1024x768 arrives
    // stretched over the whole display — which reads as a broken mod rather
    // than as a setting. Electron reports in DIPs, and the game knows nothing
    // about scaling: multiplying back is what turns "1463x823 at 175%" into the
    // 2560x1440 the display actually has.
    if (profiles) {
      const display = screen.getPrimaryDisplay();
      const factor = display.scaleFactor || 1;
      setResolution(profiles,
        Math.round(display.size.width * factor), Math.round(display.size.height * factor));
    }

    return {
      file,
      extension,
      ...(note ? { note } : {}),
      windowed: windowed ? windowed.changed : [],
      windowedSkipped: windowed ? windowed.skipped : [],
      profilesFound: !!profiles || !wanted.borderless,
    };
  });
}
