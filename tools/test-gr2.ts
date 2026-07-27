// Validates the Granny reader against the shipped animation library.
//
// The checks are not "does it parse" — a wrong reader parses too, and produces
// plausible numbers. They are redundancies the FILE ITSELF carries:
//
//   * headerSize must equal 88 + 44 * sectionCount (proves the flavour and the
//     section-array offset are read right),
//   * every bone stores BOTH its local transform and the inverse of its world
//     matrix, so composing the rest pose and inverting it must reproduce the
//     stored matrix (proves parenting order, quaternion convention and the
//     row-vector matrix layout),
//   * a curve's knots must lie inside [0, duration] (proves knots are seconds
//     and that we paired knots with the right control array).
//
// Skipped when the game data is not unpacked; set HOMM5_DATA or unpack into
// data-unpacked. Usage: `node tools/test-gr2.ts [sampleSize]`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GrannyFile } from '../src/gr2.ts';
import {
  checkSkeleton, isIdentityFrame, readAnimations, readSkeletons, skinMatrices, skinPositions,
} from '../src/animation.ts';
import { extractMeshesStructured, readGeometryRefFromModelXdb } from '../src/geometry.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'data-unpacked');
const animDir = join(dataRoot, 'bin', 'animations');
if (!existsSync(animDir)) {
  console.log('\n(no game data — set HOMM5_DATA or run `npm run unpack-data`; skipping)');
  process.exit(0);
}

const sampleSize = Number(process.argv[2] ?? 250);
// Spread the sample across the directory rather than taking the first N: the
// files are named by uid, so any contiguous run is an arbitrary slice of the
// library, but a stride still mixes creatures, buildings and heroes.
const all = readdirSync(animDir);
const stride = Math.max(1, Math.floor(all.length / sampleSize));
const sample = all.filter((_, i) => i % stride === 0).slice(0, sampleSize);

console.log(`\nreading ${sample.length} of ${all.length} animation files`);

let opened = 0, compressed = 0, notGranny = 0;
let withSkeleton = 0, withAnimation = 0;
let worstSkeletonError = 0, worstSkeletonFile = '', rotatedBindFrame = 0;
const skeletonErrors: number[] = [];
let knotOutOfRange = 0, emptyDim = 0, totalBones = 0, totalTracks = 0;
const degrees = new Map<number, number>();

for (const name of sample) {
  const path = join(animDir, name);
  if (!statSync(path).isFile()) continue;
  const file = GrannyFile.open(readFileSync(path));
  if (!file) { notGranny++; continue; }
  opened++;
  if (file.isCompressed) { compressed++; continue; }

  const skeletons = readSkeletons(file);
  for (const skeleton of skeletons) {
    if (!skeleton.bones.length) continue;
    withSkeleton++;
    totalBones += skeleton.bones.length;
    const { worst, frame } = checkSkeleton(skeleton);
    if (!isIdentityFrame(frame)) rotatedBindFrame++;
    skeletonErrors.push(worst);
    if (worst > worstSkeletonError) { worstSkeletonError = worst; worstSkeletonFile = name; }
  }

  for (const animation of readAnimations(file)) {
    withAnimation++;
    for (const group of animation.groups) {
      for (const track of group.tracks) {
        totalTracks++;
        for (const curve of [track.position, track.orientation, track.scaleShear]) {
          if (!curve.dim) continue;
          degrees.set(curve.degree, (degrees.get(curve.degree) ?? 0) + 1);
          // A quaternion channel must be 4 wide, a position 3, scale-shear 9;
          // anything else means knots and controls were paired wrongly.
          if (![3, 4, 9].includes(curve.dim)) emptyDim++;
          const first = curve.knots[0]!, last = curve.knots[curve.knots.length - 1]!;
          if (first < -1e-3 || last > animation.duration + 1e-3) knotOutOfRange++;
        }
      }
    }
  }
}

