// The passability and footprint overlays — the original editor's Masks tab.
//
// Drawn into the floor's own group so they follow the terrain and vanish with
// it. Everything here is a view: the mask plane itself is edited by the brush
// (features/terrain-brush), which calls back in to refresh what is shown.

import * as THREE from 'three';

import { $ } from '#core/dom.ts';
import { heightOn } from '#core/coords.ts';
import { uiPrefs, saveUiPrefs } from '#core/prefs.ts';
import { state, activeFloor } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { Footprint } from '#src/scene/payload.ts';
import { geomFootprint } from '#viewport/geoms.ts';
import { asTileSpace, WATER_ORDER } from '#viewport/terrain-mesh.ts';

//
// The original editor's Masks tab paints impassable ground and shows it as a
// red wash. This shows the same thing, and ONLY that: the mask plane is the
// whole truth about blocking.
//
// It is tempting to also paint water red, on the grounds that you cannot walk
// there. That is backwards. Sea carries ground flag 0, which means NAVIGABLE —
// boats cross it — so it is not blocked at all, and the shipped maps agree:
// flag-0 vertices are masked 6.4% of the time against a 9.0% background, i.e.
// less often than average, precisely because there is nothing to block. A small
// pond that a designer wants closed off gets masked by hand like anything else.

/** Whether the wash and the grid are showing. */
export let showBlocked = uiPrefs.grid;

/** For callers that only need to know, not to set. */
export const blockedShown = (): boolean => showBlocked;

/**
 * A drop across one tile that a unit cannot climb.
 *
 * Every cell straddling a ground-kind boundary carries a step of 0.8 or more
 * (200 of 200 on map 12, 216 of 216 on A1M5), which is the mesher's own signal
 * for cutting a vertical face — so anything at or above it is a cliff edge.
 * Ordinary slopes inside one kind stay well under.
 */
const CLIFF_STEP = 0.8;

/**
 * How a tile reads for movement. Three states, because "can I walk here" and
 * "is this blocked" are different questions and the map answers them separately:
 * a lake stops a footman and carries a boat, and the format says so with the
 * ground flag rather than the mask.
 */
const PASS_WALK = 0, PASS_BLOCKED = 1, PASS_NAVIGABLE = 2;

/**
 * Classify every tile of a floor. Index = y*(V-1) + x.
 *
 * Blocking is a UNION, not just the mask. The mask records what a designer
 * decided by hand, and on a map where nobody opened the Masks tab it is empty —
 * Senya's map 12 has the plane at all ones despite being full of rivers and
 * cliffs. The rest is inherent to the terrain and the engine derives it:
 *
 *   * the river plane — you do not wade a river, which is why bog and lava
 *     flows stop you without anyone marking them,
 *   * a step too tall to climb, i.e. a cut face between plateau and ground.
 *
 * Navigable (sea) is not blocking: a boat crosses it.
 *
 * The passability plane is stored vertex-sized but addressed PER TILE — entry
 * (x, y) is tile (x, y), last row and column filler. Reading it as four corners
 * made a 1x1 mask stroke show up as 3x3.
 */
function classifyTiles(fl: Floor3D): Uint8Array {
  const V = fl.V, T = V - 1;
  const out = new Uint8Array(T * T); // zero-filled, and PASS_WALK is 0
  const water = (v: number): boolean => fl.flags ? fl.flags[v] === 0 : false;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const a = y * V + x, b = a + 1, c = a + V, d = c + 1;
    // Sea first: it is crossed by boat, so it is neither walkable nor blocked.
    if (water(a) && water(b) && water(c) && water(d)) { out[y * T + x] = PASS_NAVIGABLE; continue; }

    if (fl.passable && fl.passable[a] === 0) { out[y * T + x] = PASS_BLOCKED; continue; }
    if (fl.river.has(a) || fl.river.has(b) || fl.river.has(c) || fl.river.has(d)) {
      out[y * T + x] = PASS_BLOCKED; continue;
    }
    // A ramp is a deliberate walkable incline, and its half-step of 1.0 is taller
    // than the cliff threshold — so the slope rule would mark the one thing on
    // the map built to be climbed. The mesher skips ramp cells for the same
    // reason; this has to agree with it or the view contradicts the geometry.
    const ramp = fl.flags
      ? ((fl.flags[a]! | fl.flags[b]! | fl.flags[c]! | fl.flags[d]!) & 8) !== 0
      : false;
    if (ramp) continue;
    const h = [fl.heights[a]!, fl.heights[b]!, fl.heights[c]!, fl.heights[d]!];
    if (Math.max(...h) - Math.min(...h) > CLIFF_STEP) out[y * T + x] = PASS_BLOCKED;
  }
  return out;
}

