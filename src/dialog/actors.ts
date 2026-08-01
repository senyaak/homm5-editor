// An actor on a scene's stage, with the clips that scene asks of them.
//
// On the adventure map a hero is a small model with one animation — `idle00`,
// out of `*_LOD-adv`. A SCENE plays something else entirely: the shots name
// `move`, `happy`, `speech_knee`, `death`, clips that set does not have. They
// come from the ARENA character, which every hero shared names beside its
// adventure one:
//
//     AdvMapHeroShared → HeroCharacterArena → *.(Character).xdb
//                                              ├── Model         (the full mesh)
//                                              └── ArenaAnimSet  (17 clips)
//
// So an actor is resolved twice over: the map's copy decides WHERE they stand,
// the arena character decides what is drawn and what it can do. Nothing here
// touches the adventure-map path — `src/scene/skin.ts` still reads idle and
// only idle, and a map is drawn exactly as before.
//
// Only the clips a scene actually names are baked. A hero's arena set holds
// seventeen; C1M1's opening asks four of them of Isabell, and baking the rest
// would be thirteen Granny files read to be thrown away.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Assets } from '../game/assets.ts';
import { GrannyFile } from '../format/gr2.ts';
import { bakeClip, inverseBindMatrices, readAnimations, readSkeletons } from '../scene/animation.ts';
import type { BakedClip } from '../scene/animation.ts';
import { decodeModelGeom } from '../scene/model-geom.ts';
import type { GeomData } from '../scene/payload.ts';
import { modelBindSkeleton } from '../scene/skin.ts';
import { dirOf, resolveHref } from '../scene/xdb.ts';
import type { DialogScene } from './dialog-scene.ts';
import type { StageObject } from './stage.ts';

/** A scene actor: their arena mesh, and the clips this scene plays on it. */
export interface ActorRig {
  /** The link the shots address them by — the key everything else joins on. */
  href: string;
  /** The element id an inline actor's cues address them by, when it has one. */
  id: string | null;
  /** Their arena mesh, skinned. */
  geom: GeomData;
  /** Baked clips by kind. Always holds `idle00` when the set has one. */
  clips: Record<string, BakedClip>;
  /** Every kind the arena set offers, whether baked or not — for the UI. */
  available: string[];
  /** What the scene asked for and the set does not have. */
  missing: string[];
}

/**
 * The clip kinds a scene plays on each actor.
 *
 * Keyed by the link as written AND, where a cue addresses an actor by element
 * id (`#xpointer(id(item_48F7…)/AdvMapHero)`), by that id — two inline actors
 * share one href, so the id is the only thing that tells them apart. Keying by
 * href alone left every inline actor's clips unbaked and standing in idle.
 */
export function clipsWanted(scene: DialogScene): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const want = (link: string, kind: string): void => {
    if (!link || !kind) return;
    const key = /#xpointer\(id\(([^)]+)\)/.exec(link)?.[1] ?? link;
    const set = out.get(key) ?? new Set<string>();
    set.add(kind);
    out.set(key, set);
  };
  for (const shot of scene.shots) {
    const speaker = shot.heroLink || shot.monsterLink;
    // A shot's own clip belongs to whoever speaks it. The name is usually
    // empty and the INDEX is what points into the actor's set, so an index is
    // resolved later against the kinds the set turns out to hold.
    if (shot.animName) want(speaker, shot.animName);
    for (const anim of shot.animations) {
      want(anim.heroLink || anim.monsterLink || speaker, anim.animName);
    }
  }
  return out;
}

/** The `<Character>` a shared plays in an arena — a scene is an arena. */
function arenaCharacter(data: Assets, sharedHref: string): { xml: string; rel: string } | null {
  const shared = data.text(resolveHref('', sharedHref));
  if (!shared) return null;
  const href = shared.match(/<HeroCharacterArena href="([^"]+)"/)?.[1]
    // A monster has no hero character; its combat body is the shared's own.
    ?? shared.match(/<Character href="([^"]+)"/)?.[1];
  if (!href) return null;
  const rel = resolveHref(dirOf(resolveHref('', sharedHref)), href);
  const xml = data.text(rel);
  return xml ? { xml, rel } : null;
}

/** Every `<Kind>` an AnimSet lists, with the href of its animation. */
function clipIndex(setXml: string, setDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const block = setXml.match(/<animations>([\s\S]*?)<\/animations>/)?.[1] ?? '';
  const re = /<Kind>([^<]*)<\/Kind>[\s\S]*?<Anim href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.set(m[1]!, resolveHref(setDir, m[2]!));
  return out;
}

