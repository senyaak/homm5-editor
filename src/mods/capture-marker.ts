// The sign over a town the player owns, and the flag beside its name — the
// faction's own, in every player's colour.
//
// A neutral town, mine or dwelling glows grey; a captured one carries the
// owner's colour and the race's crest. The engine reads both out of
// `UI/RefTables/PlayerColourSchemes.xdb`: one record per player colour, and
// in it `schemes`, a list indexed by the town's type (`t - 3`, 0xB4E720) or,
// for anything that is not a town, by `RaceCount()` (0xB4E700) — eight race
// items and a ninth, grey one, in the shipped table. `0xC80840` picks the
// item and puts up its `PossesionMarker` effect; an index past the list puts
// up nothing. So a ninth race is the ninth item, BEFORE the grey one, which
// moves to where `RaceCount()` — nine, with a race of ours — now points.
//
// What an item is: a `TownFlag` texture (55×55, the flag beside the town's
// name) and a `PossesionMarker` effect — a sign model (Academy's skeleton and
// geometry, shared by all eight races; a material of the race's own with a
// 128×128 crest texture in the player's colour) with the shared `Sign`
// animation, and the shared glow particle textured by the player's colour.
// Ours draws the crest and the flag from the race glyph (faction-icons.ts)
// and writes the five documents per colour under `Factions/<file>/capture/`.

import { decodeDDSBuffer } from '../format/dds.ts';
import type { Image } from '../format/dds.ts';
import { Painter, pt } from '../format/paint.ts';
import type { Color } from '../format/paint.ts';
import { raceGlyph, textureFiles } from './faction-icons.ts';
import type { IconTheme } from './faction-icons.ts';
import { mustRead } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { EOL } from './xml-edit.ts';

export const PLAYER_COLOUR_SCHEMES = 'UI/RefTables/PlayerColourSchemes.xdb';

/** The eight player colours, as the shipped capture effects name them. */
export const CAPTURE_COLOURS = ['01Brown', '02Red', '03Orange', '04Yellow', '05Green', '06Azure', '07Blue', '08Violet'] as const;
export type CaptureColour = typeof CAPTURE_COLOURS[number];

/** Where the shipped signs' geometry, animation and glow live; ours reference them. */
const SIGN_MODEL_DIR = '/_(Model)/Effects/Buildings/Capture/Academy';
const SIGN_ANIMATION = '/_(BasicSkelAnim)/Buildings/Capture/Sign.(BasicSkelAnim).xdb#xpointer(/BasicSkelAnim)';
const GLOW_PARTICLE = '/Effects/_(Particle)/Buildings/Capture/Possession.xdb#xpointer(/Particle)';
const GLOW_TEXTURE_DIR = '/Textures/Effects/BuildingsCapture/Glow';
/** A shipped race's sign textures — sampled for the colour each player paints in. */
const SAMPLE_SIGN_DIR = 'Textures/Effects/BuildingsCapture/Haven';

/** Working resolution of the drawings. */
const WORK = 512;

export interface CaptureMarkerBuild {
  files: ModFile[];
  /** Per colour: the hrefs the table's item names. */
  items: Record<CaptureColour, { flag: string; marker: string }>;
}

export function captureMarkerDir(faction: { file: string }): string {
  return `Factions/${faction.file}/capture`;
}

/**
 * The colour a shipped sign is painted in: the brighter half of its opaque
 * pixels, averaged — the crest without its dark outline.
 */
function signColour(read: DataReader, colour: CaptureColour): Color {
  const img = decodeDDSBuffer(mustReadBuffer(read, `${SAMPLE_SIGN_DIR}/${colour}.dds`));
  const px: [number, number, number, number][] = [];
  for (let i = 0; i < img.rgba.length; i += 4) {
    if (img.rgba[i + 3]! < 200) continue;
    const r = img.rgba[i]!, g = img.rgba[i + 1]!, b = img.rgba[i + 2]!;
    px.push([r, g, b, r * 0.3 + g * 0.59 + b * 0.11]);
  }
  if (!px.length) throw new Error(`${SAMPLE_SIGN_DIR}/${colour}.dds: no opaque pixels to sample`);
  px.sort((a, b) => b[3] - a[3]);
  const top = px.slice(0, Math.max(1, px.length >> 1));
  const sum = top.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return [sum[0] / top.length, sum[1] / top.length, sum[2] / top.length, 255];
}

function mustReadBuffer(read: DataReader, path: string): Buffer {
  const b = read(path);
  if (!b) throw new Error(`no ${path} in the game's data`);
  return b;
}

const OUTLINE: Color = [24, 16, 20, 255];

/** The crest: the race glyph in the player's colour over a dark outline, cut out. */
export function captureSign(colour: Color, size = 128): Image {
  const p = new Painter(WORK);
  // The outline: the glyph's silhouette, a little wider.
  p.disc(0.50, 0.44, 0.275, OUTLINE);
  p.rect(0.33, 0.56, 0.34, 0.19, OUTLINE);
  raceGlyph(p, { field: OUTLINE, rim: OUTLINE, ink: colour, accent: colour });
  return p.image(size);
}

