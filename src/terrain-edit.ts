// The editable terrain document: one open GroundTerrain.bin, its planes decoded
// into working arrays, and the brush operations that mutate them.
//
// This is the authoritative copy. The renderer keeps its own mask arrays purely
// so a brush stroke shows up at once — it paints into the GPU texture and sends
// the same op here, and a reload always takes what this file wrote. Nothing in
// the renderer is ever read back.
//
// Layers are addressed by tile path, not by index. The renderer's layer order
// comes from buildSplat, which sorts by the tile's <Priority>, while the order
// here is the order the planes appear in the file. Keying on the path means the
// two never have to agree on an ordering.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readMask, readWaterPlane,
  readPassability, writeTerrain,
} from './terrain.ts';
import { addTextureLayer } from './terrain-layer.ts';
import type { Terrain, TextureLayer } from './terrain.ts';

/** Vertex indices (y*V + x) a brush touches. */
export type VertexList = readonly number[];

export class TerrainDoc {
  readonly path: string;
  readonly V: number;
  readonly N: number;
  private t: Terrain;
  private layers: TextureLayer[];
  /** Working copy of each layer's mask, parallel to `layers`. */
  private masks: Uint8Array[];
  private heights: Float32Array;
  private flags: Uint8Array | null;
  /** Explicit passability mask: 0 blocked, 1 walkable. */
  private passable: Uint8Array | null;
  /** The half-tile river plane, (2V-1)². Null on a terrain that has none. */
  private river: Uint8Array | null;
  /** Side of the river grid, 2V-1. */
  private riverW = 0;
  private touched = false;

  private constructor(path: string, raw: Buffer) {
    this.path = path;
    // Assigned by load(); declared here so the checker sees them initialised.
    this.t = parseTerrain(raw);
    this.V = this.t.V;
    this.N = this.t.N;
    this.layers = [];
    this.masks = [];
    this.heights = new Float32Array(0);
    this.flags = null;
    this.river = null;
    this.passable = null;
    this.load(raw);
  }

  static open(path: string): TerrainDoc {
    return new TerrainDoc(path, readFileSync(path));
  }

  /** Parse `raw` and take fresh working copies of every plane. */
  private load(raw: Buffer): void {
    const t = parseTerrain(raw);
    this.t = t;
    this.layers = readTextureLayers(t);
    // Copies, not views: a view aliases t.raw, which must stay pristine so
    // writeTerrain can use it as the untouched base for every other byte.
    this.masks = this.layers.map((l) => Uint8Array.from(readMask(t, l)));
    this.heights = Float32Array.from(readHeights(t));
    const f = readGroundFlags(t);
    this.flags = f ? Uint8Array.from(f) : null;
    const pa = readPassability(t);
    this.passable = pa ? Uint8Array.from(pa) : null;
    const r = readWaterPlane(t);
    this.river = r ? Uint8Array.from(r.data) : null;
    this.riverW = r ? r.W : 0;
  }

  /**
   * Mark vertices as river in the half-tile plane.
   *
   * This plane is what makes a river a river to the game — the tile texture
   * alone is just paint. It sits on a (2V-1)² grid, so a vertex (x,y) lands at
   * (2y, 2x) and the cell between two river vertices gets the midpoint between
   * them, which is what keeps a stroke connected rather than dotted.
   */
  /**
   * Write the river plane directly, cell by cell, at a chosen strength.
   *
   * The plane is finer than the vertex grid and graded rather than binary, and
   * shipped maps use both: of C1M1's 2317 wet cells only 502 sit on a vertex,
   * and they carry 134 distinct values. `setRiver` below — vertex footprints at
   * full strength — cannot express either, which is fine for drawing a river by
   * hand and not enough to reproduce one.
   *
   * @param cells indices into the (2V-1)² plane
   * @param value 0..255; 0 erases
   */
  setRiverCells(cells: readonly number[], value: number): void {
    const r = this.river;
    if (!r) return;
    const v = Math.max(0, Math.min(255, Math.round(value)));
    for (const c of cells) {
      if (c < 0 || c >= r.length) continue;
      r[c] = v;
    }
    this.touched = true;
  }

  setRiver(verts: VertexList, on = true): void {
    const r = this.river;
    if (!r) return;
    const W = this.riverW, V = this.V;
    const set = (hx: number, hy: number): void => {
      if (hx < 0 || hx >= W || hy < 0 || hy >= W) return;
      r[hy * W + hx] = on ? 255 : 0;
    };
    const wet = new Set(verts);
    for (const v of verts) {
      const x = v % V, y = (v / V) | 0;
      set(2 * x, 2 * y);
      // Bridge to river neighbours so the stroke reads as continuous.
      if (wet.has(v + 1) && x + 1 < V) set(2 * x + 1, 2 * y);
      if (wet.has(v - 1) && x > 0) set(2 * x - 1, 2 * y);
      if (wet.has(v + V) && y + 1 < V) set(2 * x, 2 * y + 1);
      if (wet.has(v - V) && y > 0) set(2 * x, 2 * y - 1);
    }
    this.touched = true;
  }

