// An object's <Effect>, resolved into something the scene can show.
//
// Two products, from one chain:
//
//   Shared -> Effect -> Instances[] -> ParticleInstance -> Textures[] + Particle
//
// FxInstancePayload[] is the effect as the renderer PLAYS it — the baked keys
// themselves stay in bin/effects and travel over map:fx (see effects.ts). The
// other is a textured card at the size the particle declares, plus any models
// the effect places: what the editor shows when the payload is not wanted or
// does not resolve. A faithful particle system is a large piece of work and the
// wrong one for a map editor — what an editor needs is for the thing to be
// visible, selectable and movable, and a card using the effect's OWN texture is
// recognisable at a glance and honest about being a stand-in.
//
// Neither is optional decoration: 616 shipped objects reference an effect and
// 319 of them have no model at all, so without this they are absent from the
// scene rather than merely unanimated.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GrannyFile } from '../format/gr2.ts';
import { pngDataUri } from '../format/png.ts';
import { readAnimations, readSkeletons } from './animation.ts';
import { particleTextureUris, textureDataUri } from './materials.ts';
import { decodeModelGeom, transformGeom } from './model-geom.ts';
import { bakeCharacterClip } from './skin.ts';
import type { BakedRig } from './skin.ts';
import { followHref, listItems, readAsset, readVec3, readQuat, resolveHref, dirOf } from './xdb.ts';
import type { Assets } from '../game/assets.ts';
import type { ReadXdb } from './xdb.ts';
import type { GeomData, FxInstancePayload } from './payload.ts';

// `<Model/>` empty and everything visible about the object a particle effect is
// the ordinary case here, not the corner one — the anti-magic garrison wall is
// one of the 319.
//
// The Particle's <Bound> is 28 bytes of hex: seven floats, centre then size
// then radius, confirmed on all 1055 shipped particles (the radius matches the
// half-diagonal of the size). Only the SIZE is used. The centre is in the
// coordinates of whatever scene the effect was authored in — the siege effects
// sit around (320, 284) — so honouring it would fling half the placeholders
// across the map.

/**
 * Edge of one particle FRAME, which is the model cap's business and not the
 * caller's: the renderer packs a frame table into an atlas of 128-wide cells
 * (viewport/particles.ts), so a frame decoded any larger is only scaled back
 * down by a canvas — paid for once in the payload and again in the atlas. A
 * puff of smoke is also the last thing in a scene that wants a hero's texel
 * budget.
 */
const PARTICLE_FRAME = 128;

/** Size of a particle's bounding box, from the hex-packed <Bound>. */
function particleBound(xml: string): [number, number, number] | null {
  const hex = xml.match(/<Bound>([0-9a-fA-F]{56})<\/Bound>/)?.[1];
  if (!hex) return null;
  const b = Buffer.from(hex, 'hex');
  return [b.readFloatLE(12), b.readFloatLE(16), b.readFloatLE(20)];
}

/**
 * The warm radial card standing in for a light-only effect (see the Lights
 * branch in effectGeom). Painted procedurally — there is no particle texture
 * to borrow — and drawn additive, like every particle stand-in.
 */
export function lightGlowCard(): GeomData {
  const S = 32;
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = (1 - d) * (1 - d); // the same falloff the baked pools use
      const at = (y * S + x) * 4;
      px[at] = 255; px[at + 1] = 190; px[at + 2] = 90; px[at + 3] = Math.round(a * 255);
    }
  }
  const t = pngDataUri(S, S, px);
  const hw = 1.5, h = 3; // reads as a small fire glow, about a tile wide
  return {
    pos: [-hw, 0, 0, hw, 0, 0, hw, 0, h, -hw, 0, h],
    uv: [0, 1, 1, 1, 1, 0, 0, 0],
    nrm: [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    idx: [0, 1, 2, 0, 2, 3],
    parts: [{ start: 0, count: 6, tex: t, alphaMode: 'AM_TRANSPARENT', projectOnTerrain: false, flat: false, opaque: false, terrainProjected: false, additive: true, selfIllum: true }],
  };
}

/**
 * A stand-in card for an object whose only content is an effect.
 *
 * Returns null when the chain does not lead to a texture, so the object stays
 * skipped rather than becoming an untextured rectangle.
 */
