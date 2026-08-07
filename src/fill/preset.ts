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
    const name = childText(item, 'Name').trim();
    const layersEl = find(item, 'Layers');
    if (!name || !layersEl) continue;
    const layers: FillLayer[] = [];
    for (const l of children(layersEl).filter((c) => c.name === 'Item')) {
      const objectsEl = find(l, 'objects');
      const objects: FillObject[] = [];
      for (const o of objectsEl ? children(objectsEl).filter((c) => c.name === 'Item') : []) {
        const ref = find(o, 'Object');
        const type = ref ? childText(ref, 'Type').trim() : '';
        const id = ref ? childText(ref, 'ID').trim() : '';
        if (!type || !id) continue;
        objects.push({
          shared: sharedHref(type, id),
          type: typeOf(type),
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

/** Every object any layer of a preset can place — what needs resolving on disk. */
export function presetObjects(p: FillPreset): FillObject[] {
  return p.layers.flatMap((l) => l.objects);
}
