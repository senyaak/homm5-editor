// Everything an "open this scene" is, with no Electron in it.
//
// Pulled out of the IPC handler so it can run somewhere other than the main
// process: assembling C1M1's opening is seven seconds of reading, meshing and
// baking, and the main process is single-threaded — for those seven seconds the
// app answers nothing at all. `electron/scene-worker.ts` runs this in a child
// and the handler just waits, which is what a promise is for.
//
// The only reason this is a module rather than a function in the worker is that
// nothing about it is about being in a worker: the paths come in as arguments
// (they have to — a utility process has no `app` to ask), and what comes out is
// the payload the renderer draws.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { assets } from '../game/assets.ts';
import { extractMapFolder } from '../map/map-source.ts';
import { mountCreatureMods } from '../mods/mod-archive.ts';
import { packTextures } from '../scene/tex-table.ts';
import type { Scene } from '../scene/payload.ts';
import { buildScenePlay } from './play.ts';
import type { ActorView, ShotView } from './play.ts';
import { isArchive, sceneArchives, SCENE_FILE } from './scene-source.ts';

/** Where everything is. Given rather than asked for — see the head of the file. */
export interface OpenSceneJob {
  /** The scene's folder, as the game addresses it: `DialogScenes/C1/M1/D1`. */
  inner: string;
  /** The data root everything resolves against. */
  data: string;
  /** The install, when there is one — for the archives a scene is unpacked from. */
  game: string | null;
  /** Where a scene may be unpacked to, and where mounted mods are staged. */
  tmp: string;
  /** The file the user pointed at: an archive to take the scene out of, or the
   *  `DialogScene.xdb` itself (in which case `root` says where to mount it). */
  file?: string;
  /** An asset root to put in FRONT of the data root — a scene folder's parent. */
  root?: string;
}

/**
 * A scene, ready for the wire — the shape `scene:open` answers with.
 *
 * Declared here rather than assembled by each caller: it was written out twice
 * for a day (once in the worker, once in the fallback that runs when there is
 * no worker), which is two places for the same six fields to drift.
 */
export interface ScenePayload {
  stage: Scene;
  shots: ShotView[];
  actors: ActorView[];
  /** The pictures the payload's texture handles stand for. */
  textures: string[];
  info: {
    inner: string;
    name: string;
    /** The map the scene is staged on. */
    stage: string;
    shots: number;
    placed: number;
    skipped: number;
  };
}

/** The payload plus what to say about how it went. */
export interface OpenSceneOut {
  payload: ScenePayload;
  /** Milliseconds spent building it. */
  ms: number;
  /** The line for the timing log — one wording, wherever this ran. */
  note: string;
}

/**
 * Read a scene and everything under it, ready to be drawn.
 *
 * Unpacks first when the scene is still inside an archive — at its IN-GAME
 * path, so every href resolves through the chain it would in the game.
 */
export function openScenePayload(job: OpenSceneJob): OpenSceneOut {
  const t0 = performance.now();
  const inner = job.inner.replace(/\\/g, '/').replace(/\/+$/, '');
  const scenePath = `${inner}/${SCENE_FILE}`;

  const roots = [job.data];
  if (job.root) roots.unshift(job.root);
  else if (!existsSync(join(job.data, scenePath))) {
    const workspace = join(job.tmp, 'scenes');
    mkdirSync(workspace, { recursive: true });
    // Out of the archive the user pointed at, when they pointed at one: a map
    // that carries its own scene must give up THAT scene, not the copy of the
    // same path some other archive happens to hold.
    const picked = job.file && isArchive(job.file) ? [job.file] : [];
    if (!picked.length && !job.game) throw new Error(`${inner} is not unpacked and the game is not configured`);
    if (!existsSync(join(workspace, scenePath))) {
      extractMapFolder(picked.length ? picked : sceneArchives(job.game!), inner, workspace);
    }
    // The shared camera library the campaigns' shots point into. Extracted
    // once, from the INSTALL rather than from the file the user opened — the
    // library is not in the map that carries a scene, and half the shots of a
    // campaign scene frame nothing without it. Best-effort: a scene of one's
    // own points at its own cameras and must still open where there is no such
    // library.
    if (job.game && !existsSync(join(job.data, 'Dialogs')) && !existsSync(join(workspace, 'Dialogs'))) {
      try { extractMapFolder(sceneArchives(job.game), 'Dialogs', workspace); }
      catch (e) { console.warn('[scene] no shared camera library:', e instanceof Error ? e.message : String(e)); }
    }
    roots.unshift(workspace);
  }

  // Mods over the data root, as everywhere else, with the workspace on top.
  const over: string[] = [];
  if (job.game) {
    try { for (const m of mountCreatureMods(job.game, join(job.tmp, 'mods'))) over.push(m.root); }
    catch (e) { console.warn('[mods] not mounted:', e instanceof Error ? e.message : String(e)); }
  }
  const chain = assets([...roots.slice(0, -1), ...over, job.data]);
  const play = buildScenePlay(chain, scenePath);
  // One picture per texture on the wire, not one per mesh wearing it — the
  // difference is 85 MB against 21 for this scene.
  const packed = packTextures([play.stage, play.shots, play.actors] as const);
  const placed = play.stage.floors.reduce((a, f) => a + f.instances.length, 0);
  const clips = play.actors.reduce((a, x) => a + Object.keys(x.clips).length, 0);
  const ms = performance.now() - t0;
  return {
    ms,
    note: `${ms | 0}ms · ${inner} · ${play.shots.length} shots, ${play.stage.geoms.length} meshes, `
      + `${placed} placed, ${play.actors.length} actors, ${clips} clips`,
    payload: {
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
    },
  };
}
