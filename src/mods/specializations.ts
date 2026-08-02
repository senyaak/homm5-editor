// A specialization of our own — the one thing about a hero that is neither his
// class nor his stats.
//
// WHAT IT IS, IN THE DATA. `HeroSpecialization` is a plain enum in types.xml,
// 84 values (`HERO_SPEC_NONE` = 0 … `HERO_SPEC_INFERNAL_MACHINE` = 83), and
// that is all of it: no reference table, no file per value, no `MinElements`
// and no `MaxElements`, so nothing declares how many there are. A hero names
// one and carries three hrefs beside it — the name, the description and the
// icon the hero screen prints. So adding one is a single enum entry, which
// makes this the cheapest of the three things that hold a number (a creature
// extends a table AND a compiled ceiling, an artifact extends a table).
//
// WHAT IT IS, IN THE EXECUTABLE. The value is field +0xEC of the hero, and
// roughly sixty places compare it against a literal — that is the whole of
// what a specialization does. A value the executable has never heard of does
// NOTHING; the words and the icon show up, the arithmetic does not. So a
// specialization of ours is two halves that have to agree: the enum entry here,
// and a term the native extension adds where the engine sums its own
// (src/mods/artifact-effects.ts writes the config, native/homm5-editor.c reads
// it). See docs/engineInternals/SPECIALIZATIONS.md.
//
// WHERE ITS WORDS LIVE. Not here — on the HERO, because that is where the game
// keeps them. Two heroes may hold one specialization and describe it
// differently, and the shipped data does exactly that in reverse: a hero
// borrowing another faction's specialization shows the lender's text. So a
// specialization of the mod carries the words it WOULD like its heroes to use,
// and a hero that names it gets them unless he says otherwise. See
// heroTexts() and its one caller in hero-files.ts.

/**
 * How many the game ships — and therefore the first value that is ours.
 *
 * Counted from the enum rather than guessed: 0…83 inclusive. Unlike creatures
 * and artifacts this number is NOT declared anywhere the game reads, so nothing
 * has to be retuned when the mod adds one.
 */
export const SHIPPED_SPECIALIZATIONS = 84;

/** The last entry of the shipped enum — where ours are appended. */
export const LAST_SHIPPED_SPECIALIZATION = 'HERO_SPEC_INFERNAL_MACHINE';

/** The enum's own name in types.xml. */
export const SPECIALIZATION_TYPE = 'HeroSpecialization';

/**
 * What a specialization DOES — a term added to one of the engine's own sums.
 *
 * The list grows by reverse engineering rather than by wishing: each `stat` is
 * a place in the executable that was found, read, and hooked. There is one so
 * far.
 *
 *   `tent` — the first aid tent's amount, which is one number for BOTH of its
 *     spells (healing and the plague the Chumnaya Palatka perk adds). The
 *     engine computes `{10,20,50,100}[war machines mastery]`, plus five per
 *     hero level for its own HERO_SPEC_EMPIRIC. Ours is a PERCENTAGE of that
 *     number per level, which is what Heroes III's Gem does — and note the two
 *     coincide at expert mastery, where five per level IS five percent of 100.
 */
export const SPECIALIZATION_STATS = ['tent'] as const;
export type SpecializationStat = (typeof SPECIALIZATION_STATS)[number];

/** One term: this much more of that sum, per level of the hero holding it. */
export interface SpecializationEffect {
  stat: SpecializationStat;
  /**
   * Percentage points of the engine's own number, per hero level. Five is
   * Heroes III's Gem: a level 8 hero with an expert tent heals 140 instead of
   * 100. Fractions are not offered because the engine's number is an integer
   * and the product is truncated — see the extension.
   */
  percentPerLevel: number;
}

