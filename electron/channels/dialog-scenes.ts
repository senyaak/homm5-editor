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
import { closeBlob, openBlob } from '#electron/blobs.ts';
import { geomCacheDir } from '#electron/decode.ts';
import { packBlobs } from '#src/scene/blob-table.ts';
import { compressedTexturesOn } from '#src/scene/materials.ts';

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

  /** The open scene's blob, let go when the next scene is opened over it. */
  let sceneBlob: string | null = null;
  // Assembled somewhere else — this handler only says WHERE things are and
  // waits. Seven seconds of meshing in the main process is seven seconds in
  // which no other channel answers; see electron/scene-jobs.ts.
  ipcMain.handle('scene:open', async (_e: IpcMainInvokeEvent, p: SceneOpenPayload): Promise<SceneOpenResult> => {
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    // A scene picked as a FILE brings its own root: the folder it was found in,
    // which is not necessarily anywhere the install can see.
    const onDisk = p.file && !isArchive(p.file) ? sceneOnDisk(p.file, data) : null;
    const built = await buildSceneOffThread({
      inner: clean(onDisk?.inner ?? p.inner),
      data,
      game: gameRoot(),
      tmp: tmpRoot(),
      compressed: compressedTexturesOn(),
      cache: geomCacheDir(),
      ...(p.file ? { file: p.file } : {}),
      ...(onDisk?.root ? { root: onDisk.root } : {}),
    });
    // The typed arrays go out of band, as a map's do (electron/blobs.ts): the
    // stage's models are file references into the geom cache, served off the
    // disk; the actors' skins and the shots' effects are bytes the child
    // handed over. One blob per scene, the previous scene's let go.
    if (sceneBlob) closeBlob(sceneBlob);
    const blob = openBlob();
    sceneBlob = blob.url;
    const packed = packBlobs([built.stage, built.shots, built.actors] as const, blob);
    console.log(`[perf] scene:open blobs: ${packed.count} typed arrays = ${(packed.bytes / 1048576).toFixed(1)} MB for the window to fetch`);
    return { ...built, stage: packed.payload[0], shots: packed.payload[1], actors: packed.payload[2] } as SceneOpenResult;
  });
}
