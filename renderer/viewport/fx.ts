// Particle effects: which placements play, and stepping them each frame.
//
// The batch itself (the baked keys, the one simulation, the draw) lives in
// particles.ts; this is the map-facing half — which placed objects are copies
// of which effect, placing each copy, following the bone an effect is glued
// to, and taking a copy down with its object.

import * as THREE from 'three';

import { api } from '#core/ipc.ts';
import { state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { FxInstancePayload, Instance } from '#src/scene/payload.ts';
import type { FxTransfer } from '#src/scene/effects.ts';
import { tileCenter } from '#core/coords.ts';
import { geomFx } from '#viewport/geoms.ts';
import { createFxBatch } from '#viewport/particles.ts';
import type { FxBatch } from '#viewport/particles.ts';
import type { IdleBody } from '#viewport/skinning.ts';
import { uFxTint } from '#viewport/lighting.ts';

/**
 * One effect on one floor, and the placed objects that are its copies.
 *
 * `at[slot]` is the object drawn by that slot of the batch, `rest[slot]` the
 * matrix it stands with when nothing animates it — the object's placement
 * times the effect's own offset. A glued copy leaves `rest` for its bone
 * every frame and comes back to it when the skeleton goes away.
 */
export interface PlacedFx {
  batch: FxBatch;
  at: Instance[];
  rest: THREE.Matrix4[];
}

/**
 * Give every placed object its playing particle effects.
 *
 * The scene payload carries only each effect's placement, textures and uid;
 * the baked keys come from `map:fx` here, once per unique uid, as typed
 * arrays. Every placement of the same effect is a copy in one batch, all on
 * one clock — thirty campfires flicker in step, and may: they are one
 * recording, and one simulation.
 */
export async function loadFx(floors: Floor3D[]): Promise<void> {
  if (!geomFx.size) return;
  const uids = [...new Set([...geomFx.values()].flat().map((f) => f.uid))];
  const bank = await api.fx(uids);
  let built = 0, batches = 0;
  for (const fl of floors) { built += buildFx(fl, bank); batches += fl.fx.length; }
  if (built) console.log(`[perf] effects: ${built} cop${built === 1 ? 'y' : 'ies'} in ${batches} batch(es) over ${uids.length} unique effect(s)`);
}

/** Place the copies for the objects standing on one floor, from a fetched bank. */
function buildFx(fl: Floor3D, bank: Record<string, FxTransfer>): number {
  let built = 0;
  for (const inst of fl.instances) {
    const list = geomFx.get(inst.g);
    if (!list) continue;
    for (const f of list) if (addCopy(fl, f, inst, bank)) built++;
  }
  return built;
}

/** The floor's batch for this payload — made on its first copy. */
function batchFor(fl: Floor3D, f: FxInstancePayload, bank: Record<string, FxTransfer>): PlacedFx | null {
  const have = fl.fx.find((e) => e.batch.fx === f);
  if (have) return have;
  const baked = bank[f.uid];
  if (!baked?.particles.length) return null;
  const { batch } = createFxBatch(f, baked, uFxTint);
  batch.mesh.userData.uid = f.uid; // for fxSystems() debugging
  batch.mesh.visible = state.showFx; // effects arrive async; respect the toggle they land under
  const entry: PlacedFx = { batch, at: [], rest: [] };
  fl.fx.push(entry);
  fl.objGroup.add(batch.mesh);
  return entry;
}

/** Where the map puts an object: its tile centre, height and facing. */
function objectMatrix(inst: Instance, out: THREE.Matrix4): THREE.Matrix4 {
  return out.makeRotationZ(inst.r).setPosition(tileCenter(inst.x), tileCenter(inst.y), inst.z);
}

const _m4 = new THREE.Matrix4();

/** One object's copy of one of its effects, placed where the object stands. */
function addCopy(fl: Floor3D, f: FxInstancePayload, inst: Instance, bank: Record<string, FxTransfer>): boolean {
  const e = batchFor(fl, f, bank);
  if (!e) return false;
  const slot = e.batch.addCopy();
  e.at[slot] = inst;
  e.rest[slot] = objectMatrix(inst, new THREE.Matrix4()).multiply(e.batch.local);
  e.batch.setCopyMatrix(slot, e.rest[slot]);
  return true;
}

/**
 * Take a floor's effects down and put them back for the objects standing on it
 * NOW — the undo path, which replaces the whole instance list.
 *
 * A copy is bound to the instance object it was placed for (`at[slot]`), and
 * undo hands back freshly parsed instances, so every existing copy belongs to
 * an object that no longer exists. Left alone they keep burning where they
 * were — a campfire whose placement was undone goes on smoking over bare grass,
 * and it cannot be moved or deleted, because nothing on the map claims it — while
 * the objects that came back stand cold.
 *
 * The old ones go SYNCHRONOUSLY, before the fetch: the caller has just rebuilt
 * the batches, and a frame drawn between here and the bank arriving must not
 * show effects for objects that are gone.
 */
export async function reloadFx(fl: Floor3D): Promise<void> {
  for (const e of fl.fx) { fl.objGroup.remove(e.batch.mesh); e.batch.dispose(); }
  fl.fx.length = 0;
  if (!geomFx.size) return;
  const uids = [...new Set(fl.instances.flatMap((i) => geomFx.get(i.g) ?? []).map((f) => f.uid))];
  if (!uids.length) return;
  buildFx(fl, await api.fx(uids));
}

/** The one clock every effect follows. */
let fxClock = 0;
export function advanceFx(dt: number): void {
  if (!state.world || !state.showFx) return;
  fxClock += dt;
  const fl = state.world.floors[state.world.active];
  if (!fl?.fx.length || !fl.objGroup.visible) return;
  /** Animated bodies by instance, built only when something is glued to one. */
  let bodies: Map<unknown, IdleBody> | null = null;
  for (const e of fl.fx) {
    e.batch.update(fxClock);
    if (!e.batch.glue || !e.batch.glueLocal) continue;
    bodies ??= new Map(fl.idle.map((i) => [i.inst, i]));
    for (let slot = 0; slot < e.at.length; slot++) followBone(e, slot, bodies.get(e.at[slot]));
  }
}

/**
 * Hang a glued copy off the bone it names, where the bone is NOW.
 *
 * The ghost dragon's eye glow is two particles around its Head bone. Their
 * placement was folded against the bind pose when the scene was built, which is
 * right until the idle clip moves the skeleton — then the head turns and the
 * eyes stay behind, hanging in the air where the head used to be.
 *
 * The bone's matrix comes out of the kind's baked table in MODEL space, so the
 * body's own placement — the object's world matrix, display scale included —
 * goes in front of it, and the bone-local transform behind. The placement is
 * current: it is written when the object is placed or moved, not by the
 * render.
 */
export function followBone(e: PlacedFx, slot: number, body: IdleBody | undefined): void {
  const bone = body ? boneOf(body, e.batch.glue!) : -1;
  if (bone < 0) {
    // No animated body (idle stance off, or this object has no skeleton): the
    // bind-pose placement is the right one.
    e.batch.setCopyMatrix(slot, e.rest[slot]!);
    return;
  }
  _m4.multiplyMatrices(body!.matrix, body!.kind.skel.boneWorld(bone, _bone));
  e.batch.setCopyMatrix(slot, _m4.multiply(e.batch.glueLocal!));
}
const _bone = new THREE.Matrix4();

/** The bone an effect names: `<GlueToNamedBone>` by name, `<GlueToBone>` by index; -1 when the body has no such bone. */
export function boneOf(body: IdleBody, glue: string): number {
  const bones = body.kind.skin.bones;
  if (/^\d+$/.test(glue)) return Number(glue) < bones.length ? Number(glue) : -1;
  return bones.findIndex((b) => b.name === glue);
}

/** An object moved or turned: its copies go with it. */
export function moveFx(fl: Floor3D, inst: Instance, objectWorld: THREE.Matrix4): void {
  for (const e of fl.fx) {
    for (let slot = 0; slot < e.at.length; slot++) {
      if (e.at[slot] !== inst) continue;
      e.rest[slot]!.multiplyMatrices(objectWorld, e.batch.local);
      e.batch.setCopyMatrix(slot, e.rest[slot]!);
    }
  }
}

/**
 * Place one instance's effect copies — the palette-add path, where loadFx has
 * already run. Without this a campfire dropped from the palette stood cold
 * until the map was saved and reopened.
 */
export async function spawnFx(fl: Floor3D, inst: Instance): Promise<void> {
  const list = geomFx.get(inst.g);
  if (!list?.length) return;
  const bank = await api.fx([...new Set(list.map((f) => f.uid))]);
  for (const f of list) addCopy(fl, f, inst, bank);
}

/** Drop one object's effect copies, e.g. when it is deleted; the last copy takes its batch down. */
export function removeFx(fl: Floor3D, inst: Instance): void {
  for (let i = fl.fx.length - 1; i >= 0; i--) {
    const e = fl.fx[i]!;
    for (let slot = e.at.length - 1; slot >= 0; slot--) {
      if (e.at[slot] !== inst) continue;
      // The batch fills the hole with its last slot; the bookkeeping follows.
      const moved = e.batch.removeCopy(slot);
      if (moved >= 0) { e.at[slot] = e.at[moved]!; e.rest[slot] = e.rest[moved]!; }
      e.at.length--; e.rest.length--;
    }
    if (e.batch.copies) continue;
    fl.objGroup.remove(e.batch.mesh);
    e.batch.dispose();
    fl.fx.splice(i, 1);
  }
}
