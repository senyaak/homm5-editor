// Draw the mission's PWL picture — the splash the campaign shows before the map
// loads — and write it as the game's own texture pair.
//
// C1M1 ships `PWL.(Texture).dds`: Isabel on horseback with her sword up, griffins
// behind her, a sunset over the woods, 1024×1024 DXT3 with the picture in the
// top 768 rows and a black band under it. A reconstruction cannot copy the
// original's art, so it draws its own in the same shape and format: a stick
// horse, a stick rider with long hair and a raised sword, stick griffins, and a
// sunset. Crude on purpose — what is being reproduced is the FILE, not the art.
//
// No image library: the pixels are drawn here and encoded to DXT3 below, which
// is the format the original declares and the engine loads.
//
// Usage: npm run make-pwl <out dir>   (writes PWL.(Texture).dds and .xdb)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024, H = 1024;
/** The picture sits in the top 768 rows; the rest is black, as in the original. */
const ART_H = 768;

const px = new Uint8Array(W * H * 4); // RGBA, opaque black by default
for (let i = 3; i < px.length; i += 4) px[i] = 255;

type RGB = [number, number, number];

function set(x: number, y: number, c: RGB, a = 1): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = Math.round(px[i]! * (1 - a) + c[0] * a);
  px[i + 1] = Math.round(px[i + 1]! * (1 - a) + c[1] * a);
  px[i + 2] = Math.round(px[i + 2]! * (1 - a) + c[2] * a);
}

/** A round-capped line, which is what a stick figure is made of. */
function stroke(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 6): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c);
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) set(x, y, c, Math.min(1, r - d + 0.5));
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d <= 1) set(x, y, c);
    }
  }
}

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB): void {
  const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
  const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
  const side = (px1: number, py1: number, px2: number, py2: number, x: number, y: number): number =>
    (x - px1) * (py2 - py1) - (y - py1) * (px2 - px1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const s1 = side(ax, ay, bx, by, x, y), s2 = side(bx, by, cx, cy, x, y), s3 = side(cx, cy, ax, ay, x, y);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) set(x, y, c);
    }
  }
}

// --- the scene ------------------------------------------------------------
//
// Sunset over the woods, in the same arrangement as the original: sky down to
// the treeline, hills, then the meadow the rider stands on.

const HORIZON = 430;
for (let y = 0; y < ART_H; y++) {
  for (let x = 0; x < W; x++) {
    if (y < HORIZON) {
      // Sky: deep blue at the top through orange at the horizon, with the sun's
      // glow banked to the left where the original has it.
      const t = y / HORIZON;
      const glow = Math.max(0, 1 - Math.hypot(x - 300, y - HORIZON + 40) / 460);
      const c: RGB = [
        Math.round(60 + 175 * t ** 1.5 + 60 * glow),
        Math.round(90 + 105 * t ** 1.8 + 55 * glow),
        Math.round(150 - 60 * t + 20 * glow),
      ];
      set(x, y, [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2])]);
    } else {
      // Meadow: greener and darker towards the viewer.
      const t = (y - HORIZON) / (ART_H - HORIZON);
      set(x, y, [Math.round(96 - 40 * t), Math.round(140 - 45 * t), Math.round(58 - 25 * t)]);
    }
  }
}

// The sun, low and to the left.
disc(300, HORIZON - 60, 46, [255, 232, 170]);

// Hills along the horizon.
for (let i = 0; i < 7; i++) {
  const cx = 60 + i * 165, r = 90 + (i % 3) * 40;
  ellipse(cx, HORIZON + 6, r, r * 0.42, [70, 96, 62]);
}

/** A tree: a brown stick and two green triangles. */
function tree(x: number, groundY: number, h: number): void {
  stroke(x, groundY, x, groundY - h * 0.45, [72, 52, 34], Math.max(4, h * 0.06));
  triangle(x, groundY - h, x - h * 0.32, groundY - h * 0.42, x + h * 0.32, groundY - h * 0.42, [44, 96, 48]);
  triangle(x, groundY - h * 0.75, x - h * 0.38, groundY - h * 0.2, x + h * 0.38, groundY - h * 0.2, [52, 110, 54]);
}
for (const [x, y, h] of [[90, 470, 150], [190, 455, 120], [880, 470, 160], [960, 450, 130],
  [760, 445, 110], [40, 500, 180]] as [number, number, number][]) tree(x, y, h);

