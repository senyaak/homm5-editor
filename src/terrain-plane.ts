// Giving a map its passability plane.
//
// A fresh map has no plane to write into: New Map's output ends with three empty
// trailer blocks, and the passability plane is one of them — tag 15, present but
// declared 0×0 with no array. Until it is filled in, "this tile is blocked"
// simply has nowhere to go, and every mask stroke on a from-scratch map is lost.
//
// So this is not an insert of something new so much as filling in a slot the
// format already reserves. Comparing a blank against a shipped mission, byte by
// byte, the two trailers differ in exactly that:
//
//   blank    0d 18 <0,0>   0e 02 00   0f 18 <0,0>   10 18 <0,0>   end
//   C1M1     0d 18 <0,0>   0e 02 b8   0f <V,V, N bytes>          end
//
// Every one of the 282 shipped GroundTerrain.bin carries the passability plane
// in tag 15, and 278 of them have it filled: it is the same slot, always.
//
// A map that has no tag-15 slot at all (two of the 282, both odd combat arenas)
// gets a fresh block appended to the plane container instead, which is the same
// splice `terrain-layer.ts` does for a texture layer.
//
// The one-byte tag-14 record next to it stays untouched. Its low bit tracks
// whether the coarse tag-16 LOD block follows (279 of 282 maps agree, and every
// map with the bit set has the block); the other bits vary without correlating
// to anything the file holds — including whether the passability plane is there
// at all, which 46 maps set the bit for and 46 leave clear. Nothing suggests the
// engine reads it: our own blanks carry 0 with a tag-16 block present, which is
// what the original editor writes, and three shipped maps disagree the same way.

import { parseTerrain, passabilityPlane, PASSABLE } from './terrain.ts';
import type { Terrain } from './terrain.ts';
import { ancestors, children, growBlock, header, isBlock, scalar } from './terrain-records.ts';
import type { Block } from './terrain-records.ts';

/** The trailer block the passability plane lives in, on every map seen. */
const PASSABILITY_TAG = 0x0f;

/** Build a complete plane block: the grid dimensions twice, then the data. */
function buildPlaneBlock(tag: number, V: number, fill: number): Buffer {
  const N = V * V;
  const data = Buffer.alloc(N, fill);
  const inner = Buffer.concat([scalar(0x01, V), scalar(0x02, V), header(0x03, N), data]);
  return Buffer.concat([header(tag, inner.length), inner]);
}

/**
 * The block whose children are the planes — layers, height, the u8 planes and
 * the trailer — plus everything enclosing it, outermost first. These are the
 * blocks whose declared length must grow around the splice.
 *
 * Found from the height plane rather than by tag or position: walking out from
 * height, the first few blocks each wrap a single thing (the array record, then
 * the plane block); the container is the first one holding SEVERAL. So a file
 * that nests its blocks differently still resolves.
 */
function planeContainer(raw: Buffer, t: Terrain): { container: Block; enclosing: Block[] } {
  if (!t.height) throw new Error('no height plane — not a terrain container');
  const chain = ancestors(raw, t.height.dataOff);
  for (let i = chain.length - 1; i >= 0; i--) {
    const blk = chain[i]!;
    if (children(raw, blk.body, blk.bodyEnd).filter(isBlock).length < 2) continue;
    return { container: blk, enclosing: chain.slice(0, i + 1) };
  }
  throw new Error('could not locate the plane container');
}

/**
 * Add the passability plane to a terrain that has none, returning a NEW buffer.
 *
 * The plane starts all walkable, so the map plays exactly as it did until
 * something masks a tile.
 *
 * @throws if the terrain already has one — overwriting is `writeTerrain`'s job.
 */
export function addPassabilityPlane(raw: Buffer): Buffer {
  const t = parseTerrain(raw);
  if (passabilityPlane(t)) throw new Error('this terrain already has a passability plane');

  const { container, enclosing } = planeContainer(raw, t);
  const kids = children(raw, container.body, container.bodyEnd).filter(isBlock);
  // The empty slot: a tag-15 block with no array in it, which is what a blank
  // carries. Anything with a body larger than the two dimension scalars is a
  // plane already, and parseTerrain would have found it.
  const slot = kids.find((k) => k.tag === PASSABILITY_TAG && k.bodyEnd - k.body <= 12);
  const block = buildPlaneBlock(PASSABILITY_TAG, t.V, PASSABLE);

  // Fill the slot in place where there is one, otherwise append a sibling at the
  // end of the container — the same splice a new texture layer gets.
  const from = slot ? slot.off : container.bodyEnd;
  const to = slot ? slot.bodyEnd : container.bodyEnd;
  const out = Buffer.concat([raw.subarray(0, from), block, raw.subarray(to)]);
  const delta = block.length - (to - from);

  // Every block enclosing the splice now spans more bytes — including the
  // container itself, since the plane goes inside it. Missing one leaves a file
  // that still parses while silently truncating a later plane. The chain comes
  // from the height plane rather than from the splice point: appending puts the
  // new block exactly where the container ends, and "which blocks contain that
  // offset" is ambiguous at the boundary — it is the container's sibling by
  // offset and its child by structure.
  for (const anc of enclosing) growBlock(out, anc, delta);

  return out;
}
