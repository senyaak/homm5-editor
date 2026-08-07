// The terrain brush: what it paints, how hard, and the cursor that shows it.
//
// A stroke is collected here and committed to the main process in one go —
// the map model is the source of truth, and a stroke that is still being
// dragged has not happened yet as far as the file is concerned.

//
// Painting is applied twice: into the mask texture on the GPU, so the stroke
// appears under the cursor with no round trip, and — on pointer-up — into the
// main process, which owns the bytes that get saved. The two use the same rule
// (target layer to full strength, every other layer cleared at that vertex),
// because the shader composites by priority: raising the target alone would
// leave any higher-priority layer sitting on top of the new paint.
//
// The renderer's copy is never read back. A reload always takes what the main
// process wrote, so the GPU copy drifting would show up immediately rather than
// corrupting anything.

import { fillTool } from '#features/fill.ts';
import { region, regionDraw } from '#features/regions.ts';
import { markDirty } from '#core/dirty.ts';
import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { activeFloor, state } from '#core/state.ts';
import { committing } from '#features/terrain-brush/sculpt.ts';
import { refreshBlocked, setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { cam, ptr, raycaster, scene, syncTopCamera, topCamera } from '#viewport/stage.ts';
import { asTileSpace } from '#viewport/terrain-mesh.ts';
import type { Floor3D } from '#core/state.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';
import { uiPrefs } from '#core/prefs.ts';
import * as THREE from 'three';

/**
 * A tile rectangle, inclusive, clamped to the map.
 *
 * Every brush works from one of these. A square brush is the rectangle around
 * the cursor; the Rect size is the rectangle dragged out between two corners.
 * Keeping "which cells" in one place is what let Rect be added withouteach brush
 * growing its own copy of the geometry.
 */
export interface TileRect { x0: number; y0: number; x1: number; y1: number }

/** The rectangle a square brush of `size` covers, centred on tile (cx, cy). */
export function squareRect(cx: number, cy: number, size: number): TileRect {
  const k = Math.floor(Math.max(1, size) / 2);
  return { x0: cx - k, y0: cy - k, x1: cx + k, y1: cy + k };
}

/** Tiles in a rectangle, as indices into a vertex-sized plane. */
export function rectTiles(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 2, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 2, r.x1); x++) out.push(y * V + x);
  }
  return out;
}

/** Corner vertices of every tile in a rectangle — one more along each axis. */
export function rectVerts(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 1, r.y1 + 1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 1, r.x1 + 1); x++) out.push(y * V + x);
  }
  return out;
}

