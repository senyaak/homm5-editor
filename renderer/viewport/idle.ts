// Idle stance: which objects animate, and when they are stepped.
//
// Creatures on the adventure map have one clip, an idle loop, and playing it is
// off by default (Settings.idleAnimation). It cannot ride the instanced batches:
// those draw one model many times from a single matrix buffer, and a skinned
// body is posed by a bone texture. So an animated object leaves its batch and
// becomes its own SkinnedMesh — one draw call each, which is the whole reason
// the setting has a middle setting rather than being a checkbox.
//
// What a body is posed BY is shared: every copy of a creature plays the one
// loop at the one time, so the clip is baked once per creature kind to a table
// (skinning.ts, `bakeBoneTable`) and one table skeleton per kind poses all its
// bodies — nothing is computed per body per frame. The scene player, whose
// actors play clips of their own, keeps real bones (`makeIdle`).

import * as THREE from 'three';

import { state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { Instance, SkinnedGeom } from '#src/scene/payload.ts';
import { worldGeos, worldMats, geomSkin } from '#viewport/geoms.ts';
import { markShadowRoles } from '#viewport/shadows.ts';
import { bakeBoneTable, makeBody, TableSkeleton } from '#viewport/skinning.ts';
import type { IdleBody } from '#viewport/skinning.ts';
import { cam } from '#viewport/stage.ts';

export type IdleMode = 'off' | 'visible' | 'all';

/** Which mode the CURRENT scene was built for; `off` means it has no bones. */
let mode: IdleMode = 'off';

/** What the scene is set to, and how the toolbar and a load switch it. */
export const idleMode = (): IdleMode => mode;
export const setIdleMode = (m: IdleMode): void => { mode = m; };
const idleFrustum = new THREE.Frustum();
const idleViewProjection = new THREE.Matrix4();
const _idlePoint = new THREE.Vector3();

/**
 * The table skeletons, one per creature kind, shared by its bodies and
 * reference-counted by them: the last body of a kind takes its skeleton — and
 * the bone texture — down. Keyed by the skin payload, which is one object per
 * geom for the life of a world.
 */
const skeletons = new Map<SkinnedGeom, { skel: TableSkeleton; refs: number }>();

function skeletonFor(skin: SkinnedGeom, geo: THREE.BufferGeometry, mat: THREE.Material[]): TableSkeleton | null {
  const have = skeletons.get(skin);
  if (have) { have.refs++; return have.skel; }
  const t0 = performance.now();
  const table = bakeBoneTable(skin, geo, mat);
  if (!table) return null;
  const ms = performance.now() - t0;
  if (ms > 20) console.log(`[perf] idle table: ${table.frames} frames × ${table.bones} bones in ${ms | 0}ms`);
  const skel = new TableSkeleton(table);
  skeletons.set(skin, { skel, refs: 1 });
  return skel;
}

function releaseSkeleton(skin: SkinnedGeom): void {
  const have = skeletons.get(skin);
  if (!have || --have.refs > 0) return;
  have.skel.dispose();
  skeletons.delete(skin);
}

/** What the tables hold right now — for view.perf(). */
export function idleTableStats(): { tables: number; bytes: number } {
  let bytes = 0;
  for (const { skel } of skeletons.values()) bytes += skel.table.offsets.byteLength + skel.table.world.byteLength;
  return { tables: skeletons.size, bytes };
}

/**
 * Advance every animated object on the visible floor by `dt`.
 *
 * The clock is per creature kind, not per body — one skeleton poses them all,
 * and three updates it once a frame however many bodies draw from it. In
 * `visible` mode a body whose origin is off screen is not drawn at all: with
 * the posing shared, the draw (and its shadow pass) is the only per-body cost
 * left, and that is where the middle mode's saving is now. What counts as on
 * screen is a point test, so a creature straddling the edge can vanish while a
 * sliver of it still shows; that is the trade the middle mode is for, and
 * `all` does not make it.
 */
export function advanceIdle(dt: number): void {
  if (mode === 'off' || !state.world) return;
  const fl = state.world.floors[state.world.active];
  if (!fl?.idle.length || !fl.objGroup.visible) return;
  for (const { skel } of skeletons.values()) skel.time += dt;
  if (mode !== 'visible') {
    // Back from `visible`: whatever it hid is drawn again.
    if (hid) { for (const body of fl.idle) body.mesh.visible = true; hid = false; }
    return;
  }
  idleViewProjection.multiplyMatrices(cam.active.projectionMatrix, cam.active.matrixWorldInverse);
  idleFrustum.setFromProjectionMatrix(idleViewProjection);
  for (const body of fl.idle) {
    _idlePoint.setFromMatrixPosition(body.mesh.matrixWorld);
    body.mesh.visible = idleFrustum.containsPoint(_idlePoint);
  }
  hid = true;
}
/** Whether `visible` mode has hidden bodies that a mode change must show again. */
let hid = false;

/** The loop's playback head, seconds — the furthest along of any kind's. */
export function idleTime(): number {
  let t = 0;
  for (const { skel } of skeletons.values()) t = Math.max(t, skel.time);
  return t;
}

/** Drop animated objects and their skeletons. */
export function clearIdle(objGroup: THREE.Group, list: IdleBody[]): void {
  for (const body of list) {
    objGroup.remove(body.mesh);
    releaseSkeleton(body.skin);
  }
  list.length = 0;
}

/** Remove one object's animated body, if it had one. */
export function removeIdle(fl: Floor3D, inst: Instance): void {
  const i = fl.idle.findIndex((a) => a.mesh.userData.inst === inst);
  if (i < 0) return;
  const [body] = fl.idle.splice(i, 1);
  if (!body) return;
  fl.objGroup.remove(body.mesh);
  releaseSkeleton(body.skin);
}

/**
 * Give an instance its animated body, if it has one, and take it out of the
 * batched draw so the model is not rendered twice.
 */
export function addIdle(objGroup: THREE.Group, list: IdleBody[], inst: Instance, handle: THREE.Mesh): boolean {
  if (mode === 'off') return false;
  const skin = geomSkin.get(inst.g);
  const geo = worldGeos[inst.g], mat = worldMats[inst.g];
  if (!skin || !geo || !mat) return false;
  const skel = skeletonFor(skin, geo, mat);
  if (!skel) return false;
  const body = makeBody(skel, skin, geo, mat);
  body.mesh.position.copy(handle.position);
  body.mesh.rotation.copy(handle.rotation);
  body.mesh.scale.copy(handle.scale); // creature display scale rides the handle
  body.mesh.userData.inst = inst;
  body.mesh.updateMatrixWorld();
  // An animated body stands on the map like any other object, so it casts and
  // receives like one — said HERE rather than by the caller, because the pass
  // that hands the roles out runs once when a floor is built and two of the
  // three callers come later: the palette placing an object, and undo rebuilding
  // the floor. A body made by either of those was drawn in flat sun with nothing
  // falling on it, and stayed that way until the map was reopened.
  markShadowRoles(body.mesh);
  objGroup.add(body.mesh);
  list.push(body);
  return true;
}
