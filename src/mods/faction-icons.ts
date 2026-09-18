// The icons a faction needs and nobody has drawn: drawn here.
//
// A town shows three kinds of picture that are the faction's own rather than
// a creature's: its icon on the map and in lists (55×55, one plain and one
// with a fort), its tile in the scenario setup's race picker (55×55), and one
// per building on the build screen (128×128, cut out on transparency). A copy
// of a shipped town ships the donor's, which is a Haven crest over a town of
// the undead. So the copy draws its own set, in one theme, from pictograms
// the building's type and level decide: a dwelling is a house numbered by
// tier, a hall a keep with a merlon per level, a fort a wall with a tower per
// level, the guild a tower with a star per circle, and so on. Nothing here is
// a portrait; everything is legible at 55 pixels.

import type { Image } from '../format/dds.ts';
import { Painter, pt, star } from '../format/paint.ts';
import type { Color, Point } from '../format/paint.ts';
import { writeDDS, textureDoc } from '../format/texture.ts';
import type { ModFile } from './mod-files.ts';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readPicture } from '../format/png.ts';
import { fitSquare, magnify } from '../format/texture.ts';
import type { BuildingKey } from './town-files.ts';
import type { CapturePictures } from './capture-marker.ts';

/**
 * Pictures of our own for the icons a theme would draw — PNG or GIF files on
 * disk, each fitted to the size the game reads that icon at. Any slot given
 * replaces the drawn one; a slot left out is drawn from the theme when there
 * is one and kept the donor's when there is not. The same rule for all of
 * them, so a faction can start with a theme and replace its icons one by one.
 */
export interface IconPictures {
  /** The build screen's icon per building record, by key (`TB_DWELLING_1/2`), 128×128. */
  buildings?: Readonly<Record<BuildingKey, string>>;
  /** The town on the map and in lists, 55×55, without and with a fort. */
  town?: string;
  townFort?: string;
  /** The race picker's tile, 55×55. */
  race?: string;
  /** The siege tower's portrait on the initiative bar, 128×128. */
  tower?: string;
  /** The kingdom overview's four, by hall level, 128×128. */
  kingdom?: readonly [string, string, string, string];
  /** The dial's centre button, 82×82: normal, pushed, disabled. */
  button?: { normal: string; pushed: string; disabled: string };
  /** The sign over a captured town and the flag by its name — for every player colour, or per colour (capture-marker.ts). */
  capture?: CapturePictures;
}

/** A picture file as an icon of `size`: read, grown by whole pixels when smaller, fitted square. */
export function pictureIcon(file: string, size: number): Image {
  let image = readPicture(readFileSync(file), basename(file));
  const times = Math.floor(size / Math.max(image.width, image.height));
  if (times > 1) image = magnify(image, times);
  return fitSquare(image, size);
}

export interface IconTheme {
  /** The field a glyph sits on. */
  field: Color;
  /** The ring around it, and the metal of the grail. */
  rim: Color;
  /** What the glyphs are drawn in. */
  ink: Color;
  /** Marks: the upgrade star, the guild's stars, windows. */
  accent: Color;
}

/** Bone on plum, ringed in old gold: the undead in a town of the light. */
export const BONE_ON_PLUM: IconTheme = {
  field: [58, 28, 66, 255],
  rim: [196, 160, 70, 255],
  ink: [232, 222, 196, 255],
  accent: [130, 205, 195, 255],
};

/** Working resolution: the picture is drawn at this and reduced. */
const WORK = 512;

// --- the pictograms ----------------------------------------------------------
//
// Every glyph is drawn in the unit square with the frame already there, and
// keeps to the inner disc (radius 0.40 about the centre).

export type Glyph = (p: Painter, t: IconTheme) => void;

