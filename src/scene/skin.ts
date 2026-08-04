// Hanging an animation on a decoded model: the skin binding from the model's
// own Granny file, and the idle clip its <AnimSet> names, baked onto an even
// grid the renderer can play without knowing what Granny is.
//
// Only walked when the caller asks for animation — a still map pays for none
// of it (see SceneAnimationOptions).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GrannyFile } from '../format/gr2.ts';
import { bakeClip, inverseBindMatrices, readAnimations, readSkeletons } from './animation.ts';
import { followHref, listItems, resolveHref, dirOf } from './xdb.ts';
import type { Assets } from '../game/assets.ts';
import type { ReadXdb } from './xdb.ts';
import type { Animation, BakedClip, Skeleton } from './animation.ts';
import type { GeomData } from './payload.ts';


/** Worst bone rotation between consecutive baked samples, in degrees. */
function worstSampleStep(clip: BakedClip): number {
  const n = clip.times.length;
  let worst = 0;
  for (const r of clip.rotations) {
    if (!r.length) continue;
    for (let k = 0; k + 1 < n; k++) {
      const dot = Math.abs(
        r[k * 4]! * r[k * 4 + 4]! + r[k * 4 + 1]! * r[k * 4 + 5]!
        + r[k * 4 + 2]! * r[k * 4 + 6]! + r[k * 4 + 3]! * r[k * 4 + 7]!);
      const angle = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
      if (angle > worst) worst = angle;
    }
  }
  return worst;
}

/**
 * The model's OWN skeleton — the bind pose — from `bin/Skeletons`.
 *
 * The skeleton inside an animation file holds the pose its clip STARTS from,
 * not the pose the mesh was skinned in. Inverse binds built from it look right
 * exactly as long as the clip starts near the bind pose — most adventure idles
 * do — and tear the mesh apart when it does not: the addon creatures' stances
 * sit up to 167 degrees away (Combat Mage), which shredded the Air Elemental
 * into loose chunks. The model names its true bind skeleton right beside its
 * geometry, so that is the copy to skin against; tracks bind by name, so the
 * clip plays on it all the same.
 *
 * The two rigs do NOT have to be the same: a Footman's arena clip carries 45
 * bones against the model's 39 — the extras are combat props — and tracks bind
 * by name, so the clip plays on the model's rig with the surplus ignored. What
 * IS required is that the clip actually addresses this rig: with under half
 * the bones tracked the naming schemes clearly differ, everything would freeze
 * at rest, and the animation's own copy is the safer bet.
 *
 * Null when the model declares no skeleton, the file is absent or unreadable,
 * or the coverage test fails — every case falls back to the animation's copy,
 * which is what all of this behaved like before.
 */
export function modelBindSkeleton(
  model: { xml: string; rel: string } | null, data: Assets, animation: Animation,
): Skeleton | null {
  if (!model) return null;
  try {
    // The uid is inline in some models and behind a <Skeleton href> in others.
    let uid = model.xml.match(/<Skeleton\b[\s\S]*?<uid>([0-9A-Fa-f-]{36})<\/uid>[\s\S]*?<\/Skeleton>/)?.[1];
    if (!uid) {
      const href = model.xml.match(/<Skeleton href="([^"]+)"/)?.[1];
      const doc = href ? followHref(data, model.xml, dirOf(resolveHref('', model.rel)), href) : null;
      uid = doc?.xml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
    }
    if (!uid) return null;
    const path = data.path(join('bin', 'Skeletons', uid.toUpperCase()));
    if (!existsSync(path)) return null;
    const file = GrannyFile.open(readFileSync(path));
    if (!file || file.isUnreadable) return null;
    const skeleton = readSkeletons(file)[0];
    if (!skeleton?.bones.length) return null;
    const tracked = new Set(animation.groups.flatMap((g) => g.tracks.map((t) => t.name)));
    const covered = skeleton.bones.filter((b) => tracked.has(b.name)).length;
    if (covered * 2 < skeleton.bones.length) return null;
    return skeleton;
  } catch { return null; }
}

