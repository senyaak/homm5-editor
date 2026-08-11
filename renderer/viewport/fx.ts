// Particle effects: which placements play, and stepping them each frame.
//
// The system itself (emitters, the baked keys, the draw) lives in particles.ts;
// this is the map-facing half — spawning a placement's systems, following the
// bone an effect is glued to, and taking them down with the object.

import * as THREE from 'three';

import { api } from '#core/ipc.ts';
import { state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { Instance } from '#src/scene/payload.ts';
import type { FxTransfer } from '#src/scene/effects.ts';
import { tileCenter } from '#core/coords.ts';
import { geomFx } from '#viewport/geoms.ts';
import { createFxSystem } from '#viewport/particles.ts';
import type { FxSystem } from '#viewport/particles.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { uFxTint } from '#viewport/lighting.ts';

/**
 * Give every placed object its playing particle effects.
 *
 * The scene payload carries only each effect's placement, textures and uid;
 * the baked keys come from `map:fx` here, once per unique uid, as typed
 * arrays. One system per (placement x ParticleInstance); phases are spread by
 * placement so thirty campfires don't flicker in lockstep.
 */
export async function loadFx(floors: Floor3D[]): Promise<void> {
  if (!geomFx.size) return;
  const uids = [...new Set([...geomFx.values()].flat().map((f) => f.uid))];
  const bank = await api.fx(uids);
  let built = 0;
  for (const fl of floors) built += buildFx(fl, bank);
  if (built) console.log(`[perf] effects: ${built} system(s) over ${uids.length} unique effect(s)`);
}

/** Spawn the systems for the objects standing on one floor, from a fetched bank. */
function buildFx(fl: Floor3D, bank: Record<string, FxTransfer>): number {
  const m4 = new THREE.Matrix4();
  let at = 0, built = 0;
  for (const inst of fl.instances) {
    const list = geomFx.get(inst.g);
    if (!list) continue;
    at++;
    for (const f of list) {
      const baked = bank[f.uid];
      if (!baked?.particles.length) continue;
      m4.makeRotationZ(inst.r).setPosition(tileCenter(inst.x), tileCenter(inst.y), inst.z);
      const { system } = createFxSystem(f, baked, m4, (at * 0.37) % 3, uFxTint);
      system.mesh.userData.inst = inst;
      system.mesh.userData.uid = f.uid; // for fxSystems() debugging
      system.mesh.visible = state.showFx; // effects arrive async; respect the toggle they land under
      fl.fx.push(system);
      fl.objGroup.add(system.mesh);
      built++;
    }
  }
  return built;
}

/**
 * Take a floor's effects down and put them back for the objects standing on it
 * NOW — the undo path, which replaces the whole instance list.
 *
 * A system is bound to the instance object it was built for (`userData.inst`),
 * and undo hands back freshly parsed instances, so every existing system belongs
 * to an object that no longer exists. Left alone they keep burning where they
 * were — a campfire whose placement was undone goes on smoking over bare grass,
 * and it cannot be moved or deleted, because nothing on the map claims it — while
 * the objects that came back stand cold.
 *
 * The old ones go SYNCHRONOUSLY, before the fetch: the caller has just rebuilt
 * the batches, and a frame drawn between here and the bank arriving must not
 * show effects for objects that are gone.
 */
export async function reloadFx(fl: Floor3D): Promise<void> {
  for (const s of fl.fx) { fl.objGroup.remove(s.mesh); s.dispose(); }
  fl.fx.length = 0;
  if (!geomFx.size) return;
  const uids = [...new Set(fl.instances.flatMap((i) => geomFx.get(i.g) ?? []).map((f) => f.uid))];
  if (!uids.length) return;
  buildFx(fl, await api.fx(uids));
}

/** The one clock every effect follows (phase offsets are per system). */
let fxClock = 0;
export function advanceFx(dt: number): void {
  if (!state.world || !state.showFx) return;
  fxClock += dt;
  const fl = state.world.floors[state.world.active];
  if (!fl?.fx.length || !fl.objGroup.visible) return;
  /** Animated bodies by instance, built only when something is glued to one. */
  let bodies: Map<unknown, IdleObject> | null = null;
  for (const s of fl.fx) {
    s.update(fxClock);
    if (!s.glue || !s.glueLocal) continue;
    bodies ??= new Map(fl.idle.map((i) => [i.mesh.userData.inst, i]));
    followBone(s, bodies.get(s.mesh.userData.inst));
  }
}

/**
 * Hang a glued effect off the bone it names, where the bone is NOW.
 *
 * The ghost dragon's eye glow is two particles around its Head bone. Their
 * placement was folded against the bind pose when the scene was built, which is
 * right until the idle clip moves the skeleton — then the head turns and the
 * eyes stay behind, hanging in the air where the head used to be.
 *
 * The bone's world matrix already carries the object's placement and the
 * creature's display scale (the bones are children of the skinned mesh), so the
 * object matrix must NOT be multiplied in again — only the bone-local transform.
 * And it has to be refreshed by hand: three.js updates world matrices during
 * render, which is after this, so reading it raw would follow the animation one
 * frame late.
 */
export function followBone(s: FxSystem, body: IdleObject | undefined): void {
  const bone = body ? boneOf(body, s.glue!) : null;
  if (!bone) {
    // No animated body (idle stance off, or this object has no skeleton): the
    // bind-pose placement is the right one.
    if (s.restMatrix) s.mesh.matrix.copy(s.restMatrix);
    return;
  }
  bone.updateWorldMatrix(true, false);
  s.mesh.matrix.multiplyMatrices(bone.matrixWorld, s.glueLocal!);
}

/** The bone an effect names: `<GlueToNamedBone>` by name, `<GlueToBone>` by index. */
export function boneOf(body: IdleObject, glue: string): THREE.Bone | null {
  const byIndex = /^\d+$/.test(glue) ? body.bones[Number(glue)] : undefined;
  return byIndex ?? body.bones.find((b) => b.name === glue) ?? null;
}

/**
 * Build one placed instance's effect systems — the palette-add path, where
 * loadFx has already run. Without this a campfire dropped from the palette
 * stood cold until the map was saved and reopened.
 */
export async function spawnFx(fl: Floor3D, inst: Instance): Promise<void> {
  const list = geomFx.get(inst.g);
  if (!list?.length) return;
  const bank = await api.fx([...new Set(list.map((f) => f.uid))]);
  const m4 = new THREE.Matrix4();
  for (const f of list) {
    const baked = bank[f.uid];
    if (!baked?.particles.length) continue;
    m4.makeRotationZ(inst.r).setPosition(tileCenter(inst.x), tileCenter(inst.y), inst.z);
    const { system } = createFxSystem(f, baked, m4, (fl.fx.length * 0.37) % 3, uFxTint);
    system.mesh.userData.inst = inst;
    system.mesh.userData.uid = f.uid;
    system.mesh.visible = state.showFx;
    fl.fx.push(system);
    fl.objGroup.add(system.mesh);
  }
}

/** Drop one object's effect systems, e.g. when it is deleted. */
export function removeFx(fl: Floor3D, inst: Instance): void {
  for (let i = fl.fx.length - 1; i >= 0; i--) {
    const s = fl.fx[i]!;
    if (s.mesh.userData.inst !== inst) continue;
    fl.objGroup.remove(s.mesh);
    s.dispose();
    fl.fx.splice(i, 1);
  }
}
