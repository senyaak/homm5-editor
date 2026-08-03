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

import type { Assets } from '../game/assets.ts';
import type { BakedClip } from '../scene/animation.ts';
import { decodeModelGeom } from '../scene/model-geom.ts';
import type { GeomData } from '../scene/payload.ts';
import { bakeCharacterClip } from '../scene/skin.ts';
import type { BakedRig } from '../scene/skin.ts';
import { dirOf, resolveHref } from '../scene/xdb.ts';
import { colourModelHref, colourOfPlayer } from '../scene/colour-models.ts';
import type { DialogScene } from './dialog-scene.ts';
import type { StageObject } from './stage.ts';

/** A scene actor: their arena mesh, and the clips this scene plays on it. */
export interface ActorRig {
  /** The name everything joins on — see `actorRef` in dialog-scene.ts. */
  key: string;
  /** The link as written, for the inspector. */
  href: string;
  /** The element id an inline actor's cues address them by, when it has one. */
  id: string | null;
  /** Their arena mesh, skinned. */
  geom: GeomData;
  /**
   * The model that mesh came out of, as a data-root path.
   *
   * Worth carrying because the character alone does not decide it: a hero has
   * nine bodies and the one drawn is his owner's colour (src/scene/colour-
   * models.ts). Two figures of the same class in one scene can be two different
   * models, and this says which.
   */
  model: string;
  /** Baked clips by kind. Always holds `idle00` when the set has one. */
  clips: Record<string, BakedClip>;
  /** Every kind the arena set offers, whether baked or not — for the UI. */
  available: string[];
  /**
   * The effect a clip brings with it, by kind, as a data-root path.
   *
   * A clip is not only movement: `BasicSkelAnim` names an `<Effect>` beside its
   * Granny file, and that is where a spell's own fire lives — the blue glow that
   * runs up a knight's sword as he casts is `Characters/Heroes/Knight/buff.xdb`,
   * named by the `buff` clip and by nothing in the scene. 45 of the 132 cues in
   * C1M1's opening play a clip that carries one, so a third of what the scene
   * does was happening in silence.
   */
  clipEffects: Record<string, string>;
  /**
   * How fast a clip carries the actor over the ground, in world units a second.
   *
   * On the CLIP, not on the cue: every one of the 922 walks in the shipped
   * scenes writes `MovementSpeed` 0 and leaves the pace to `move` itself, which
   * declares it (`<MovementSpeed>` on the BasicSkelAnim, 5.7 for a footman,
   * 9.29 for a demon lord). `SpeedFactor` is folded in — it is the rate the
   * engine plays the clip at, and the two have to agree or the feet slide.
   */
  clipSpeed: Record<string, number>;
  /** What the scene asked for and the set does not have. */
  missing: string[];
}

/** What one actor is asked to play: clips by name, and clips by set position. */
export interface Wanted {
  names: Set<string>;
  indices: Set<number>;
}

/**
 * The clip kinds a scene plays on each actor.
 *
 * Keyed by `actorRef` — the element id where an actor has one, the href where
 * that is all there is. Two inline actors share one href, so keying by href
 * left every inline actor's clips unbaked and standing in idle.
 *
 * A cue names its clip one of two ways and a scene uses both: `AnimName`, or
 * `ActorAnimationIndex` / `AnimationIndex` — a position in the actor's own
 * AnimSet. The index is by far the commoner of the two (C1M1's opening writes a
 * name in 39 of its 73 shots and an index in every one of them, and every
 * animation it gives to the armies is an index and nothing else), so reading
 * only the names left the heroes standing still through most of the scene and
 * the armies through all of it. Which position means which clip cannot be known
 * here — it depends on the actor — so indices are carried and resolved in
 * `actorRigs`, where the set is open.
 */
export function clipsWanted(scene: DialogScene): Map<string, Wanted> {
  const out = new Map<string, Wanted>();
  const at = (key: string): Wanted | null => {
    if (!key) return null;
    const known = out.get(key) ?? { names: new Set<string>(), indices: new Set<number>() };
    out.set(key, known);
    return known;
  };
  const want = (key: string, kind: string, index: number): void => {
    const w = at(key);
    if (!w) return;
    // The name wins where both are written. It has to: an index left over from
    // an earlier edit is common (of the 590 cues that write both a name and a
    // non-zero index, 56 disagree, and 4008 more write index 0 beside a name
    // that is not the set's first clip), and the name is never stale.
    if (kind) w.names.add(kind);
    else if (index >= 0) w.indices.add(index);
  };
  for (const shot of scene.shots) {
    want(shot.actor, shot.animName, shot.actorAnimationIndex);
    for (const anim of shot.animations) {
      want(anim.actor || shot.actor, anim.animName, anim.animationIndex);
    }
  }
  return out;
}

