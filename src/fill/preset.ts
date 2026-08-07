// Fill presets: the vegetation recipes the fill tool paints with.
//
// The original editor keeps these in `Editor/FillPresets.xml`, loose on disk
// beside the game rather than in a pak, and loads them into an NDb table called
// `FillPreset`. The file is the whole definition — nothing about a preset lives
// in the binary — so ours reads the same format from the same place, and adds
// its own file beside it (assets/fill-presets.xml) rather than inventing a
// second shape for the same thing.
//
// The format, as the original's field registration declares it:
//
//   <Presets><Item>
//     <Name>Grass wood</Name>
//     <Layers><Item>
//       <objects><Item>
//         <Object><Type>AdvMapStaticShared</Type><ID>Grass\Tree\Birch\Birch01</ID></Object>
//         <Size>0.2</Size> <Probability>0.35</Probability> <NoRandomAngle>false</NoRandomAngle>
//       </Item></objects>
//       <Dispersion>0.8</Dispersion> <Width>0.5</Width> <NoRandomAngle>false</NoRandomAngle>
//     </Item></Layers>
//   </Item></Presets>
//
// `ID` is a path under MapObjects with Windows separators and no extension; the
// file it names is `<ID>.(<Type>).xdb`, and the shared reference an object on the
// map carries is that path with an xpointer at the class. Assembling it here is
// what lets a preset name `Grass\Tree\Birch\Birch01` and the placement carry the
// href the game resolves.

import { children, childText, find, findAll, parse } from '../format/xml.ts';

/** One candidate object in a layer. */
export interface FillObject {
  /** Full shared href, as a placed object records it. */
  shared: string;
  /** Object type the href implies, e.g. `AdvMapStatic`. */
  type: string;
  /**
   * The class the preset names, e.g. `AdvMapStaticShared`.
   *
   * Kept beside the placed type because the file is written back out: the
   * document's own `<Type>` is what round-trips, and deriving it from the
   * placed type would be a second opinion about something the file states.
   */
  sharedClass: string;
  /** The `ID` as the preset writes it — what a person reads in the panel. */
  id: string;
  /**
   * Radius it claims, in tiles.
   *
   * Two things use it: nothing is placed within this distance of another
   * object's, and nothing is placed within this distance of the painted area's
   * edge. Zero is legal and means "no clearance at all" — the grass layers use
   * it, and that is why grass fills right up to the border.
   */
  size: number;
  /** Chance this candidate is actually placed once it has been drawn, 0..1. */
  probability: number;
  /** Stand it at its authored facing rather than a random one. */
  noRandomAngle: boolean;
}

/** One layer of a preset: a grid of candidates at one spacing and inset. */
export interface FillLayer {
  objects: FillObject[];
  /**
   * Grid spacing, in tiles. The layer's candidates sit on a lattice of this
   * pitch, so a smaller number means a denser layer.
   */
  dispersion: number;
  /**
   * How much further from the edge THE NEXT layers start, in tiles.
   *
   * Not this layer's own inset: a layer is kept clear of the edge by the widths
   * of every layer BEFORE it. That is what makes a preset read as bands —
   * grass (width 0) covers everything, bushes start half a tile in, trees a
   * further three quarters — from one number per layer.
   */
  width: number;
  /** Applies to every object of the layer that does not say otherwise. */
  noRandomAngle: boolean;
}

/** A named recipe: what the panel lists and the tool paints with. */
export interface FillPreset {
  name: string;
  layers: FillLayer[];
  /** Which file it came from — shown in the panel, since the two can clash. */
  source: string;
}

/**
 * The object type a shared href implies.
 *
 * Same rule the object catalogue follows (src/map/objects.ts): the class in the
 * xpointer is the placed element's name with `Shared` dropped.
 */
const typeOf = (sharedClass: string): string => sharedClass.replace(/Shared$/i, '');

const num = (v: string, d: number): number => {
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : d;
};

/**
 * Text as it was before being written into the file.
 *
 * Our XML layer keeps character data verbatim — it exists to round-trip the
 * game's documents byte for byte, not to interpret them — so the entities the
 * writer puts in are undone here, where the pair belongs together. Nothing in
 * the shipped files carries one, so this is inert for them.
 */