console.log('\ncontainer');
check('every sampled file is a Granny GR2', notGranny === 0, `${notGranny} rejected`);
check('headers line up on all of them', opened === sample.length - notGranny, `${opened} opened`);
console.log(`  (${compressed} of ${opened} carry Oodle-compressed sections and were skipped)`);

console.log('\nskeletons');
check('files carry a skeleton', withSkeleton > 0, `${withSkeleton} skeletons, ${totalBones} bones`);
// Two thresholds, because the error is float32 accumulation and not a constant.
// Bones are stored as float32 and composed level by level, so a cloth strand
// fifteen joints deep drifts further from the file's own (also float32) inverse
// bind than a hip two joints down: measured, the median skeleton lands at 4e-7
// and the deepest ones at 7e-4. The MEDIAN is therefore the real signal — a
// transposed matrix or a reversed parent order shifts every skeleton at once,
// not just the deep tail, and both numbers would jump to order 1.
const median = skeletonErrors.slice().sort((a, b) => a - b)[skeletonErrors.length >> 1] ?? 0;
check('every bone agrees on one bind frame',
  worstSkeletonError < 2e-3, `worst ${worstSkeletonError.toExponential(2)} in ${worstSkeletonFile || 'n/a'}`);
check('and the typical skeleton agrees exactly', median < 1e-5, `median ${median.toExponential(2)}`);
console.log(`  (${rotatedBindFrame} of ${withSkeleton} skeletons carry the exporter's rotated root frame)`);

console.log('\nanimations');
check('files carry an animation', withAnimation > 0, `${withAnimation} animations, ${totalTracks} tracks`);
check('every curve is 3, 4 or 9 wide', emptyDim === 0, `${emptyDim} odd widths`);
check('knots stay inside [0, duration]', knotOutOfRange === 0, `${knotOutOfRange} outside`);
console.log('  curve degrees:', [...degrees].sort((a, b) => a[0] - b[0]).map(([d, n]) => `deg${d} ×${n}`).join(', '));

// --- skinning ----------------------------------------------------------------
//
// Ties the two halves together on real creatures: the mesh and its binding come
// out of our own geometry container, the bones and curves out of a Granny file,
// and the bone indices in the first only mean anything against the bone list in
// the second. The test that matters is the rest pose — skinning matrices built
// from the rest pose are the identity, so a skinned vertex must land exactly
// where the unskinned one is. If the two bone lists were ordered differently,
// or the binding were read per render vertex instead of per position, the mesh
// would come apart and this would show it.

/** Index every file under a directory tree by base name. */
function indexTree(dir: string, out = new Map<string, string>()): Map<string, string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) indexTree(path, out);
    else out.set(entry.name, path);
  }
  return out;
}

const models = indexTree(join(dataRoot, '_(Model)'));
const animSets = indexTree(join(dataRoot, '_(AnimSet)'));
const idles = [...animSets.keys()].filter((n) => n.endsWith('-adv-idle00.xdb')).sort();

let skinned = 0, unbound = 0, worstWeightSum = 0, badIndex = 0;
let worstRestDrift = 0, worstRestModel = '';
let worstGrowth = 0, worstGrowthModel = '';
let bestMotion = 0, bestMotionModel = '';
const stillModels: string[] = [];

