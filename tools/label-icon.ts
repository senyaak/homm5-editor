// Draft perk icons: a shipped texture with a word stamped in the corner.
//
//   node tools/label-icon.ts <source> <label> <out.png> [--corner tr|tl|br|bl]
//   node tools/label-icon.ts Textures/HeroScreen/Perks/WarMachines_FirstAid.dds fix assets/skills/perk_fix.png
//
// A branch of our own needs an icon per perk, and three drawings of a tent that
// differ only in what they mean is not something anybody wants to draw twice.
// So the DRAFT is the game's own tent with the word on it — legible at 64
// pixels, obviously provisional, and replaced by pointing the perk at a real
// drawing later. The output is an ordinary picture in `assets/`, so nothing in
// the build knows this tool exists.
//
// The font is five pixels tall and drawn here rather than loaded: rendering
// text needs a rasteriser, a rasteriser needs a font file, and a font file for
// four letters in the corner of an icon is the wrong trade. Lowercase only,
// because that is what fits.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { pngDataUri, readPicture } from '../src/format/png.ts';

/** 3×5 glyphs, one string of five rows per character. `#` is ink. */
const FONT: Record<string, string[]> = {
  a: ['   ', '## ', ' ##', '###', ' ##'],
  b: ['#  ', '#  ', '## ', '# #', '## '],
  c: ['   ', ' ##', '#  ', '#  ', ' ##'],
  d: ['  #', '  #', ' ##', '# #', ' ##'],
  e: ['   ', ' # ', '###', '#  ', ' ##'],
  f: [' ##', ' # ', '###', ' # ', ' # '],
  i: [' # ', '   ', ' # ', ' # ', ' # '],
  l: ['#  ', '#  ', '#  ', '#  ', ' ##'],
  n: ['   ', '## ', '# #', '# #', '# #'],
  u: ['   ', '# #', '# #', '# #', ' ##'],
  x: ['   ', '# #', ' # ', ' # ', '# #'],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const [source, label, out] = positional;
if (!source || !label || !out) {
  console.error('usage: label-icon.ts <source .dds|.png|.gif> <label> <out.png> [--corner tr]');
  process.exit(2);
}

const REPO = join(import.meta.dirname, '..');
const dataRoot = process.env.HOMM5_DATA ?? join(REPO, 'data-unpacked');
const path = resolve(source.startsWith('/') || source.includes(':') ? source : join(dataRoot, source));
const bytes = readFileSync(path);
const image = path.toLowerCase().endsWith('.dds') ? decodeDDSBuffer(bytes) : readPicture(bytes, source);

const rgba = new Uint8Array(image.rgba);
const put = (x: number, y: number, r: number, g: number, b: number): void => {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  rgba[at] = r; rgba[at + 1] = g; rgba[at + 2] = b; rgba[at + 3] = 255;
};

const text = label.toLowerCase();
for (const ch of text) if (!FONT[ch]) throw new Error(`no glyph for "${ch}" — the font here is small on purpose`);
const width = text.length * 4 - 1;                       // 3 wide, 1 apart
const corner = flag('corner') ?? 'tr';
const x0 = corner.includes('l') ? 2 : image.width - width - 2;
const y0 = corner.startsWith('b') ? image.height - 8 : 2;

// A dark plate under the word, so it reads on a light icon as well as a dark one.
for (let y = y0 - 1; y < y0 + 6; y++) {
  for (let x = x0 - 1; x < x0 + width + 1; x++) put(x, y, 0, 0, 0);
}
text.split('').forEach((ch, i) => {
  FONT[ch]!.forEach((row, ry) => {
    row.split('').forEach((cell, rx) => {
      if (cell === '#') put(x0 + i * 4 + rx, y0 + ry, 255, 236, 160);
    });
  });
});

const uri = pngDataUri(image.width, image.height, rgba);
const target = resolve(out.includes(':') ? out : join(REPO, out));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
console.log(`${target} — ${image.width}x${image.height}, "${text}" in the ${corner} corner`);
