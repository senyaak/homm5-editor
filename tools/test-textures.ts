// Tests for how a texture reaches the renderer: how it is REDUCED
// (src/format/texture.ts) and how it TRAVELS (src/scene/tex-table.ts).
//
// Both were written for one complaint — the models in a dialog scene came out
// mush — and both have a failure mode that looks like success. A resampler that
// point-samples produces a picture of the right size; a packer that mutates
// what it packs produces a payload that draws perfectly, once. So the checks
// below are written to fail if either goes back to what it replaced:
//
//   - the averaging is asked for a case where sampling and averaging give
//     different numbers, and told what the average is;
//   - the packing is asked whether the payload it was GIVEN still holds its
//     pictures afterwards, which is the thing the geom resolver depends on.
//
// The last section needs game data and skips itself without it.

// needs: data
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ddsChain, decodeDDS } from '../src/format/dds.ts';
import { assets } from '../src/game/assets.ts';
import { resampleTo, shrinkToFit } from '../src/format/texture.ts';
import { setCompressedTextures, textureDataUri } from '../src/scene/materials.ts';
import type { CompressedPicture, Picture } from '../src/scene/payload.ts';
import { packTextures, unpackTextures } from '../src/scene/tex-table.ts';
import type { Image } from '../src/format/gif.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** An image from a list of [r,g,b,a] texels, row-major. */
function image(width: number, height: number, texels: number[][]): Image {
  const rgba = new Uint8Array(width * height * 4);
  texels.forEach((t, i) => rgba.set(t, i * 4));
  return { width, height, rgba };
}

const at = (img: Image, i: number): number[] => [...img.rgba.subarray(i * 4, i * 4 + 4)];

function testShrink(): void {
  console.log('\nREDUCING A TEXTURE');

  const small = image(2, 2, [[1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255], [10, 11, 12, 255]]);
  check('a texture under the cap is handed back untouched', shrinkToFit(small, 512) === small);
  check('and so is one exactly at it', shrinkToFit(small, 2) === small);

  // Halving, both sides, so the shape survives the trip: a 512x256 skin used to
  // be squashed onto a 128x128 square, which cost it half its width for nothing.
  const wide = image(512, 256, []);
  const fit = shrinkToFit(wide, 128);
  check('the cap is on the LONGEST side, and the shape is kept',
    fit.width === 128 && fit.height === 64, `${fit.width}x${fit.height}`);

  // The check that tells averaging from sampling. Point sampling returns one of
  // the four corners — 0, 100, 200 or 40 — and only the mean is 85.
  const quad = image(2, 2, [[0, 0, 0, 255], [100, 100, 100, 255], [200, 200, 200, 255], [40, 40, 40, 255]]);
  const one = shrinkToFit(quad, 1);
  check('four texels become their MEAN, not one of them',
    at(one, 0)[0] === 85, `${at(one, 0)[0]}`);

  // A DXT1 cutout stores its transparent texels as black. Weighted by alpha,
  // the leaf keeps its colour and only its alpha falls; unweighted, it would
  // come out at half brightness — the black fringe around foliage.
  const leaf = image(2, 1, [[200, 40, 40, 255], [0, 0, 0, 0]]);
  const mixed = shrinkToFit(leaf, 1);
  check('colour is averaged in proportion to alpha', at(mixed, 0)[0] === 200, `${at(mixed, 0)[0]}`);
  check('…and the alpha itself is the plain mean', at(mixed, 0)[3] === 128, `${at(mixed, 0)[3]}`);

  // Nothing to weight by: the colour under a wholly transparent box is still
  // the colour a particle is drawn from, so it is kept rather than zeroed.
  const ghost = image(2, 1, [[10, 20, 30, 0], [30, 40, 50, 0]]);
  const kept = shrinkToFit(ghost, 1);
  check('a wholly transparent box keeps its colour', at(kept, 0)[0] === 20, `${at(kept, 0)[0]}`);

  const asked = resampleTo(small, 8, 8);
  check('resampleTo refuses to enlarge', asked === small);
  check('resampleTo squares a picture for an atlas cell',
    resampleTo(image(4, 2, []), 2, 2).width === 2);
}

function testTable(): void {
  console.log('\nSENDING EACH TEXTURE ONCE');

  const red = 'data:image/png;base64,AAAA';
  const blue = 'data:image/png;base64,BBBB';
  const shared = { tex: red, alphaMode: 'AM_OPAQUE' };
  const payload = {
    geoms: [
      { pos: [1.5, 2.5, 3.5], idx: [0, 1, 2], parts: [shared, { tex: blue, alphaMode: 'AM_OPAQUE' }] },
      // The same part object, named twice — a geom used by fifty trees.
      { pos: [0, 0, 0], parts: [shared] },
    ],
    fx: [{ textures: [null, { c: red, a: blue }] }],
    name: 'not a picture',
  };
  const before = JSON.stringify(payload);

  const { payload: packed, textures } = packTextures(payload);
  check('one entry per distinct picture', textures.length === 2, `${textures.length}`);
  check('a packed field is a handle, not a picture',
    /^\0tex\d+$/.test(packed.geoms[0]!.parts[0]!.tex), packed.geoms[0]!.parts[0]!.tex);

  // The one that matters for the main process: the geom resolver keeps the
  // scene it built, and an object placed later is meshed from it.
  check('the payload it was given is untouched', JSON.stringify(payload) === before);

  check('what did not change is SHARED with the original, not copied',
    packed.geoms[0]!.pos === payload.geoms[0]!.pos);
  check('a part named twice is still one object after packing',
    packed.geoms[0]!.parts[0] === packed.geoms[1]!.parts[0]);

  unpackTextures(packed, textures);
  check('unpacking gives back exactly what was built', JSON.stringify(packed) === before);

  // Nothing to put back, and nothing broken by asking.
  const plain = { parts: [{ tex: null }] };
  unpackTextures(plain, []);
  check('an empty table is a no-op', plain.parts[0]!.tex === null);
}

