// Turning a scene's skin payload into a three.js skinned mesh, and posing it.
//
// Its own module so the app is not the only thing that can build one: the test
// (tools/test-idle.ts) drives THESE functions rather than a copy of them, and
// checks the result against three.js's own skinning maths. A copy would happily
// pass a test the renderer then fails.
//
// The maths, since three.js does not spell it out and reasoning about it in the
// abstract wastes an afternoon. The vertex shader computes
//
//   transformed = bindMatrixInverse * Σ w (bone.matrixWorld * boneInverse) * bindMatrix * p
//
// and the renderer then applies modelViewMatrix = view * mesh.matrixWorld on
// top. Our inverse binds are in MODEL space and the bones are children of the
// mesh, so bone.matrixWorld already carries the object's placement — which
// means bindMatrix must be the IDENTITY, or the placement is applied twice and
// a creature ends up at twice its distance from the origin. bindMode stays
// attached, so bindMatrixInverse is recomputed from matrixWorld every frame and
// dragging an animated object keeps working.

import * as THREE from 'three';
import type { SkinnedGeom } from '#src/scene/payload.ts';

/** One animated object: its own skeleton, its own place in the loop. */
export interface IdleObject {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  skin: SkinnedGeom;
  /** Playback head in seconds, wrapped into the clip's duration. */
  time: number;
}

/**
 * Build a skinned mesh for one object out of a scene geom's skin payload.
 *
 * The geometry and materials are the shared ones — a model's binding is the
 * same for every copy of it, and only the skeleton is per object, because two
 * gremlins on the same map are at different points of the same loop.
 */
export function makeIdle(
  skin: SkinnedGeom, geometry: THREE.BufferGeometry, material: THREE.Material[],
): IdleObject | null {
  if (!skin.clip || !skin.bones.length) return null;
  const bones = skin.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.pos[0]!, b.pos[1]!, b.pos[2]!);
    bone.quaternion.set(b.quat[0]!, b.quat[1]!, b.quat[2]!, b.quat[3]!);
    return bone;
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  skin.bones.forEach((b, i) => {
    const parent = b.parent >= 0 ? bones[b.parent] : null;
    (parent ?? mesh).add(bones[i]!);
  });
  mesh.bind(
    new THREE.Skeleton(bones, skin.bind.map((m) => new THREE.Matrix4().fromArray(m))),
    new THREE.Matrix4(),
  );
  // The bones carry vertices well outside the geometry's own bounds, and three
  // culls against those bounds, so a leaning creature would blink out. What is
  // on screen is decided by hand instead (see advanceIdle in app.ts).
  mesh.frustumCulled = false;
  return { mesh, bones, skin, time: 0 };
}

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

/**
 * Put an object's bones where its clip says they are at `time`, looping.
 *
 * The clip is already sampled onto an even grid (src/animation.ts bakes the
 * B-splines away), so this is a lookup and a blend — linear between
 * neighbouring samples, spherical for the rotations.
 */
export function poseIdle(idle: IdleObject, time: number): void {
  const clip = idle.skin.clip;
  if (!clip) return;
  const n = clip.times.length;
  if (!n) return;
  const span = clip.duration || 1;
  const at = ((time % span) + span) % span;
  // Even spacing is what makes this a division rather than a search.
  const f = Math.min(n - 1, Math.max(0, at / span * (n - 1)));
  const i0 = Math.min(n - 1, Math.floor(f));
  const i1 = Math.min(n - 1, i0 + 1);
  const t = f - i0;
  idle.bones.forEach((bone, b) => {
    const rot = clip.rotations[b], pos = clip.positions[b];
    if (rot) {
      _a.set(rot[i0 * 4]!, rot[i0 * 4 + 1]!, rot[i0 * 4 + 2]!, rot[i0 * 4 + 3]!);
      _b.set(rot[i1 * 4]!, rot[i1 * 4 + 1]!, rot[i1 * 4 + 2]!, rot[i1 * 4 + 3]!);
      bone.quaternion.slerpQuaternions(_a, _b, t);
    }
    if (pos) {
      bone.position.set(
        pos[i0 * 3]! + (pos[i1 * 3]! - pos[i0 * 3]!) * t,
        pos[i0 * 3 + 1]! + (pos[i1 * 3 + 1]! - pos[i0 * 3 + 1]!) * t,
        pos[i0 * 3 + 2]! + (pos[i1 * 3 + 2]! - pos[i0 * 3 + 2]!) * t,
      );
    }
  });
}
