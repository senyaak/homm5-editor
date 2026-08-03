// Opening a dialog scene in the editor's own window.
//
// The same assembly the standalone page uses (`src/dialog/play.ts`), handed to
// the renderer as one payload: the stage as an ordinary scene payload, so
// `buildWorld` draws it with no special case, plus the shots and the actors'
// rigs on the side.
//
// A scene is addressed by its FOLDER, data-root relative, the way the game
// addresses it — `DialogScenes/C1/M1/D1`. Where that folder physically is
// (unpacked in the data tree, or still inside a mod archive) is this module's
// problem and nobody else's.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assets } from '#src/game/assets.ts';
import { extractMapFolder, gameArchives } from '#src/map/map-source.ts';
import { buildScenePlay } from '#src/dialog/play.ts';
import { packTextures } from '#src/scene/tex-table.ts';
import type { SceneOpenPayload, SceneOpenResult } from '#electron/ipc.ts';
import { gameData, gameRoot, mountedAssets, tmpRoot } from '#electron/paths.ts';

/** The mod archives, in mount order — the campaigns' scenes live in them. */
function modArchives(game: string): string[] {
  const dir = join(game, 'UserMODs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.h5u$/i.test(f)).sort().map((f) => join(dir, f));
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerDialogScenes(): void {
  ipcMain.handle('scene:open', async (_e: IpcMainInvokeEvent, p: SceneOpenPayload): Promise<SceneOpenResult> => {
    const inner = p.inner.replace(/\\/g, '/').replace(/\/+$/, '');
    const scenePath = `${inner}/DialogScene.xdb`;
    const data = gameData();
    if (!data) throw new Error('no data root configured');
    const t0 = performance.now();

    const roots = [data];
    if (!existsSync(join(data, scenePath))) {
      // Unpacked at its IN-GAME path, so every href in the scene — the absolute
      // one at the arena and the relative ones at its own props — resolves
      // through the same chain it would in the game.
      const game = gameRoot();
      if (!game) throw new Error(`${inner} is not unpacked and the game is not configured`);
      const workspace = join(tmpRoot(), 'scenes');
      mkdirSync(workspace, { recursive: true });
      const archives = [...gameArchives(game), ...modArchives(game)];
      if (!existsSync(join(workspace, scenePath))) extractMapFolder(archives, inner, workspace);
      // The shared camera library the campaigns' shots point into. Extracted
      // once; without it half the shots of a campaign scene frame nothing.
      if (!existsSync(join(data, 'Dialogs')) && !existsSync(join(workspace, 'Dialogs'))) {
        extractMapFolder(archives, 'Dialogs', workspace);
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