export function effectGeom(
  sharedXml: string, sharedHref: string, data: Assets, texSize: number,
): GeomData | null {
  const follow = (xml: string, dir: string, href: string) => followHref(data, xml, dir, href);

  const effHref = sharedXml.match(/<Effect href="([^"]+)"/)?.[1];
  if (!effHref) return null;
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const effect = follow(sharedXml, sharedDir, effHref);
  if (!effect) return null;

  // The first instance is enough for a placeholder; effects that layer several
  // are still one object on the map.
  const block = effect.xml.match(/<Instances>([\s\S]*?)<\/Instances>/)?.[1];
  const item = block ? listItems(block)[0] : undefined;
  const instHref = item?.attrs.match(/href="([^"]+)"/)?.[1];
  // No particles at all, but a light: Fire_glow (the palette's one pure
  // AnimLight object — an invisible fire light the original editor draws as
  // a warm glow decal) would otherwise vanish entirely. A procedural radial
  // glow card stands in; the light's own colour/flicker (bin/Lights) stays
  // parked. [~]
  if (!instHref) return /<Lights>\s*<Item/.test(effect.xml) ? lightGlowCard() : null;
  // Inline instances live in this item, not in the file: reading the file works
  // out for the FIRST instance by luck and picks the wrong one for any other.
  const instance = instHref.startsWith('#')
    ? { xml: item!.body, dir: effect.dir }
    : follow(effect.xml, effect.dir, instHref);
  if (!instance) return null;
  const inst = instance.xml;

  const texHref = inst.match(/<Textures>[\s\S]*?<Item href="([^"]+)"/)?.[1];
  if (!texHref) return null;
  const texRel = resolveHref(instance.dir, texHref);
  const t = textureDataUri('', data, texSize, '/' + texRel);
  if (!t) return null;

  const partHref = inst.match(/<Particle href="([^"]+)"/)?.[1];
  const particle = partHref ? follow(inst, instance.dir, partHref) : null;
  const part = particle?.xml ?? null;
  const bound = part ? particleBound(part) : null;
  const scale = +(inst.match(/<Scale>([\d.]+)<\/Scale>/)?.[1] ?? 1) || 1;
  // A default that reads as "something is here" when the particle declares no
  // useful extent.
  const w = Math.max(0.5, Math.min(12, (bound ? Math.max(bound[0], bound[1]) : 2) * scale));
  const h = Math.max(0.5, Math.min(12, (bound ? bound[2] : 2) * scale));

  // A vertical card standing on the object's origin: most of these are glows
  // and columns, and a card lying flat would be hidden by the ground.
  const hw = w / 2;
  return {
    pos: [-hw, 0, 0, hw, 0, 0, hw, 0, h, -hw, 0, h],
    uv: [0, 1, 1, 1, 1, 0, 0, 0],
    nrm: [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    idx: [0, 1, 2, 0, 2, 3],
    // A particle stand-in is a glow: draw it additive and full-bright so it
    // reads as light, the way the game's particles do, not as a dark grey decal.
    parts: [{ start: 0, count: 6, tex: t.uri, alphaMode: 'AM_TRANSPARENT', projectOnTerrain: false, flat: false, opaque: false, terrainProjected: false, additive: true, selfIllum: true }],
  };
}

/**
 * The models an effect layers on the object, decoded and placed by their own
 * ModelInstance transforms.
 *
 * An effect is not only particles: its `<Models>` list carries real geometry —
 * the swirling Spiral and Rune ring that ARE a teleporter portal, the object's
 * own model being a bare minimap-icon quad. Following only the particle card
 * The object's full particle effect, baked (docs/EFFECTS_FORMAT.md): one
 * payload per ParticleInstance whose chain resolves end to end. Returns []
 * rather than throwing for every kind of miss — an effect that cannot be read
 * leaves the static glow card, never an unopenable map.
 */
export function effectParticles(
  sharedXml: string, sharedHref: string, data: Assets, texSize: number,
): FxInstancePayload[] {
  const effHref = sharedXml.match(/<Effect href="([^"]+)"/)?.[1];
  if (!effHref) return [];
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const effect = followHref(data, sharedXml, sharedDir, effHref);
  if (!effect) return [];
  return particlesOfEffect(effect, data, texSize);
}

/** A bone's rest-pose world transform, looked up by name (or numeric index as a string). */
export type BoneWorld = (bone: string) => BoneRest | null;