function brushTiles(V: number, cx: number, cy: number, size: number): number[] {
  const k = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - k; y <= cy + k; y++) {
    if (y < 0 || y >= V - 1) continue;
    for (let x = cx - k; x <= cx + k; x++) {
      if (x < 0 || x >= V - 1) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Vertices of a square brush of `size` tiles centred on tile (cx, cy). */
function brushVerts(V: number, cx: number, cy: number, size: number): number[] {
  const r = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r + 1; y++) {
    if (y < 0 || y >= V) continue;
    for (let x = cx - r; x <= cx + r + 1; x++) {
      if (x < 0 || x >= V) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Write the stroke into the GPU masks. Layer i lives in group i/3, channel i%3. */
export function paintMaskTexture(fl: Floor3D, layerIdx: number, verts: number[], strength = 255, exclusive = true): void {
  const tex = fl.maskTex, s = fl.splat;
  if (!tex || !s) return;
  const data = tex.image.data;
  if (!data) return; // the texture always carries its data; three's type says maybe
  const n = fl.V * fl.V;
  const at = (i: number, v: number): number => ((i / 3 | 0) * n + v) * 4 + (i % 3);
  for (const v of verts) {
    if (!exclusive) { data[at(layerIdx, v)] = strength; continue; }
    for (let i = 0; i < s.layerCount; i++) data[at(i, v)] = i === layerIdx ? strength : 0;
  }
  tex.needsUpdate = true;
}
/**
 * What the brush is set to. One object because the strip, the palette and the
 * pointer all write it — an ESM import cannot be assigned, and the alternative
 * was a setter per field.
 */
export const brush = {
  /** Armed: a left-drag edits the terrain rather than orbiting. */
  on: false,
  /** In tiles: 1, 3, 5, 7. */
  size: 1,
  /** Which edit a stroke performs. */
  mode: 'paint' as BrushMode,
  /** Height direction for the sculpt modes; 0 for the rest. */
  dir: 0,
  /** How far one stroke moves the plane, and how far it tapers. */
  force: uiPrefs.brushForce,
  tension: uiPrefs.brushTension,
  /** Drag out a rectangle instead of stamping a square. */
  rect: false,
  /** Move the single nearest corner rather than a tile's worth. */
  vertex: false,
};

/** The edits a stroke can make — the strip's mode selector. */
export type BrushMode = 'paint' | 'bulk' | 'dig' | 'raise' | 'lower' | 'ramp' | 'level' | 'kind' | 'river' | 'mask' | 'erase';
/** The live state of a stroke — the pointer writes it, the brushes read it. */
export const stroke = {
  /** A drag is editing the terrain right now (the camera is held off). */
  painting: false,
  /** The last tile a held brush ticked on, and when. */
  lastTile: -1,
  lastTick: 0,
  /** Where a Rect drag started, in tiles. */
  rectAnchor: null as { x: number; y: number } | null,
};
/** Vertices touched by the stroke in progress, deduped. */
export const strokeVerts = new Set<number>();


/** Paint or erase the mask under the brush. */
export function maskAt(tiles: number[], walkable: boolean): void {
  const fl = activeFloor();
  // A map made by New Map has no mask plane yet: the format leaves the slot
  // empty and the main process fills it in on the first stroke. Start one here
  // too, all walkable, or the brush would do nothing on a fresh map.
  if (!fl.passable) fl.passable = new Array<number>(fl.V * fl.V).fill(1);
  const fresh = tiles.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) return;
  for (const v of fresh) {
    strokeVerts.add(v);
    fl.passable[v] = walkable ? 1 : 0;
  }
  // The overlay is the only feedback this brush has, so force it on: masking
  // blind would be indistinguishable from the tool not working.
  if (!showBlocked) setShowBlocked(true); else refreshBlocked(fl);
}

/** Send the finished mask stroke. */
export async function commitMask(walkable: boolean): Promise<void> {
  if (!strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(api.setMask({ floor: state.world.active, verts, walkable }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'mask failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- brush cursor ----------------------------------------------------------
//
// The system cursor says nothing about what a stroke will cover: the brush is
// square, sized in tiles, and lands on the grid, none of which an arrow conveys.
// So the arrow is hidden while the brush is armed and replaced by the footprint
// drawn on the ground — every cell it will touch, following the terrain.
//
// Drawn with depthTest off so it stays readable inside a pit or behind a hill.
// A gizmo that disappears exactly where the ground is interesting is worse than
// none, and a depth offset large enough to survive a cliff would float visibly
// over flat ground.

let brushCursor: THREE.LineSegments | null = null;

function ensureBrushCursor(): THREE.LineSegments {
  if (brushCursor) return brushCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false,
  });
  brushCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  brushCursor.renderOrder = 999;
  brushCursor.visible = false;
  scene.add(brushCursor);
  return brushCursor;
}

/** Redraw the footprint outline over tile (cx, cy), or hide it when off-map. */
export function updateBrushCursor(at: { x: number; y: number } | null): void {
  const c = ensureBrushCursor();
  if (!at || !state.world) { c.visible = false; return; }
  const fl = activeFloor();
  // Mid-drag in Rect mode the footprint is the rectangle so far, not a square
  // under the cursor — otherwise the one size whose shape you choose yourself is
  // the one size you cannot see before committing to it.
  // The region tool drags out a rectangle the same way, and wants the same
  // preview: which tiles the region will cover, before it exists.
  // The fill tool paints tiles with a brush of its own, and drags out a
  // rectangle the same way — so it wants the same preview, from its own size.
  const anchor = regionDraw ? region.anchor
    : fillTool.on ? fillTool.anchor
      : brush.rect ? stroke.rectAnchor : null;
  const r = anchor
    ? { x0: Math.min(anchor.x, at.x), y0: Math.min(anchor.y, at.y),
        x1: Math.max(anchor.x, at.x), y1: Math.max(anchor.y, at.y) }
    : squareRect(at.x, at.y,
      regionDraw ? 1
        : fillTool.on ? (fillTool.rect ? 1 : fillTool.size)
          : brush.rect ? 1 : brush.size);
  const LIFT = 0.05; // just clear of the surface, so it reads as lying on it
  const z = (x: number, y: number): number => {
    const cx = Math.min(fl.V - 1, Math.max(0, x)), cy = Math.min(fl.V - 1, Math.max(0, y));
    return fl.heights[cy * fl.V + cx]! + LIFT;
  };
  const pts: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    pts.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  // Every cell edge in the footprint, so the grid reads as tiles rather than
  // one box — the brush works per tile and should look like it.
  for (let y = r.y0; y <= r.y1 + 1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (y < 0 || y >= fl.V || x < 0 || x + 1 >= fl.V) continue;
      seg(x, y, x + 1, y);
    }
  }
  for (let x = r.x0; x <= r.x1 + 1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (x < 0 || x >= fl.V || y < 0 || y + 1 >= fl.V) continue;
      seg(x, y, x, y + 1);
    }
  }
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  c.visible = pts.length > 0;
}

// A quiet one-tile marker that follows the mouse whenever no brush or object is
// armed, so it is always clear which square a click would act on — the same job
// the brush gizmo does while armed, kept up the rest of the time.
let hoverCursor: THREE.LineSegments | null = null;

function ensureHoverCursor(): THREE.LineSegments {
  if (hoverCursor) return hoverCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.7, depthTest: false,
  });
  hoverCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  hoverCursor.renderOrder = 998; // just under the brush gizmo's 999
  hoverCursor.visible = false;
  scene.add(hoverCursor);
  return hoverCursor;
}

/** Outline the single cell under the cursor, or hide it when off-map. */
export function updateHoverCursor(at: { x: number; y: number } | null): void {
  const c = ensureHoverCursor();
  const fl = state.world ? activeFloor() : null;
  // A cell (x, y) needs its far corner (x+1, y+1) to exist, so stop one short.
  if (!at || !fl || at.x < 0 || at.y < 0 || at.x + 1 >= fl.V || at.y + 1 >= fl.V) {
    c.visible = false; return;
  }
  const LIFT = 0.05;
  const z = (x: number, y: number): number => fl.heights[y * fl.V + x]! + LIFT;
  const x = at.x, y = at.y;
  const p: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    p.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  seg(x, y, x + 1, y); seg(x + 1, y, x + 1, y + 1);
  seg(x + 1, y + 1, x, y + 1); seg(x, y + 1, x, y);
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeBoundingSphere();
  c.visible = true;
}

/** Tile under the cursor, from a ray against the terrain itself (so it follows hills). */
export function tileUnderCursor(ev: PointerEvent): { x: number; y: number } | null {
  return tileAtClient(ev.clientX, ev.clientY);
}

/**
 * The VERTEX nearest the cursor — the grid corner, not the tile.
 *
 * Heights live on vertices, and a map has one more of them per side than it has
 * tiles, so the outermost row and column can only be addressed this way. It
 * rounds where the tile pick floors, off the same ray.
 */
export function vertexAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const V = activeFloor().V;
  const x = Math.round(p.x / U), y = Math.round(p.y / U);
  if (x < 0 || y < 0 || x >= V || y >= V) return null;
  return { x, y };
}

