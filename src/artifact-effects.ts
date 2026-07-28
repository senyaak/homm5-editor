// What an artifact does beyond its six stats — the file the native extension
// reads.
//
// The six stats an artifact record carries are the only ones the game's own
// data can express. Everything else a shipped artifact does is compiled into
// the executable against its id, so a new id gets none of it
// (docs/ENGINE_INTERNALS.md). The extension adds our terms to the engine's own
// arithmetic, and this is where it is told which ones.
//
// A FLAT TEXT FILE, and deliberately. It is written by one program and read by
// another, in C, with no parser worth the name — and when a bonus does not turn
// up in game the first question is what the file actually says. It is meant to
// be readable in a text editor and diffable in a commit.
//
// It sits beside the executable rather than inside the mod archive, because the
// extension reads it at load time from its own folder and knows nothing about
// archives. That also means it survives rebuilding the mod, which is the common
// case while tuning a number.

import { join } from 'node:path';

/** Beside `H5_Game_H5E.exe` and the extension, relative to the game root. */
export const EFFECTS_FILE = join('bin', 'homm5-editor-effects.txt');

/**
 * The bonuses the extension knows how to add.
 *
 * One so far, and the list grows by reverse engineering rather than by wishing:
 * each entry is a place in the executable where the engine sums its own terms
 * and we have found where to append ours. `necromancy` is the percentage of a
 * battle's dead a necromancer raises — `CNecromancy::RaisePercent`.
 */
export const EFFECT_STATS = ['necromancy'] as const;
export type EffectStat = (typeof EFFECT_STATS)[number];

/** One term: while this artifact is worn, add this much to that sum. */
export interface EffectRow {
  stat: EffectStat;
  /** The artifact's NUMBER, which is what the engine knows it by. */
  artifact: number;
  /** Percentage points. Negative is allowed and means a cursed item. */
  amount: number;
  /** For the comment beside it — the file is meant to be read. */
  name?: string;
}

/**
 * Render the file.
 *
 * Rows with a zero amount are dropped rather than written: a row that adds
 * nothing is indistinguishable in game from a row that was never read, and
 * leaving it in makes the file lie about what is in effect.
 */
export function writeEffects(rows: readonly EffectRow[]): string {
  const lines = [
    '# Artifact effects, written by the editor — see src/artifact-effects.ts.',
    '# The game does not read this; the extension beside it does.',
    '#',
    '#   <stat> artifact <id> <amount>',
    '',
  ];
  for (const r of rows) {
    if (!r.amount) continue;
    lines.push(`${r.stat} artifact ${r.artifact} ${r.amount}${r.name ? `   # ${r.name}` : ''}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Read one back, ignoring comments and anything we do not understand. */
export function readEffects(text: string): EffectRow[] {
  const rows: EffectRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\w+)\s+artifact\s+(-?\d+)\s+(-?\d+)/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const stat = m[1] as EffectStat;
    if (!EFFECT_STATS.includes(stat)) continue;
    rows.push({ stat, artifact: Number(m[2]), amount: Number(m[3]) });
  }
  return rows;
}

/** The rows a mod's artifacts imply, in id order. */
export function effectsOf(
  artifacts: readonly { id: string; number: number; effects?: Partial<Record<EffectStat, number>> }[],
): EffectRow[] {
  const rows: EffectRow[] = [];
  for (const a of artifacts) {
    for (const stat of EFFECT_STATS) {
      const amount = a.effects?.[stat];
      if (amount) rows.push({ stat, artifact: a.number, amount, name: a.id });
    }
  }
  return rows;
}
