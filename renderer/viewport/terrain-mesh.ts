// The terrain surface: the ground mesh, the sea sheet, and the cut cells where
// a cliff drops between two tiers.
//
// Everything here works in GRID space (one unit per tile) and is stretched to
// world spacing by the group transform (asTileSpace) — the cut-cell meshing and
// the per-triangle tile map both rely on those buffers staying in grid units.

import * as THREE from 'three';

import { uiPrefs } from '#core/prefs.ts';
import { tierOf, RAMP_BIT, TIER_STEP } from '#src/terrain.ts';
import { UNITS_PER_TILE as U } from '#src/units.ts';
import type { TileInfo } from '#src/scene.ts';

/**
 * A point on a cut cell's boundary ring. Corners reuse their existing grid
 * vertex; a cut sits at an edge midpoint and carries TWO heights, since the cut
 * follows the terrain rather than sitting level.
 */
interface RingCorner { cut: false; up: boolean; gi: number }
interface RingCut { cut: true; xy: [number, number]; hz: number; lz: number }
type RingPoint = RingCorner | RingCut;

// Height -> RGB (0..1). Below ~1 reads as water; above ramps green -> rocky tan,
// mirroring the reference software render's palette.
export function terrainColor(h: number): [number, number, number] {
  if (h < 1) return [0.15, 0.28, 0.34];        // water
  const t = Math.max(0, Math.min(1, (h - 1) / 7));
  return [(70 + t * 70) / 255, (95 + t * 50) / 255, (60 + t * 30) / 255];
}

/** Draw order for the sea sheet; the ground overlay lands underneath it. */
export const WATER_ORDER = 2;

/**
 * Stretch a grid-space object to the real tile spacing.
 *
 * The renderer's world is the game's world, so anything laid out by walking the
 * grid — the ground, the sea, the passability overlays, the brush cursor — is
 * stretched here instead of every loop that builds one multiplying as it goes.
 * Z is untouched: heights are already world units.
 */
export function asTileSpace<T extends THREE.Object3D>(o: T): T {
  o.scale.set(U, U, 1);
  return o;
}

export function waterCells(V: number, flags: number[] | null): number[] {
  if (!flags) return [];
  const cells: number[] = [];
  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    const a = y * V + x;
    // Cover every cell touching water and let the terrain occlude the sheet:
    // the bed sits at 0 and the shore climbs to 2.0, so a flat sheet is cut
    // exactly where the beach crosses it -- a real waterline for free.
    if (!flags[a] || !flags[a + 1] || !flags[a + V] || !flags[a + V + 1]) cells.push(a);
  }
  return cells;
}

/** The flat sea sheet over those cells. Rebuilt whenever sculpting floods or drains one. */
export function waterGeometry(V: number, cells: number[], level: number): THREE.BufferGeometry {
  const wpos: number[] = [], wuv: number[] = [], widx: number[] = [];
  const vmap = new Map<number, number>();
  const vert = (i: number): number => {
    let v = vmap.get(i);
    if (v === undefined) {
      v = wpos.length / 3;
      const x = i % V, y = (i / V) | 0;
      wpos.push(x, y, level);
      wuv.push(x / 8, y / 8); // gentle tiling; the sheet is mostly flat colour
      vmap.set(i, v);
    }
    return v;
  };
  for (const a of cells) {
    const A = vert(a), B = vert(a + 1), C = vert(a + V), D = vert(a + V + 1);
    widx.push(A, B, C, B, D, C);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpos), 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wuv), 2));
  wg.setIndex(widx);
  wg.computeVertexNormals();
  return wg;
}

/**
 * The sea sheet over `cells`, with its own material.
 *
 * Built here rather than inline in buildFloor because sculpting can raise a sea
 * on a map that started dry -- lowering ground to 0 floods it -- and that needs
 * the same mesh, texture and all, without a reload.
 */
export function makeWaterMesh(V: number, cells: number[], level: number, tex: string | null): THREE.Mesh {
  const wg = waterGeometry(V, cells, level);
  // The sea wears its own sheet -- dark by design. Rivers are a different thing
  // entirely: painted tiles using the blue _TNL brush textures.
  const wmat = new THREE.MeshPhongMaterial({
    color: 0xffffff, transparent: true, opacity: 0.88,
    shininess: 90, specular: 0x5f7f95, side: THREE.DoubleSide, depthWrite: false,
  });
  if (tex) {
    const wt = new THREE.TextureLoader().load(tex);
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    wt.colorSpace = THREE.SRGBColorSpace; // diffuse sheet: decode sRGB, see above
    wmat.map = wt;
  } else {
    wmat.color.setHex(0x0a2b2e); // fall back to the sheet's own dark tone
  }
  const mesh = asTileSpace(new THREE.Mesh(wg, wmat));
  mesh.renderOrder = WATER_ORDER;
  return mesh;
}

