// The preset's sky dome: the backdrop the game draws behind everything.
//
// The dome is a model like any other (SkyDome1 is a 250-unit skybox cube, the
// arena skies are spheres), but it is DRAWN unlike any other: self-illuminated
// (its materials say so), depth ignored (they say that too — IgnoreZBuffer),
// painted first so the whole world lays over it, and it RIDES THE CAMERA — a
// sky is a direction, not a place, and a dome left at the map's origin shows
// its outside wall the moment the camera pans off it. It lives on its own
// render layer: only the perspective camera opts in, so the plan view (whose
// straight-down look would be the dome's underside, a texture the game never
// shows) and the layer-0 raycaster never meet it.

import * as THREE from 'three';

import { onAmbient } from '#viewport/lighting.ts';
import { geometryFor, materialFor } from '#viewport/materials.ts';
import { camera, scene } from '#viewport/stage.ts';
import type { AmbientData, GeomData } from '#src/scene/payload.ts';

const SKY_LAYER = 1;

// One mesh per decoded dome, kept for as long as its world is up: a dialog
// scene flips presets per SHOT (C1M1 alternates day and inferno), and that
// must swap a mesh, not rebuild one.
const built = new Map<GeomData, THREE.Mesh>();
let shown: THREE.Mesh | null = null;

function domeFor(g: GeomData): THREE.Mesh {
  const known = built.get(g);
  if (known) return known;
  const mesh = new THREE.Mesh(geometryFor(g), g.parts.map((p) => materialFor(p, true)));
  mesh.renderOrder = -1; // before everything: it is the background
  mesh.frustumCulled = false; // its authored bounds mean nothing once it follows the camera
  mesh.layers.set(SKY_LAYER);
  // three.js computes the object's model-view matrix right AFTER this hook, so
  // moving the dome here puts it around the eye of whichever camera is about
  // to draw it — the editor's orbit and a shot's own move alike.
  mesh.onBeforeRender = (_r, _s, cam) => {
    mesh.position.setFromMatrixPosition(cam.matrixWorld);
    mesh.updateMatrixWorld();
  };
  built.set(g, mesh);
  return mesh;
}

/** Show the preset's dome, or none — applyAmbient calls this with the rest. */
function applySkyDome(a: AmbientData | null): void {
  const want = a?.dome ? domeFor(a.dome) : null;
  if (want === shown) return;
  if (shown) scene.remove(shown);
  if (want) scene.add(want);
  shown = want;
}

/**
 * Drop every dome built for the current world (clearWorld). The geometry is
 * this module's to dispose; the materials stay in materialFor's shared cache
 * like every other model's.
 */
export function clearSky(): void {
  for (const mesh of built.values()) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  built.clear();
  shown = null;
}

export function initSky(): void {
  camera.layers.enable(SKY_LAYER);
  onAmbient(applySkyDome);
}
