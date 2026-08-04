// Validates the idle stance as the GPU will actually draw it.
//
// The risky part of animating an object is not reading the clip — that is
// checked in test-gr2 — it is handing three.js the right bind matrices. Get
// them wrong and the model still draws: it draws inside out, at twice its
// distance from the origin, or subtly sheared, and none of that is obvious from
// a screenshot of a creature you have never seen animated.
//
// So this drives the renderer's own module (renderer/skinning.ts, the same code
// the app runs) and checks it against three.js's `applyBoneTransform`, which is
// the CPU twin of the skinning vertex shader — same bindMatrix, same
// boneMatrices, same order. If this agrees, the GPU agrees.
//
// Skipped without game data. Usage: `node tools/test-idle.ts`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createGeomResolver } from '../src/scene/scene.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = dataDir();
if (!existsSync(join(dataRoot, 'MapObjects'))) {
  console.log('\n(no game data — set HOMM5_DATA or run `npm run unpack-data`; skipping)');
  process.exit(0);
}

const SHARED = '/MapObjects/Neutral/Earth_Elemental.(AdvMapMonsterShared).xdb';
const resolver = createGeomResolver(dataRoot, 64, { animate: true });
const geom = resolver.geoms[resolver.resolve(SHARED)];
if (!geom?.skin?.clip) {
  console.log('\nFAIL: the monster resolved without an idle clip');
  process.exit(1);
}

console.log(`\n${geom.pos.length / 3} vertices, ${geom.skin.bones.length} bones, clip ${geom.skin.clip.duration.toFixed(2)}s`);

// The same geometry the renderer builds, with the binding on it.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geom.pos), 3));
geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(geom.skin.index), 4));
geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(geom.skin.weight), 4));
geometry.setIndex(geom.idx);

const idle = makeIdle(geom.skin, geometry, [new THREE.MeshBasicMaterial()]);
if (!idle) { console.log('\nFAIL: makeIdle returned nothing'); process.exit(1); }

/** Skin every vertex the way the shader does, in the mesh's own local space. */
function skinAll(): THREE.Vector3[] {
  idle!.mesh.updateMatrixWorld(true);
  idle!.mesh.skeleton.update();
  const out: THREE.Vector3[] = [];
  const count = geom!.pos.length / 3;
  for (let v = 0; v < count; v++) {
    const p = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute, v);
    out.push(idle!.mesh.applyBoneTransform(v, p));
  }
  return out;
}

const rest = (v: number): THREE.Vector3 =>
  new THREE.Vector3(geom!.pos[v * 3]!, geom!.pos[v * 3 + 1]!, geom!.pos[v * 3 + 2]!);

// --- 1. at rest, skinning must be the identity -------------------------------
//
// The clip is not applied, so every bone sits at the rest pose the inverse
// binds were built from. Skinning is then bone × its own inverse, summed to
// weight 1 — the identity. Any drift here is the bind matrices being wrong.
console.log('\nbind pose');
let worst = 0;
skinAll().forEach((p, v) => { worst = Math.max(worst, p.distanceTo(rest(v))); });
check('the bind pose skins to itself', worst < 1e-3, `worst ${worst.toExponential(2)} units`);

const size = Math.max(...['x', 'y', 'z'].map((_, i) => {
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < geom.pos.length / 3; v++) { const c = geom.pos[v * 3 + i]!; lo = Math.min(lo, c); hi = Math.max(hi, c); }
  return hi - lo;
}));

// --- 2. placement must not be applied twice ----------------------------------
//
// The classic bindMatrix mistake: bones are children of the mesh, so their world
// matrices already carry its placement. If bindMatrix were the mesh's world
// matrix instead of the identity, a creature moved 40 units out would skin to 80.
idle.mesh.position.set(312, 208, 2); // far out, as objects on a real map are
idle.mesh.rotation.z = 0.9;
idle.mesh.updateMatrixWorld(true);
worst = 0;
skinAll().forEach((p, v) => { worst = Math.max(worst, p.distanceTo(rest(v))); });
// The tolerance is relative to the model, not absolute: the bind matrices are
// rounded on their way through the scene payload, and that rounding is scaled
// by however far from the origin the object stands — 300 units out here. The
// failure this guards against is not subtle drift but a doubling, which at this
// distance would be hundreds of units.
check('moving the object does not move its vertices twice',
  worst < size * 0.01, `worst ${worst.toExponential(2)} units on a ${size.toFixed(2)} model, 300 units from the origin`);

// --- 3. the clip moves the mesh, and keeps it a creature ---------------------
//
// Posed, vertices must move — a clip that quietly reads as constants is the
// failure that looks fine in every other check — but they must stay near where
// they were: skinning that is subtly wrong tends to fling parts of the model
// across the map rather than nudge them.
console.log('\nposed');
let motion = 0, reach = 0;
const duration = geom.skin.clip.duration;
for (const t of [0.25, 0.5, 0.75]) {
  poseIdle(idle, duration * t);
  skinAll().forEach((p, v) => {
    motion = Math.max(motion, p.distanceTo(rest(v)));
    reach = Math.max(reach, p.length());
  });
}
check('the clip moves the mesh', motion > size * 0.01, `largest move ${(motion / size * 100).toFixed(1)}% of model size`);
check('and does not tear it apart', motion < size, `largest move ${motion.toFixed(2)} against a ${size.toFixed(2)} model`);
check('every vertex stays near the model', reach < size * 3, `furthest ${reach.toFixed(2)} units from the origin`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
