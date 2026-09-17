// The race picker's order — the file the extension reads it from.
//
// The scenario setup's race picker walks a compiled table of eight (see
// docs/engineInternals/FACTIONS.md, "the race picker has its own ledger"), and
// `native/faction/race-order.c` detours the four accessors of that table onto
// a table of OURS, read from `bin/homm5-editor-races.txt`. This writes it.
//
// One line per race, in the order the arrows show them, shipped ones first:
//
//   race <townType> [pickerTexture [tooltipText]]   # name
//
// The number is the `TownType` ordinal from the game's `types.xml` — the only
// thing the DLL can compare a player's record against. The texture is the name
// of an item in `UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb`,
// given only for a race of ours: the shipped eight are drawn by the engine's
// own constructor, name by name, and a line that repeats theirs would only
// put the same texture back. The tooltip is the item's name in the sibling
// `Races.(WindowRelatedTexts).xdb`, and the same rule applies.
//
// Always written whole, like the effects file: a stale line would keep a race
// in the picker after its faction is gone from the mod.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Beside `H5_Game_H5E.exe` and the extension, relative to the game root. */
export const RACES_FILE = join('bin', 'homm5-editor-races.txt');

/**
 * The shipped picker, in its own order — the compiled table at `0x1090E0C`
 * spelt by name. Haven, Inferno, Necropolis, Sylvan, Dungeon, Academy,
 * Fortress, Stronghold: not the enum's order, which is the tavern's.
 */
export const SHIPPED_PICKER_ORDER: readonly string[] = [
  'TOWN_HEAVEN', 'TOWN_INFERNO', 'TOWN_NECROMANCY', 'TOWN_PRESERVE',
  'TOWN_DUNGEON', 'TOWN_ACADEMY', 'TOWN_FORTRESS', 'TOWN_STRONGHOLD',
];

export interface PickerRace {
  /** `TOWN_*`, for the comment. */
  name: string;
  /** Its ordinal in `types.xml`. */
  town: number;
  /** The related-textures item that draws it — a race of ours only. */
  texture?: string;
  /** The related-texts item the arrow's tooltip shows — with `texture`, a race of ours only. */
  tooltip?: string;
}

/** The file's text. */
export function racesFileText(races: readonly PickerRace[]): string {
  const lines = [
    '# The race picker, in order. Written by the editor; read by homm5-editor.dll.',
    '#   race <townType> [pickerTexture [tooltipText]]   # name',
  ];
  for (const r of races) {
    const texture = r.texture ? ` ${r.texture}` : '';
    const tooltip = r.texture && r.tooltip ? ` ${r.tooltip}` : '';
    lines.push(`race ${r.town}${texture}${tooltip}   # ${r.name}`);
  }
  return lines.join('\n') + '\n';
}

/** Write it beside the executable and say where. */
export function writeRacesFile(gameRoot: string, races: readonly PickerRace[]): string {
  const path = join(gameRoot, RACES_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, racesFileText(races), 'latin1');
  return path;
}