/** Read and bake one clip, or null when anything along the chain is missing. */
function bake(
  data: Assets, animPath: string, model: { xml: string; rel: string }, fps: number,
): { clip: BakedClip; bones: GeomData['skin']; scale: number } | null {
  const uid = data.text(animPath)?.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
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
  // the pose the mesh was skinned in (src/scene/skin.ts says what that costs).
  const skeleton = modelBindSkeleton(model, data, animation) ?? own;
  return {
    clip: bakeClip(skeleton, animation, fps),
    // The DISPLAY SCALE rides on the clip skeleton's root, as it does for a
    // creature on the map: the mesh is authored at one size and the game shows
    // it through the rig. An arena hero comes out ten times too big without it
    // — a boot filling the frame is what that looks like.
    scale: Number(own.bones[0]?.rest.scaleShear?.[0] ?? 1) || 1,
    bones: {
      index: [], weight: [],
      bones: skeleton.bones.map((b) => ({
        name: b.name, parent: b.parentIndex,
        pos: b.rest.position.map((v) => +v.toFixed(5)),
        quat: b.rest.orientation.map((v) => +v.toFixed(6)),
      })),
      bind: inverseBindMatrices(skeleton).map((m) => m.map((v) => +v.toFixed(6))),
      clip: null,
    },
  };
}

export interface ActorOptions {
  /** Samples per second when baking (default 15, as the map's idle uses). */
  fps?: number;
  texSize?: number;
}

/**
 * The rigs for a scene's actors: arena mesh plus the clips the scene names.
 *
 * `stage` is what `stageObjects` returned — the actors among it are the ones
 * with a role of 'actor', already resolved to where they stand.
 */
export function actorRigs(
  data: Assets, scene: DialogScene, stage: StageObject[], options: ActorOptions = {},
): ActorRig[] {
  const fps = options.fps ?? 15;
  const texSize = options.texSize ?? 128;
  const wanted = clipsWanted(scene);
  const readXdb = (href: string): string | null => data.text(href.split('#')[0]!.replace(/^\//, ''));
  const rigs: ActorRig[] = [];

  for (const item of stage) {
    if (item.role !== 'actor') continue;
    const sharedHref = item.object.shared;
    const character = sharedHref ? arenaCharacter(data, sharedHref) : null;
    if (!character) continue;

    const modelHref = character.xml.match(/<Model href="([^"]+)"/)?.[1];
    const modelRel = modelHref ? resolveHref(dirOf(character.rel), modelHref) : null;
    const modelXml = modelRel ? data.text(modelRel) : null;
    if (!modelRel || !modelXml) continue;
    const geom = decodeModelGeom(modelXml, `/${modelRel}`, data, readXdb, texSize, { skin: true });
    if (!geom?.skin) continue;

    const setHref = character.xml.match(/<ArenaAnimSet href="([^"]+)"/)?.[1];
    const setRel = setHref ? resolveHref(dirOf(character.rel), setHref) : null;
    const setXml = setRel ? data.text(setRel) : null;
    const kinds = setXml ? clipIndex(setXml, dirOf(setRel!)) : new Map<string, string>();

    // Always the idle: it is what an actor does between the moments a scene
    // gives them something to do, and 1001 shots name it outright.
    const ask = new Set<string>([
      'idle00',
      ...(wanted.get(item.href) ?? []),
      ...(item.id ? wanted.get(item.id) ?? [] : []),
    ]);
    const clips: Record<string, BakedClip> = {};
    const missing: string[] = [];
    let bones: GeomData['skin'] | null = null;
    let scale = 1;
    for (const kind of ask) {
      const path = kinds.get(kind);
      if (!path) { if (kind !== 'idle00') missing.push(kind); continue; }
      const baked = bake(data, path, { xml: modelXml, rel: modelRel }, fps);
      if (!baked) { missing.push(kind); continue; }
      clips[kind] = baked.clip;
      if (!bones) { bones = baked.bones; scale = baked.scale; }
    }
    if (!bones) continue;

    // The mesh's bone indices only mean anything against this bone list; a
    // mismatch does not look like a small error, it tears the model apart.
    if (geom.skin.index.some((b) => b >= bones.bones.length)) continue;
    geom.skin.bones = bones.bones;
    geom.skin.bind = bones.bind;
    geom.skin.clip = clips['idle00'] ?? Object.values(clips)[0] ?? null;
    if (scale !== 1) geom.scale = scale;

    rigs.push({ href: item.href, id: item.id, geom, clips, available: [...kinds.keys()], missing });
  }
  return rigs;
}