function testAgainstData(): void {
  console.log('\nAGAINST THE GAME’S OWN TEXTURES');
  const root = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
  // A hero's head atlas: 512x512 in the file, which is the size a cutscene
  // camera gets close enough to read.
  const rel = 'Characters/Heroes/H5A2/Isabel_Ghost-head.(Texture).xdb';
  if (!existsSync(join(root, rel))) {
    console.log('  skip  no unpacked data at ' + root);
    return;
  }
  const data = assets([root]);
  const big = textureDataUri('', data, 512, '/' + rel);
  check('a 512 skin arrives at 512 under the default cap', big?.picture.width === 512,
    big ? String(big.picture.width) : 'null');
  check('as its texels, the buffer the size says', !!big && 'rgba' in big.picture && big.picture.rgba.byteLength === 512 * 512 * 4);

  const again = textureDataUri('', data, 512, '/' + rel);
  check('asked twice, it is decoded once and the same picture comes back',
    !!again && again.picture === big!.picture);

  const small = textureDataUri('', data, 128, '/' + rel);
  check('a lower cap really does reduce it', small?.picture.width === 128);
  const bytesOf = (p: Picture | CompressedPicture): number => 'levels' in p ? p.levels.reduce((n, l) => n + l.data.byteLength, 0) : p.rgba.byteLength;
  check('and the reduction is smaller than the original',
    !!small && bytesOf(small.picture) < bytesOf(big!.picture),
    `${small ? (bytesOf(small.picture) / 1024) | 0 : 0} KB vs ${(bytesOf(big!.picture) / 1024) | 0} KB`);
  // The file carries a mip chain, and the cap reads the level off it rather
  // than reducing the top one (dds.ts): a 128 from a 512 is the file's third level.
  const raw = decodeDDS(data.path(dirname('/' + rel) + '/' + readFileSync(data.path('/' + rel), 'utf8').match(/<DestName href="([^"]+)"/)![1]!));
  const level2 = decodeDDS(data.path(dirname('/' + rel) + '/' + readFileSync(data.path('/' + rel), 'utf8').match(/<DestName href="([^"]+)"/)![1]!), 128);
  check('the 128 is the file\'s own level, not the top one box-filtered', raw.width === 512 && level2.width === 128
    && !level2.rgba.every((v: number, i: number) => v === shrinkToFit(raw, 128).rgba[i]));

  // With a GPU that takes S3TC, the same ask comes back as the file's blocks
  // and mip chain, padded to 1×1 with blocks of the average colour.
  setCompressedTextures(true);
  const dxt = textureDataUri('', data, 512, '/' + rel);
  setCompressedTextures(false);
  const c = dxt && 'levels' in dxt.picture ? dxt.picture : null;
  check('as blocks, when the window said it can take them', !!c && c.width === 512 && c.format === 'DXT3' && c.levels.length === 10,
    c ? `${c.format} ${c.levels.length} levels` : 'not compressed');
  check('the chain runs to 1×1', !!c && c.levels.at(-1)!.width === 1 && c.levels.at(-1)!.height === 1);
  check('each level is the blocks its size takes', !!c && c.levels.every((l) => l.data.byteLength === Math.ceil(l.width / 4) * Math.ceil(l.height / 4) * 16));
  check('and a quarter of the texels\' bytes, chain and all', !!c && bytesOf(c) * 2 < bytesOf(big!.picture), c ? `${(bytesOf(c) / 1024) | 0} KB` : '');
  check('the alpha verdict is the same read off a small level', !!dxt && dxt.hasAlpha === big!.hasAlpha && dxt.opaque === big!.opaque);

  // A non-square chain: the padded tail has as many blocks as its level
  // needs (4×8 is two), or the GPU refuses the level as the wrong size.
  const tall = join(root, 'Textures', 'auto-imported', 'Creatures', 'Dungeon', 'BlackDragon', 'BlackDragon.tga.dds');
  if (existsSync(tall)) {
    const chain = ddsChain(readFileSync(tall), 512);
    const bb = chain?.format === 'DXT1' ? 8 : 16;
    let w = chain?.width ?? 0, h = chain?.height ?? 0, sized = !!chain;
    for (const l of chain?.levels ?? []) {
      if (l.width !== w || l.height !== h || l.data.byteLength !== Math.ceil(w / 4) * Math.ceil(h / 4) * bb) sized = false;
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    check('a non-square chain has every level the size its blocks take, down to 1×1', sized && w === 1 && h === 1,
      chain ? `${chain.width}×${chain.height}, ${chain.levels.length} levels` : 'no chain');
  }
}

testShrink();
testTable();
testAgainstData();

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
