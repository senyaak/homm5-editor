// Making a texture the game will load.
//
// The game reads `.dds` beside a `.(Texture).xdb` that says how to read it, and
// the pair has to agree: the xdb declares the size and the format, the dds
// carries the pixels. Writing one without the other is the only way to get a
// texture that is present and invisible.
//
// Only the ONE format the interface uses: `TF_8888`, uncompressed 32-bit, no
// mip-maps. Measured off the shipped artifact icons — 64x64, 16512 bytes, which
// is a 128-byte header and exactly one 64*64*4 surface. DXT compression is what
// the rest of the game's art uses and is deliberately not attempted here: an
// icon is small, and a compressor is a lot of code to get subtly wrong.

import type { Image } from './gif.ts';

const EOL = '\r\n';

/** DDS header flags: caps | height | width | pixelformat, plus pitch. */
const DDSD = 0x1 | 0x2 | 0x4 | 0x1000 | 0x8;
/** Pixel-format flags: uncompressed RGB with alpha. */
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_RGB = 0x40;
const DDSCAPS_TEXTURE = 0x1000;

/**
 * A `.dds` holding `image` as uncompressed BGRA.
 *
 * BGRA, not RGBA: the masks below say which byte is which, and these are the
 * ones the shipped icons use. Swapping them gives a picture in the right shape
 * with red and blue exchanged, which reads as an art mistake rather than a
 * format one.
 */
export function writeDDS(image: Image): Buffer {
  const { width, height, rgba } = image;
  const header = Buffer.alloc(128);
  header.write('DDS ', 0, 'latin1');
  header.writeUInt32LE(124, 4);            // header size, always 124
  header.writeUInt32LE(DDSD, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(width * 4, 20);     // pitch, one row in bytes
  header.writeUInt32LE(0, 24);             // depth
  header.writeUInt32LE(1, 28);             // mip-map count
  header.writeUInt32LE(32, 76);            // pixel-format size
  header.writeUInt32LE(DDPF_RGB | DDPF_ALPHAPIXELS, 80);
  header.writeUInt32LE(0, 84);             // fourCC — none, this is uncompressed
  header.writeUInt32LE(32, 88);            // bits per pixel
  header.writeUInt32LE(0x00ff0000, 92);    // red mask
  header.writeUInt32LE(0x0000ff00, 96);    // green
  header.writeUInt32LE(0x000000ff, 100);   // blue
  header.writeUInt32LE(0xff000000, 104);   // alpha
  header.writeUInt32LE(DDSCAPS_TEXTURE, 108);

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = rgba[i * 4 + 2]!;
    pixels[i * 4 + 1] = rgba[i * 4 + 1]!;
    pixels[i * 4 + 2] = rgba[i * 4]!;
    pixels[i * 4 + 3] = rgba[i * 4 + 3]!;
  }
  return Buffer.concat([header, pixels]);
}

/**
 * The `.xdb` that tells the game how to read the `.dds` beside it.
 *
 * `SrcName` names the authoring original — a `.tga` the game never shipped. It
 * is kept because every shipped texture has one and it is where the picture
 * came from; nothing reads it at run time.
 */
export function textureDoc(o: {
  dds: string;
  width: number;
  height: number;
  /** The authoring source, for the record. */
  source?: string;
  /** `CLAMP` for an icon, which must not tile. */
  addressing?: 'CLAMP' | 'WRAP';
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Texture>',
    `\t<SrcName href="${o.source ?? ''}"/>`,
    `\t<DestName href="${o.dds}"/>`,
    '\t<Type>REGULAR</Type>',
    // What the shipped icons use: the picture's own alpha decides what shows.
    '\t<ConversionType>CONVERT_TRANSPARENT</ConversionType>',
    `\t<AddrType>${o.addressing ?? 'CLAMP'}</AddrType>`,
    '\t<Format>TF_8888</Format>',
    `\t<Width>${o.width}</Width>`,
    `\t<Height>${o.height}</Height>`,
    '\t<MappingSize>0</MappingSize>',
    '\t<NMips>1</NMips>',
    '\t<Gain>0</Gain>',
    '\t<AverageColor>0</AverageColor>',
    '\t<InstantLoad>true</InstantLoad>',
    '\t<IsDXT>false</IsDXT>',
    '\t<FlipY>false</FlipY>',
    '\t<StandardExport>true</StandardExport>',
    '\t<UseS3TC>false</UseS3TC>',
  ].join(EOL) + `${EOL}</Texture>${EOL}`;
}

/**
 * The picture on a square canvas of `size`, centred, with the edges left clear.
 *
 * Nearest-neighbour, and scaling only DOWN. The pictures this exists for are
 * Heroes III icons at 58x64 going onto a 64x64 texture, so the honest thing is
 * to place them, not to interpolate: smoothing a 58-pixel-wide drawing up to 64
 * loses the crispness that is most of what those icons are.
 */
export function fitSquare(image: Image, size: number): Image {
  const rgba = new Uint8Array(size * size * 4);
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const dx = Math.floor((size - w) / 2);
  const dy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const from = (sy * image.width + sx) * 4;
      const to = ((dy + y) * size + dx + x) * 4;
      rgba[to] = image.rgba[from]!;
      rgba[to + 1] = image.rgba[from + 1]!;
      rgba[to + 2] = image.rgba[from + 2]!;
      rgba[to + 3] = image.rgba[from + 3]!;
    }
  }
  return { width: size, height: size, rgba };
}