/** Roman numeral strokes for 1..7, centred on (cx, cy), `h` tall. */
function numeral(p: Painter, n: number, cx: number, cy: number, h: number, c: Color): void {
  const w = h * 0.16, gap = h * 0.22;
  const parts: ('I' | 'V')[] = n >= 5 ? ['V', ...Array<'I'>(n - 5).fill('I')] : n === 4 ? ['I', 'V'] : Array<'I'>(n).fill('I');
  const widths = parts.map((g) => (g === 'I' ? 0 : h * 0.6));
  const total = widths.reduce((s, x) => s + x, 0) + gap * (parts.length - 1);
  let x = cx - total / 2;
  for (const [i, g] of parts.entries()) {
    if (g === 'I') p.stroke([pt(x, cy - h / 2), pt(x, cy + h / 2)], w, c);
    else p.stroke([pt(x, cy - h / 2), pt(x + widths[i]! / 2, cy + h / 2), pt(x + widths[i]!, cy - h / 2)], w, c);
    x += widths[i]! + gap;
  }
}

/** A house: walls, a roof, a door — and a numeral on the wall. */
const dwelling = (tier: number, upgraded: boolean): Glyph => (p, t) => {
  p.polygon([pt(0.30, 0.52), pt(0.70, 0.52), pt(0.70, 0.80), pt(0.30, 0.80)], t.ink);
  p.polygon([pt(0.22, 0.54), pt(0.50, 0.26), pt(0.78, 0.54)], t.ink);
  numeral(p, tier, 0.50, 0.66, 0.18, t.field);
  if (upgraded) p.polygon(star(0.72, 0.30, 0.10, 0.045), t.accent);
};

/** A keep with a merlon more per level; the capitol flies a flag. */
const hall = (level: number): Glyph => (p, t) => {
  p.rect(0.28, 0.46, 0.44, 0.34, t.ink);
  const n = level + 1, w = 0.44 / (2 * n - 1);
  for (let i = 0; i < n; i++) p.rect(0.28 + i * 2 * w, 0.38, w, 0.10, t.ink);
  p.rect(0.46, 0.62, 0.08, 0.18, t.field);
  if (level >= 4) {
    p.stroke([pt(0.50, 0.38), pt(0.50, 0.18)], 0.025, t.rim);
    p.polygon([pt(0.51, 0.18), pt(0.66, 0.23), pt(0.51, 0.28)], t.accent);
  }
};

/** A wall with a tower per level. */
const fort = (level: number): Glyph => (p, t) => {
  p.rect(0.20, 0.56, 0.60, 0.22, t.ink);
  for (let i = 0; i < 5; i++) p.rect(0.20 + i * 0.12, 0.50, 0.06, 0.08, t.ink);
  const xs = level === 1 ? [0.50] : level === 2 ? [0.30, 0.70] : [0.26, 0.50, 0.74];
  for (const x of xs) {
    p.rect(x - 0.07, 0.30, 0.14, 0.30, t.ink);
    p.polygon([pt(x - 0.10, 0.31), pt(x, 0.18), pt(x + 0.10, 0.31)], t.accent);
  }
  p.rect(0.46, 0.64, 0.08, 0.14, t.field);
};

/** Scales. */
const marketplace: Glyph = (p, t) => {
  p.stroke([pt(0.50, 0.24), pt(0.50, 0.76)], 0.035, t.ink);
  p.stroke([pt(0.38, 0.76), pt(0.62, 0.76)], 0.035, t.ink);
  p.stroke([pt(0.24, 0.34), pt(0.76, 0.34)], 0.03, t.ink);
  for (const x of [0.24, 0.76]) {
    p.stroke([pt(x, 0.34), pt(x - 0.09, 0.56)], 0.015, t.ink);
    p.stroke([pt(x, 0.34), pt(x + 0.09, 0.56)], 0.015, t.ink);
    p.polygon([pt(x - 0.11, 0.56), pt(x + 0.11, 0.56), pt(x + 0.07, 0.62), pt(x - 0.07, 0.62)], t.accent);
  }
};

/** A barrel. */
const silo: Glyph = (p, t) => {
  p.polygon([pt(0.34, 0.26), pt(0.66, 0.26), pt(0.70, 0.50), pt(0.66, 0.76), pt(0.34, 0.76), pt(0.30, 0.50)], t.ink);
  for (const y of [0.36, 0.50, 0.64]) p.stroke([pt(0.30, y), pt(0.70, y)], 0.02, t.field);
};

