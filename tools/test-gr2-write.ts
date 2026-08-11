// The Granny writer, checked against the game's own files and our own reader.
//
//   node tools/test-gr2-write.ts [dataRoot]
//
// Three questions:
//
//   1. Is the type library we WRITE the one the game's files declare? Every
//      structure, every member, in order, by kind and name. This is what makes
//      the table in gr2-write.ts a transcription rather than an invention — and
//      it is the check that would catch a member quietly dropped or renamed.
//   2. Does a file of ours read back? Through gr2.ts, the same reader the
//      editor uses on shipped rigs, plus the header arithmetic and the CRC.
//   3. Does the clip we generate actually turn a bone? Sampled, not assumed.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GrannyFile } from '../src/format/gr2.ts';
import { GRANNY_TYPES, spinClip, writeAnimationGR2, writeSkeletonGR2 } from '../src/format/gr2-write.ts';
import { readAnimations, readSkeletons, poseWorldMatrices } from '../src/scene/animation.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const root = process.argv[2] ?? dataDir();

// ---- 1. the type library ----------------------------------------------------

// The library is stamped by the header's type tag, and two of them are in wide
// use: 2836 shipped files say 0x80000013 and 2787 say 0x80000011, with the same
// tree under both. Ours writes the commoner stamp, so that is what it is checked
// against — a file with a DIFFERENT tag has a different library and would be the
// wrong authority (0x80000010, 32 files, still has `ScalarTracks`).
const OUR_TAG = 0x80000013;

function sample(dir: string): { path: string; file: GrannyFile } | null {
  const at = join(root, 'bin', dir);
  if (!existsSync(at)) return null;
  for (const name of readdirSync(at)) {
    const file = GrannyFile.open(readFileSync(join(at, name)));
    if (file && file.typeTag === OUR_TAG) return { path: join(at, name), file };
  }
  return null;
}

/**
 * Walk both trees together from `FileInfo`, comparing member for member.
 *
 * By STRUCTURE, not by name: a type is reached by many members (a Material's
 * `Texture` and the file's `Textures` are one type), so keying a comparison on
 * the member name that got there first only compares the walk order.
 */
function compare(file: GrannyFile, theirs: { sec: number; off: number } | null, ourName: string,
  path: string, seen: Set<string>, wrong: string[]): void {
  if (!theirs) return;
  const key = `${theirs.sec}:${theirs.off}|${ourName}`;
  if (seen.has(key)) return;
  seen.add(key);
  const theirMembers = file.type(theirs);
  const ourMembers = GRANNY_TYPES[ourName];
  if (!ourMembers) { wrong.push(`${path}: we have no type ${ourName}`); return; }
  if (ourMembers.length !== theirMembers.length) {
    wrong.push(`${path}: ${ourMembers.length} members, theirs ${theirMembers.length} (${theirMembers.map((x) => x.name).join(',')})`);
    return;
  }
  for (const [i, mem] of theirMembers.entries()) {
    const o = ourMembers[i]!;
    if (o.kind !== mem.kind || o.name !== mem.name || (o.width ?? 1) !== mem.arrayWidth) {
      wrong.push(`${path}.${mem.name}: ours ${o.kind} ${o.name}[${o.width ?? 1}], theirs ${mem.kind} ${mem.name}[${mem.arrayWidth}]`);
      continue;
    }
    if (mem.refType && o.type && mem.kind !== 'String') {
      compare(file, mem.refType, o.type, `${path}.${mem.name}`, seen, wrong);
    } else if (!!mem.refType !== !!o.type && mem.kind !== 'String') {
      wrong.push(`${path}.${mem.name}: element type ${o.type ?? 'none'} vs ${mem.refType ? 'one' : 'none'}`);
    }
  }
}

for (const dir of ['Skeletons', 'animations']) {
  const found = sample(dir);
  if (!found) { console.log(`no ${dir} with tag ${OUR_TAG.toString(16)} — skipping`); continue; }
  const wrong: string[] = [];
  compare(found.file, found.file.rootType, 'FileInfo', 'FileInfo', new Set(), wrong);
  check(`${dir}: our type library is the game's, member for member`, wrong.length === 0,
    wrong.slice(0, 4).join(' · '));
}

// ---- 2. a file of ours ------------------------------------------------------

