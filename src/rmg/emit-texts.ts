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

/** The generated text files, named as the archive holds them. */
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
  for (let i = 0; i < 2 + input.players; i++) files.push({ name: `caption-text-${i}.txt`, data: name });
  for (let i = 0; i < input.players; i++) files.push({ name: `desc-text-${i}.txt`, data: description });
  files.push({ name: 'mapobjective-text-0.txt', data: encode(paramText(dataRoot, href('DefaultRMGObjective'))) });
  files.push({ name: 'objective-caption-text-0.txt', data: encode(paramText(dataRoot, href('ObjectiveCaption'))) });
  files.push({ name: 'objective-desc-text-0.txt', data: encode(paramText(dataRoot, href('ObjectiveDescription'))) });
  return files;
}
