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

// needs: data
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createGeomResolver } from '../src/scene/scene.ts';
import { makeIdle, poseIdle, bakeBoneTable, TableSkeleton, TABLE_RATE } from '#viewport/skinning.ts';
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
geometry.setIndex(new THREE.BufferAttribute(geom.idx, 1));

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

// --- 4. the display scale is applied ONCE ------------------------------------
//
// A creature is authored at one size and drawn at another: the scale rides on
// the clip skeleton's ROOT, and every caller hoists it onto the mesh
// (GeomData.scale — a phoenix at 0.37, a griffin at 1.5). The clip must
// therefore NOT carry it too, or it multiplies in twice and the phoenix comes
// out at 0.37² of its size.
//
// This is here rather than beside the effects because only a creature can show
// it: the effect models whose swell made scale-baking necessary all happen to
// have a root at 1, so a check on those passes either way — it was written,
// sabotaged, and stayed green, which is exactly the blind metric to avoid.
const scaledRoots: string[] = [];
for (const shared of [
  '/MapObjects/Neutral/Phoenix.(AdvMapMonsterShared).xdb',
  '/MapObjects/Inferno/ArchDevil.(AdvMapMonsterShared).xdb',
  '/MapObjects/Neutral/Earth_Elemental.(AdvMapMonsterShared).xdb',
]) {
  const i = resolver.resolve(shared);
  if (i < 0) continue;
  const g = resolver.geoms[i]!;
  const root = g.skin?.clip?.scales?.[0];
  const off = root?.find((v) => Math.abs(v - 1) > 0.01);
  if (off !== undefined) scaledRoots.push(`${shared.split('/').pop()} root ${off.toFixed(3)} with display scale ${g.scale ?? 1}`);
}
console.log('\ndisplay scale');
check('a creature\'s clip leaves its root at unit scale', scaledRoots.length === 0,
  scaledRoots.join('; ') || 'the root scale is on the mesh alone');

// The map's bodies are posed from a table the clip was baked to, not from
// bones (skinning.ts, bakeBoneTable). The table is only right if a body over
// it draws what the bone path drew: at any time t, its skinning matrices must
// equal a real skeleton's posed at the table's frame for t.
console.log('\nbaked table');
const table = bakeBoneTable(geom.skin, geometry, [new THREE.MeshBasicMaterial()]);
if (!table) { console.log('FAIL: bakeBoneTable returned nothing'); process.exit(1); }
check('one row per frame at the table rate', table.frames === Math.max(1, Math.round(table.duration * TABLE_RATE)) && table.offsets.length === table.frames * table.bones * 16,
  `${table.frames} frames × ${table.bones} bones over ${table.duration.toFixed(2)}s`);
const skel = new TableSkeleton(table);
// The table is in model space — a body's placement is its own matrix, applied
// after — so the bones it is held against stand at the origin.
idle.mesh.position.set(0, 0, 0);
idle.mesh.rotation.set(0, 0, 0);
let tableWorst = 0;
for (const t of [0, 0.37, table.duration * 0.5, table.duration - 0.01, table.duration + 0.2]) {
  skel.time = t;
  skel.update();
  const f = skel.frameAt();
  poseIdle(idle, f / TABLE_RATE);
  idle.mesh.updateMatrixWorld(true);
  idle.mesh.skeleton.update();
  const real = idle.mesh.skeleton.boneMatrices!, mine = skel.boneMatrices!;
  for (let i = 0; i < real.length; i++) tableWorst = Math.max(tableWorst, Math.abs(real[i]! - mine[i]!));
  // And the bone's own place, which the glued effects hang off.
  const w = new THREE.Matrix4();
  skel.boneWorld(0, w);
  for (let i = 0; i < 16; i++) tableWorst = Math.max(tableWorst, Math.abs(w.elements[i]! - idle.bones[0]!.matrixWorld.elements[i]!));
}
check('a table skeleton poses as the bones do at the frame', tableWorst < 1e-5, `largest difference ${tableWorst.toExponential(2)}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