const qmul = (a: number[], b: number[]): number[] => [
  a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
  a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
  a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
  a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
];
const qrot = (q: number[], v: number[]): number[] => {
  // v' = v + 2·qw·(q×v) + 2·(q×(q×v)) — same form transformGeom uses.
  const [qx, qy, qz, qw] = q as [number, number, number, number];
  const [x, y, z] = v as [number, number, number];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
};

/** The particle payloads of one resolved Effect document. See effectParticles. */
export function particlesOfEffect(
  effect: { xml: string; dir: string }, data: Assets, texSize: number, boneWorld?: BoneWorld,
): FxInstancePayload[] {
  const follow = (xml: string, dir: string, href: string) => followHref(data, xml, dir, href);
  const out: FxInstancePayload[] = [];
  const block = effect.xml.match(/<Instances>([\s\S]*?)<\/Instances>/)?.[1];
  for (const item of block ? listItems(block) : []) {
    try {
      const instHref = item.attrs.match(/href="([^"]+)"/)?.[1];
      if (!instHref) continue;
      const instance = instHref.startsWith('#')
        ? { xml: item.body, dir: effect.dir }
        : follow(effect.xml, effect.dir, instHref);
      if (!instance) continue;
      const inst = instance.xml;

      const partHref = inst.match(/<Particle href="([^"]+)"/)?.[1];
      const particle = partHref ? follow(inst, instance.dir, partHref) : null;
      const uid = particle?.xml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
      if (!uid) continue;
      const binPath = data.path(join('bin', 'effects', uid.toUpperCase()));
      if (!existsSync(binPath)) continue;

      // The frame table, order preserved — the baked indices point into it.
      // Empty <Item/> slots stay as nulls so the numbering holds.
      const texBlock = inst.match(/<Textures>([\s\S]*?)<\/Textures>/)?.[1] ?? '';
      const textures = listItems(texBlock).map((t) => {
        const href = t.attrs.match(/href="([^"]+)"/)?.[1];
        if (!href) return null;
        return particleTextureUris(data, PARTICLE_FRAME, '/' + resolveHref(instance.dir, href));
      });
      if (!textures.some(Boolean)) continue;

      const vec = (tag: string, d: number[]): number[] => {
        const m = inst.match(new RegExp(`<${tag}>\\s*<x>([^<]*)</x>\\s*<y>([^<]*)</y>\\s*<z>([^<]*)</z>(?:\\s*<w>([^<]*)</w>)?`));
        return m ? [+m[1]!, +m[2]!, +m[3]!, ...(m[4] !== undefined ? [+m[4]!] : [])] : d;
      };
      let pos = vec('Position', [0, 0, 0]).slice(0, 3);
      let quat = vec('Rotation', [0, 0, 0, 1]);

      // A glued instance lives in a BONE's frame — the ghost dragon's eye glow
      // is two particles 0.3 apart around the Head bone's origin, and played in
      // object space they'd hover at its feet. The baked keys stay bone-local
      // (the bake does not fold the bone in), so the bone's rest transform is
      // composed here. Glued somewhere unresolvable → the instance is dropped:
      // absent beats at-the-feet.
      const glueName = inst.match(/<GlueToNamedBone>([^<]+)<\/GlueToNamedBone>/)?.[1]?.trim();
      const glueIdx = +(inst.match(/<GlueToBone>([-\d]+)<\/GlueToBone>/)?.[1] ?? 0);
      const glue = glueName || (glueIdx > 0 ? String(glueIdx) : null);
      let instScale = +(inst.match(/<Scale>([-\d.eE]+)</)?.[1] ?? 1) || 1;
      /** The bone-local transform, kept so the renderer can follow the animation. */
      let glued: FxInstancePayload['glue'];
      if (glue) {
        const bone = boneWorld?.(glue);
        if (!bone) continue;
        const bs = bone.scale || 1;
        // What is left of the bone's accumulated scale once the root's display
        // scale is taken out: at run time that one rides on the skinned mesh.
        const rootScale = boneWorld?.('__rootScale__')?.scale || 1;
        const own = bs / rootScale;
        glued = {
          bone: glue,
          pos: [pos[0]! * own, pos[1]! * own, pos[2]! * own],
          quat: [...quat],
          scale: instScale * own,
        };
        const r = qrot(bone.quat, [pos[0]! * bs, pos[1]! * bs, pos[2]! * bs]);
        pos = [bone.pos[0]! + r[0]!, bone.pos[1]! + r[1]!, bone.pos[2]! + r[2]!];
        quat = qmul(bone.quat, quat);
        // The bone's accumulated scale reaches the baked keys through the
        // instance scale, so eye glow on a 0.37-scaled head stays ON the head.
        instScale *= bs;
      }

      out.push({
        uid: uid.toUpperCase(),
        pos,
        quat,
        scale: instScale,
        ...(glued ? { glue: glued } : {}),
        speed: +(inst.match(/<Speed>([-\d.eE]+)</)?.[1] ?? 1) || 1,
        offset: +(inst.match(/<Offset>([-\d.eE]+)</)?.[1] ?? 0) || 0,
        endCycle: +(inst.match(/<EndCycle>([-\d.eE]+)</)?.[1] ?? 0) || 0,
        cycleCount: +(inst.match(/<CycleCount>([-\d.eE]+)</)?.[1] ?? 0) || 0,
        lit: /<Light>L_LIT<\/Light>/.test(inst),
        textures,
      });
    } catch { /* one broken instance must not take the object's other instances down */ }
  }
  return out;
}

