// Build a dialog scene's stage and report what came out.
//
//   node tools/scene-stage.ts [DialogScenes/C1/M1/D1]
//
// The renderer's own path, run headless: unpack the scene's folder out of the
// archives the way opening a shipped map does, mount it over the data root,
// then hand its stage map and its own objects to the scene builder. What the
// numbers say is whether a scene can be DRAWN — every prop meshed, nothing
// skipped — before any window exists to draw it in.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { buildScene } from '../src/scene/scene.ts';
import { extractMapFolder, gameArchives } from '../src/map/map-source.ts';
import { dirOf, resolveHref } from '../src/scene/xdb.ts';
import { loadDialogScene } from '../src/dialog/dialog-scene.ts';
import { stageObjects } from '../src/dialog/stage.ts';
import { actorRigs } from '../src/dialog/actors.ts';
import { gameDir } from './game-dir.ts';

const DATA = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
// The install, SAID rather than guessed: two levels above the data cache is
// the checkout's parent, and a worktree's parent holds no game at all.
const GAME = gameDir();
const REPO = join(import.meta.dirname, '..');

const inner = (process.argv[2] ?? 'DialogScenes/C1/M1/D1').replace(/\\/g, '/').replace(/\/+$/, '');
const scenePath = `${inner}/DialogScene.xdb`;

// A scene the data ships unpacked needs no workspace; one that lives inside an
// archive is extracted into a tree that MIRRORS its data path, so every href in
// it — the absolute ones at the arena and the relative ones at its own props —
// resolves through the same mounted chain.
/** The mod archives, where the original campaigns' scenes and cameras live. */
function modArchives(): string[] {
  const dir = join(GAME, 'UserMODs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.h5u$/i.test(f)).sort().map((f) => join(dir, f));
}

const workspace = join(REPO, '_tmp', 'scene-stage');
const roots = [DATA];
if (!existsSync(join(DATA, scenePath))) {
  // The extractor writes each member under its own full path, so it is handed
  // the ROOT of the mirrored tree, not the scene's folder inside it.
  mkdirSync(workspace, { recursive: true });
  const n = extractMapFolder([...gameArchives(GAME), ...modArchives()], inner, workspace);
  console.log(`unpacked ${n} files of ${inner} into _tmp/scene-stage`);
  roots.unshift(workspace);
}

const data = assets(roots);
const text = data.text(scenePath);
if (!text) throw new Error(`no scene at ${scenePath} (looked in ${roots.join(', ')})`);

const scene = loadDialogScene(text);
const stagePath = data.path(resolveHref(dirOf(scenePath), scene.stage));
const objects = stageObjects(data, scenePath, scene);
const props = objects.filter((o) => o.role === 'prop').length;

console.log(`${inner}`);
console.log(`  stage    ${resolveHref(dirOf(scenePath), scene.stage)}`);
console.log(`  scene    ${scene.shots.length} shots, ${props} props, ${objects.length - props} actors resolved`);

const built = buildScene(data, stagePath, { extraObjects: objects.map((o) => o.object) });
const placed = built.scene.floors.reduce((a, f) => a + f.instances.length, 0);
console.log(`  drawn    ${built.map.tileX}x${built.map.tileY}, ${built.scene.geoms.length} meshes, ${placed} placed, ${built.skipped.length} skipped`);

// Name what did not make it. A count alone reads as rounding; the href says
// whether a prop is missing its model or the scene points at nothing.
for (const { object, role, href } of objects) {
  const shared = object.shared;
  if (shared && built.resolver.resolve(shared) >= 0) continue;
  console.log(`  skipped  ${role} ${href} — ${shared ? `no mesh for ${shared.split('#')[0]}` : 'no <Shared>'}`);
}

// The actors' own rigs: not the adventure model with its one idle, but the
// arena character and the clips this scene names on it.
const rigs = actorRigs(data, scene, objects);
console.log(`  actors   ${rigs.length} rigged`);
for (const rig of rigs) {
  const baked = Object.keys(rig.clips);
  console.log(`    ${rig.href.split('#')[0].padEnd(24)} ${rig.geom.skin?.bones.length ?? 0} bones · `
    + `${baked.length}/${rig.available.length} clips baked (${baked.join(', ')})`
    + (rig.missing.length ? ` · missing ${rig.missing.join(', ')}` : ''));
}
