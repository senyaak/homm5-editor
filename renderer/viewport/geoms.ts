// The per-geom registry: one entry per decoded model, shared across floors.
//
// Module-level rather than local to a load because these outlive it: placing an
// object from the palette can bring a model the map never used, and it is
// registered here at the index the main process assigned it. The arrays are
// rewritten in place (never reassigned) so importers keep seeing the live one.

import * as THREE from 'three';

import type { Scene, GeomData, GeomPart, Footprint, SkinnedGeom, FxInstancePayload } from '#src/scene/scene.ts';
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
export function registerGeom(index: number, g: GeomData): void {
  worldGeos[index] = geometryFor(g);
  worldMats[index] = g.parts.map(materialFor);
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
  worldGeos.length = 0;
  worldMats.length = 0;
  S.geoms.forEach((g, i) => registerGeom(i, g));
  return { geos: worldGeos, mats: worldMats };
}