/** Creature enum -> its `Creature` document, read once per asset chain. */
const creatureTables = new WeakMap<Assets, Map<string, string>>();
function creatureTable(data: Assets): Map<string, string> {
  let table = creatureTables.get(data);
  if (!table) {
    table = new Map<string, string>();
    const xml = data.text('GameMechanics/RefTables/Creatures.xdb') ?? '';
    for (const m of xml.matchAll(/<ID>([^<]+)<\/ID>\s*<Obj href="([^"]+)"/g)) table.set(m[1]!, m[2]!);
    creatureTables.set(data, table);
  }
  return table;
}

/**
 * The `<Character>` a shared plays in an arena — a scene is an arena.
 *
 * A hero's shared names theirs outright. A MONSTER's does not: an
 * AdvMapMonsterShared carries an adventure model and a `<Creature>` enum, and
 * the arena body is four documents away —
 *
 *     <Creature> -> Creatures.xdb -> Creature.Visual -> CreatureVisual.AnimCharacter
 *
 * which is worth following, because the armies standing behind the two heroes
 * are most of what a scene animates.
 */
function arenaCharacter(data: Assets, sharedHref: string): { xml: string; rel: string } | null {
  const sharedRel = resolveHref('', sharedHref);
  const shared = data.text(sharedRel);
  if (!shared) return null;
  let base = sharedRel;
  let href = shared.match(/<HeroCharacterArena href="([^"]+)"/)?.[1]
    ?? shared.match(/<Character href="([^"]+)"/)?.[1];
  if (!href) {
    const creature = shared.match(/<Creature>([^<]+)<\/Creature>/)?.[1];
    const entry = creature ? creatureTable(data).get(creature) : null;
    const creatureRel = entry ? resolveHref('', entry) : null;
    const visual = creatureRel ? data.text(creatureRel)?.match(/<Visual href="([^"]+)"/)?.[1] : null;
    const visualRel = visual && creatureRel ? resolveHref(dirOf(creatureRel), visual) : null;
    const anim = visualRel ? data.text(visualRel)?.match(/<AnimCharacter href="([^"]+)"/)?.[1] : null;
    if (anim && visualRel) { href = anim; base = visualRel; }
  }
  if (!href) return null;
  const rel = resolveHref(dirOf(base), href);
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

export interface ActorOptions {
  /** Samples per second when baking (default 15, as the map's idle uses). */
  fps?: number;
  texSize?: number;
}

/**
 * The rigs for a scene's actors: arena mesh plus the clips the scene names.
 *
 * `stage` is what `stageObjects` returned. An ACTOR is anyone the scene moves,
 * not only whoever speaks: the shots hand out animations to the armies drawn up
 * behind the two heroes — sixteen of them in one shot of C1M1's opening, saluting
 * their commander on a three-second delay — and each of those is a `<objects>`
 * entry that would otherwise stand in the crowd's shared idle.
 */
