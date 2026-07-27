// Validates the Oodle1 decompressor against the game's own data.
//
// An arithmetic decoder is bit-exact or it is noise, so "it produced the right
// number of bytes" proves very little on its own. What proves it is that the
// game ships the SAME SKELETON TWICE: compressed in bin/Skeletons/<uid>, and
// again — uncompressed — inside the animation that plays on it. Decompress the
// first and it must agree with the second, bone for bone and name for name.
// Nothing about that agreement can happen by accident: one wrong bit anywhere
// in the arithmetic decoder turns the rest of the stream into noise.
//
// The second check is coverage: how much of the library decodes at all. All of
// it does — the port is byte-exact against the game's own granny2.dll on every
// packed section (docs/OODLE1_FORMAT.md §5) — so any section failing here is a
// regression, and the check demands every sampled one.
//
// Skipped without game data. Usage: `node tools/test-oodle.ts [sampleSize]`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GrannyFile } from '../src/gr2.ts';
import { checkSkeleton, readSkeletons } from '../src/animation.ts';
import type { Skeleton } from '../src/animation.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'data-unpacked');
if (!existsSync(join(dataRoot, 'bin', 'Skeletons'))) {
  console.log('\n(no game data — set HOMM5_DATA or run `npm run unpack-data`; skipping)');
  process.exit(0);
}

/** Index a tree by file name. */
function indexTree(dir: string, out = new Map<string, string>()): Map<string, string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) indexTree(path, out);
    else out.set(entry.name, path);
  }
  return out;
}

const uid = (xml: string, block: RegExp): string | null =>
  xml.match(block)?.[0].match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1]?.toUpperCase() ?? null;

// --- the two copies of one skeleton ------------------------------------------

const models = indexTree(join(dataRoot, '_(Model)'));
const animSets = indexTree(join(dataRoot, '_(AnimSet)'));
const pairs: Array<{ name: string; compressed: Skeleton; plain: Skeleton }> = [];

for (const [file, path] of animSets) {
  if (pairs.length >= 12 || !file.endsWith('-adv-idle00.xdb')) continue;
  const base = file.slice(0, -'-adv-idle00.xdb'.length);
  const modelPath = models.get(`${base}.(Model).xdb`);
  if (!modelPath) continue;
  const model = readFileSync(modelPath, 'utf8');
  // The model names its skeleton; the animation set names the clip.
  const skeletonUid = uid(model, /<Skeleton\b[\s\S]*?<\/Skeleton>/);
  const animUid = readFileSync(path, 'utf8').match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1]?.toUpperCase();
  if (!skeletonUid || !animUid) continue;
  const skeletonPath = join(dataRoot, 'bin', 'Skeletons', skeletonUid);
  const animPath = join(dataRoot, 'bin', 'animations', animUid);
  if (!existsSync(skeletonPath) || !existsSync(animPath)) continue;

  const compressedFile = GrannyFile.open(readFileSync(skeletonPath));
  const plainFile = GrannyFile.open(readFileSync(animPath));
  // The animation must be one of the plain ones for this to be a fair oracle.
  if (!compressedFile || !plainFile || plainFile.isUnreadable) continue;
  if (!compressedFile.sections.some((s) => s.compression !== 0 && s.rawSize > 0)) continue;
  if (compressedFile.isUnreadable) continue;
  const compressed = readSkeletons(compressedFile)[0];
  const plain = readSkeletons(plainFile)[0];
  if (!compressed?.bones.length || !plain?.bones.length) continue;
  pairs.push({ name: base, compressed, plain });
}

console.log(`\ncomparing ${pairs.length} skeletons against their uncompressed copies`);

let sameCount = 0, sameNames = 0;
for (const { compressed, plain } of pairs) {
  if (compressed.bones.length === plain.bones.length) sameCount++;
  const n = Math.min(compressed.bones.length, plain.bones.length);
  let namesMatch = true;
  for (let i = 0; i < n; i++) {
    const a = compressed.bones[i]!, b = plain.bones[i]!;
    if (a.name !== b.name || a.parentIndex !== b.parentIndex) namesMatch = false;
  }
  if (namesMatch) sameNames++;
}

check('every pair has the same number of bones', pairs.length > 0 && sameCount === pairs.length,
  `${sameCount}/${pairs.length}`);
check('every bone has the same name and parent, in the same order',
  sameNames === pairs.length, `${sameNames}/${pairs.length}`);
// Not compared: the rest transforms themselves. The two copies legitimately
// differ — the standalone skeleton holds the bind pose, the one inside an
// animation the pose that clip starts from — so a difference there says nothing
// about the decompressor. What DOES pin the floats down is each file's own
// redundancy: every bone stores its transform and, separately, the inverse of
// its world matrix, and those only agree if every float came out bit-exact.
let worstBind = 0, worstBindModel = '';
for (const { name, compressed } of pairs) {
  const { worst } = checkSkeleton(compressed);
  if (worst > worstBind) { worstBind = worst; worstBindModel = name; }
}
check('the floats hold up: composed rest pose matches the stored inverse binds',
  pairs.length > 0 && worstBind < 2e-3, `worst ${worstBind.toExponential(2)} on ${worstBindModel || 'n/a'}`);

// --- coverage ----------------------------------------------------------------

const sampleSize = Number(process.argv[2] ?? 40);
let sections = 0, decoded = 0, files = 0, readable = 0;
for (const [dir, limit] of [['Skeletons', sampleSize], ['animations', Math.floor(sampleSize / 2)]] as const) {
  const d = join(dataRoot, 'bin', dir);
  const all = readdirSync(d);
  const stride = Math.max(1, Math.floor(all.length / limit));
  for (const name of all.filter((_, i) => i % stride === 0).slice(0, limit)) {
    const file = GrannyFile.open(readFileSync(join(d, name)));
    if (!file) continue;
    const compressed = file.sections.filter((s) => s.compression !== 0 && s.rawSize > 0);
    if (!compressed.length) continue;
    files++;
    if (!file.isUnreadable) readable++;
    sections += compressed.length;
    decoded += compressed.filter((s) => s.data).length;
  }
}

console.log('\ncoverage');
console.log(`  ${decoded}/${sections} compressed sections decode (${(decoded / sections * 100).toFixed(0)}%),` +
  ` ${readable}/${files} files fully`);
// Everything decodes since the decay-gate fix (the library is byte-exact
// against granny2.dll), so one failing section is one regression.
check('every sampled section decodes', sections > 0 && decoded === sections,
  `${decoded}/${sections}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