/** A stick griffin: a body, wings, a beak — Isabel's escort, at her left. */
function griffin(x: number, y: number, s: number): void {
  const tan: RGB = [188, 150, 92];
  ellipse(x, y, s * 0.5, s * 0.3, tan);                        // body
  stroke(x - s * 0.5, y, x - s * 1.1, y - s * 0.55, tan, s * 0.14); // wing
  stroke(x + s * 0.5, y, x + s * 1.05, y - s * 0.5, tan, s * 0.14);
  stroke(x + s * 0.35, y - s * 0.1, x + s * 0.75, y - s * 0.45, tan, s * 0.12); // neck
  disc(x + s * 0.8, y - s * 0.5, s * 0.17, [222, 208, 170]);   // head
  triangle(x + s * 0.95, y - s * 0.52, x + s * 1.2, y - s * 0.45, x + s * 0.95, y - s * 0.38, [230, 180, 60]);
  stroke(x - s * 0.3, y + s * 0.25, x - s * 0.35, y + s * 0.6, tan, s * 0.1); // legs
  stroke(x + s * 0.2, y + s * 0.25, x + s * 0.25, y + s * 0.6, tan, s * 0.1);
}
griffin(215, 545, 90);
griffin(120, 590, 70);

// --- the horse, in sticks -------------------------------------------------
const HX = 560, HY = 560;               // withers
const BROWN: RGB = [126, 84, 48], DARK: RGB = [70, 46, 26];

stroke(HX - 130, HY, HX + 120, HY - 10, BROWN, 34);            // barrel
stroke(HX + 120, HY - 10, HX + 190, HY - 110, BROWN, 22);      // neck
disc(HX + 205, HY - 130, 34, BROWN);                           // head
triangle(HX + 225, HY - 155, HX + 235, HY - 185, HX + 205, HY - 168, DARK); // ear
stroke(HX + 175, HY - 150, HX + 120, HY - 120, DARK, 14);      // mane
stroke(HX - 130, HY - 5, HX - 200, HY + 60, DARK, 14);         // tail
for (const [x0, x1] of [[HX - 100, HX - 120], [HX - 70, HX - 40], [HX + 60, HX + 40], [HX + 95, HX + 118]]) {
  stroke(x0, HY + 10, x1, HY + 165, BROWN, 18);                // legs
  disc(x1, HY + 172, 12, DARK);                                // hooves
}

// --- the rider: a stick figure, long hair, sword up ----------------------
const RX = HX + 30, RY = HY - 70;       // hips, sitting on the horse's back
const STEEL: RGB = [214, 219, 228], SKIN: RGB = [236, 200, 170], HAIR: RGB = [58, 40, 30];

stroke(RX, RY, RX + 4, RY - 92, STEEL, 26);                    // torso
disc(RX + 6, RY - 118, 27, SKIN);                              // head
// Long hair, which is how a stick figure says who this is.
for (const dx of [-1, 0, 1]) stroke(RX - 12 + dx * 6, RY - 128, RX - 26 + dx * 5, RY - 40, HAIR, 13);
disc(RX + 6, RY - 132, 26, HAIR);                              // hair over the crown
stroke(RX + 4, RY - 84, RX + 70, RY - 40, STEEL, 15);          // rein arm
stroke(RX + 4, RY - 86, RX - 40, RY - 190, STEEL, 15);         // sword arm, raised
stroke(RX - 40, RY - 190, RX - 62, RY - 330, [232, 238, 246], 11); // blade
stroke(RX - 26, RY - 178, RX - 54, RY - 196, [206, 172, 70], 13);  // crossguard
stroke(RX + 2, RY + 4, RX + 46, RY + 78, STEEL, 16);           // leg down the flank
disc(RX + 50, RY + 84, 12, DARK);                              // boot

// --- encode ---------------------------------------------------------------
//
// DXT3: per 4×4 block, 8 bytes of 4-bit alpha then a DXT1-style colour block.
// The endpoints are the block's darkest and brightest pixel by luminance, and
// every pixel takes whichever of the four interpolated colours is nearest. Good
// enough for flat art, and it is the format the original declares.