const BONE = 'PandoraBox';
const skeleton = writeSkeletonGR2('PandoraBoxRig', [{ name: BONE }]);
check('the skeleton opens as a Granny file', !!GrannyFile.open(skeleton), `${skeleton.length} bytes`);
{
  const file = GrannyFile.open(skeleton)!;
  check('its header arithmetic holds', skeleton.readUInt32LE(16) === 88 + file.sections.length * 44
    && skeleton.readUInt32LE(36) === skeleton.length);
  // The CRC rule, recomputed here rather than trusted: byte 88 to the end.
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1; table[i] = c >>> 0; }
  let c = 0xffffffff;
  for (let i = 88; i < skeleton.length; i++) c = (table[(c ^ skeleton[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  check('and its CRC is the one the header claims', ((c ^ 0xffffffff) >>> 0) === skeleton.readUInt32LE(40));
  check('nothing in it is unreadable', !file.isUnreadable);

  const bones = readSkeletons(file);
  check('one skeleton, one bone, named', bones.length === 1 && bones[0]!.bones.length === 1
    && bones[0]!.bones[0]!.name === BONE, `${bones[0]?.bones.map((b) => b.name).join(',')}`);
  const bone = bones[0]?.bones[0];
  if (bone) {
    check('the bone is a root', bone.parentIndex === -1);
    check('its rest pose is the identity',
      bone.rest.position.every((v) => v === 0) && bone.rest.orientation.join() === '0,0,0,1');
    check('and so is its inverse bind', bone.inverseWorld.every((v, i) => v === (i % 5 === 0 ? 1 : 0)));
  }
}

const SECONDS = 6;
const clip = spinClip(BONE, SECONDS, 0.2);
const animation = writeAnimationGR2('PandoraBoxSpin', clip.duration, clip.tracks);
check('the animation opens as a Granny file', !!GrannyFile.open(animation), `${animation.length} bytes`);
{
  const file = GrannyFile.open(animation)!;
  const clips = readAnimations(file);
  check('one clip, of the length asked for', clips.length === 1 && Math.abs(clips[0]!.duration - SECONDS) < 1e-5,
    `${clips[0]?.duration}s`);
  const group = clips[0]?.groups[0];
  check('one track group, one transform track, named for the bone',
    clips[0]?.groups.length === 1 && group?.tracks.length === 1 && group.tracks[0]!.name === BONE);
  const track = group?.tracks[0];
  if (track) {
    check('the orientation curve is a quaternion one', track.orientation.dim === 4,
      `${track.orientation.knots.length} knots × ${track.orientation.dim}`);
    check('the position curve carries the bob', track.position.dim === 3);
    check('its knots span the clip', Math.abs(track.orientation.knots[0]!) < 1e-6
      && Math.abs(track.orientation.knots[track.orientation.knots.length - 1]! - SECONDS) < 1e-5);
  }

  // ---- 3. does it turn? -----------------------------------------------------
  const skel = readSkeletons(GrannyFile.open(skeleton)!)[0]!;
  const yawAt = (t: number): number => {
    const world = poseWorldMatrices(skel, clips[0]!, t)[0]!;
    // Row-major, row-vector convention: the first row is where +X went.
    return Math.atan2(world[1]!, world[0]!) * 180 / Math.PI;
  };
  const turns = [0, 0.25, 0.5, 0.75].map((f) => yawAt(SECONDS * f));
  const wrapped = turns.map((deg, i) => {
    const want = i * 90;
    let d = deg - want;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
  });
  check('a quarter of the clip is a quarter turn, all the way round',
    Math.max(...wrapped) < 1.5, `off by ${Math.max(...wrapped).toFixed(2)}°`);
  // Sabotage's counterpart: a clip that did nothing would sit at 0° throughout,
  // so the check has to see the movement rather than only its shape.
  check('and the turn is real, not a still frame', Math.abs(turns[1]! - turns[0]!) > 45,
    `${turns.map((t) => t.toFixed(0)).join('° → ')}°`);

  const heights = [0, 0.25, 0.5, 0.75].map((f) => poseWorldMatrices(skel, clips[0]!, SECONDS * f)[0]![14]!);
  check('and it rises and falls', Math.max(...heights) - Math.min(...heights) > 0.3,
    heights.map((h) => h.toFixed(3)).join(' '));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall good');
process.exit(failures ? 1 : 0);
