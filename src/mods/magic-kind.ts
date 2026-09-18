// A FACTION'S MAGIC — the file the extension reads to answer "does this one
// use warcries" for a class and a town of ours.
//
// The game ships one kind of hero who shouts and one town that teaches it,
// and asks about both by identity: `GetClass() == HERO_CLASS_BARBARIAN` at
// nineteen places, `type == TOWN_STRONGHOLD` at nine about the guild
// (native/faction/magic-kind.c lists them). A class of ours that should
// shout, and a town of ours whose guild is a hall, are rows here; the
// extension overwrites those places with a call that answers the shipped
// identity for them and the engine's own for everyone else. Nothing else
// about the class or the town changes.
//
// The town's data half is the copier's (`TownSpec.magic`, town-files.ts); the
// class's data half is nothing — a spellbook and a book of warcries are the
// same `Spell` records, drawn by school. Own SCHOOLS are not possible: the
// enum, the book's tabs and the skills that key on a school are compiled
// (FACTION_PLAN.md, 1c).
//
//   bin/homm5-editor-magic.txt
//     class <ordinal> warcries
//     town <townType> warcries

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Beside `H5_Game_H5E.exe` and the extension, relative to the game root. */
export const MAGIC_FILE = join('bin', 'homm5-editor-magic.txt');

/** What a class's heroes do in a battle, and what a town's guild teaches. */
export type MagicKind = 'spellbook' | 'warcries';

export interface MagicRow {
  /** A hero class (its ordinal in the class table) or a town type. */
  what: 'class' | 'town';
  ordinal: number;
}

/** The file's text: one row per class and town of warcries. */
export function magicFileText(rows: readonly MagicRow[]): string {
  const lines = [
    '# Who uses warcries: a class of ours that shouts, a town of ours whose guild is a hall.',
    '# Written by the editor; read by homm5-editor.dll.',
    '#   class <ordinal> warcries',
    '#   town <townType> warcries',
  ];
  for (const r of rows) {
    if (!Number.isInteger(r.ordinal) || r.ordinal <= 0) throw new Error(`${r.what} ${r.ordinal}: an ordinal is a positive integer`);
    lines.push(`${r.what} ${r.ordinal} warcries`);
  }
  return lines.join('\n') + '\n';
}

/** Write it beside the executable and say where. Always whole: a stale row would keep a class shouting after its faction is gone. */
export function writeMagicFile(gameRoot: string, rows: readonly MagicRow[]): string {
  const path = join(gameRoot, MAGIC_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, magicFileText(rows), 'latin1');
  return path;
}

/** The rows for a mod's classes and towns: those of warcries, by ordinal. */
export function magicRows(
  classes: readonly { number: number; magic?: MagicKind }[],
  towns: readonly { ordinal: number; magic?: 'guild' | 'warcries' }[],
): MagicRow[] {
  return [
    ...classes.filter((c) => c.magic === 'warcries').map((c): MagicRow => ({ what: 'class', ordinal: c.number })),
    ...towns.filter((t) => t.magic === 'warcries').map((t): MagicRow => ({ what: 'town', ordinal: t.ordinal })),
  ];
}