/**
 * Fill in a skinned geom's bones and clip, or drop the binding when there is no
 * animation to play.
 *
 * The link is declared, not guessed: a shared that animates names its
 * `<AnimSet href>` right beside its `<Model href>`. The set lists clips by kind,
 * and an adventure-map set normally holds exactly one — `idle00`.
 *
 * Anything missing along the way (no set, a compressed animation file, a bone
 * index the skeleton does not have) drops `skin` entirely, so the object falls
 * back to the still mesh it has always drawn rather than to a broken one.
 */
export function attachAnimation(
  geom: GeomData, sharedXml: string, sharedHref: string, data: Assets, readXdb: ReadXdb, fps: number,
  model: { xml: string; rel: string } | null = null,
): void {
  const drop = (): void => { delete geom.skin; };
  if (!geom.skin) return;
  try {
    // A model that declares NO skeleton is not skinned, whatever its AnimSet
    // says: the Gold Mine ships a seven-bone idle clip AND an empty
    // <Skeleton/>, and skinning its meshes against the clip's own skeleton
    // scattered the gold across the hill. Declared-but-unreadable is different
    // and falls back below.
    if (model) {
      const decl = model.xml.match(/<Skeleton\b[^>]*>/)?.[0];
      if (!decl || (decl.endsWith('/>') && !decl.includes('href'))) return drop();
    }
    const setHref = sharedXml.match(/<AnimSet href="([^"]+)"/)?.[1];
    const sharedDir = dirOf(resolveHref('', sharedHref));
    const set = setHref ? followHref(data, sharedXml, sharedDir, setHref) : null;
    if (!set) return drop();
    // Prefer idle00; take any idle if a set names them differently.
    const items = listItems(set.xml.match(/<animations>([\s\S]*?)<\/animations>/)?.[1] ?? '');
    const idle = items.find((i) => /<Kind>idle00<\/Kind>/.test(i.body))
      ?? items.find((i) => /<Kind>idle/.test(i.body));
    const animHref = idle?.body.match(/<Anim href="([^"]+)"/)?.[1];
    const anim = animHref ? followHref(data, set.xml, set.dir, animHref) : null;
    const uid = anim?.xml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
    if (!uid) return drop();
    const binPath = data.path(join('bin', 'animations', uid.toUpperCase()));
    if (!existsSync(binPath)) return drop();
    const file = GrannyFile.open(readFileSync(binPath));
    if (!file || file.isUnreadable) return drop();
    const animation = readAnimations(file)[0];
    const animSkeleton = readSkeletons(file)[0];
    if (!animSkeleton?.bones.length || !animation) return drop();
    // The BIND pose, preferably the model's own — see modelBindSkeleton.
    const skeleton = modelBindSkeleton(model, data, animation) ?? animSkeleton;
    // The mesh's bone indices only mean anything against THIS bone list. They
    // are checked rather than trusted: a mismatch would not look like a subtle
    // error, it would tear the model apart.
    if (geom.skin.index.some((b) => b >= skeleton.bones.length)) return drop();

    geom.skin.bones = skeleton.bones.map((b) => ({
      name: b.name,
      parent: b.parentIndex,
      pos: b.rest.position.map((v) => +v.toFixed(5)),
      quat: b.rest.orientation.map((v) => +v.toFixed(6)),
    }));
    // Handed over element for element, deliberately. Ours are row-vector
    // matrices stored row-major (translation in the last row); three.js wants
    // the column-vector form stored COLUMN-major, and the two differ by a
    // transpose twice over — so the arrays are byte-identical and transposing
    // "into three.js's convention" transposes it out of it. Measured, not
    // reasoned: transposing here put the translation in the wrong column and
    // threw vertices 1100 units off a 4-unit model (tools/test-idle.ts).
    geom.skin.bind = inverseBindMatrices(skeleton).map((m) => m.map((v) => +v.toFixed(6)));
    // A fast bone can turn most of the way round between two samples at the
    // default rate — the Air Elemental's vortex does 171° per 15fps step, and
    // slerp between such samples takes the short way each time, which reads as
    // jerking. Resample faster until steps are sane; the payload only grows
    // for the clips that need it.
    let clip = bakeClip(skeleton, animation, fps, animSkeleton);
    for (let f = fps * 2; f <= 60 && worstSampleStep(clip) > 45; f *= 2) {
      clip = bakeClip(skeleton, animation, f, animSkeleton);
    }
    geom.skin.clip = {
      duration: clip.duration,
      times: clip.times.map((v) => +v.toFixed(4)),
      rotations: clip.rotations.map((r) => r.map((v) => +v.toFixed(5))),
      positions: clip.positions.map((p) => p.map((v) => +v.toFixed(4))),
      // Only the clips that leave unit scale carry this at all (bakeClip), so
      // rounding a copy that is not there must not invent one.
      ...(clip.scales ? { scales: clip.scales.map((s) => s.map((v) => +v.toFixed(4))) } : {}),
    };
  } catch { drop(); }
}