const unesc = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const bool = (v: string): boolean => /^(true|1)$/i.test(v.trim());

/**
 * The shared href a preset's `Type` + `ID` name.
 *
 * The leading slash and the xpointer are both load-bearing: a `<Shared>` names
 * a document AND the class in it, and the game resolves neither half without
 * the other (see paletteShared in electron/channels/objects.ts).
 */
export function sharedHref(type: string, id: string): string {
  const path = id.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return `/MapObjects/${path}.(${type}).xdb#xpointer(/${type})`;
}

/**
 * The `Type` and `ID` a shared href is made of — `sharedHref` backwards.
 *
 * This is how the object catalogue's entries become preset candidates: the
 * palette knows an object by its href, and a preset writes the two halves.
 * Null when the href is not a `MapObjects` path with a class on it, which is
 * every reference a preset cannot name.
 */
export function presetRefOf(href: string): { type: string; id: string } | null {
  const m = /^\/?MapObjects\/(.+)\.\((\w+)\)\.xdb(?:#.*)?$/i.exec(href.replace(/\\/g, '/').replace(/^\/+/, ''));
  return m ? { type: m[2]!, id: m[1]!.replace(/\//g, '\\') } : null;
}

/** Parse one `FillPresets.xml`. Malformed entries are dropped, not thrown over. */
export function readFillPresets(xml: string, source: string): FillPreset[] {
  const root = parse(xml);
  // Searched rather than walked: `find` only looks at direct children, and the
  // list sits under a `<Base>` in the game's file. Ours could as easily be
  // written without one, and the wrapper is not what identifies the data.
  const presets = findAll(root, 'Presets')[0];
  if (!presets) return [];
  const out: FillPreset[] = [];
  for (const item of children(presets).filter((c) => c.name === 'Item')) {
    const name = unesc(childText(item, 'Name').trim());
    const layersEl = find(item, 'Layers');
    if (!name || !layersEl) continue;
    const layers: FillLayer[] = [];
    for (const l of children(layersEl).filter((c) => c.name === 'Item')) {
      const objectsEl = find(l, 'objects');
      const objects: FillObject[] = [];
      for (const o of objectsEl ? children(objectsEl).filter((c) => c.name === 'Item') : []) {
        const ref = find(o, 'Object');
        const type = ref ? unesc(childText(ref, 'Type').trim()) : '';
        const id = ref ? unesc(childText(ref, 'ID').trim()) : '';
        if (!type || !id) continue;
        objects.push({
          shared: sharedHref(type, id),
          type: typeOf(type),
          sharedClass: type,
          id,
          size: num(childText(o, 'Size'), 0),
          // A candidate with no probability at all would never be placed, which
          // is a silently empty layer; the original's own presets always write
          // one, so a missing field is a broken file rather than "never".
          probability: num(childText(o, 'Probability'), 1),
          noRandomAngle: bool(childText(o, 'NoRandomAngle')),
        });
      }
      // A layer with no candidates or no spacing cannot place anything: the
      // grid step comes from Dispersion, and zero would be an endless loop.
      const dispersion = num(childText(l, 'Dispersion'), 0);
      if (!objects.length || dispersion <= 0) continue;
      layers.push({
        objects,
        dispersion,
        width: num(childText(l, 'Width'), 0),
        noRandomAngle: bool(childText(l, 'NoRandomAngle')),
      });
    }
    if (layers.length) out.push({ name, layers, source });
  }
  return out;
}

/**
 * A preset as something EDITING it holds one: the file's own two-part
 * reference, and no derived fields.
 *
 * The window builds one of these, the channel writes it, and both turn it into
 * a preset through `presetFromDraft` — so what the editor previews and what the
 * file ends up saying come from one function rather than two that agree today.
 */
export interface FillDraftObject {
  /** The class the file names, e.g. `AdvMapStaticShared`. */
  type: string;
  id: string;
  size: number;
  probability: number;
  noRandomAngle: boolean;
}
export interface FillDraftLayer {
  dispersion: number;
  width: number;
  noRandomAngle: boolean;
  objects: FillDraftObject[];
}
export interface FillDraft {
  name: string;
  layers: FillDraftLayer[];
}

/**
 * Turn a draft into a preset, refusing the ones that would do nothing.
 *
 * Both ways a preset can be silently inert — a layer with no candidates, a
 * spacing of zero — are caught here, where they can still be explained, rather
 * than at the end of a fill that planted nothing.
 */
export function presetFromDraft(d: FillDraft, source: string): FillPreset {
  const name = d.name.trim();
  if (!name) throw new Error('a preset needs a name');
  const layers: FillLayer[] = d.layers.map((l) => ({
    dispersion: l.dispersion,
    width: l.width,
    noRandomAngle: l.noRandomAngle,
    objects: l.objects.map((o) => ({
      shared: sharedHref(o.type, o.id),
      type: o.type.replace(/Shared$/i, ''),
      sharedClass: o.type,
      id: o.id,
      size: o.size,
      probability: o.probability,
      noRandomAngle: o.noRandomAngle,
    })),
  }));
  if (!layers.length) throw new Error('a preset needs at least one layer');
  for (const [i, l] of layers.entries()) {
    if (!l.objects.length) throw new Error(`layer ${i + 1} has nothing to plant`);
    if (!(l.dispersion > 0)) throw new Error(`layer ${i + 1} needs a spacing above zero`);
  }
  return { name, layers, source };
}

/** Every object any layer of a preset can place — what needs resolving on disk. */
export function presetObjects(p: FillPreset): FillObject[] {
  return p.layers.flatMap((l) => l.objects);
}

/** A number as the file writes it: no trailing zeros, no exponent. */
const numText = (v: number): string => String(Number.isFinite(v) ? +v.toFixed(4) : 0);

/** Text that has to survive being read back as XML. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Write presets back out in the same format they are read from.
 *
 * Whole file at a time, not an edit in place: a preset file is a list and the
 * editor owns all of one file (the user's), so re-emitting it keeps the shape
 * uniform instead of accumulating whatever an in-place insert would leave. The
 * game's own file and ours are never written — see electron/channels/fill.ts.
 */
export function writeFillPresets(presets: readonly FillPreset[]): string {
  const out: string[] = ['<?xml version="1.0"?>', '<Base>', '\t<Presets>'];
  for (const p of presets) {
    out.push('\t\t<Item>', `\t\t\t<Name>${esc(p.name)}</Name>`, '\t\t\t<Layers>');
    for (const l of p.layers) {
      out.push('\t\t\t\t<Item>', '\t\t\t\t\t<objects>');
      for (const o of l.objects) {
        out.push('\t\t\t\t\t\t<Item>',
          '\t\t\t\t\t\t\t<Object>',
          `\t\t\t\t\t\t\t\t<Type>${esc(o.sharedClass)}</Type>`,
          `\t\t\t\t\t\t\t\t<ID>${esc(o.id)}</ID>`,
          '\t\t\t\t\t\t\t</Object>',
          `\t\t\t\t\t\t\t<Size>${numText(o.size)}</Size>`,
          `\t\t\t\t\t\t\t<Probability>${numText(o.probability)}</Probability>`);
        // Only when set: the game's own presets leave it out, and a file that
        // grows a field on every save reads as a change that was not made.
        if (o.noRandomAngle) out.push('\t\t\t\t\t\t\t<NoRandomAngle>true</NoRandomAngle>');
        out.push('\t\t\t\t\t\t</Item>');
      }
      out.push('\t\t\t\t\t</objects>',
        `\t\t\t\t\t<Dispersion>${numText(l.dispersion)}</Dispersion>`,
        `\t\t\t\t\t<Width>${numText(l.width)}</Width>`);
      if (l.noRandomAngle) out.push('\t\t\t\t\t<NoRandomAngle>true</NoRandomAngle>');
      out.push('\t\t\t\t</Item>');
    }
    out.push('\t\t\t</Layers>', '\t\t</Item>');
  }
  out.push('\t</Presets>', '</Base>', '');
  return out.join('\n');
}
