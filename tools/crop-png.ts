// Cut a region out of a PNG and magnify it, for looking at one detail closely.
//
//   node tools/crop-png.ts in.png out.png x y w h [scale]
//
// Why this exists: a full frame out of `view.snapshot()` or a shot sheet is
// 1900 px wide, and the things that go wrong in it are small — which way a
// blade of grass points, whether a decal z-fights, where a seam lands. Looked
// at whole, the frame says "grass"; looked at 3x on one patch, it says the
// blades hang downward, which is how the upside-down particle frame was found
// (docs/EFFECTS_FORMAT.md §5). Nearest-neighbour on purpose: it magnifies
// without inventing pixels, so what you see is what the renderer wrote.

import { readFileSync, writeFileSync } from 'node:fs';
import { readPng, pngDataUri } from '../src/format/png.ts';

const [inp, outp, xs, ys, ws, hs, ss] = process.argv.slice(2);
if (!inp || !outp || !ws || !hs) {
  console.error('usage: node tools/crop-png.ts in.png out.png x y w h [scale]');
  process.exit(2);
}
const img = readPng(readFileSync(inp));
const x = +xs!, y = +ys!, w = +ws, h = +hs, s = ss ? +ss : 2;
const out = new Uint8Array(w * s * h * s * 4);
for (let j = 0; j < h * s; j++) {
  for (let i = 0; i < w * s; i++) {
    // Clamped rather than wrapped: a crop that runs off the edge should smear
    // the border, not fold the far side of the frame into it.
    const sx = Math.min(img.width - 1, x + Math.floor(i / s));
    const sy = Math.min(img.height - 1, y + Math.floor(j / s));
    const from = (sy * img.width + sx) * 4, to = (j * w * s + i) * 4;
    out[to] = img.rgba[from]!; out[to + 1] = img.rgba[from + 1]!;
    out[to + 2] = img.rgba[from + 2]!; out[to + 3] = img.rgba[from + 3]!;
  }
}
writeFileSync(outp, Buffer.from(pngDataUri(w * s, h * s, out).split(',')[1]!, 'base64'));
console.log(`${outp} ${w * s}x${h * s} from ${img.width}x${img.height}`);
