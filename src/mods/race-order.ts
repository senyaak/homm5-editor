// The race picker's order — the file the extension reads it from.
//
// The scenario setup's race picker walks a compiled table of eight (see
// docs/engineInternals/FACTIONS.md, "the race picker has its own ledger"), and
// `native/faction/race-order.c` detours the four accessors of that table onto
// a table of OURS, read from `bin/homm5-editor-races.txt`. This writes it.
//
// One line per race, in the order the arrows show them, shipped ones first:
//
//   race <townType> <name> [pickerTexture [tooltipText]]
//
// The number is the `TownType` ordinal from the game's `types.xml` — the only
// thing the DLL can compare a player's record against. The name is the enum's
// own spelling, `TOWN_*`: for a type past the compiled eleven it is what the
// engine's name-of-type function answers, out of the DLL (the switch in the
// executable stops at TOWN_STRONGHOLD, and growing its table in place broke
// under ASLR — see native/faction/race-order.c). The texture is the name
// of an item in `UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb`,
// given only for a race of ours: the shipped eight are drawn by the engine's
// own constructor, name by name, and a line that repeats theirs would only
// put the same texture back. The tooltip is the item's name in the sibling
// `Races.(WindowRelatedTexts).xdb`, and the same rule applies.
//
// Always written whole, like the effects file: a stale line would keep a race
// in the picker after its faction is gone from the mod.
//
// The same file carries what the engine COMPILED per race and answers for a
// race of ours from a row instead (native/faction/race-traits.c):
//
//   trait <townType> alignment good|evil|neutral
//   trait <townType> dwellings <sharedGroupName>
//   trait <townType> ai-skills-like <townType>
//   skillvalue <townType> <skill> <commander> <collectorSupplier> <freelancer>
//
// Only a race of ours has any: the shipped eight are the engine's own arms.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SkillValues } from './factions.ts';

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
  /** `TOWN_*` — the enum's spelling, what the type stringifies as. */
  name: string;
  /** Its ordinal in `types.xml`. */
  town: number;
  /** The related-textures item that draws it — a race of ours only. */
  texture?: string;
  /** The related-texts item the arrow's tooltip shows — with `texture`, a race of ours only. */
  tooltip?: string;
  /** What the engine compiled per race, for a race of ours. */
  traits?: RaceTraits;
}

/** The compiled-per-race properties a row answers — see native/faction/race-traits.c. */
export interface RaceTraits {
  alignment?: 'good' | 'evil' | 'neutral';
  /** The `AdvMapSharedGroup` a random dwelling of the race is drawn from, by its RPGRoot id. */
  dwellings?: string;
  /** A shipped town type's ordinal whose AI skill values answer for ours. */
  aiSkillsLike?: number;
  /** Per skill ordinal, the three values themselves. */
  skillValues?: Record<number, SkillValues>;
}

/** The file's text. */
export function racesFileText(races: readonly PickerRace[]): string {
  const lines = [
    '# The race picker, in order. Written by the editor; read by homm5-editor.dll.',
    '#   race <townType> <name> [pickerTexture [tooltipText]]',
    '# What the engine compiled per race, answered for a race of ours:',
    '#   trait <townType> alignment good|evil|neutral',
    '#   trait <townType> dwellings <sharedGroupName>',
    '#   trait <townType> ai-skills-like <townType>',
    '#   skillvalue <townType> <skill> <commander> <collectorSupplier> <freelancer>',
  ];
  for (const r of races) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(r.name)) throw new Error(`${r.name} is not a TownType name`);
    const texture = r.texture ? ` ${r.texture}` : '';
    const tooltip = r.texture && r.tooltip ? ` ${r.tooltip}` : '';
    lines.push(`race ${r.town} ${r.name}${texture}${tooltip}`);
  }
  for (const r of races) {
    const t = r.traits;
    if (!t) continue;
    if (t.alignment) lines.push(`trait ${r.town} alignment ${t.alignment}`);
    if (t.dwellings) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(t.dwellings)) throw new Error(`${t.dwellings} is not a shared group id`);
      lines.push(`trait ${r.town} dwellings ${t.dwellings}`);
    }
    if (t.aiSkillsLike !== undefined) lines.push(`trait ${r.town} ai-skills-like ${t.aiSkillsLike}`);
    for (const [skill, v] of Object.entries(t.skillValues ?? {})) {
      lines.push(`skillvalue ${r.town} ${skill} ${v.commander} ${v.collectorSupplier} ${v.freelancer}`);
    }
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