/**
 * The position under the cursor WITHOUT rounding it to a tile, in tiles.
 *
 * What Alt-placement and Alt-drag use. A shipped mission is not laid out on the
 * grid alone: C1M1 puts 218 of its 2645 objects at an arbitrary fraction of a
 * tile — not halves, so no finer grid would catch them either.
 */
export function freeTileAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const T = activeFloor().V - 1;
  const x = p.x / U, y = p.y / U;
  if (x < 0 || y < 0 || x >= T || y >= T) return null;
  return { x: +x.toFixed(3), y: +y.toFixed(3) };
}

/** Same, from bare client coordinates — what the automation hook picks with. */
export function tileAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const T = activeFloor().V - 1;
  const x = Math.floor(p.x / U), y = Math.floor(p.y / U);
  if (x < 0 || y < 0 || x >= T || y >= T) return null;
  return { x, y };
}

/**
 * The ground position under the pointer, in world units.
 *
 * In the plan view the ray is vertical, so where it lands on the ground plane
 * follows from the camera alone — and taking it from the camera is not just
 * cheaper but MORE correct than asking what the ray hit. A cut face between two
 * tiers stands vertical, edge-on to this camera, and a ray grazing one reports a
 * hit sitting exactly on the grid line between two vertices; rounding that
 * lands on the neighbour. Rebuilding C1M1 that way put 18 of 9409 vertices on
 * the wrong side of a steep step, every one of them beside a tall spike.
 *
 * The 3D view has no such shortcut: there the ray is oblique and the ground's
 * height is what decides where it meets, so it still asks the geometry.
 */
export function groundPointAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!state.world) return null;
  if (cam.top) {
    syncTopCamera();
    const aspect = innerWidth / innerHeight;
    const ndcX = (clientX / innerWidth) * 2 - 1, ndcY = -(clientY / innerHeight) * 2 + 1;
    return {
      x: topCamera.position.x + ndcX * cam.half * aspect,
      y: topCamera.position.y + ndcY * cam.half,
    };
  }
  const p = hitPointAtClient(clientX, clientY);
  return p ? { x: p.x, y: p.y } : null;
}

/** Where a ray through these client coordinates meets the ground, in world units. */
function hitPointAtClient(clientX: number, clientY: number): THREE.Vector3 | null {
  if (!state.world) return null;
  ptr.x = (clientX / innerWidth) * 2 - 1;
  ptr.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, cam.active);
  const ground = activeFloor().terrainMesh;
  // The raycaster tests against matrixWorld, and three.js only refreshes that
  // while rendering. The ground carries a real transform now — it is built in
  // grid space and stretched to tile spacing — so a stale matrix is no longer
  // harmlessly the identity: it aims the ray at a map half the size and every
  // pick misses. Cheap to make certain, and it removes the dependency on a
  // frame having been drawn between the mesh appearing and the first click.
  ground.updateMatrixWorld();
  const hit = raycaster.intersectObject(ground, false)[0];
  // intersectObject reports the hit in world units, whatever the mesh's own
  // transform; the callers divide by U to get grid coordinates.
  return hit ? hit.point : null;
}