/**
 * Build a floor's terrain geometry from its height and flag planes.
 *
 * Split out of buildFloor because the height brush has to rebuild it: sculpting
 * moves vertices AND can flip a vertex between water and ground, which changes
 * where cells are cut. Re-running the whole thing is far simpler than patching
 * the affected cells in place, and on a 137x137 map it costs a few ms -- cheap
 * enough to do once per brush tick.
 */
export function terrainGeometry(
  V: number, heights: number[], flags: number[] | null, colors: number[] | null,
): THREE.BufferGeometry {
  const tg = new THREE.BufferGeometry();
  const tp = new Float32Array(V * V * 3);
  const tc = new Float32Array(V * V * 3);
  // Half-texel offset: vertex (x,y) must land on mask texel (x,y)'s CENTRE, or
  // the splat weights drift half a tile against the heightmap.
  const tuv = new Float32Array(V * V * 2);
  // Prefer the real ground colours (blended tile textures incl. roads); fall
  // back to height-based colouring only when no texture layers resolved.
  const gc = colors;
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    const i = y * V + x, o = i * 3, h = heights[i];
    tp[o] = x; tp[o + 1] = y; tp[o + 2] = h;
    tuv[i * 2] = (x + 0.5) / V; tuv[i * 2 + 1] = (y + 0.5) / V;
    if (gc) { tc[o] = gc[o]; tc[o + 1] = gc[o + 1]; tc[o + 2] = gc[o + 2]; }
    else { const [r, g, b] = terrainColor(h); tc[o] = r; tc[o + 1] = g; tc[o + 2] = b; }
  }
  // --- cliff-aware meshing -------------------------------------------------
  // The ground is built from flat steps, not a smooth field: 92.5% of map 12's
  // cells have all four corners at the same height (68.8% on A1M5). The cells
  // that don't are transitions, and there are two kinds. A RAMP (flag bit 3) is
  // a deliberate walkable incline — a whole cell the height slides down. Every
  // other big step is a CUT, and interpolating it across the cell turns a sheer
  // edge into a diagonal slide, which is why shorelines looked like grass
  // poured over the side.
  //
  // So cut cells are split marching-squares style: the corners snap to the
  // cell's high or low level, the boundary runs through the midpoints of the
  // two edges that straddle it, each side is laid flat, and a vertical quad
  // joins them. Diagonal (checkerboard) cases are ambiguous, so those fall back
  // to the smooth quad.
  // A cut is a change of GROUND KIND, not merely a steep spot. Height alone is
  // the wrong signal: raise a hill and smooth it and its slopes get as steep as
  // a cliff, yet it stays smooth ground. What actually marks an edge is the flag
  // plane — and it is emphatic about it. Every single cell straddling a kind
  // boundary carries a step of 0.8 or more: 200 of 200 on map 12, 216 of 216 on
  // A1M5, 16 of 16 on A2C2M3. Meanwhile cells wholly inside one kind reach 12.4
  // of relief on A2C2M3 while still being smooth hillside.
  //
  // So: any change of tier is cut — water to land, ground to plateau, plateau to
  // the plateau stacked on it — while anything within one tier is smooth however
  // steep. Ramps (bit 3) sit half a tier up and stay smooth across the boundary,
  // which is what makes them walkable.
  const fl = flags;
  // The flag is the tier number times 16 (plus 8 for a ramp), so a cut forms
  // wherever the TIER changes — 0 water, 1 ground, 2+ stacked plateaus, each
  // 2.0 above the last. Lumping everything above ground into one "plateau" kind
  // smoothed away the edge between a plateau and the plateau raised on top of
  // it, which is a wall in the game.
  const tierOf = (i: number): number => fl![i]! >> 4;
  const isRamp = (i: number): boolean => (fl![i]! & 8) !== 0;
  const MIN_STEP = 0.1; // a boundary with no real drop isn't worth a wall

  const ti: number[] = [];
  // Which tile each triangle belongs to, so an overlay can follow the ground
  // exactly instead of laying flat quads over it. Cut cells are split into
  // several triangles at odd angles, and a quad drawn across one floats over
  // the hole or pokes through the cliff.
  const triTile: number[] = [];
  let cell = 0;
  /** Push triangles for the current cell, recording which cell they came from. */
  const emit = (...idx: number[]): void => {
    for (let i = 0; i < idx.length; i += 3) triTile.push(cell);
    ti.push(...idx);
  };
  const extra: number[] = [];          // [x, y, z] triples appended after the grid vertices
  const addV = (x: number, y: number, z: number): number => {
    extra.push(x, y, z);
    return V * V + extra.length / 3 - 1;
  };

  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    cell = y * (V - 1) + x;
    // corner indices, counter-clockwise from (x,y)
    const ci = [y * V + x, y * V + x + 1, (y + 1) * V + x + 1, (y + 1) * V + x];
    const h = ci.map((i) => heights[i]);
    const smooth = () => { const [a, b, c, d] = [ci[0], ci[1], ci[3], ci[2]]; emit(a, b, c, b, d, c); };
    if (!fl) { smooth(); continue; }
    if (ci.some(isRamp)) { smooth(); continue; }

    const k0 = tierOf(ci[0]);
    if (ci.every((i) => tierOf(i) === k0)) { smooth(); continue; } // all one tier
    if (Math.max(...h) - Math.min(...h) < MIN_STEP) { smooth(); continue; }

    // The boundary is authoritative; heights only say which side is up.
    const level = (Math.max(...h) + Math.min(...h)) / 2;
    const up = h.map((v) => v > level);
    const nUp = up.filter(Boolean).length;
    if (nUp === 0 || nUp === 4) { smooth(); continue; }
    // Checkerboard: two crossings on each diagonal, no single boundary line.
    if ((up[0] === up[2]) && (up[1] === up[3])) { smooth(); continue; }

    // Ring of the cell boundary: corner, edge-midpoint, corner, ... (CCW).
    // A cut is NOT level. A plateau dropped onto uneven ground inherits that
    // unevenness, so the edge flows with it — raise one side and the cut rises
    // with it. Flattening each side to a single height was what produced the
    // rectangular tabs along the rim. So corners keep their OWN heights (and
    // their existing grid vertices, which also welds the cell to its smooth
    // neighbours), and each break point carries two: the upper surface's height
    // and the lower one's, taken from the corners that edge spans.
    const cxy = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const ring: RingPoint[] = [];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      ring.push({ cut: false, up: up[k], gi: ci[k] });
      if (up[k] !== up[n]) {
        ring.push({
          cut: true,
          xy: [(cxy[k][0] + cxy[n][0]) / 2, (cxy[k][1] + cxy[n][1]) / 2],
          hz: up[k] ? h[k] : h[n],   // where the upper surface meets the break
          lz: up[k] ? h[n] : h[k],   // where the lower one does
        });
      }
    }
    const cuts = ring.filter((p): p is RingCut => p.cut);
    if (cuts.length !== 2) { smooth(); continue; }

    // Walk the ring from one cut to the other: one arc is the high side, the
    // other the low side.
    const start = ring.findIndex((p) => p.cut);
    const arcs: RingPoint[][] = [[], []];
    let side = 0;
    for (let k = 0; k <= ring.length; k++) {
      const p = ring[(start + k) % ring.length]!;
      arcs[side]!.push(p);
      if (p.cut && k > 0 && k < ring.length) { side = 1; arcs[1]!.push(p); }
    }
    const cutHi = cuts.map((p) => addV(p.xy[0], p.xy[1], p.hz));
    const cutLo = cuts.map((p) => addV(p.xy[0], p.xy[1], p.lz));

    for (const arc of arcs) {
      const corners = arc.filter((p): p is RingCorner => !p.cut);
      if (!corners.length) continue;
      const top = corners[0].up;
      const ends = [arc[0], arc[arc.length - 1]] as [RingCut, RingCut];
      const edge = (p: RingCut) => (top ? cutHi : cutLo)[cuts.indexOf(p)];
      const poly = [edge(ends[0]), ...corners.map((p) => p.gi), edge(ends[1])];
      for (let k = 1; k < poly.length - 1; k++) emit(poly[0], poly[k], poly[k + 1]);
    }
    // The wall, both faces (material is DoubleSide anyway).
    emit(cutHi[0], cutHi[1], cutLo[0], cutHi[1], cutLo[1], cutLo[0]);
  }
  // Cut cells contributed vertices beyond the regular grid; append them, taking
  // uv from their position and colour from the grid vertex they sit nearest.
  const nExtra = extra.length / 3;
  const pos = new Float32Array((V * V + nExtra) * 3);
  const col = new Float32Array((V * V + nExtra) * 3);
  const uvs = new Float32Array((V * V + nExtra) * 2);
  pos.set(tp); col.set(tc); uvs.set(tuv);
  for (let k = 0; k < nExtra; k++) {
    const x = extra[k * 3], y = extra[k * 3 + 1], z = extra[k * 3 + 2];
    const o = (V * V + k) * 3, u = (V * V + k) * 2;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    uvs[u] = (x + 0.5) / V; uvs[u + 1] = (y + 0.5) / V;
    const gi = (Math.min(V - 1, Math.round(y)) * V + Math.min(V - 1, Math.round(x))) * 3;
    col[o] = tc[gi]; col[o + 1] = tc[gi + 1]; col[o + 2] = tc[gi + 2];
  }

  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tg.setIndex(ti); tg.computeVertexNormals();
  tg.userData.triTile = new Int32Array(triTile);
  return tg;
}
