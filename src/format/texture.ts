// Making a texture the game will load, and the picture arithmetic either side
// of that needs — `magnify`, `fitSquare`, `shrinkToFit`.
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
 * The picture at a whole multiple of its size — every pixel becoming a square
 * block of them.
 *
 * The counterpart to `fitSquare`'s refusal to enlarge, and the exception that
 * refusal leaves: a hero's portrait is drawn at 58x64 and his frame is 128x128,
 * so it has to grow or sit lost in the middle of a black field. Doubling by
 * whole pixels is the one enlargement that invents nothing — no blend, no
 * half-tone along an edge the artist drew sharp — which is the same reason
 * fitSquare will not interpolate downwards.
 */
export function magnify(image: Image, times: number): Image {
  if (times <= 1) return image;
  const width = image.width * times;
  const height = image.height * times;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / times);
    for (let x = 0; x < width; x++) {
      const from = (sy * image.width + Math.floor(x / times)) * 4;
      const to = (y * width + x) * 4;
      rgba[to] = image.rgba[from]!;
      rgba[to + 1] = image.rgba[from + 1]!;
      rgba[to + 2] = image.rgba[from + 2]!;
      rgba[to + 3] = image.rgba[from + 3]!;
    }
  }
  return { width, height, rgba };
}

/**
 * The picture in its own shape, no bigger than `cap` on either side, with every
 * source texel that lands in a target one AVERAGED into it.
 *
 * This is what the renderer's models are textured from, and it is written the
 * way it is because of what it replaced. The old path took ONE source texel per
 * target texel onto a fixed 128x128 SQUARE: a 512x512 hero skin threw away 15
 * of every 16 texels — Isabel's face is a quarter of her atlas, so it arrived
 * about 50 texels across — and a 512x256 skin was squashed into a square
 * besides. At the distance a dialog scene puts the camera, that is the mush
 * Senya reported. Averaging is also exactly what a mip level is, so a texture
 * reduced here and one the GPU reduces further from it agree.
 *
 * It never ENLARGES: a 64x64 skin under a cap of 512 comes back untouched
 * rather than as four times the bytes carrying no more detail. Most shipped
 * textures are that way round — 64x64 is the commonest size in the game.
 *
 * RGB is averaged in proportion to ALPHA, and only falls back to a plain mean
 * where the whole box is transparent. A DXT1 cutout stores its transparent
 * texels as BLACK, so a leaf edge mixed with the void behind it comes out
 * fringed in black otherwise — which is the one thing alpha-tested foliage
 * shows off.
 */
export function shrinkToFit(image: Image, cap: number): Image {
  let width = image.width;
  let height = image.height;
  // Halving, so a power-of-two texture stays one and the box below is a whole
  // number of texels wide. The aspect ratio rides along.
  while (width > cap || height > cap) {
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return resampleTo(image, width, height);
}

/**
 * The picture at exactly these dimensions, by averaging — the arithmetic behind
 * `shrinkToFit`, and the shape a particle atlas needs, which is square whatever
 * the texture's own proportions are.
 *
 * For REDUCTION only. Asked to enlarge it returns the picture it was given:
 * every enlargement here would be invention, and the two callers both have
 * somewhere better to do it (the GPU's sampler, a canvas drawing into a cell).
 */
export function resampleTo(image: Image, width: number, height: number): Image {
  if (width >= image.width && height >= image.height) return image;
  const src = image.rgba;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * image.height / height);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * image.height / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * image.width / width);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * image.width / width));
      let r = 0, g = 0, b = 0, a = 0, weight = 0, n = 0;
      let plainR = 0, plainG = 0, plainB = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const from = (sy * image.width + sx) * 4;
          const av = src[from + 3]!;
          r += src[from]! * av; g += src[from + 1]! * av; b += src[from + 2]! * av;
          plainR += src[from]!; plainG += src[from + 1]!; plainB += src[from + 2]!;
          a += av; weight += av; n++;
        }
      }
      // Rounded, not truncated: a typed array truncates towards zero on the way
      // in, and a whole texture a half-step darker than its own average is a
      // gamma error nobody would go looking for.
      const to = (y * width + x) * 4;
      if (weight) {
        rgba[to] = r / weight + 0.5; rgba[to + 1] = g / weight + 0.5; rgba[to + 2] = b / weight + 0.5;
      } else {
        rgba[to] = plainR / n + 0.5; rgba[to + 1] = plainG / n + 0.5; rgba[to + 2] = plainB / n + 0.5;
      }
      rgba[to + 3] = a / n + 0.5;
    }
  }
  return { width, height, rgba };
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