/** The flag: a pennant in the player's colour on a pole, a small skull on it. */
export function captureFlag(colour: Color, theme: IconTheme, size = 55): Image {
  const p = new Painter(WORK);
  p.stroke([pt(0.20, 0.08), pt(0.20, 0.96)], 0.07, OUTLINE);
  p.polygon([pt(0.23, 0.08), pt(0.96, 0.34), pt(0.23, 0.60)], OUTLINE);
  p.polygon([pt(0.26, 0.14), pt(0.86, 0.34), pt(0.26, 0.54)], colour);
  // The glyph at a fifth of its size, where the pennant is widest.
  const cx = 0.46, cy = 0.31, k = 0.42;
  p.disc(cx, cy - 0.06 * k, 0.24 * k, theme.ink);
  p.rect(cx - 0.14 * k, cy + 0.08 * k, 0.28 * k, 0.14 * k, theme.ink);
  p.disc(cx - 0.09 * k, cy - 0.06 * k, 0.065 * k, colour);
  p.disc(cx + 0.09 * k, cy - 0.06 * k, 0.065 * k, colour);
  return p.image(size);
}

/** The five documents and two pictures of one colour's item. */
function colourFiles(dir: string, colour: CaptureColour, paint: Color, theme: IconTheme): { files: ModFile[]; flag: string; marker: string } {
  const at = `${dir}/${colour}`;
  const sign = `${at}/Sign.(Texture).xdb`;
  const flag = `${at}/Flag.(Texture).xdb`;
  const material = `${at}/Sign.(Material).xdb`;
  const model = `${at}/Sign.(Model).xdb`;
  const instance = `${at}/Sign.(ModelInstance).xdb`;
  const glow = `${at}/Glow.(ParticleInstance).xdb`;
  const effect = `${at}/Marker.(Effect).xdb`;
  const doc = (root: string, body: string[]): Buffer =>
    Buffer.from(['<?xml version="1.0" encoding="UTF-8"?>', `<${root} ObjectRecordID="1">`, ...body, `</${root}>`, ''].join(EOL), 'latin1');
  const files: ModFile[] = [
    ...textureFiles(sign, captureSign(paint)),
    ...textureFiles(flag, captureFlag(paint, theme)),
    { path: material, data: doc('Material', [
      `\t<Texture href="/${sign}#xpointer(/Texture)"/>`,
      '\t<Bump/>', '\t<SpecFactor>0</SpecFactor>',
      '\t<SpecColor>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</SpecColor>',
      '\t<Gloss/>', '\t<MetalMirror>0</MetalMirror>', '\t<DielMirror>0</DielMirror>', '\t<Mirror/>',
      '\t<CastShadow>false</CastShadow>', '\t<ReceiveShadow>false</ReceiveShadow>', '\t<Priority>0</Priority>',
      '\t<TranslucentColor>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</TranslucentColor>',
      '\t<FloatParam>0</FloatParam>', '\t<DetailTexture/>', '\t<DetailScale>5</DetailScale>',
      '\t<ProjectOnTerrain>false</ProjectOnTerrain>', '\t<LightingMode>L_SELFILLUM</LightingMode>',
      '\t<DynamicMode>DM_DONT_CARE</DynamicMode>', '\t<Is2Sided>false</Is2Sided>', '\t<Effect>M_GENERIC</Effect>',
      '\t<AlphaMode>AM_TRANSPARENT</AlphaMode>', '\t<AffectedByFog>true</AffectedByFog>', '\t<AddPlaced>false</AddPlaced>',
      '\t<IgnoreZBuffer>false</IgnoreZBuffer>', '\t<BackFaceCastShadow>false</BackFaceCastShadow>',
    ]) },
    { path: model, data: doc('Model', [
      '\t<Materials>', `\t\t<Item href="/${material}#xpointer(/Material)"/>`, '\t</Materials>',
      `\t<Skeleton href="${SIGN_MODEL_DIR}/${colour}-skel.xdb#xpointer(/Skeleton)"/>`,
      `\t<Geometry href="${SIGN_MODEL_DIR}/${colour}-geom.xdb#xpointer(/Geometry)"/>`,
      '\t<Animations/>', '\t<WindPower>1</WindPower>',
    ]) },
    { path: instance, data: doc('ModelInstance', [
      `\t<Model href="/${model}#xpointer(/Model)"/>`,
      `\t<SkelAnim href="${SIGN_ANIMATION}"/>`,
      '\t<Position>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</Position>',
      '\t<Rotation>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t\t<w>1</w>', '\t</Rotation>',
      '\t<Scale>1</Scale>', '\t<Offset>0</Offset>', '\t<CycleLength>0</CycleLength>', '\t<CycleCount>0</CycleCount>', '\t<GlueToBone>0</GlueToBone>',
    ]) },
    { path: glow, data: doc('ParticleInstance', [
      '\t<SrcName/>', '\t<Light>L_NORMAL</Light>',
      `\t<Particle href="${GLOW_PARTICLE}"/>`,
      '\t<Position>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</Position>',
      '\t<Rotation>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t\t<w>1</w>', '\t</Rotation>',
      '\t<Scale>1</Scale>', '\t<Speed>1</Speed>', '\t<Offset>0</Offset>', '\t<EndCycle>2</EndCycle>', '\t<CycleCount>0</CycleCount>',
      '\t<Pivot>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t</Pivot>',
      // The shipped glow's texture slots: the crest in the second, the glow in the last of ten.
      '\t<Textures>',
      '\t\t<Item/>', `\t\t<Item href="/${sign}#xpointer(/Texture)"/>`, '\t\t<Item/>', '\t\t<Item/>', '\t\t<Item/>',
      '\t\t<Item/>', '\t\t<Item/>', '\t\t<Item/>', '\t\t<Item/>', `\t\t<Item href="${GLOW_TEXTURE_DIR}/${colour}.xdb#xpointer(/Texture)"/>`,
      '\t</Textures>',
      '\t<IsCrown>false</IsCrown>', '\t<Static>P_STATIC</Static>', '\t<DoesCastShadow>false</DoesCastShadow>',
      '\t<GlueToBone>0</GlueToBone>', '\t<GlueToNamedBone/>', '\t<LeaveParticlesWhereStarted>false</LeaveParticlesWhereStarted>', '\t<Priority>0</Priority>',
    ]) },
    { path: effect, data: doc('Effect', [
      '\t<Instances>', `\t\t<Item href="/${glow}#xpointer(/ParticleInstance)"/>`, '\t</Instances>',
      '\t<Lights/>',
      '\t<Models>', `\t\t<Item href="/${instance}#xpointer(/ModelInstance)"/>`, '\t</Models>',
      '\t<WindAffected>false</WindAffected>', '\t<WindPower>1</WindPower>', '\t<Duration>2.5</Duration>',
    ]) },
  ];
  return { files, flag: `/${flag}#xpointer(/Texture)`, marker: `/${effect}#xpointer(/Effect)` };
}

