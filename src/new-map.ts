// Assemble a complete blank map project — the whole file set a fresh map folder
// holds, ready to pack into a .h5m. This ties together the two generated
// binaries (map.xdb, the terrain) and the sibling text files, so "New Map" is a
// single call producing exactly what the original editor exports.
//
// Pure and filesystem-free: it returns the files as {path, data}; the caller
// (electron/main.ts) writes them and registers the project. Verified against the
// editor's own blanks in tools/test-new-map.ts.

import { buildBlankMap } from './blank-map.ts';
import { buildBlankTerrain } from './terrain-blank.ts';

/** Everything New Map needs: a name, a size, level count, and the rosters. */
export interface NewMapOptions {
  /** The map's visible name — goes into name.txt and the scenario captions. */
  name: string;
  /** TileX = TileY: one of the New Map sizes (72, 96, 136, 176, 216, 256, 320). */
  tiles: number;
  /** A second (underground) floor: adds UndergroundTerrain.bin and flips the doc. */
  twoLevel: boolean;
  /** Every spell id (registry.spells()); the map enables them all. */
  spells: string[];
  /** Every artifact id (registry.artifacts()). */
  artifacts: string[];
}

/** One file in the project, by its path relative to the map folder. */
export interface ProjectFile {
  path: string;
  data: Buffer;
}

// The sibling text files are UTF-16 LE with a byte-order mark and NO trailing
// newline — exactly how the editor writes them.
const utf16 = (s: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

// The editor's defaults for a fresh map's canned text.
const DESCRIPTION = 'Custom Map';
const OBJECTIVE = "Kill'em all";
// Eight scenario-info slots: base file plus .1 … .7.
const SCENARIO_SUFFIXES = ['', '.1', '.2', '.3', '.4', '.5', '.6', '.7'];

/**
 * Build the full file set for a fresh map. The result mirrors the editor's blank
 * export: map.xdb, GroundTerrain.bin (+ UndergroundTerrain.bin when two-level),
 * and the name/description/objective/scenario text files.
 */
export function buildNewMapProject(opt: NewMapOptions): ProjectFile[] {
  const { name, tiles, twoLevel, spells, artifacts } = opt;

  const files: ProjectFile[] = [
    { path: 'map.xdb', data: Buffer.from(buildBlankMap({ tiles, twoLevel, spells, artifacts }), 'latin1') },
    { path: 'GroundTerrain.bin', data: buildBlankTerrain(tiles, 'surface') },
  ];
  if (twoLevel) files.push({ path: 'UndergroundTerrain.bin', data: buildBlankTerrain(tiles, 'underground') });

  files.push(
    { path: 'name.txt', data: utf16(name) },
    { path: 'description.txt', data: utf16(DESCRIPTION) },
    { path: 'objective-caption-text.txt', data: utf16(OBJECTIVE) },
    { path: 'objective-desc-text.txt', data: utf16(OBJECTIVE) },
  );
  for (const s of SCENARIO_SUFFIXES) {
    files.push({ path: `scenario-caption${s}.txt`, data: utf16(name) });
    files.push({ path: `scenario-description${s}.txt`, data: utf16(DESCRIPTION) });
  }
  return files;
}
