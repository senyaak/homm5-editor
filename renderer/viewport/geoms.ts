// The per-geom registry: one entry per decoded model, shared across floors.
//
// Module-level rather than local to a load because these outlive it: placing an
// object from the palette can bring a model the map never used, and it is
// registered here at the index the main process assigned it. The arrays are
// rewritten in place (never reassigned) so importers keep seeing the live one.

import * as THREE from 'three';

import type { Scene, GeomData, GeomPart, Footprint, SkinnedGeom, FxInstancePayload } from '#src/scene/payload.ts';
import { state } from '#core/state.ts';
import { geometryFor, materialFor } from '#viewport/materials.ts';

export const worldGeos: THREE.BufferGeometry[] = [];
/** One material ARRAY per geom, lined up with that geometry's groups. */
export const worldMats: THREE.Material[][] = [];

/** Submesh descriptions per geom index, so materials can be rebuilt later. */
export const geomParts = new Map<number, GeomPart[]>();

/**
 * Creature display scale per geom index (GeomData.scale: the idle clip
 * skeleton's root — Phoenix 0.37, Devil 0.7). Applied on the pick-handle mesh
 * so it flows into the batch, the selection box and the idle body alike;
 * absent means 1. Effects deliberately do NOT take it.
 */
export const geomScale = new Map<number, number>();

/** Building tile footprint per geom index (null for objects that declare none). */
export const geomFootprint = new Map<number, Footprint | null>();

/** Skin payloads by geom index, kept from the scene for building skeletons. */
export const geomSkin = new Map<number, SkinnedGeom>();

/** Effect instances per geom — every placement of the geom plays them. */
export const geomFx = new Map<number, FxInstancePayload[]>();

/**
 * Take one decoded model into the registry at its index.
 *
 * Both paths in — the map load and a placement from the palette — come through
 * here. They used to be two copies of this, and the copies drifted: a brand-new
 * model placed with idles on stood frozen while its loaded twins moved, because
 * only one of them remembered the skin.
 */
/**
 * The material of a part that is not drawn: the effect stand-in card of an
 * object whose particles play. It stays in the geometry — the pick handle is
 * built from the same buffers, so the card is still what a click on an
 * effect-only object hits — and three skips an invisible group in both the
 * colour and the shadow pass, which is what takes the card's shadow off the
 * ground with it.
 */
const UNDRAWN = new THREE.MeshBasicMaterial({ visible: false });

/**
 * The cards that can be switched between drawn and not: each one's slot in
 * its geom's material list, and the material it is drawn with. The lists are
 * the very arrays the batches render from, so writing a slot changes the
 * next frame — no rebuild.
 */
const fxCards: { mats: THREE.Material[]; i: number; drawn: THREE.Material }[] = [];

/**
 * Show or hide the stand-in cards under playing particles (the explorer's
 * "effect markers" checkbox). The game never draws them; the editor does on
 * request, because a swarm of bats is nothing to click on.
 */
export function setFxCardsVisible(on: boolean): void {
  for (const c of fxCards) c.mats[c.i] = on ? c.drawn : UNDRAWN;
}

export function registerGeom(index: number, g: GeomData): void {
  worldGeos[index] = geometryFor(g);
  const mats = g.parts.map((p) => materialFor(p));
  if (g.fx?.length) {
    g.parts.forEach((p, i) => {
      if (!p.card) return;
      fxCards.push({ mats, i, drawn: mats[i]! });
      if (!state.showFxCards) mats[i] = UNDRAWN;
    });
  }
  worldMats[index] = mats;
  geomParts.set(index, g.parts);
  geomFootprint.set(index, g.footprint ?? null);
  // Only a model with a clip is worth remembering: the binding alone poses
  // nothing, and every other geom would just sit in the map unused.
  if (g.skin?.clip) geomSkin.set(index, g.skin);
  if (g.fx?.length) geomFx.set(index, g.fx);
  if (g.scale && g.scale !== 1) geomScale.set(index, g.scale);
}

/** Build the shared per-geom geometries + materials for a freshly loaded scene. */
export function buildGeos(S: Scene): { geos: THREE.BufferGeometry[]; mats: THREE.Material[][] } {
  geomParts.clear();
  geomFootprint.clear();
  geomSkin.clear();
  geomFx.clear();
  geomScale.clear();
  fxCards.length = 0;
  worldGeos.length = 0;
  worldMats.length = 0;
  S.geoms.forEach((g, i) => registerGeom(i, g));
  return { geos: worldGeos, mats: worldMats };
}