/** The faction's sign and flag in all eight colours. */
export function captureMarkerFiles(faction: { file: string }, theme: IconTheme, read: DataReader): CaptureMarkerBuild {
  const dir = captureMarkerDir(faction);
  const files: ModFile[] = [];
  const items = {} as CaptureMarkerBuild['items'];
  for (const colour of CAPTURE_COLOURS) {
    const one = colourFiles(dir, colour, signColour(read, colour), theme);
    files.push(...one.files);
    items[colour] = { flag: one.flag, marker: one.marker };
  }
  return { files, items };
}

/** The colour of a record's `schemes`, by the shipped effect its first race item names. */
function recordColour(record: string): CaptureColour | null {
  const m = /Buildings\/Capture\/\w+\/(\d\d\w+)\.xdb/.exec(record);
  if (!m) return null;
  const colour = CAPTURE_COLOURS.find((c) => c === m[1]);
  if (!colour) throw new Error(`a player colour record names the capture effect ${m[1]}, which is not one of the eight`);
  return colour;
}

/**
 * Our item into every player colour's `schemes`, before its last one — the
 * grey "not a town" item, which stays last: the engine indexes it by
 * `RaceCount()`, nine with us. A record that names no race effect (neutral)
 * takes a copy of its last item instead. Refused when our items are already
 * there.
 */
export function patchColourSchemes(table: string, faction: { file: string }, build: CaptureMarkerBuild): string {
  const dir = captureMarkerDir(faction);
  if (table.includes(`/${dir}/`)) throw new Error(`${PLAYER_COLOUR_SCHEMES} already carries ${faction.file}'s capture marker`);
  let out = '';
  let at = 0;
  for (;;) {
    const open = table.indexOf('<schemes>', at);
    if (open < 0) break;
    const close = table.indexOf('</schemes>', open);
    if (close < 0) throw new Error(`${PLAYER_COLOUR_SCHEMES}: a record's schemes never close`);
    const schemes = table.slice(open, close);
    const lastItem = schemes.lastIndexOf('<Item>');
    if (lastItem < 0) throw new Error(`${PLAYER_COLOUR_SCHEMES}: a record's schemes list no item`);
    const colour = recordColour(schemes);
    const item = colour
      ? ['<Item>', `\t\t\t\t\t\t<TownFlag href="${build.items[colour].flag}"/>`, `\t\t\t\t\t\t<PossesionMarker href="${build.items[colour].marker}"/>`, '\t\t\t\t\t</Item>'].join(EOL)
      : schemes.slice(lastItem, schemes.indexOf('</Item>', lastItem) + '</Item>'.length);
    out += table.slice(at, open + lastItem) + item + EOL + '\t\t\t\t\t';
    at = open + lastItem;
  }
  return out + table.slice(at);
}
