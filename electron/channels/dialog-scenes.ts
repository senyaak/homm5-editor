// Opening a dialog scene in the editor's own window.
//
// The same assembly the standalone page uses (`src/dialog/play.ts`), handed to
// the renderer as one payload: the stage as an ordinary scene payload, so
// `buildWorld` draws it with no special case, plus the shots and the actors'
// rigs on the side.
//
// A scene is addressed by its FOLDER, data-root relative, the way the game
// addresses it — `DialogScenes/C1/M1/D1`. Where that folder physically is
// (unpacked in the data tree, still inside an archive, or in a folder of the
// user's own outside the install) is this module's problem and nobody else's.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { basename, dirname, relative, resolve } from 'node:path';
import { ARCHIVE_EXT, isArchive, listScenesIn, SCENE_FILE } from '#src/dialog/scene-source.ts';
import type { SceneOpenPayload, SceneOpenResult, ScenesInFileResult } from '#electron/ipc.ts';
import { gameData, gameRoot, tmpRoot } from '#electron/paths.ts';
import { buildSceneOffThread, ensureChild } from '#electron/scene-jobs.ts';
import { state } from '#electron/state.ts';

/** Slashes forward, no trailing one — how a scene folder is written everywhere here. */
const clean = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The folder a `DialogScene.xdb` on disk is addressed by, and the root it is
 * addressed from.
 *
 * Under the data tree that is simply its relative path — the game's own way of
 * naming it, which every href inside resolves against. A scene ANYWHERE ELSE
 * (a folder of one's own, a workspace, a Dropbox) still opens: its parent is
 * mounted as an asset root, so the scene's own siblings — the actors and
 * cameras written beside it — resolve relatively, while the absolute hrefs it
 * shares with the game (`/Dialogs/…`, the arena it stands on) fall through to
 * the install.
 */
function sceneOnDisk(file: string, data: string): { inner: string; root: string | null } {
  const folder = dirname(resolve(file));
  const rel = relative(resolve(data), folder);
  if (rel && !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel)) return { inner: clean(rel), root: null };
  return { inner: basename(folder), root: dirname(folder) };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerDialogScenes(): void {
  // Which file to look in — an archive, or a scene document itself.
  ipcMain.handle('scene:pick-file', async (): Promise<string | null> => {
    const opts = {
      title: 'Open scenes from…',
      defaultPath: gameRoot() ?? gameData() ?? undefined,
      properties: ['openFile' as const],
      filters: [
        { name: 'Scene or archive', extensions: ['xdb', ...ARCHIVE_EXT] },
        { name: 'A scene', extensions: ['xdb'] },
        { name: 'An archive to look in', extensions: [...ARCHIVE_EXT] },
      ],
    };
    const parent = state.win;
    const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  // What is in that file. An archive is read by its central directory alone —
  // no unpacking, so pointing at `data.pak` costs a seek — and a scene document
  // is one scene, itself.
  ipcMain.handle('scene:in-file', async (_e: IpcMainInvokeEvent, file: string): Promise<ScenesInFileResult> => {
    const t0 = performance.now();
    // Somebody looking in a file is somebody about to open a scene: start the
    // builder now, so its ~200ms of startup is spent while they are reading the
    // list rather than added to the first open.
    ensureChild();
    if (isArchive(file)) {
      const { scenes, anim } = listScenesIn(file);
      console.log(`[perf] scene:in-file ${(performance.now() - t0) | 0}ms · ${scenes.length} in ${basename(file)}`
        + (anim.length ? ` (+${anim.length} AnimScene)` : ''));
      return { file, archive: file, scenes, anim };
    }
    if (basename(file).toLowerCase() !== SCENE_FILE.toLowerCase()) {
      throw new Error(`${basename(file)} is neither an archive nor a ${SCENE_FILE}`);
    }
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    const { inner } = sceneOnDisk(file, data);
    return { file, archive: '', anim: [], scenes: [{ inner, name: inner.split('/').slice(-3).join('/') }] };
  });

  // Assembled somewhere else — this handler only says WHERE things are and
  // waits. Seven seconds of meshing in the main process is seven seconds in
  // which no other channel answers; see electron/scene-jobs.ts.
  ipcMain.handle('scene:open', async (_e: IpcMainInvokeEvent, p: SceneOpenPayload): Promise<SceneOpenResult> => {
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    // A scene picked as a FILE brings its own root: the folder it was found in,
    // which is not necessarily anywhere the install can see.
    const onDisk = p.file && !isArchive(p.file) ? sceneOnDisk(p.file, data) : null;
    return await buildSceneOffThread({
      inner: clean(onDisk?.inner ?? p.inner),
      data,
      game: gameRoot(),
      tmp: tmpRoot(),
      ...(p.file ? { file: p.file } : {}),
      ...(onDisk?.root ? { root: onDisk.root } : {}),
    }) as SceneOpenResult;
  });
}
