// What in the MOD names a creature — one list, read by the model that refuses a
// removal and by the window that says why before anybody presses Remove.
//
// Structural on purpose, as spell-holders.ts is: the window holds the
// manifest's DTOs, the model holds the manifest itself, and both have these
// fields. No imports, so the renderer can take it without the mod builder.

/** The parts of a mod a creature can be named from. */
export interface CreatureHoldingMod {
  creatures?: readonly { id: string; raisedAs?: string; stats?: { base?: string; upgrades?: readonly string[] } }[];
  dwellings?: readonly { file: string; creatures?: readonly string[] }[];
  factions?: readonly {
    file: string;
    shooter?: string;
    dwellings?: Partial<Record<number, { base: string; upgrade: string; alternate?: string }>>;
  }[];
}

/**
 * Each holder as "<who> <how>": a creature that is an upgrade of it, that
 * upgrades into it or that is raised as it; a dwelling that hires it; a
 * faction whose tier hires it or whose towers it mans. Maps are not here —
 * they are not the mod's (`findCreatureUses`), and they are a warning, not a
 * refusal.
 */
export function creatureHolders(mod: CreatureHoldingMod, id: string): string[] {
  const others = (mod.creatures ?? []).filter((c) => c.id !== id);
  return [
    ...others.filter((c) => c.stats?.base === id).map((c) => `creature ${c.id} is its upgrade`),
    ...others.filter((c) => c.stats?.upgrades?.includes(id)).map((c) => `creature ${c.id} upgrades into it`),
    ...others.filter((c) => c.raisedAs === id).map((c) => `creature ${c.id} is raised as it`),
    ...(mod.dwellings ?? []).filter((d) => d.creatures?.includes(id)).map((d) => `dwelling ${d.file} hires it`),
    ...(mod.factions ?? []).flatMap((f) => Object.entries(f.dwellings ?? {})
      .filter(([, t]) => t && [t.base, t.upgrade, t.alternate].includes(id))
      .map(([tier]) => `faction ${f.file}'s tier ${tier} hires it`)),
    ...(mod.factions ?? []).filter((f) => f.shooter === id).map((f) => `faction ${f.file}'s towers are manned by it`),
  ];
}
