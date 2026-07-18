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

  private constructor(path: string, t: Terrain) {
    this.path = path;
    this.t = t;
    this.V = t.V;
    this.N = t.N;
    this.layers = readTextureLayers(t);
    // Copies, not views: the views alias t.raw, which must stay pristine so
    // writeTerrain can use it as the untouched base for every other byte.
    this.masks = this.layers.map((l) => Uint8Array.from(readMask(t, l)));
    this.heights = Float32Array.from(readHeights(t));
    const f = readGroundFlags(t);
    this.flags = f ? Uint8Array.from(f) : null;
  }

  static open(path: string): TerrainDoc {
    return new TerrainDoc(path, parseTerrain(readFileSync(path)));
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

  /** Current mask for a layer, by tile path. Returns a copy. */
  maskOf(tilePath: string): Uint8Array | null {
    const i = this.layers.findIndex((l) => l.path === tilePath);
    return i < 0 ? null : Uint8Array.from(this.masks[i]!);
  }

  heightsCopy(): Float32Array { return Float32Array.from(this.heights); }
  flagsCopy(): Uint8Array | null { return this.flags ? Uint8Array.from(this.flags) : null; }

  /** Write every plane back to the file this was opened from. */
  save(): void {
    const buf = writeTerrain(this.t, {
      heights: this.heights,
      ...(this.flags ? { flags: this.flags } : {}),
      masks: this.layers.map((l, i) => ({ layer: l, data: this.masks[i]! })),
    });
    writeFileSync(this.path, buf);
    // Re-parse from what we just wrote so subsequent saves build on it. Offsets
    // do not move, but this keeps `t.raw` and the file in step by construction
    // rather than by assumption.
    this.t = parseTerrain(buf);
    this.layers = readTextureLayers(this.t);
    this.touched = false;
  }
}
