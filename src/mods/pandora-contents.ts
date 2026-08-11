// What a Pandora's Box holds, and what that is worth.
//
// The contents belong to the PLACED BOX, not to the object definition: two
// boxes of the same shared document hold different things, and the map is what
// remembers which. This module is the model and the valuer only — where the
// contents are kept is src/map/pandora-store.ts, and what the game is told is
// src/mods/pandora-scripts.ts.
//
// ONE VALUER FOR CREATURES, whichever side they are on. Ten archangels handed
// over and ten archangels fought are the same ten archangels — the box holds
// them either way — so a guard costs exactly what a gift costs and the two land
// on the same glow. That is the rule this file exists to keep in one place.
//
// WHAT IS MEASURED AND WHAT IS OURS. Every price that the game states, we read:
// an artifact's `CostOfGold`, a creature's hire gold, a spell's level. The
// three RATES below are not stated anywhere — the game ships no resource price
// (ResourcesInfo.xdb carries icons and nothing else; the market rate is
// computed in the executable), and experience has no price at all. So they are
// OURS, named here, changed in one line, and the documentation says so rather
// than pretending they were measured.

/** One stack, of creatures given or of creatures fought. */
export interface PandoraStack {
  /** A `CREATURE_*` name or a raw number. */
  creature: string | number;
  count: number;
}

/** The six mine resources, in the order the game lists them. */
export const PANDORA_RESOURCES = ['wood', 'ore', 'mercury', 'crystal', 'sulfur', 'gem'] as const;
export type PandoraResource = (typeof PANDORA_RESOURCES)[number];

/**
 * What one placed box holds. Everything is optional and everything adds up: a
 * box may hand over gold AND an artifact AND a stack, and be guarded besides.
 */
export interface PandoraContents {
  /** The placement's Name on the map — the handle the trigger watches. */
  name: string;
  /** Shown when the box opens, the way a signpost speaks. */
  message?: string;
  exp?: number;
  gold?: number;
  wood?: number; ore?: number; mercury?: number; crystal?: number; sulfur?: number; gem?: number;
  /** `ARTIFACT_*` names or raw ids. */
  artifacts?: (string | number)[];
  /** Spell ids, taught to the opening hero. */
  spells?: (string | number)[];
  /** Join the opening hero's army. */
  creatures?: PandoraStack[];
  /** Fought before the box opens. */
  guards?: PandoraStack[];
  /**
   * The glow, when the author overrides it: a tier key, or absent for the tier
   * the contents earn. An override is kept even when the contents change, which
   * is the point of having one.
   */
  tier?: string;
}

// --- the glows ---------------------------------------------------------------

/** The glow tiers, poorest first — the game's own artifact glows. */
export interface PandoraTier {
  key: string;
  /** The shipped glow effect this tier copies. */
  effect: string;
  /** Contents worth at least this much, in gold, earn the tier. */
  from: number;
}

export const PANDORA_TIERS: readonly PandoraTier[] = [
  { key: 'Blue', effect: 'Effects/_(Effect)/Artefacts/General/Blue.xdb', from: 0 },
  { key: 'Green', effect: 'Effects/_(Effect)/Artefacts/General/Green.xdb', from: 5000 },
  { key: 'Gold', effect: 'Effects/_(Effect)/Artefacts/General/Gold.xdb', from: 15000 },
  { key: 'Red', effect: 'Effects/_(Effect)/Artefacts/General/Red.xdb', from: 40000 },
];

/** The tier a contents value earns. */
export function pandoraTier(value: number): PandoraTier {
  let tier = PANDORA_TIERS[0]!;
  for (const t of PANDORA_TIERS) if (value >= t.from) tier = t;
  return tier;
}

/** A tier by key, for an override — unknown keys fall back to the poorest. */
export function tierByKey(key: string | undefined): PandoraTier | null {
  if (!key) return null;
  return PANDORA_TIERS.find((t) => t.key === key) ?? null;
}

// --- the prices --------------------------------------------------------------

/**
 * OUR rates, in gold. Not measured — see the header. They are chosen so the
 * four tiers read the way a player expects: a chest of 10 000 gold is richer
 * than a stack of peasants and poorer than an archangel.
 */
export const PANDORA_RATES = {
  /** A common resource (wood, ore). */
  common: 250,
  /** A rare one (mercury, crystal, sulfur, gems). */
  rare: 500,
  /** One point of experience. */
  exp: 1,
  /** One level of a taught spell — a level-5 spell is worth 5 of these. */
  spellLevel: 1000,
} as const;

const RARE = new Set<PandoraResource>(['mercury', 'crystal', 'sulfur', 'gem']);

/** What the game says things cost — supplied by the caller, so the valuer is
 *  testable without the game's data. Unknown ids answer 0. */
export interface PandoraPrices {
  /** Gold ONE of this creature costs to hire. */
  creature(id: string | number): number;
  /** An artifact's `CostOfGold`. */
  artifact(id: string | number): number;
  /** A spell's level, 1–5. */
  spellLevel(id: string | number): number;
}

/** A valuer that knows no prices — what a form shows before the data is read. */
export const NO_PRICES: PandoraPrices = { creature: () => 0, artifact: () => 0, spellLevel: () => 0 };

/** One line of the breakdown a window shows beside the total. */
export interface PandoraValuePart {
  /** Which part of the contents: `gold`, `wood`, `artifacts`, `creatures`, `guards`… */
  what: string;
  /** What it is worth, in gold. */
  gold: number;
}

/**
 * What the box is worth, and where that came from.
 *
 * The parts are what the window shows: a total alone cannot be argued with,
 * and the first question anyone asks a number like this is which half of the
 * box made it.
 */
export function pandoraValue(box: PandoraContents, prices: PandoraPrices): {
  total: number;
  parts: PandoraValuePart[];
} {
  const parts: PandoraValuePart[] = [];
  const add = (what: string, gold: number): void => { if (gold) parts.push({ what, gold: Math.round(gold) }); };

  add('gold', box.gold ?? 0);
  for (const r of PANDORA_RESOURCES) {
    add(r, (box[r] ?? 0) * (RARE.has(r) ? PANDORA_RATES.rare : PANDORA_RATES.common));
  }
  add('experience', (box.exp ?? 0) * PANDORA_RATES.exp);
  add('artifacts', (box.artifacts ?? []).reduce<number>((sum, a) => sum + prices.artifact(a), 0));
  add('spells', (box.spells ?? [])
    .reduce<number>((sum, s) => sum + prices.spellLevel(s) * PANDORA_RATES.spellLevel, 0));
  const stacks = (list: readonly PandoraStack[] | undefined): number =>
    (list ?? []).reduce((sum, s) => sum + prices.creature(s.creature) * s.count, 0);
  add('creatures', stacks(box.creatures));
  // The guards count as contents, not as a discount: the box holds them too.
  add('guards', stacks(box.guards));

  return { total: parts.reduce((sum, p) => sum + p.gold, 0), parts };
}

/** The glow a box wears: the author's override, or the one its contents earn. */
export function boxTier(box: PandoraContents, prices: PandoraPrices): PandoraTier {
  return tierByKey(box.tier) ?? pandoraTier(pandoraValue(box, prices).total);
}

/** True when the box would hand over nothing at all — an empty box still opens,
 *  and still says its message, but nothing else happens. */
export function isEmptyBox(box: PandoraContents): boolean {
  return !box.message && !box.exp && !box.gold
    && !PANDORA_RESOURCES.some((r) => box[r])
    && !box.artifacts?.length && !box.spells?.length && !box.creatures?.length;
}
