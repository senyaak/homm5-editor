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
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { assets } from '#src/game/assets.ts';
import { extractMapFolder } from '#src/map/map-source.ts';
import { buildScenePlay } from '#src/dialog/play.ts';
import { ARCHIVE_EXT, isArchive, listScenesIn, sceneArchives, SCENE_FILE } from '#src/dialog/scene-source.ts';
import { packTextures } from '#src/scene/tex-table.ts';
import type { SceneOpenPayload, SceneOpenResult, ScenesInFileResult } from '#electron/ipc.ts';
import { gameData, gameRoot, mountedAssets, tmpRoot } from '#electron/paths.ts';
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
    if (isArchive(file)) {
      const scenes = listScenesIn(file);
      console.log(`[perf] scene:in-file ${(performance.now() - t0) | 0}ms · ${scenes.length} in ${basename(file)}`);
      return { file, archive: file, scenes };
    }
    if (basename(file).toLowerCase() !== SCENE_FILE.toLowerCase()) {
      throw new Error(`${basename(file)} is neither an archive nor a ${SCENE_FILE}`);
    }
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    const { inner } = sceneOnDisk(file, data);
    return { file, archive: '', scenes: [{ inner, name: inner.split('/').slice(-3).join('/') }] };
  });

  ipcMain.handle('scene:open', async (_e: IpcMainInvokeEvent, p: SceneOpenPayload): Promise<SceneOpenResult> => {
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    const t0 = performance.now();
    // A scene picked as a FILE brings its own root: the folder it was found in,
    // which is not necessarily anywhere the install can see.
    const onDisk = p.file && !isArchive(p.file) ? sceneOnDisk(p.file, data) : null;
    const inner = clean(onDisk?.inner ?? p.inner);
    const scenePath = `${inner}/${SCENE_FILE}`;

    const roots = [data];
    if (onDisk?.root) roots.unshift(onDisk.root);
    else if (!existsSync(join(data, scenePath))) {
      // Unpacked at its IN-GAME path, so every href in the scene — the absolute
      // one at the arena and the relative ones at its own props — resolves
      // through the same chain it would in the game.
      const game = gameRoot();
      const workspace = join(tmpRoot(), 'scenes');
      mkdirSync(workspace, { recursive: true });
      // Out of the archive the user pointed at, when they pointed at one: a map
      // that carries its own scene must give up THAT scene, not the copy of the
      // same path some other archive happens to hold.
      const archives = p.file && isArchive(p.file) ? [p.file] : [];
      if (!archives.length && !game) throw new Error(`${inner} is not unpacked and the game is not configured`);
      if (!existsSync(join(workspace, scenePath))) {
        extractMapFolder(archives.length ? archives : sceneArchives(game!), inner, workspace);
      }
      // The shared camera library the campaigns' shots point into. Extracted
      // once, from the INSTALL rather than from the file the user opened — the
      // library is not in the map that carries a scene, and half the shots of a
      // campaign scene frame nothing without it. Best-effort: a scene of one's
      // own points at its own cameras and must still open on an install that
      // has no such library.
      if (game && !existsSync(join(data, 'Dialogs')) && !existsSync(join(workspace, 'Dialogs'))) {
        try { extractMapFolder(sceneArchives(game), 'Dialogs', workspace); }
        catch (e) { console.warn('[scene] no shared camera library:', e instanceof Error ? e.message : String(e)); }
      }
      roots.unshift(workspace);
    }

    // Mods over the data root, as everywhere else, with the workspace on top.
    const mounted = mountedAssets(data);
    const chain = assets([...roots.slice(0, -1), ...mounted.roots]);
    const play = buildScenePlay(chain, scenePath);
    const placed = play.stage.floors.reduce((a, f) => a + f.instances.length, 0);
    const clips = play.actors.reduce((a, x) => a + Object.keys(x.clips).length, 0);
    console.log(`[perf] scene:open ${(performance.now() - t0) | 0}ms · ${inner} · `
      + `${play.shots.length} shots, ${play.stage.geoms.length} meshes, ${placed} placed, `
      + `${play.actors.length} actors, ${clips} clips`);

    // One picture per texture on the wire, not one per mesh wearing it — the
    // difference is 85 MB against 21 for this scene. The renderer puts them
    // back the moment it has them.
    const packed = packTextures([play.stage, play.shots, play.actors] as const);
    return {
      stage: packed.payload[0],
      shots: packed.payload[1],
      actors: packed.payload[2],
      textures: packed.textures,
      info: {
        inner,
        name: inner.split('/').slice(-3).join('/'),
        stage: play.scene.stage.split('#')[0] ?? '',
        shots: play.shots.length,
        placed,
        skipped: play.skipped.length,
      },
    };
  });
}