for (const idle of idles.slice(0, 24)) {
  const base = idle.slice(0, -'-adv-idle00.xdb'.length);
  const modelPath = models.get(`${base}.(Model).xdb`);
  if (!modelPath) continue;
  const animUid = readFileSync(animSets.get(idle)!, 'utf8').match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
  const animPath = animUid && join(dataRoot, 'bin', 'animations', animUid.toUpperCase());
  if (!animPath || !existsSync(animPath)) continue;
  const granny = GrannyFile.open(readFileSync(animPath));
  if (!granny || granny.isCompressed) continue;
  const skeleton = readSkeletons(granny)[0];
  const animation = readAnimations(granny)[0] ?? null;
  if (!skeleton?.bones.length) continue;

  const model = readGeometryRefFromModelXdb(readFileSync(modelPath, 'utf8'));
  const geometryPath = model && join(dataRoot, 'bin', 'Geometries', model.uid);
  if (!geometryPath || !existsSync(geometryPath)) continue;
  const meshes = extractMeshesStructured(readFileSync(geometryPath), { skin: true }) ?? [];

  const rest = skinMatrices(skeleton, null, 0);
  for (const mesh of meshes) {
    if (!mesh.skin) { unbound++; continue; }
    skinned++;
    for (let v = 0; v < mesh.vertexCount; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += mesh.skin.weights[v * 4 + k]!;
        if (mesh.skin.indices[v * 4 + k]! >= skeleton.bones.length) badIndex++;
      }
      worstWeightSum = Math.max(worstWeightSum, Math.abs(sum - 1));
    }
    const bound = skinPositions(mesh.positions, mesh.skin, rest);
    for (let i = 0; i < bound.length; i++) {
      const drift = Math.abs(bound[i]! - mesh.positions[i]!);
      if (drift > worstRestDrift) { worstRestDrift = drift; worstRestModel = base; }
    }

    // And the clip itself: an idle keeps a creature roughly where it stands, so
    // the posed mesh must stay near its own bounding box. A mismatched bone list
    // does not drift, it explodes — this catches that without needing a picture.
    if (!animation) continue;
    const size = Math.max(model!.bbox.sx, model!.bbox.sy, model!.bbox.sz) || 1;
    const frames: Float32Array[] = [];
    for (let step = 0; step <= 4; step++) {
      const posed = skinPositions(mesh.positions, mesh.skin, skinMatrices(skeleton, animation, animation.duration * step / 4));
      frames.push(posed);
      let reach = 0;
      for (let v = 0; v < posed.length; v += 3) {
        reach = Math.max(reach, Math.hypot(posed[v]! - model!.bbox.cx, posed[v + 1]! - model!.bbox.cy, posed[v + 2]! - model!.bbox.cz));
      }
      const growth = reach / size;
      if (growth > worstGrowth) { worstGrowth = growth; worstGrowthModel = base; }
    }
    // And it has to MOVE. Every check above passes just as happily on a clip
    // read as all-constant curves, which is exactly the failure a quiet bug in
    // knot or control handling would produce: a creature standing frozen.
    let motion = 0;
    for (const frame of frames.slice(1)) {
      for (let i = 0; i < frame.length; i++) motion = Math.max(motion, Math.abs(frame[i]! - frames[0]![i]!));
    }
    const relative = motion / size;
    if (relative > bestMotion) { bestMotion = relative; bestMotionModel = base; }
    if (relative < 1e-3) stillModels.push(base);
  }
}

console.log('\nskinning');
check('creature meshes carry a binding', skinned > 0, `${skinned} bound, ${unbound} without`);
check('weights sum to 1 on every vertex', worstWeightSum < 1e-5, `worst ${worstWeightSum.toExponential(2)}`);
check('every bone index is inside the skeleton', badIndex === 0, `${badIndex} out of range`);
check('the rest pose skins to itself exactly', worstRestDrift < 1e-3,
  `worst ${worstRestDrift.toExponential(2)} on ${worstRestModel || 'n/a'}`);
check('the idle stays inside its own bounding box', worstGrowth < 2,
  `worst reach ${worstGrowth.toFixed(2)}× model size on ${worstGrowthModel || 'n/a'}`);
check('and the idle actually moves the mesh', stillModels.length === 0,
  `largest motion ${(bestMotion * 100).toFixed(1)}% of model size on ${bestMotionModel || 'n/a'}` +
  (stillModels.length ? `; still: ${stillModels.slice(0, 4).join(', ')}` : ''));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