/**
 * The creature's own idle effect — the ghost dragon's mist and eye glow, the
 * fire elemental's flames. It does NOT hang off the shared's `<Effect>` (empty
 * on every monster) but off the ANIMATION CLIP: AnimSet → idle00 →
 * BasicSkelAnim `<Effect href>`. Played whether or not the idle animation
 * itself is on — the original editor shows the mist on a frozen dragon too.
 *
 * The clip's GR2 is opened (once per shared, and only then) when an instance
 * is glued to a bone: the skeleton lives inside the animation file, and the
 * glued instance needs that bone's rest-pose world transform.
 */
export function clipEffectParticles(
  sharedXml: string, sharedHref: string, data: Assets, texSize: number,
): { fx: FxInstancePayload[]; scale: number } {
  const none = { fx: [] as FxInstancePayload[], scale: 1 };
  const setHref = sharedXml.match(/<AnimSet href="([^"]+)"/)?.[1];
  if (!setHref) return none;
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const set = followHref(data, sharedXml, sharedDir, setHref);
  if (!set) return none;
  const items = listItems(set.xml.match(/<animations>([\s\S]*?)<\/animations>/)?.[1] ?? '');
  const idle = items.find((i) => /<Kind>idle00<\/Kind>/.test(i.body))
    ?? items.find((i) => /<Kind>idle/.test(i.body));
  const animHref = idle?.body.match(/<Anim href="([^"]+)"/)?.[1];
  const anim = animHref ? followHref(data, set.xml, set.dir, animHref) : null;
  if (!anim) return none;
  // The clip's skeleton carries the creature's DISPLAY SCALE on its root bone
  // (Phoenix 0.37, Devil 0.7, Griffin 1.5): the mesh is authored full-size and
  // the game shows it through this rig. The effect is NOT scaled with it — the
  // phoenix's flames are baked full-size around a 0.37 bird, which is exactly
  // the game's picture (small bird, towering fire).
  const bones = clipRestBones(anim.xml, data);
  const scale = bones?.get('__rootScale__')?.scale ?? 1;
  const effHref = anim.xml.match(/<Effect href="([^"]+)"/)?.[1];
  const effect = effHref ? followHref(data, anim.xml, anim.dir, effHref) : null;
  if (!effect) return { fx: [], scale };
  const boneWorld: BoneWorld = (bone) => bones?.get(bone) ?? null;
  const fx = particlesOfEffect(effect, data, texSize, boneWorld);
  // The engine replays a clip's effect with every animation cycle. Only a
  // finite train (cycleCount > 0) can tell the difference — a one-burst
  // instance fires once per cycle, not once ever — so the clip is only
  // opened for its duration when such an instance exists.
  if (fx.some((i) => i.cycleCount > 0)) {
    const dur = clipDurationSeconds(anim.xml, data);
    if (dur) for (const i of fx) i.retrigger = dur;
  }
  return { fx, scale };
}

/**
 * Every bone's rest-pose WORLD transform from a clip's GR2, keyed by name and
 * by index-as-string (`<GlueToBone>` addresses bones numerically). The root's
 * scaleShear — the display scale above — accumulates down the chain, so a
 * glued instance lands where the SCALED skeleton has the bone. Null when the
 * file is missing or unreadable — the caller then drops glued instances.
 * The root scale itself rides out under the reserved key `__rootScale__`.
 */