/**
 * The terrain's own triangles for every tile of one class, lifted a hair.
 *
 * Not a flat quad per tile: a cell straddling a cut is split marching-squares
 * style into several triangles at different heights, and a quad laid across it
 * floats over the hole or pokes through the cliff face. Reusing the ground's
 * triangulation makes the overlay hug whatever the ground actually does — which
 * is why a half-submerged tile at a lake edge shows up as a triangle, exactly
 * as it does in the original editor.
 */
function tileFill(fl: Floor3D, cls: Uint8Array, want: number): THREE.BufferGeometry {
  const src = fl.terrainMesh.geometry;
  const pos = src.getAttribute('position');
  const index = src.getIndex();
  const triTile = src.userData.triTile as Int32Array | undefined;
  const out: number[] = [];
  const LIFT = 0.05;
  if (pos && index && triTile) {
    for (let t = 0; t < triTile.length; t++) {
      const tile = triTile[t]!;
      if (cls[tile] !== want) continue;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        out.push(pos.getX(v), pos.getY(v), pos.getZ(v) + LIFT);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeBoundingSphere();
  return g;
}

/** Outline of every tile of one class. */
function tileOutline(fl: Floor3D, cls: Uint8Array, want: number): THREE.BufferGeometry {
  const V = fl.V, T = V - 1;
  const pos: number[] = [];
  const LIFT = 0.1;
  const z = (x: number, y: number): number => fl.heights[y * V + x]! + LIFT;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (cls[y * T + x] !== want) continue;
    const c: [number, number][] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = c[k]!, [bx, by] = c[(k + 1) % 4]!;
      pos.push(ax, ay, z(ax, ay), bx, by, z(bx, by));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * The tile grid itself, following the ground.
 *
 * Movement in this game is per tile, so a wash of colour is only half the
 * answer — you also need to count squares to know whether a gap is passable.
 * Drawn for the whole floor at once: a 137x137 map is ~37k segments, which is
 * one buffer and no measurable cost.
 */
function tileGrid(fl: Floor3D): THREE.BufferGeometry {
  const V = fl.V;
  const LIFT = 0.06;
  const pos: number[] = [];
  const z = (x: number, y: number): number => fl.heights[y * V + x]! + LIFT;
  for (let y = 0; y < V; y++) for (let x = 0; x < V - 1; x++) {
    pos.push(x, y, z(x, y), x + 1, y, z(x + 1, y));
  }
  for (let x = 0; x < V; x++) for (let y = 0; y < V - 1; y++) {
    pos.push(x, y, z(x, y), x, y + 1, z(x, y + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeBoundingSphere();
  return g;
}

/** Rebuild the passability view for a floor. */
export function refreshBlocked(fl: Floor3D): void {
  for (const m of fl.passMeshes) {
    fl.group.remove(m);
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  }
  fl.passMeshes = [];
  // Footprints ride with the grid: rebuilt when it is on, cleared when off.
  // Done before the early return so turning the grid off actually removes them
  // rather than leaving the last set on the ground.
  refreshFootprints(fl);
  if (!showBlocked) return;

  const cls = classifyTiles(fl);
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, lines = false): void => {
    if (!g.getAttribute('position')?.count) { g.dispose(); mat.dispose(); return; }
    const mesh = asTileSpace(lines ? new THREE.LineSegments(g, mat) : new THREE.Mesh(g, mat));
    // The mask belongs to the GROUND, and water is a separate sheet lying over
    // it. Drawing before the sheet lets the sea tint what shows through, the way
    // a masked pond reads in the original editor: the bed is red, not the water.
    // Drawn last instead, it was a flat red film on top of the sea.
    mesh.renderOrder = WATER_ORDER - 1;
    fl.passMeshes.push(mesh as THREE.Mesh);
    fl.group.add(mesh);
  };

  const fill = (c: number, o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false,
  });
  // Bright and fairly opaque: this wash sits on ground that is already dark
  // rock or dirt half the time, and at 0.45 of a muted red it vanished into it.
  add(tileFill(fl, cls, PASS_BLOCKED), fill(0xff2020, 0.62));
  // Navigable water is outlined ON TOP of the sea rather than filled under it.
  // A fill beneath the sheet is invisible; a fill above it hides the water
  // texture, which is most of what makes a lake readable. An outline says "boat
  // goes here" and leaves the water looking like water.
  const navGrid = tileOutline(fl, cls, PASS_NAVIGABLE);
  if (navGrid.getAttribute('position')?.count) {
    const m = asTileSpace(new THREE.LineSegments(navGrid, new THREE.LineBasicMaterial({
      color: 0x6fb2ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    })));
    m.renderOrder = WATER_ORDER + 1;
    fl.passMeshes.push(m as unknown as THREE.Mesh);
    fl.group.add(m);
  } else navGrid.dispose();
  add(tileGrid(fl), new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false,
  }), true);
}

// The roles a building declares tiles for, with the colour each is drawn in.
// Ordered back-to-front: hole and passable first, then blocked, then the active
// tile on top, so where they overlap the more important one wins. Red blocked
// and green active are the pair Senya named; hole and passable get their own
// colours rather than being folded into those.
const FOOT_ROLES: [keyof Footprint, number, number][] = [
  ['hole', 0x9b59ff, 0.32],
  ['passable', 0xe8d23a, 0.32],
  ['blocked', 0xff2020, 0.5],
  ['active', 0x2ad04a, 0.62],
];

/** Merged footprint squares for one role across every building on the floor. */
export function footprintQuads(fl: Floor3D, role: keyof Footprint): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const inst of fl.instances) {
    const tiles = geomFootprint.get(inst.g)?.[role];
    if (!tiles || !tiles.length) continue;
    const cos = Math.cos(inst.r), sin = Math.sin(inst.r);
    // A tile (x, y) is the cell spanning grid [x, x+1] — its centre is at
    // (x+0.5, y+0.5), the same convention classifyTiles/tileOutline use. The
    // object sits at the cell's corner vertex, so anchor the footprint at the
    // cell centre; without the half-tile the squares straddled the grid lines.
    const ax = inst.x + 0.5, ay = inst.y + 0.5;
    for (const t of tiles) {
      // The tile's centre: the object's own cell plus this offset, turned with
      // the object so a rotated building's footprint rotates with it.
      const cx = ax + t.x * cos - t.y * sin;
      const cy = ay + t.x * sin + t.y * cos;
      // Each corner is sampled against the ground it sits over, so the square
      // hugs a slope instead of floating flat above it.
      const corner = (ox: number, oy: number): number[] => {
        const gx = cx + ox * cos - oy * sin;
        const gy = cy + ox * sin + oy * cos;
        return [gx, gy, heightOn(fl, gx, gy) + 0.06];
      };
      const a = corner(-0.5, -0.5), b = corner(0.5, -0.5), c = corner(0.5, 0.5), d = corner(-0.5, 0.5);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/**
 * Rebuild the building footprint squares. Kept apart from refreshBlocked's
 * passability wash because it only walks the placed objects, not the whole
 * V×V grid, so moving or rotating an object can refresh it cheaply.
 *
 * Drawn depth-test off, above the models: the original shows these as an
 * overlay lying over the building, not tucked under it.
 */
export function refreshFootprints(fl: Floor3D): void {
  for (const m of fl.footMeshes) {
    fl.group.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  fl.footMeshes = [];
  if (!showBlocked) return;
  for (const [role, color, opacity] of FOOT_ROLES) {
    const g = footprintQuads(fl, role);
    if (!g.getAttribute('position')?.count) { g.dispose(); continue; }
    const mesh = asTileSpace(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false,
    })));
    mesh.renderOrder = 900;
    fl.footMeshes.push(mesh as THREE.Mesh);
    fl.group.add(mesh);
  }
}

/** Refresh a floor's footprints if the grid is showing; a no-op otherwise. */
export function syncFootprints(fl: Floor3D = activeFloor()): void {
  if (showBlocked) refreshFootprints(fl);
}

export function setShowBlocked(on: boolean): void {
  showBlocked = on;
  $('blockbtn').classList.toggle('on', on);
  $('passlegend').style.display = on ? 'flex' : 'none';
  if (state.world) for (const fl of state.world.floors) refreshBlocked(fl);
  saveUiPrefs({ grid: on });
}
