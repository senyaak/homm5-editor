// Adding a texture layer to GroundTerrain.bin.
//
// Every other terrain edit overwrites bytes in place, because a plane's size is
// fixed for the life of a map. This one is different: a tile the map has no
// layer for means a new mask array plus its (AdvMapTile) path spliced into the
// stream, which moves everything after it and changes the byte length of every
// block that encloses it. The record encoding and the tree walk that finds those
// blocks live in `terrain-records.ts`.
//
// --- the layer layout ------------------------------------------------------
//
//   04 <size>                     the layer container
//     02 08 <u32 count>           how many layers follow
//     01 <size>                   one layer:
//       02 <size>
//         01 08 <u32 V>           grid side, twice, as everywhere else
//         02 08 <u32 V>
//         03 <size> <V*V bytes>   the weight mask
//       03 <size> 03 <size> <path>
//     01 <size>  ...
//
// So inserting a layer means: build the record, splice it after the last one,
// bump the count, and grow the size field of every ancestor block. Miss one
// ancestor and the file still parses — the trailing planes just quietly become
// unreachable — so the tests compare every pre-existing plane byte for byte.

import { parseTerrain, readTextureLayers } from './terrain.ts';
import type { Terrain } from './terrain.ts';
import { ancestors, children, growBlock, header, isBlock, scalar } from './terrain-records.ts';
import type { Block, Scalar } from './terrain-records.ts';

/** Suffix the game appends to every tile reference. */
const XPOINTER = '#xpointer(/AdvMapTile)';

/** The layer container, plus what it takes to splice a sibling into it. */
interface LayerContainer {
  /** The container and everything enclosing it, outermost first. These are the
   *  blocks whose declared length must grow; the layer records inside must not. */
  enclosing: Block[];
  count: Scalar;
  /** End of the last layer record — where a new one goes. */
  insertAt: number;
}

function findLayerContainer(b: Buffer, t: Terrain, layerCount: number): LayerContainer {
  const layers = readTextureLayers(t);
  const first = layers[0];
  if (!first) throw new Error('this terrain has no texture layers to extend');
  const chain = ancestors(b, first.maskOff);
  // The container is the enclosing block that declares how many layers follow.
  // Identifying it by its own count, rather than by tag or position, means a map
  // that orders its blocks differently still resolves correctly.
  for (let i = chain.length - 1; i >= 0; i--) {
    const blk = chain[i]!;
    const kids = children(b, blk.body, blk.bodyEnd);
    const count = kids.find((r): r is Scalar => !isBlock(r) && r.int === layerCount);
    if (!count) continue;
    const records = kids.filter(isBlock);
    const last = records[records.length - 1];
    if (!last) continue;
    // The last layer usually ends exactly where the container does, so "which
    // blocks contain the insertion point" is ambiguous at that boundary: the
    // answer would include the layer record itself, which must NOT grow — the
    // new record is its sibling, not its content. Taking the chain down to the
    // container and stopping decides it by structure instead of by offset.
    return { enclosing: chain.slice(0, i + 1), count, insertAt: last.bodyEnd };
  }
  throw new Error('could not locate the texture-layer container');
}

/** Build one complete layer record: an all-zero mask plus its tile path. */
function buildLayerRecord(V: number, tilePath: string): Buffer {
  const N = V * V;
  const mask = Buffer.concat([header(0x03, N), Buffer.alloc(N)]);
  const maskInner = Buffer.concat([scalar(0x01, V), scalar(0x02, V), mask]);
  const maskBlock = Buffer.concat([header(0x02, maskInner.length), maskInner]);

  const full = tilePath.endsWith(XPOINTER) ? tilePath : tilePath + XPOINTER;
  const str = Buffer.from(full, 'latin1');
  // Shipped maps only ever use the one-byte size for a path, so a longer one
  // would be written in a form nothing has been observed to accept. Refuse
  // rather than guess: no tile the game ships comes close to this.
  if (str.length > 127) throw new Error(`tile path too long to encode (${str.length} > 127): ${full}`);
  const pathInner = Buffer.concat([header(0x03, str.length), str]);
  const pathOuter = Buffer.concat([header(0x03, pathInner.length), pathInner]);

  const body = Buffer.concat([maskBlock, pathOuter]);
  return Buffer.concat([header(0x01, body.length), body]);
}

/**
 * Add a texture layer for `tilePath`, returning a NEW buffer.
 *
 * The mask starts empty, so the map looks unchanged until something paints
 * with it. The new layer goes last, which is also lowest in the file order —
 * the renderer sorts by the tile's <Priority> regardless.
 *
 * @throws if the terrain already has a layer for this tile.
 */
export function addTextureLayer(raw: Buffer, tilePath: string): Buffer {
  const t = parseTerrain(raw);
  const layers = readTextureLayers(t);
  const bare = tilePath.replace(XPOINTER, '');
  if (layers.some((l) => l.path === bare)) throw new Error(`this terrain already has a layer for ${bare}`);

  const { enclosing, count, insertAt } = findLayerContainer(raw, t, layers.length);
  const rec = buildLayerRecord(t.V, bare);

  const out = Buffer.concat([raw.subarray(0, insertAt), rec, raw.subarray(insertAt)]);

  // One more layer than before.
  out.writeUInt32LE(layers.length + 1, count.off + 2);

  // Every block enclosing the splice now spans more bytes. Missing one leaves a
  // file that still parses while silently truncating a later plane, which is
  // why this uses the real chain rather than assuming a nesting depth.
  for (const anc of enclosing) growBlock(out, anc, rec.length);

  return out;
}