/** An anchor. */
const shipyard: Glyph = (p, t) => {
  p.ring(0.50, 0.26, 0.06, 0.025, t.ink);
  p.stroke([pt(0.50, 0.32), pt(0.50, 0.76)], 0.035, t.ink);
  p.stroke([pt(0.38, 0.40), pt(0.62, 0.40)], 0.03, t.ink);
  p.stroke(arc(0.50, 0.56, 0.20, 0.15, 0.85), 0.035, t.ink);
  p.polygon([pt(0.26, 0.60), pt(0.33, 0.70), pt(0.24, 0.72)], t.ink);
  p.polygon([pt(0.74, 0.60), pt(0.67, 0.70), pt(0.76, 0.72)], t.ink);
};

/** A mug. */
const tavern: Glyph = (p, t) => {
  p.rect(0.32, 0.34, 0.30, 0.42, t.ink);
  p.ring(0.66, 0.55, 0.11, 0.035, t.ink);
  p.rect(0.32, 0.30, 0.30, 0.06, t.accent);
};

/** A hammer over an anvil. */
const blacksmith: Glyph = (p, t) => {
  p.polygon([pt(0.28, 0.66), pt(0.72, 0.66), pt(0.66, 0.74), pt(0.34, 0.74)], t.ink);
  p.rect(0.40, 0.74, 0.20, 0.06, t.ink);
  p.stroke([pt(0.60, 0.58), pt(0.36, 0.34)], 0.035, t.ink);
  p.polygon([pt(0.30, 0.22), pt(0.44, 0.22), pt(0.50, 0.32), pt(0.36, 0.42), pt(0.26, 0.36)], t.accent);
};

/** A tower with a star per circle. */
const guild = (level: number): Glyph => (p, t) => {
  p.rect(0.40, 0.42, 0.20, 0.38, t.ink);
  p.polygon([pt(0.36, 0.44), pt(0.50, 0.24), pt(0.64, 0.44)], t.ink);
  p.rect(0.47, 0.66, 0.06, 0.14, t.field);
  const spots = [pt(0.20, 0.36), pt(0.80, 0.36), pt(0.24, 0.62), pt(0.76, 0.62), pt(0.50, 0.14)];
  for (let i = 0; i < level; i++) p.polygon(star(spots[i]!.x, spots[i]!.y, 0.07, 0.03), t.accent);
};

/** Crossed swords. */
const training: Glyph = (p, t) => {
  for (const s of [1, -1]) {
    const x = (v: number) => 0.5 + s * v;
    p.stroke([pt(x(-0.22), 0.26), pt(x(0.20), 0.68)], 0.035, t.ink);
    p.stroke([pt(x(0.14), 0.62), pt(x(0.26), 0.74)], 0.05, t.rim);
    p.stroke([pt(x(0.10), 0.70), pt(x(0.20), 0.60)], 0.03, t.accent);
  }
};

/** An obelisk. */
const monument: Glyph = (p, t) => {
  p.polygon([pt(0.44, 0.24), pt(0.56, 0.24), pt(0.60, 0.70), pt(0.40, 0.70)], t.ink);
  p.polygon([pt(0.44, 0.24), pt(0.50, 0.14), pt(0.56, 0.24)], t.accent);
  p.rect(0.30, 0.70, 0.40, 0.08, t.ink);
};

/** A horseshoe. */
const stables: Glyph = (p, t) => {
  p.stroke(arc(0.50, 0.50, 0.22, -0.40, 1.40), 0.06, t.ink);
  for (const [x, y] of [[0.33, 0.30], [0.67, 0.30], [0.26, 0.52], [0.74, 0.52], [0.36, 0.70], [0.64, 0.70]] as const) {
    p.disc(x, y, 0.02, t.field);
  }
};

