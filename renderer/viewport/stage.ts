// The 3D stage: the WebGL context, the scene, the two cameras and the controls.
//
// Everything else in viewport/ draws into `scene` and reads `cam.active`;
// the features drive the camera through the handful of functions here rather
// than touching OrbitControls themselves.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { $ } from '#core/dom.ts';
import { saveUiPrefs } from '#core/prefs.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';

/**
 * The 3D context, or a failure that says what to do about it.
 *
 * three.js throws a bare "Error creating WebGL context." here, and this is a
 * top-level `const`: the throw stops the rest of this module, which is every
 * event handler the window has. The page keeps its static markup, so the editor
 * looks open and does nothing at all — the map list stays on its "loading…"
 * placeholder for good. That is how this shipped, and the message a user got was
 * nothing. The context is genuinely required (the whole editor is the 3D view),
 * so this does not try to carry on without one; it just makes the failure name
 * itself, and index.html's trap puts it on screen.
 */
function makeRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    throw new Error(
      'This machine did not give the editor a 3D (WebGL) context, so the map view cannot start. '
      + 'The usual causes are a graphics driver too old for Chromium to trust, a remote-desktop '
      + 'or virtual-machine session with no GPU, or a laptop running this on its idle GPU.\n\n'
      + 'Updating the graphics driver is the fix worth having. Failing that, the button below '
      + 'restarts the editor drawing in software — several times slower, but it does not need a '
      + 'driver to cooperate, and it can be turned off again from inside the editor.\n\n'
      + `(three.js said: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

export const renderer = makeRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('app').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const DEFAULT_BG = new THREE.Color(0x0d1014);
scene.background = DEFAULT_BG;

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 6000);
camera.up.set(0, 0, 1); // Z-up

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Map-editor feel: middle-drag pans (the default dollies, which duplicates the
// wheel), and panning slides along the ground plane instead of the screen plane
// so the view doesn't drift off the terrain when the camera is tilted.
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.screenSpacePanning = false;

// --- top-down (plan) camera -------------------------------------------------
// A fixed orthographic view straight down the -Z axis. Perspective foreshortening
// and terrain height both drop out, so world (x, y) maps to the screen by a plain
// affine transform: a proper plan view for laying a map out, and — because that
// mapping is exact and camera-independent — the stable coordinate frame the
// click-driven reconstruction tests need to compute "where to click" for a tile.
//
// The orbit camera above still owns pan/target; this one just re-centres on that
// same target every frame (see syncTopCamera). Rotation is disabled in plan view
// so the affine mapping holds; pan (WASD / middle-drag) and zoom (wheel -> the
// frustum half-height) still work.
export const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
topCamera.up.set(0, 1, 0); // world +Y is screen up, +X is screen right

/** Which camera is live and how far the plan view is zoomed out. */
export const cam = {
  /** false = 3D perspective + orbit; true = 2D plan (orthographic top-down). */
  top: false,
  /** Half-height of the ortho frustum, in world units — the plan-view zoom level. */
  half: 40 * U,
  /** The camera the render loop, raycaster and resize all read; swapped by the toggle. */
  active: camera as THREE.Camera,
};

/** Re-fit the ortho frustum to the viewport aspect and re-centre it over the orbit target. */
export function syncTopCamera(): void {
  const aspect = innerWidth / innerHeight;
  topCamera.top = cam.half; topCamera.bottom = -cam.half;
  topCamera.left = -cam.half * aspect; topCamera.right = cam.half * aspect;
  const t = controls.target;
  topCamera.position.set(t.x, t.y, 10000); // height is arbitrary under ortho, just above all geometry
  topCamera.lookAt(t.x, t.y, 0);
  topCamera.updateProjectionMatrix();
  topCamera.updateMatrixWorld();
}

/** Switch between the 3D orbit view and the 2D plan view. */
export function setTopView(on: boolean): void {
  cam.top = on;
  cam.active = on ? topCamera : camera;
  controls.enableRotate = !on; // plan view keeps pan + zoom, drops orbit
  if (on) syncTopCamera();
  const b = document.getElementById('viewbtn');
  if (b) { b.textContent = on ? 'View: 2D' : 'View: 3D'; b.classList.toggle('on', on); }
  saveUiPrefs({ topView: on });
}

// Wheel zoom in plan view: OrbitControls dollies the (hidden) perspective camera,
// which does nothing to the ortho frustum, so adjust its half-height here instead.
addEventListener('wheel', (e) => {
  if (!cam.top) return;
  cam.half = Math.max(2 * U, Math.min(400 * U, cam.half * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
}, { passive: true });

// --- WASD panning ---
// Held keys move the camera and its orbit target together across the ground.
// Speed scales with zoom distance so it feels the same up close and far out.
export const keys = new Set();
export const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
addEventListener('keydown', (e) => { if (!isTyping(e.target)) keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear()); // don't keep sliding if focus is lost

const panVec = new THREE.Vector3(), fwdVec = new THREE.Vector3();
export function keyPan(dt: number): void {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (!f && !s) return;
  camera.getWorldDirection(fwdVec);
  fwdVec.z = 0;                                   // travel along the ground
  if (fwdVec.lengthSq() < 1e-6) fwdVec.set(0, 1, 0);
  fwdVec.normalize();
  const speed = camera.position.distanceTo(controls.target) * 0.9
    * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1) * dt;
  // right = forward × up, for a Z-up world
  panVec.set(fwdVec.x * f + fwdVec.y * s, fwdVec.y * f - fwdVec.x * s, 0).normalize().multiplyScalar(speed);
  camera.position.add(panVec);
  controls.target.add(panVec);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  syncTopCamera(); // keep the plan-view frustum matched to the new aspect
});

/** What the raycaster and the pointer handlers share. */
export const raycaster = new THREE.Raycaster();
export const ptr = new THREE.Vector2();
