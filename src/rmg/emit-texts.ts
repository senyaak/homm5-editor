// The .h5m's text files — the generator's own dozen UTF-16LE snippets.
//
// Nothing here is invented: the description is `RMG/Params/rmgMapDesc.txt`
// with its `<value=...>` holes filled from the words the SAME document
// names file by file (the size ladder, the monster-strength ladder, the
// with/without pairs), and the objectives are the `DefaultRMGObjective` /
// `ObjectiveCaption` / `ObjectiveDescription` files verbatim. The map
// name (typed into the order dialog) fans out into `mapname-text-0.txt`
// and the caption files.
//
// Encoding: every emitted file is UTF-16LE with a BOM and no trailing
// newline — the engine's own writer (`src/map/new-map.ts` has the same
// encoder for the editor's blanks).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { find, findAll, parse } from '../format/xml.ts';

/** What the GAME's generator writes into every scenario caption — see `captionText`. */
export const GAME_CAPTION_TEXT = 'Это название карты';

export interface RmgTextsInput {
  /** The typed map name. */
  mapName: string;
  /** The template file stem — S1P2Z2M1, S0-1P2Z2K3.1T, … */
  template: string;
  /** The map-size table index (72 -> 0, 96 -> 1, …). */
  sizeIndex: number;
  underground: boolean;
  water: boolean;
  /** The monster-strength index, 0..4. */
  monsterStrength: number;
  players: number;
  seed: number;
  /**
   * The index the FIRST scenario caption document gets. The generator's own
   * output numbers from 0; a map saved through the editor's dialog starts at 2
   * and carries two unreferenced copies at 0 and 1. See `buildRmgTexts` below.
   */
  captionBase?: number;
  /**
   * What the two caption documents BELOW the base say. The editor's save path
   * copies the map name into every caption document; the GAME's save writes
   * its two unreferenced ones as a fixed placeholder — every map its generator
   * has produced carries `Это название карты` ("this is the map's name") in
   * `caption-text-0/1` and the real name in the referenced `2/3`. Taken as the
   * value it is; where the game reads it from has not been found in the
   * unpacked data or either executable.
   */
  captionText?: string;
}

/** A params-relative text file, decoded by its BOM (they ship UTF-16LE). */
function paramText(dataRoot: string, name: string): string {
  const raw = readFileSync(join(dataRoot, 'RMG', 'Params', name));
  if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le');
  const text = raw.toString('utf8');
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** UTF-16LE with a BOM, no trailing newline. */
function encode(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/**
 * The generated text files, named as the archive holds them.
 *
 * THE CAPTION NUMBERING IS THE SAVE PATH'S, NOT THE GENERATOR'S. Ordering the
 * same map two ways gives two numberings, and the split is total: all 44 maps
 * of the two console sweeps (`tools/rmg-batch.ts`, one launch per order) write
 * exactly `players` caption documents and reference them from 0, while all 11
 * maps saved through the editor's own dialog write two MORE at 0 and 1 that
 * nothing references and reference the generator's at 2. Same seeds, same
 * templates, same everything else - `map.xdb` differs by those two bytes alone.
 *
 * So the caller says which it is writing: `captionBase` 0 for the generator's
 * own output (the default), 2 for a comparison against a dialog-saved archive.
 * The port used to hardcode 2, which made it exact against the three saved
 * references and two bytes out against every map the batch orders.
 */
export function buildRmgTexts(dataRoot: string, input: RmgTextsInput): Array<{ name: string; data: Buffer }> {
  const params = find(parse(readFileSync(join(dataRoot, 'RMG', 'Params', 'Default.xdb'), 'utf8')), 'RMGParameters');
  if (!params) throw new Error('RMG/Params/Default.xdb: not an RMGParameters');
  const href = (tag: string): string => {
    const h = find(params, tag)?.attrs['href'];
    if (!h) throw new Error(`RMGParameters: no ${tag} href`);
    return h;
  };
  const listHref = (tag: string, index: number): string => {
    const holder = find(params, tag);
    const items = holder ? findAll(holder, 'Item') : [];
    const h = items[index]?.attrs['href'];
    if (!h) throw new Error(`RMGParameters: no ${tag}[${index}] href`);
    return h;
  };

  const desc = paramText(dataRoot, href('MapDescription'))
    .replace('<value=template>', input.template)
    .replace('<value=mapsize>', paramText(dataRoot, listHref('MapSizeNames', input.sizeIndex)))
    .replace('<value=underground>', paramText(dataRoot, href(input.underground ? 'TextWith' : 'TextWithout')))
    .replace('<value=water>', paramText(dataRoot, href(input.water ? 'TextWithWater' : 'TextWithoutWater')))
    .replace('<value=monsterstrenght>', paramText(dataRoot, listHref('MonsterStrenghtNames', input.monsterStrength)))
    .replace('<value=playerscount>', String(input.players))
    .replace('<value=startseed>', String(input.seed));

  const files: Array<{ name: string; data: Buffer }> = [];
  const name = encode(input.mapName);
  const description = encode(desc);
  files.push({ name: 'mapname-text-0.txt', data: name });
  files.push({ name: 'mapdesc-text-0.txt', data: description });
  // ONE PER SCENARIO ITEM, plus whatever the numbering starts above. Every one
  // of them is a copy of the map name; only the last `players` are referenced.
  const captionBase = input.captionBase ?? 0;
  // The GAME's two unreferenced documents below the base carry a fixed
  // placeholder rather than another copy of the name — see `captionText`;
  // the referenced ones above it are the name in both builds.
  const placeholder = input.captionText === undefined ? name : encode(input.captionText);
  for (let i = 0; i < captionBase + input.players; i++) {
    files.push({ name: `caption-text-${i}.txt`, data: i < captionBase ? placeholder : name });
  }
  for (let i = 0; i < input.players; i++) files.push({ name: `desc-text-${i}.txt`, data: description });
  files.push({ name: 'mapobjective-text-0.txt', data: encode(paramText(dataRoot, href('DefaultRMGObjective'))) });
  files.push({ name: 'objective-caption-text-0.txt', data: encode(paramText(dataRoot, href('ObjectiveCaption'))) });
  files.push({ name: 'objective-desc-text-0.txt', data: encode(paramText(dataRoot, href('ObjectiveDescription'))) });
  return files;
}