  /**
   * Mark vertices blocked or walkable in the explicit passability mask — the
   * original editor's Masks tab.
   *
   * The mask is the whole truth about blocking. Sea is not in it and should not
   * be: ground flag 0 means navigable, so a boat crosses it — which is why
   * flag-0 vertices are masked only 6.4% of the time against a 9.0% background,
   * less often than average rather than more. What goes here is what a designer
   * decides by hand: an unfordable river, a rock field, a pond too small to
   * sail, a scripted barrier.
   */
  setPassable(verts: VertexList, walkable: boolean): void {
    const p = this.passable;
    if (!p) return;
    for (const v of verts) {
      if (v < 0 || v >= this.N) continue;
      p[v] = walkable ? 1 : 0;
    }
    this.touched = true;
  }

  /** True where the vertex is explicitly masked as blocked. */
  isBlocked(vert: number): boolean {
    return this.passable ? this.passable[vert] === 0 : false;
  }

  /** True where the river plane is already set for this vertex. */
  isRiver(vert: number): boolean {
    if (!this.river) return false;
    const x = vert % this.V, y = (vert / this.V) | 0;
    return this.river[(2 * y) * this.riverW + 2 * x]! > 0;
  }

  /** True when there are edits not yet written to disk. */
  get dirty(): boolean { return this.touched; }

  /** Tile paths this terrain has layers for — the only tiles paintable today. */
  layerPaths(): string[] {
    return this.layers.map((l) => l.path ?? '');
  }

  /**
   * Paint `tilePath` over `verts`.
   *
   * The shader composites layers by priority, so raising the target layer alone
   * would leave any higher-priority layer painted on top of it. A hard brush
   * therefore clears every other layer at those vertices — paint replaces.
   *
   * @param strength 0..255 opacity written into the target layer.
   */
  paintTile(tilePath: string, verts: VertexList, strength = 255): void {
    const target = this.layers.findIndex((l) => l.path === tilePath);
    if (target < 0) throw new Error(`this map has no layer for ${tilePath}`);
    const s = Math.max(0, Math.min(255, Math.round(strength)));
    for (const v of verts) {
      if (v < 0 || v >= this.N) continue;
      for (let i = 0; i < this.masks.length; i++) {
        this.masks[i]![v] = i === target ? s : 0;
      }
    }
    this.touched = true;
  }

  /**
   * Set the height (and ground flag) of specific vertices.
   *
   * The caller supplies final values rather than a delta. Height brushes apply
   * a falloff, and duplicating that maths on both sides of the IPC boundary
   * would be two chances to get it different; this way there is one answer.
   *
   * @param flags one per vertex, or null to leave the flag plane alone.
   */
  setVertices(verts: VertexList, heights: readonly number[], flags: readonly number[] | null): void {
    if (heights.length !== verts.length) {
      throw new Error(`heights length ${heights.length} != verts ${verts.length}`);
    }
    if (flags && flags.length !== verts.length) {
      throw new Error(`flags length ${flags.length} != verts ${verts.length}`);
    }
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k]!;
      if (v < 0 || v >= this.N) continue;
      this.heights[v] = heights[k]!;
      if (flags && this.flags) this.flags[v] = flags[k]!;
    }
    this.touched = true;
  }

  /**
   * Add a texture layer for a tile this terrain does not carry, so it becomes
   * paintable. The new mask starts empty, so nothing changes on screen until
   * something paints with it.
   *
   * Unlike every other edit this changes the file's structure, so the working
   * copies are rebuilt from the grown buffer rather than patched — offsets past
   * the splice have all moved.
   */
  addLayer(tilePath: string): void {
    // Fold pending edits in first: the insert works on bytes, and anything not
    // yet written back would be dropped when the working copies are rebuilt.
    this.load(addTextureLayer(this.compose(), tilePath));
    this.touched = true;
  }

  /** The current state as a buffer, edits included. */
  buffer(): Buffer { return this.compose(); }

  /**
   * Replace every plane with the contents of `raw`.
   *
   * For undo, which works on the bytes this document composes rather than on
   * the meaning of any one edit. Marked dirty because the file on disk is now
   * whatever the last save left there, which is not what is held here.
   */
  restore(raw: Buffer): void {
    this.load(raw);
    this.touched = true;
  }

  /** The current state as a buffer — every working copy written back into the container. */
  private compose(): Buffer {
    return writeTerrain(this.t, {
      heights: this.heights,
      ...(this.flags ? { flags: this.flags } : {}),
      ...(this.river ? { water: this.river } : {}),
      ...(this.passable ? { passable: this.passable } : {}),
      masks: this.layers.map((l, i) => ({ layer: l, data: this.masks[i]! })),
    });
  }

  /** Current mask for a layer, by tile path. Returns a copy. */
  maskOf(tilePath: string): Uint8Array | null {
    const i = this.layers.findIndex((l) => l.path === tilePath);
    return i < 0 ? null : Uint8Array.from(this.masks[i]!);
  }

  heightsCopy(): Float32Array { return Float32Array.from(this.heights); }
  flagsCopy(): Uint8Array | null { return this.flags ? Uint8Array.from(this.flags) : null; }

  /** Write every plane back to the file this was opened from. */
  save(): void {
    const buf = this.compose();
    writeFileSync(this.path, buf);
    // Re-parse from what we just wrote so subsequent saves build on it. Offsets
    // do not move, but this keeps `t.raw` and the file in step by construction
    // rather than by assumption.
    this.t = parseTerrain(buf);
    this.layers = readTextureLayers(this.t);
    this.touched = false;
  }
}