/** A specialization to add to the mod. */
export interface SpecializationSpec {
  /**
   * Its enum name, ours, appended to `HeroSpecialization` — `HERO_SPEC_…`.
   *
   * This is what a hero's `<Specialization>` names and what the extension's
   * config identifies the term by (as the NUMBER, which is why the two must be
   * built together and why the list is append-only).
   */
  id: string;
  /** The name a hero screen prints, when the hero does not override it. */
  name: string;
  /** What it does, in words — the same, and equally overridable. */
  description: string;
  /**
   * A drawing to build the icon from — a path on disk, as `assets/` keeps them.
   * The hero's own picture wins if he has one.
   */
  picture?: string;
  /** Or an href to a texture that already exists, when there is no drawing. */
  icon?: string;
  /**
   * What it gives. Omitted, the specialization is words and a picture — which
   * is a real thing to want (a port needs the NAME long before the effect), and
   * is exactly what every value the executable does not know does anyway.
   */
  effect?: SpecializationEffect;
}

/** One in a mod: a spec plus the enum value it holds. */
export interface ModSpecialization extends SpecializationSpec {
  /** Assigned on the way in and never changed — see addSpecialization. */
  number: number;
}

/**
 * types.xml: one enum entry per specialization of ours, appended.
 *
 * Nothing else moves. There is no size to retune and no table to extend — the
 * difference from artifacts, whose `MinElements` equals their `MaxElements` and
 * where forgetting either leaves the game declaring a count it does not carry.
 */
export function patchSpecializationTypes(
  types: string, specs: readonly ModSpecialization[],
): string {
  if (!specs.length) return types;
  const at = types.indexOf(`<TypeName>${SPECIALIZATION_TYPE}</TypeName>`);
  if (at < 0) throw new Error(`types.xml declares no ${SPECIALIZATION_TYPE}`);
  const last = types.indexOf(`<Name>${LAST_SHIPPED_SPECIALIZATION}</Name>`, at);
  if (last < 0) {
    throw new Error(`types.xml: ${SPECIALIZATION_TYPE} does not end at ${LAST_SHIPPED_SPECIALIZATION}`);
  }
  const itemEnd = types.indexOf('</Item>', last);
  if (itemEnd < 0) throw new Error('types.xml specialization enum: the last entry has no </Item>');
  const lineEnd = types.indexOf('\n', itemEnd);
  const cut = lineEnd < 0 ? types.length : lineEnd + 1;
  // The indent of the entry we are following, so the file reads like the ones
  // beside it and a diff shows the four lines added and nothing else.
  const lineStart = types.lastIndexOf('\n', last) + 1;
  const indent = /^[\t ]*/.exec(types.slice(lineStart))![0].replace(/\t$/, '');
  const added = specs.map((s) => [
    `${indent}<Item>`,
    `${indent}\t<Name>${s.id}</Name>`,
    `${indent}\t<Value>${s.number}</Value>`,
    `${indent}</Item>`,
  ].join('\r\n')).join('\r\n');
  return `${types.slice(0, cut)}${added}\r\n${types.slice(cut)}`;
}

/**
 * Every specialization name the game already answers to, read off types.xml.
 *
 * A duplicate `<Name>` in an enum is not an error the game reports — it is a
 * value that resolves to whichever entry the parser reached first, which is the
 * kind of bug that only shows up as "the wrong hero got the bonus".
 */
export function takenSpecializations(types: string): Set<string> {
  const at = types.indexOf(`<TypeName>${SPECIALIZATION_TYPE}</TypeName>`);
  if (at < 0) return new Set();
  const end = types.indexOf('</Entries>', at);
  const body = types.slice(at, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/<Name>(HERO_SPEC_\w+)<\/Name>/g)].map((m) => m[1]!));
}

/** What a hero holding this specialization should say about it, unless he says otherwise. */
export function heroTexts(spec: ModSpecialization): {
  specializationName: string;
  specializationDescription: string;
  picture?: string;
  icon?: string;
} {
  return {
    specializationName: spec.name,
    specializationDescription: spec.description,
    picture: spec.picture,
    icon: spec.icon,
  };
}