export interface BoneRest { pos: number[]; quat: number[]; scale: number }
export function clipRestBones(animXml: string, data: Assets): Map<string, BoneRest> | null {
  try {
    const uid = animXml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
    if (!uid) return null;
    const binPath = data.path(join('bin', 'animations', uid.toUpperCase()));
    if (!existsSync(binPath)) return null;
    const file = GrannyFile.open(readFileSync(binPath));
    if (!file || file.isUnreadable) return null;
    const sk = readSkeletons(file)[0];
    if (!sk?.bones.length) return null;
    const world: (BoneRest | undefined)[] = new Array(sk.bones.length);
    const at = (i: number): BoneRest => {
      const hit = world[i];
      if (hit) return hit;
      const b = sk.bones[i]!;
      const lp = Array.from(b.rest.position), lq = Array.from(b.rest.orientation);
      const ls = Number(b.rest.scaleShear?.[0] ?? 1) || 1; // uniform approx of the 3x3
      const p = b.parentIndex >= 0 && b.parentIndex !== i ? at(b.parentIndex) : null;
      if (!p) { const w = { pos: lp, quat: lq, scale: ls }; world[i] = w; return w; }
      const r = qrot(p.quat, [lp[0]! * p.scale, lp[1]! * p.scale, lp[2]! * p.scale]);
      const w = {
        pos: [p.pos[0]! + r[0]!, p.pos[1]! + r[1]!, p.pos[2]! + r[2]!],
        quat: qmul(p.quat, lq),
        scale: p.scale * ls,
      };
      world[i] = w;
      return w;
    };
    const out = new Map<string, BoneRest>();
    sk.bones.forEach((b, i) => { const w = at(i); out.set(b.name, w); out.set(String(i), w); });
    const root = at(0);
    out.set('__rootScale__', { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: root.scale });
    return out;
  } catch { return null; }
}

/** The clip's length in seconds, from its GR2; 0 when unreadable. */
export function clipDurationSeconds(animXml: string, data: Assets): number {
  try {
    const uid = animXml.match(/<uid>([0-9A-Fa-f-]{36})<\/uid>/)?.[1];
    if (!uid) return 0;
    const binPath = data.path(join('bin', 'animations', uid.toUpperCase()));
    if (!existsSync(binPath)) return 0;
    const file = GrannyFile.open(readFileSync(binPath));
    if (!file || file.isUnreadable) return 0;
    return readAnimations(file)[0]?.duration ?? 0;
  } catch { return 0; }
}

/**
 * left those objects looking empty. Each `<Item>` points at a ModelInstance
 * (Model href + Position/Rotation/Scale), which resolves to an ordinary model.
 */
export function effectModelGeoms(
  sharedXml: string, sharedHref: string, data: Assets, readXdb: ReadXdb, texSize: number,
): GeomData[] {
  const effHref = sharedXml.match(/<Effect href="([^"]+)"/)?.[1];
  if (!effHref) return [];
  const sharedDir = dirOf(resolveHref('', sharedHref));
  const effect = followHref(data, sharedXml, sharedDir, effHref);
  if (!effect) return [];
  // A map draws these still, so the instance's placement is folded into the
  // vertices and the object carries one geometry per model, as it always has.
  return modelsOfEffect(effect, data, readXdb, texSize).map((m) => {
    transformGeom(m.geom, m.pos, m.quat, m.scale);
    return m.geom;
  });
}

/** One `<Models>` entry of an effect: geometry, where it sits, how long it lasts. */
export interface EffectModel {
  /**
   * The model, UNTRANSFORMED. An animated one cannot have its placement folded
   * into the vertices — the skinning is against the bind pose — so the
   * transform travels beside it and whoever draws it applies both.
   */
  geom: GeomData;
  pos: [number, number, number];
  quat: [number, number, number, number];
  scale: number;
  /**
   * Seconds the model is on screen, 0 when the file names no end.
   *
   * `CycleCount` copies of `CycleLength` seconds — and where the length is left
   * at 0, which is every shipped instance, one cycle is the `<SkelAnim>`'s own
   * length. This is what ends a spell: a model has no particle system's die-out
   * to stop it, so left unbounded the praying hands of a Prayer stay standing
   * in the soldier they were cast on for the rest of the scene.
   */
  life: number;
}