export function actorRigs(
  data: Assets, scene: DialogScene, stage: StageObject[], options: ActorOptions = {},
): ActorRig[] {
  const fps = options.fps ?? 15;
  const texSize = options.texSize ?? 128;
  const wanted = clipsWanted(scene);
  const readXdb = (href: string): string | null => data.text(href.split('#')[0]!.replace(/^\//, ''));

  /** One character's parts, read once however many figures of it are on stage. */
  interface Cast {
    modelRel: string;
    modelXml: string;
    /** Clip kind -> the animation's path. */
    kinds: Map<string, string>;
    /** Kind names in set order — what an animation INDEX counts along. */
    order: string[];
    /** Every clip anyone on stage plays on it, gathered before any is baked. */
    ask: Set<string>;
    on: StageObject[];
  }

  // Six swordsmen of one kind stand in a line and three of them are cued in the
  // same shot. They are one mesh and one set of clips: read per CHARACTER, not
  // per figure, or the same Granny file is decoded six times and sent to the
  // renderer six times over (the payload for C1M1's opening triples).
  const cast = new Map<string, Cast>();
  const casting: Cast[] = [];
  for (const item of stage) {
    const asked = [wanted.get(item.key)].filter((w) => !!w);
    if (item.role !== 'actor' && !asked.length) continue;
    const sharedHref = item.object.shared;
    const character = sharedHref ? arenaCharacter(data, sharedHref) : null;
    if (!character) continue;

    // A hero's body comes in nine colours and the top-level <Model> is the
    // WHITE one (src/scene/colour-models.ts), so the character alone does not
    // identify a mesh — Agrael and Isabell are the same Knight or DemonLord
    // document in two different bodies. The colour joins the key.
    const colour = colourOfPlayer(item.object.player);
    const castKey = `${character.rel}|${colour}`;
    let part = cast.get(castKey);
    if (!part) {
      const modelHref = colourModelHref(character.xml, colour)
        ?? character.xml.match(/<Model href="([^"]+)"/)?.[1];
      const modelRel = modelHref ? resolveHref(dirOf(character.rel), modelHref) : null;
      const modelXml = modelRel ? data.text(modelRel) : null;
      if (!modelRel || !modelXml) continue;
      const setHref = character.xml.match(/<ArenaAnimSet href="([^"]+)"/)?.[1];
      const setRel = setHref ? resolveHref(dirOf(character.rel), setHref) : null;
      const setXml = setRel ? data.text(setRel) : null;
      const kinds = setXml ? clipIndex(setXml, dirOf(setRel!)) : new Map<string, string>();
      // Always the idle: it is what an actor does between the moments a scene
      // gives them something to do, and 1001 shots name it outright.
      part = { modelRel, modelXml, kinds, order: [...kinds.keys()], ask: new Set(['idle00']), on: [] };
      cast.set(castKey, part);
      casting.push(part);
    }
    part.on.push(item);
    for (const w of asked) {
      for (const name of w.names) part.ask.add(name);
      // The set's own order is what an index counts along — measured, not
      // assumed: of the 590 cues writing both a non-zero index and a name, 534
      // land on the same clip this way against 383 for the other candidate
      // (alphabetical), and the misses are stale indices beside a newer name.
      for (const i of w.indices) if (part.order[i]) part.ask.add(part.order[i]!);
    }
  }

  const rigs: ActorRig[] = [];
  for (const part of casting) {
    const { modelRel, modelXml } = part;
    const geom = decodeModelGeom(modelXml, `/${modelRel}`, data, readXdb, texSize, { skin: true });
    if (!geom?.skin) continue;

    const clips: Record<string, BakedClip> = {};
    const clipEffects: Record<string, string> = {};
    const clipSpeed: Record<string, number> = {};
    const missing: string[] = [];
    let rig: BakedRig | null = null;
    let scale = 1;
    for (const kind of part.ask) {
      const path = part.kinds.get(kind);
      if (!path) { if (kind !== 'idle00') missing.push(kind); continue; }
      const animXml = data.text(path);
      const baked = animXml ? bakeCharacterClip(data, animXml, { xml: modelXml, rel: modelRel }, fps) : null;
      if (!baked) { missing.push(kind); continue; }
      clips[kind] = baked.clip;
      const effect = animXml?.match(/<Effect href="([^"]+)"/)?.[1];
      // Kept as a data-root path so the caller can resolve it without knowing
      // which folder the clip came from — a scene's own effects are written
      // that way too, and both go through the same reader.
      if (effect) clipEffects[kind] = '/' + resolveHref(dirOf(path), effect);
      const pace = +(animXml?.match(/<MovementSpeed>([-+.\deE]+)</)?.[1] ?? 0);
      const rate = +(animXml?.match(/<SpeedFactor>([-+.\deE]+)</)?.[1] ?? 1) || 1;
      if (pace > 0) clipSpeed[kind] = pace * rate;
      if (!rig) { rig = baked; scale = baked.scale; }
    }
    if (!rig) continue;

    // The mesh's bone indices only mean anything against this bone list; a
    // mismatch does not look like a small error, it tears the model apart.
    if (geom.skin.index.some((b) => b >= rig.bones.length)) continue;
    geom.skin.bones = rig.bones;
    geom.skin.bind = rig.bind;
    geom.skin.clip = clips['idle00'] ?? Object.values(clips)[0] ?? null;
    if (scale !== 1) geom.scale = scale;

    // One rig per figure, but `geom` and `clips` are the SAME objects in each:
    // structured clone keeps shared references shared, so the payload carries
    // the mesh once, and the renderer can build one THREE geometry for all.
    for (const item of part.on) {
      rigs.push({
        key: item.key, href: item.href, id: item.id, model: part.modelRel,
        geom, clips, clipEffects, clipSpeed, available: part.order, missing,
      });
    }
  }
  return rigs;
}
