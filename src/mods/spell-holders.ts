// What in the MOD names a spell — one list, read by the model that refuses a
// removal and by the window that says why before anybody presses Remove.
//
// Structural on purpose: the window holds the manifest's DTOs, the model holds
// the manifest itself, and both have these fields. No imports, so the renderer
// can take it without pulling the mod builder in behind it.

/** The parts of a mod a spell can be named from. */
export interface SpellHoldingMod {
  heroes?: readonly { id: string; spells?: readonly string[] }[];
  classes?: readonly { id: string; preferredSpells?: readonly string[] }[];
  specializations?: readonly { id: string; ability?: string }[];
  factions?: readonly { file: string; race?: { moat?: { spells?: readonly { spell: string }[] } } }[];
}

/**
 * Each holder as "<who> <how>": a hero who starts knowing it, a class that
 * prefers it in the spell shop, a specialization that grants it, a faction
 * whose moat casts it. Maps are not here — they are not the mod's
 * (`findSpellUses`), and they are a warning, not a refusal.
 */
export function spellHolders(mod: SpellHoldingMod, id: string): string[] {
  return [
    ...(mod.heroes ?? []).filter((h) => h.spells?.includes(id)).map((h) => `hero ${h.id} knows it`),
    ...(mod.classes ?? []).filter((c) => c.preferredSpells?.includes(id)).map((c) => `class ${c.id} prefers it`),
    ...(mod.specializations ?? []).filter((s) => s.ability === id).map((s) => `specialization ${s.id} grants it`),
    ...(mod.factions ?? []).filter((f) => f.race?.moat?.spells?.some((m) => m.spell === id))
      .map((f) => `faction ${f.file}'s moat casts it`),
  ];
}
