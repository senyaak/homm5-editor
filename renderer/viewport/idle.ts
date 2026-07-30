// Idle stance: which objects animate, and when they are stepped.
//
// Creatures on the adventure map have one clip, an idle loop, and playing it is
// off by default (Settings.idleAnimation). It cannot ride the instanced batches:
// those draw one model many times from a single matrix buffer, and every copy
// of a creature poses independently. So an animated object leaves its batch and
// becomes its own SkinnedMesh — one draw call each, which is the whole reason
// the setting has a middle setting rather than being a checkbox.
//
// Building and posing one lives in skinning.ts, where the bind-matrix maths is
// written out; what is here is only which objects get one and when.

import * as THREE from 'three';

import { state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { Instance } from '#src/scene.ts';
import { worldGeos, worldMats, geomSkin } from '#viewport/geoms.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
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
 * Advance every animated object on the visible floor by `dt`.
 *
 * In `visible` mode an object off screen still holds its pose but stops being
 * re-posed, which is where the saving is: the skinning itself is the cost, not
 * the clock. What counts as on screen is the object's own origin against the
 * camera frustum — a point test, so a creature straddling the edge can stop
 * moving while a sliver of it still shows. That is the trade the middle mode
 * is for; `all` does not make it.
 */
export function advanceIdle(dt: number): void {
  if (mode === 'off' || !state.world) return;
  const fl = state.world.floors[state.world.active];
  if (!fl?.idle.length || !fl.objGroup.visible) return;
  if (mode === 'visible') {
    idleViewProjection.multiplyMatrices(cam.active.projectionMatrix, cam.active.matrixWorldInverse);
    idleFrustum.setFromProjectionMatrix(idleViewProjection);
  }
  for (const idle of fl.idle) {
    idle.time += dt;
    if (mode === 'visible') {
      _idlePoint.setFromMatrixPosition(idle.mesh.matrixWorld);
      if (!idleFrustum.containsPoint(_idlePoint)) continue;
    }
    poseIdle(idle, idle.time);
  }
}

/** Drop animated objects and their skeletons. */
export function clearIdle(objGroup: THREE.Group, list: IdleObject[]): void {
  for (const idle of list) {
    objGroup.remove(idle.mesh);
    idle.mesh.skeleton.dispose();
  }
  list.length = 0;
}

/** Remove one object's animated body, if it had one. */
export function removeIdle(fl: Floor3D, inst: Instance): void {
  const i = fl.idle.findIndex((a) => a.mesh.userData.inst === inst);
  if (i < 0) return;
  const [idle] = fl.idle.splice(i, 1);
  if (!idle) return;
  fl.objGroup.remove(idle.mesh);
  idle.mesh.skeleton.dispose();
}

/**
 * Give an instance its animated body, if it has one, and take it out of the
 * batched draw so the model is not rendered twice.
 *
 * Phase is spread by index rather than left at zero: a row of identical
 * gremlins breathing in perfect unison reads as a mistake, and the clip is a
 * loop, so any offset into it is as valid a starting pose as another.
 */
export function addIdle(
  objGroup: THREE.Group, list: IdleObject[], inst: Instance, handle: THREE.Mesh, phase: number,
): boolean {
  if (mode === 'off') return false;
  const skin = geomSkin.get(inst.g);
  const geo = worldGeos[inst.g], mat = worldMats[inst.g];
  if (!skin || !geo || !mat) return false;
  const idle = makeIdle(skin, geo, mat);
  if (!idle) return false;
  idle.mesh.position.copy(handle.position);
  idle.mesh.rotation.copy(handle.rotation);
  idle.mesh.scale.copy(handle.scale); // creature display scale rides the handle
  idle.mesh.userData.inst = inst;
  idle.time = phase;
  poseIdle(idle, idle.time);
  idle.mesh.updateMatrixWorld();
  objGroup.add(idle.mesh);
  list.push(idle);
  return true;
}