const lum = (r: number, g: number, b: number): number => r * 0.299 + g * 0.587 + b * 0.114;
const to565 = (r: number, g: number, b: number): number =>
  ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (c: number): RGB =>
  [((c >> 11) & 0x1f) * 255 / 31, ((c >> 5) & 0x3f) * 255 / 63, (c & 0x1f) * 255 / 31];

function encodeDXT3(): Buffer {
  const out = Buffer.alloc((W / 4) * (H / 4) * 16);
  let o = 0;
  for (let by = 0; by < H; by += 4) {
    for (let bx = 0; bx < W; bx += 4) {
      // Alpha: the picture is opaque, and 4-bit alpha of 15 is full.
      out.fill(0xff, o, o + 8); o += 8;
      let lo = Infinity, hi = -Infinity, loC: RGB = [0, 0, 0], hiC: RGB = [0, 0, 0];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const i = ((by + y) * W + bx + x) * 4;
        const c: RGB = [px[i]!, px[i + 1]!, px[i + 2]!];
        const l = lum(c[0], c[1], c[2]);
        if (l < lo) { lo = l; loC = c; }
        if (l > hi) { hi = l; hiC = c; }
      }
      let c0 = to565(hiC[0], hiC[1], hiC[2]), c1 = to565(loC[0], loC[1], loC[2]);
      // c0 > c1 selects the four-colour mode, which is the one with two mixes.
      if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
      if (c0 === c1) c1 = c0 === 0 ? 0 : c0 - 1;
      const p0 = from565(c0), p1 = from565(c1);
      const palette: RGB[] = [p0, p1,
        [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3],
        [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]];
      out.writeUInt16LE(c0, o); out.writeUInt16LE(c1, o + 2);
      let bits = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const i = ((by + y) * W + bx + x) * 4;
        let best = 0, bestD = Infinity;
        for (let k = 0; k < 4; k++) {
          const d = (px[i]! - palette[k]![0]) ** 2 + (px[i + 1]! - palette[k]![1]) ** 2
            + (px[i + 2]! - palette[k]![2]) ** 2;
          if (d < bestD) { bestD = d; best = k; }
        }
        bits |= best << (2 * (y * 4 + x));
      }
      out.writeUInt32LE(bits >>> 0, o + 4);
      o += 8;
    }
  }
  return out;
}

/** The 128-byte DDS header the original carries, for a 1024² DXT3 with no mips. */
function ddsHeader(): Buffer {
  const h = Buffer.alloc(128);
  h.write('DDS ', 0, 'latin1');
  h.writeUInt32LE(124, 4);
  h.writeUInt32LE(0x1007, 8);      // caps | height | width | pixelformat
  h.writeUInt32LE(H, 12);
  h.writeUInt32LE(W, 16);
  h.writeUInt32LE(32, 76);         // pixel-format size
  h.writeUInt32LE(4, 80);          // DDPF_FOURCC
  h.write('DXT3', 84, 'latin1');
  h.writeUInt32LE(0x1000, 108);    // DDSCAPS_TEXTURE
  return h;
}

/** The `(Texture)` document that points the map at the picture. */
const XDB = `<?xml version="1.0" encoding="UTF-8"?>
<Texture>
\t<SrcName href="PWL.tga"/>
\t<DestName href="PWL.(Texture).dds"/>
\t<Type>REGULAR</Type>
\t<ConversionType>CONVERT_TRANSPARENT</ConversionType>
\t<AddrType>CLAMP</AddrType>
\t<Format>TF_DXT3</Format>
\t<Width>${W}</Width>
\t<Height>${H}</Height>
\t<MappingSize>0</MappingSize>
\t<NMips>1</NMips>
\t<Gain>0</Gain>
\t<AverageColor>-9213900</AverageColor>
\t<InstantLoad>true</InstantLoad>
\t<IsDXT>true</IsDXT>
\t<FlipY>false</FlipY>
\t<StandardExport>true</StandardExport>
\t<UseS3TC>false</UseS3TC>
</Texture>
`;

const dir = process.argv[2] ?? '_tmp/pwl';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'PWL.(Texture).dds'), Buffer.concat([ddsHeader(), encodeDXT3()]));
writeFileSync(join(dir, 'PWL.(Texture).xdb'), XDB, 'latin1');
console.log(`wrote PWL.(Texture).dds (${W}×${H} DXT3) and PWL.(Texture).xdb into ${dir}`);
