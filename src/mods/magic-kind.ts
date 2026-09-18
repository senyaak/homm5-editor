// A CLASS WITHOUT MAGIC — the file the extension reads to refuse its heroes
// every spell.
//
// Who may learn a spell the engine decides by a skill: Blood Rage, the
// barbarian's racial, which every barbarian holds from his first day — so
// the skill is a proxy for the class, and a barbarian learns warcries and
// no spell. The extension answers the class instead: a class marked `none`
// here "holds Blood Rage" at the two gates of `CanLearnSpell`, and learns
// nothing — an ordinary, empty spellbook (native/faction/magic-kind.c).
//
// Warcries were the first shape of this and were rolled back (2026-09-18):
// every warcry is a charge of rage, and rage is the Horde's — Blood Rage
// and creatures with the Rage ability. A faction without magic is the case
// that stands: the Heroes III yogi who cannot cast.
//
// The town's side is data alone — `TownSpec.magic: 'none'`, a guild that is
// five stubs and no cell (town-files.ts).
//
//   bin/homm5-editor-magic.txt
//     class <ordinal> none

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Beside `H5_Game_H5E.exe` and the extension, relative to the game root. */
export const MAGIC_FILE = join('bin', 'homm5-editor-magic.txt');

/** What a class's heroes do with spells: learn them (the default) or never. */
export type MagicKind = 'spellbook' | 'none';

export interface MagicRow {
  /** A hero class's ordinal in the class table. */
  ordinal: number;
}

/** The file's text: one row per class without magic. */
export function magicFileText(rows: readonly MagicRow[]): string {
  const lines = [
    '# Classes whose heroes learn no spell. Written by the editor; read by homm5-editor.dll.',
    '#   class <ordinal> none',
  ];
  for (const r of rows) {
    if (!Number.isInteger(r.ordinal) || r.ordinal <= 0) throw new Error(`class ${r.ordinal}: an ordinal is a positive integer`);
    lines.push(`class ${r.ordinal} none`);
  }
  return lines.join('\n') + '\n';
}

/** Write it beside the executable and say where. Always whole: a stale row would keep a class silent after its faction is gone. */
export function writeMagicFile(gameRoot: string, rows: readonly MagicRow[]): string {
  const path = join(gameRoot, MAGIC_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, magicFileText(rows), 'latin1');
  return path;
}

/** The rows for a mod's classes: those without magic, by ordinal. */
export function magicRows(classes: readonly { number: number; magic?: MagicKind }[]): MagicRow[] {
  return classes.filter((c) => c.magic === 'none').map((c): MagicRow => ({ ordinal: c.number }));
}
