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
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readMask, writeTerrain,
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

  /** The current state as a buffer — every working copy written back into the container. */
  private compose(): Buffer {
    return writeTerrain(this.t, {
      heights: this.heights,
      ...(this.flags ? { flags: this.flags } : {}),
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