/**
 * The models an effect places, for an effect document already in hand.
 *
 * A dialog scene fires effects at a PLACE rather than hanging them off an
 * object, so it has no shared to follow — and nine of the twelve effects
 * C1M1's opening fires carry models (the meteor shower carries nineteen).
 * Without them a spell is its sparks and nothing else: the blue column a hero
 * casts inside is a model, not a particle system.
 *
 * With `animate`, each instance's `<SkelAnim>` is baked onto the model the way
 * an actor's clip is, and rides out in `geom.skin.clip`. It is not decoration:
 * every effect model in the shipped library names one, and the geometry sits at
 * the pose the clip STARTS from — the ice bolt hanging in the air where it
 * should be falling, the Prayer's hands three units under their own origin.
 */
export function modelsOfEffect(
  effect: { xml: string; dir: string }, data: Assets, readXdb: ReadXdb, texSize: number,
  options: { fps?: number; animate?: boolean } = {},
): EffectModel[] {
  const block = effect.xml.match(/<Models>([\s\S]*?)<\/Models>/)?.[1];
  if (!block) return [];
  const out: EffectModel[] = [];
  for (const item of listItems(block)) {
    const href = item.attrs.match(/href="([^"]+)"/)?.[1];
    if (!href) continue;
    // An inline ModelInstance is written INSIDE this <Item>, so the item's own
    // body is the document to read the transform from — NOT the whole effect
    // file. Reading the file instead took the first <Scale> in it, which in an
    // effect is a particle's: the Mystical Garden's gnome came out at the
    // particle halo's scale of 10 and stood over half the map.
    const inst = href.startsWith('#')
      ? { xml: item.body, dir: effect.dir }
      : followHref(data, effect.xml, effect.dir, href);
    if (!inst) continue;
    const modelHref = inst.xml.match(/<Model href="([^"]+)"/)?.[1];
    if (!modelHref) continue;
    const modelRel = '/' + resolveHref(inst.dir, modelHref);
    const model = readXdb(modelRel);
    if (!model) continue;
    const g = decodeModelGeom(model, modelRel, data, readXdb, texSize,
      options.animate ? { skin: true } : undefined);
    if (!g) continue;
    let life = 0;
    if (options.animate && g.skin) {
      const baked = bakeModelInstance(inst, { xml: model, rel: modelRel }, data, options.fps ?? 15);
      if (baked && !g.skin.index.some((b) => b >= baked.rig.bones.length)) {
        g.skin.bones = baked.rig.bones;
        g.skin.bind = baked.rig.bind;
        g.skin.clip = baked.rig.clip;
        if (baked.rig.scale !== 1) g.scale = baked.rig.scale;
        life = baked.life;
      } else {
        // No clip, or one addressing a rig this mesh was not skinned to. The
        // still mesh is the honest fallback; a mismatched bone list does not
        // look like a small error, it tears the model apart.
        delete g.skin;
      }
    }
    out.push({
      geom: g,
      pos: readVec3(inst.xml, 'Position') ?? [0, 0, 0],
      quat: readQuat(inst.xml, 'Rotation') ?? [0, 0, 0, 1],
      scale: +(inst.xml.match(/<Scale>([-+.\deE]+)<\/Scale>/)?.[1] ?? 1) || 1,
      life,
    });
  }
  return out;
}

/** A ModelInstance's `<SkelAnim>`, baked, with the seconds it plays for. */
function bakeModelInstance(
  inst: { xml: string; dir: string }, model: { xml: string; rel: string }, data: Assets, fps: number,
): { rig: BakedRig; life: number } | null {
  const skelHref = inst.xml.match(/<SkelAnim href="([^"]+)"/)?.[1];
  if (!skelHref) return null;
  const animXml = readAsset(data, resolveHref(inst.dir, skelHref));
  if (!animXml) return null;
  const rig = bakeCharacterClip(data, animXml, model, fps);
  if (!rig) return null;
  const cycles = +(inst.xml.match(/<CycleCount>([-\d]+)<\/CycleCount>/)?.[1] ?? 1);
  const length = +(inst.xml.match(/<CycleLength>([-+.\deE]+)<\/CycleLength>/)?.[1] ?? 0) || rig.clip.duration;
  return { rig, life: cycles > 0 ? cycles * length : 0 };
}

/** How long an effect stays up when nothing inside it says otherwise. */
export function effectDuration(effectXml: string): number {
  return +(effectXml.match(/<Duration>([-+.\deE]+)<\/Duration>/)?.[1] ?? 0) || 0;
}