/** One clip baked against a model's bind pose, with the rig it plays on. */
export interface BakedRig {
  clip: BakedClip;
  bones: NonNullable<GeomData['skin']>['bones'];
  bind: number[][];
  /** The display scale the clip's own root carries — see below. */
  scale: number;
}

/**
 * Bake a named clip onto a model, given the clip's own `BasicSkelAnim`.
 *
 * `attachAnimation` above does this for the ONE clip an adventure object idles
 * with, and finds it by walking the shared's AnimSet. Two callers need the same
 * work for a clip they already hold the document of and for several clips of
 * one model: a scene's actors (any of seventeen arena clips) and an effect's
 * `<Models>` (each names a `<SkelAnim>` of its own). They bake the same way or
 * they drift, so the walking and the baking are separate calls.
 *
 * Null whenever the chain breaks — no uid, no file in `bin/animations`, a
 * Granny file that will not open, an empty skeleton.
 */
export function bakeCharacterClip(
  data: Assets, animXml: string, model: { xml: string; rel: string } | null, fps: number,
): BakedRig | null {
  const uid = animXml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
  if (!uid) return null;
  const bin = data.path(join('bin', 'animations', uid.toUpperCase()));
  if (!existsSync(bin)) return null;
  const file = GrannyFile.open(readFileSync(bin));
  if (!file || file.isUnreadable) return null;
  const animation = readAnimations(file)[0];
  const own = readSkeletons(file)[0];
  if (!animation || !own?.bones.length) return null;
  // The bind pose is the MODEL's when it has one — the clip's own skeleton is
  // the pose the clip starts from, and for an arena clip that is nowhere near
  // the pose the mesh was skinned in (modelBindSkeleton says what that costs).
  const skeleton = modelBindSkeleton(model, data, animation) ?? own;
  return {
    // Bind from the model's skeleton, stance from the clip's own — see bakeClip
    // on why the two must not be conflated (the flat-skinned path props).
    clip: bakeClip(skeleton, animation, fps, own),
    // The DISPLAY SCALE rides on the clip skeleton's root, as it does for a
    // creature on the map: the mesh is authored at one size and the game shows
    // it through the rig. An arena hero comes out ten times too big without it
    // — a boot filling the frame is what that looks like.
    scale: Number(own.bones[0]?.rest.scaleShear?.[0] ?? 1) || 1,
    bones: skeleton.bones.map((b) => ({
      name: b.name, parent: b.parentIndex,
      pos: b.rest.position.map((v) => +v.toFixed(5)),
      quat: b.rest.orientation.map((v) => +v.toFixed(6)),
    })),
    bind: inverseBindMatrices(skeleton).map((m) => m.map((v) => +v.toFixed(6))),
  };
}