/** Three ears of wheat. */
const farms: Glyph = (p, t) => {
  for (const [x, lean] of [[0.36, -0.06], [0.50, 0], [0.64, 0.06]] as const) {
    p.stroke([pt(x, 0.78), pt(x + lean, 0.40)], 0.025, t.ink);
    for (let i = 0; i < 4; i++) {
      const y = 0.44 + i * 0.08, cx = x + lean * (1 - i * 0.2);
      p.polygon([pt(cx, y - 0.05), pt(cx + 0.05, y), pt(cx, y + 0.02), pt(cx - 0.05, y)], t.accent);
    }
  }
};

/** A chalice, in the rim's metal. */
const grail: Glyph = (p, t) => {
  p.polygon([pt(0.28, 0.26), pt(0.72, 0.26), pt(0.62, 0.50), pt(0.38, 0.50)], t.rim);
  p.stroke([pt(0.50, 0.50), pt(0.50, 0.68)], 0.04, t.rim);
  p.polygon([pt(0.34, 0.76), pt(0.66, 0.76), pt(0.60, 0.68), pt(0.40, 0.68)], t.rim);
  p.polygon(star(0.50, 0.36, 0.06, 0.025), t.accent);
};

/** A skull: the race. Drawn in `ink`, its eyes and teeth in `field`. */
export const raceGlyph: Glyph = (p, t) => {
  p.disc(0.50, 0.44, 0.24, t.ink);
  p.rect(0.36, 0.58, 0.28, 0.14, t.ink);
  p.disc(0.41, 0.44, 0.065, t.field);
  p.disc(0.59, 0.44, 0.065, t.field);
  p.polygon([pt(0.50, 0.50), pt(0.54, 0.58), pt(0.46, 0.58)], t.field);
  for (const x of [0.43, 0.50, 0.57]) p.rect(x - 0.015, 0.64, 0.03, 0.08, t.field);
};

/** The square frame of a full-bleed icon. */
function border(p: Painter, t: IconTheme): void {
  const w = 0.06;
  p.polygon([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1), pt(0, 0), pt(w, w), pt(w, 1 - w), pt(1 - w, 1 - w), pt(1 - w, w), pt(w, w)], t.rim);
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (from + (to - from) * i / steps) * Math.PI;
    out.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

// --- the set -----------------------------------------------------------------

/** The pictogram for a building record, by its type and upgrade level. */
export function buildingGlyph(type: string, level: number): Glyph {
  const dwell = /^TB_DWELLING_(\d)$/.exec(type);
  if (dwell) return dwelling(Number(dwell[1]), level > 1);
  switch (type) {
    case 'TB_TOWN_HALL': return hall(level);
    case 'TB_FORT': return fort(level);
    case 'TB_MARKETPLACE': return level > 1 ? silo : marketplace;
    case 'TB_SHIPYARD': return shipyard;
    case 'TB_TAVERN': return tavern;
    case 'TB_BLACKSMITH': return blacksmith;
    case 'TB_MAGIC_GUILD': return guild(level);
    case 'TB_SPECIAL_1': return training;
    case 'TB_SPECIAL_2': return monument;
    case 'TB_SPECIAL_3': return monument;
    case 'TB_SPECIAL_4': return stables;
    case 'TB_SPECIAL_5': return farms;
    case 'TB_GRAIL': return grail;
    default: return hall(1);
  }
}

/** A building's icon: the glyph in a ringed disc, cut out on transparency. */
export function buildingIcon(glyph: Glyph, theme: IconTheme, size = 128): Image {
  const p = new Painter(WORK);
  p.disc(0.50, 0.50, 0.47, theme.field);
  p.ring(0.50, 0.50, 0.47, 0.035, theme.rim);
  glyph(p, theme);
  return p.image(size);
}

/** The town's icon: a full square, a keep on the field; with a wall when fortified. */
export function townIcon(theme: IconTheme, fortified: boolean, size = 55): Image {
  const p = new Painter(WORK);
  p.clear(theme.field);
  border(p, theme);
  (fortified ? fort(2) : hall(2))(p, theme);
  return p.image(size);
}

