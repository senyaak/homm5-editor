// Whether a race can START a game — what the engine needs of the mod's
// creatures before a hero of it can take the field.
//
// A hero's starting army (0xC26FA0) walks every creature and keeps, per tier
// 1..3, the last one whose `CreatureTown` is his race and whose `BaseCreature`
// is none; then it hands him tiers 1, 2 and 3, each separately. A tier with
// nobody reads creature record 0 and the game dies at 0xC2E487 before the
// first turn (launch 8; docs/engineInternals/FACTIONS.md, "The race plays").
//
// A warning and not a refusal: the creatures of a race can only be made once
// the race exists — the Units window offers its town after the faction is
// installed — so a faction is always without them for a while.
//
// Structural and import-free, like creature-holders.ts, so the window can ask.

/** The parts of a creature the starting army reads. */
export interface RaceCreature {
  stats: { town: string; tier: number; base?: string };
}

/** The tiers 1..3 that no base creature of `type` fills — empty when the race can start. */
export function missingStartTiers(type: string, creatures: readonly RaceCreature[]): number[] {
  const filled = new Set(creatures
    .filter((c) => c.stats.town === type && !c.stats.base)
    .map((c) => c.stats.tier));
  return [1, 2, 3].filter((t) => !filled.has(t));
}

/** The same, said: what is missing and what happens without it. */
export function startWarning(type: string, creatures: readonly RaceCreature[]): string {
  const gaps = missingStartTiers(type, creatures);
  if (!gaps.length) return '';
  return `no base creature of tier ${gaps.join(', ')} is of this race — a game it plays in crashes before the first turn, `
    + 'since a hero starts with one of each of tiers 1–3. Make them in Units… (Town: this race, Upgrade of: nothing).';
}