/**
 * The siege tower on the initiative bar, where the towers queue up among the
 * creatures. The bar's `AdditionalIcons` list keys it by the TOWN TYPE'S NAME
 * (`TOWN_HEAVEN` → `Tower_Heaven`), so a type of ours needs an entry and a
 * picture; without them it queues as a white square. 128×128, cut out.
 */
export function towerIcon(theme: IconTheme, size = 128): Image {
  const p = new Painter(WORK);
  p.disc(0.50, 0.50, 0.47, theme.field);
  p.ring(0.50, 0.50, 0.47, 0.035, theme.rim);
  p.rect(0.36, 0.34, 0.28, 0.46, theme.ink);
  for (let i = 0; i < 3; i++) p.rect(0.36 + i * 0.11, 0.26, 0.06, 0.10, theme.ink);
  p.rect(0.46, 0.44, 0.08, 0.10, theme.field);
  p.rect(0.46, 0.64, 0.08, 0.16, theme.field);
  p.polygon(star(0.50, 0.16, 0.06, 0.025), theme.accent);
  return p.image(size);
}

/** The race's tile in the picker. */
export function raceIcon(theme: IconTheme, size = 55): Image {
  const p = new Painter(WORK);
  p.clear(theme.field);
  border(p, theme);
  raceGlyph(p, theme);
  return p.image(size);
}

/** A texture document and its picture, at `path` (the `.xdb`; the `.dds` beside it). */
export function textureFiles(path: string, image: Image): ModFile[] {
  const dds = path.replace(/\.xdb$/i, '.dds');
  return [
    { path, data: Buffer.from(textureDoc({ dds: dds.split('/').pop()!, width: image.width, height: image.height }), 'latin1') },
    { path: dds, data: writeDDS(image) },
  ];
}

// --- the town screen's centre button ----------------------------------------

/** A colour dimmed towards black by `k`, alpha kept. */
const dim = (c: Color, k: number): Color => [c[0] * k, c[1] * k, c[2] * k, c[3]];
/** A colour drained to grey: the disabled state. */
const grey = (c: Color): Color => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return [l * 0.7, l * 0.7, l * 0.7, c[3]];
};

/**
 * The three skins of the jog-dial's big button for a building of ours — the
 * shipped `HavenSpecialNormal/Pushed/Disabled`, 82×82, cut out: the building's
 * glyph on a ringed disc; pushed sinks and darkens, disabled is grey.
 */
export function specialButtonSkins(glyph: Glyph, theme: IconTheme, size = 82): { normal: Image; pushed: Image; disabled: Image } {
  const draw = (t: IconTheme, sink: number): Image => {
    const p = new Painter(WORK);
    p.disc(0.50, 0.50 + sink, 0.48, t.field);
    p.ring(0.50, 0.50 + sink, 0.48, 0.045, t.rim);
    // The glyph keeps to the inner disc; sunk with the field when pushed.
    const q = new Painter(WORK);
    glyph(q, t);
    for (let y = 0; y < WORK; y++) {
      const sy = y - Math.round(sink * WORK);
      if (sy < 0 || sy >= WORK) continue;
      for (let x = 0; x < WORK; x++) {
        const i = (y * WORK + x) * 4, j = (sy * WORK + x) * 4;
        const a = q.rgba[j + 3]!;
        if (!a) continue;
        const sa = a / 255, da = p.rgba[i + 3]! / 255, oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) p.rgba[i + k] = oa ? (q.rgba[j + k]! * sa + p.rgba[i + k]! * da * (1 - sa)) / oa + 0.5 : 0;
        p.rgba[i + 3] = oa * 255 + 0.5;
      }
    }
    return p.image(size);
  };
  const pushed: IconTheme = { field: dim(theme.field, 0.7), rim: dim(theme.rim, 0.8), ink: dim(theme.ink, 0.85), accent: dim(theme.accent, 0.85) };
  const disabled: IconTheme = { field: grey(theme.field), rim: grey(theme.rim), ink: grey(theme.ink), accent: grey(theme.accent) };
  return { normal: draw(theme, 0), pushed: draw(pushed, 0.02), disabled: draw(disabled, 0) };
}
