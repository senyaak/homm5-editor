// What an artifact does beyond its six stats — the file the native extension
// reads. And, since it is one file and one reader, what a SPECIALIZATION and a
// SKILL of ours do too: all three are the same bargain a subject apart, an
// identifier the executable has never heard of and a term added where it sums
// its own.
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
 * The list grows by reverse engineering rather than by wishing: each entry is a
 * place in the executable where the engine sums its own terms and we have found
 * where to append ours. Adding a ROW is free; adding a STAT costs a detour.
 *
 *   `necromancy` — the percentage of a battle's dead a necromancer raises
 *     (`CNecromancy::RaisePercent`). A property of the HERO the engine asks
 *     about, so a row is answered for that hero alone.
 *   `energy` — the ceiling of the player's dark energy pool, which the engine
 *     itself refills to the brim every week. A property of the PLAYER, so rows
 *     are answered for every hero of theirs and added up, the way an extra
 *     Necromancy Amplifier would be. See docs/engineInternals/NECROMANCY.md.
 *   `tent_charges` — how many times a first aid tent may be used in a battle.
 *     The record says three (`WarMachines.xdb`, `<Shots>`); the engine copies
 *     that into the combat machine once, when it builds it, and every gate reads
 *     the copy directly. So this is added there, to the machine of the hero who
 *     brought it. A property of the HERO, like the necromancy percentage.
 *   `tent_healing` — POINTS added to what one use of the tent is worth, on top
 *     of the {10,20,50,100} its owner's War Machines mastery is worth. It is the
 *     tent's own number being raised, so whatever doubles that number doubles
 *     this too — the extension asks the same question the engine asks before its
 *     own doubling and applies the same factor.
 *   `tent_health` — PERCENT added to the tent's own hit points, which the engine
 *     decides in a place of its own and where its own perk already multiplies
 *     them. Percent rather than points, because the number it applies to already
 *     grows with the owner's mastery.
 *   `tent_cleanse` — LEVELS added to the worst effect the tent can lift off the
 *     stack it heals. The engine's own number is {0,0,1,3} by mastery and it
 *     compares each effect's spell level against it, so war machines alone never
 *     reach a level 4 or 5 curse.
 *   `tent_mana` — charges given back per HUNDRED points of mana its owner spends
 *     in the battle. Two is one charge per fifty.
 *   `air_damage`, `fire_damage`, `water_damage`, `earth_damage` - PERCENT added
 *     to the damage of a spell of that element. The game has four artifacts of
 *     its own doing exactly this and they act on a spell of a mod's already,
 *     because the engine asks the spell's DOCUMENT for its element and never
 *     its number - measured 10.08.2026. What it cannot do is answer for an
 *     artifact of ours, and that is what these are.
 *   `air_resist`, `fire_resist`, `water_resist`, `earth_resist` - PERCENT
 *     taken OFF the damage of a spell of that element, on the stacks of the
 *     hero wearing it. The game's own three (the Iceberg Shield, the Ring of
 *     Lightning Protection, the Dragon Flame Tongue) take half; ours say how
 *     much.
 *   `magic_damage` - PERCENT added to the damage of ANY spell, whatever its
 *     element and none. NOT a replacement for the four above and not a shorthand
 *     for them: it is its own thing - "stronger magic" rather than "stronger
 *     fire" - and it adds ON TOP of whichever element row also matched. An
 *     artifact may carry both, and then both apply.
 *   `magic_resist` - the same, for a spell of ANY element and none: the
 *     percentage the engine already works out per stack, with ours added to
 *     it.
 */
export const EFFECT_STATS = [
  'necromancy', 'energy', 'tent_charges', 'tent_healing', 'tent_health', 'tent_cleanse', 'tent_mana',
  'air_damage', 'fire_damage', 'water_damage', 'earth_damage',
  'magic_damage',
  'air_resist', 'fire_resist', 'water_resist', 'earth_resist', 'magic_resist',
] as const;
export type EffectStat = (typeof EFFECT_STATS)[number];

/**
 * One term: while these artifacts are worn, add this much to that sum.
 *
 * A single artifact and a whole set are the same row with a different count,
 * which is the point. The engine's own set accessor cannot see a set of ours —
 * asked for our eleventh effect it answers 0 — so the extension counts the
 * pieces itself, through the same `CountEquipped` a single artifact goes
 * through. A set is then a list of ids and a number of them, and nothing about
 * it has to be reachable from the executable.
 */
export interface EffectRow {
  stat: EffectStat;
  /** The artifact NUMBERS counted together — what the engine knows them by. */
  artifacts: number[];
  /** How many of them must be WORN. One, for a plain artifact. */
  threshold: number;
  /** Percentage points, or energy. Negative is allowed and means a curse. */
  amount: number;
  /** For the comment beside it — the file is meant to be read. */
  name?: string;
}

/**
 * One term a SPECIALIZATION adds — the second kind of row in the same file.
 *
 * It is not an artifact row with different words: nothing is worn and nothing
 * is counted. The subject is a value of the `HeroSpecialization` enum, the
 * question the extension asks is the engine's own `HasSpecialization`, and the
 * amount is per hero LEVEL rather than flat. So it is its own shape, written on
 * its own line, and each reader below ignores the other's lines.
 */
export interface SpecializationRow {
  /** Which sum it enters. See SPECIALIZATION_STATS in src/mods/specializations.ts. */
  stat: string;
  /** The enum VALUE the hero carries — what the executable knows it by. */
  specialization: number;
  /** Percentage points of the engine's own number, per level of the hero. */
  percentPerLevel: number;
  /** For the comment beside it — the file is meant to be read. */
  name?: string;
}

/**
 * One term a SKILL of ours adds — the third kind of row in the same file.
 *
 * The same bargain as a specialization, one subject over: a value of the
 * `HeroSkill` enum the executable was not built with, and a question the engine
 * already knows how to answer about it. That question is the hero's own
 * `GetSkillMastery` — the single slot `HasHeroSkill` and `GetHeroSkillMastery`
 * both go through — so it answers 0 for a hero without the skill and 1…4 for
 * one who has it, and the amount is per level of MASTERY the way a
 * specialization's is per level of the hero.
 *
 * It enters the same sums an artifact does, because the extension asks it in the
 * same place: `necromancy` is answered for the one hero, `energy` for every hero
 * of the player. Which is what the engine already does with the necromancy skill
 * itself — a term keyed on a skill is not a new shape to it, only a new value.
 */
export interface SkillRow {
  stat: EffectStat;
  /** The enum VALUE the hero's skills answer to. */
  skill: number;
  /** Percentage points, or energy, for EACH level of mastery held. */
  amountPerMastery: number;
  /** For the comment beside it — the file is meant to be read. */
  name?: string;
}

/**
 * What a SPELL of ours does not touch, and what it covers — the fourth kind of
 * row in the file, written as two lines.
 *
 * Not a term added to a sum, like the three above: the extension adds nothing
 * here, it answers two questions the engine asks itself and has no case of its
 * own for our numbers.
 *
 *   `spares` — before the engine works out what a spell does to one stack it
 *     looks the number up, and for the handful it was compiled with a rule for
 *     it answers zero: Unholy Word for the undead and the demonic, Holy Word for
 *     everything that is neither. By ABILITY NUMBER, because the question the
 *     extension asks is the engine's own `HasAbility(int)`.
 *   `area` — which tiles an `IsAreaAttack` spell covers, as offsets from the
 *     point aimed at. Again a switch on the number, one case per spell, and the
 *     default ours would land on covers NOTHING. It is not a menu: the engine
 *     builds the list by pushing one tile at a time, so this is any set of tiles
 *     at all. Plain (x, y) — the combat grid is square.
 *
 * See SpellSpec.spares and SpellSpec.area.
 */
export interface SpellRow {
  /** The `SpellID` value — what the engine knows the spell by. */
  spell: number;
  /** `CombatAbility` values; a stack carrying any of them takes no damage. */
  spares: number[];
  /** Offsets from the aim point, `(0,0)` being the tile itself. */
  area: { x: number; y: number }[];
  /** For the comment beside it — the file is meant to be read. */
  name?: string;
}

/** A row for one artifact: the common case, written in the short form. */
function isSingle(r: EffectRow): boolean {
  return r.artifacts.length === 1 && r.threshold <= 1;
}

/**
 * Render the file.
 *
 * Rows with a zero amount are dropped rather than written: a row that adds
 * nothing is indistinguishable in game from a row that was never read, and
 * leaving it in makes the file lie about what is in effect. So is a row with
 * no members, which can only come of a set whose pieces did not resolve.
 */
export function writeEffects(
  rows: readonly EffectRow[],
  specializations: readonly SpecializationRow[] = [],
  skills: readonly SkillRow[] = [],
  spells: readonly SpellRow[] = [],
): string {
  const lines = [
    '# Effects the editor added, written by it - see src/mods/artifact-effects.ts.',
    '# The game does not read this; the extension beside it does.',
    '#',
    '#   <stat> artifact <id> <amount>',
    '#   <stat> set <worn> <amount> <id> <id> ...',
    '#   <stat> skill <value> <amount per level of mastery>',
    '#   <stat> specialization <value> <percent per hero level>',
    '#   spell <id> spares <ability> <ability> ...',
    '#   spell <id> area <dx>,<dy> <dx>,<dy> ...',
    '',
  ];
  for (const r of rows) {
    if (!r.amount || !r.artifacts.length) continue;
    const comment = r.name ? `   # ${r.name}` : '';
    lines.push(isSingle(r)
      ? `${r.stat} artifact ${r.artifacts[0]} ${r.amount}${comment}`
      : `${r.stat} set ${r.threshold} ${r.amount} ${r.artifacts.join(' ')}${comment}`);
  }
  for (const s of skills) {
    if (!s.amountPerMastery) continue;
    lines.push(`${s.stat} skill ${s.skill} ${s.amountPerMastery}${s.name ? `   # ${s.name}` : ''}`);
  }
  for (const s of specializations) {
    if (!s.percentPerLevel) continue;
    lines.push(`${s.stat} specialization ${s.specialization} ${s.percentPerLevel}${s.name ? `   # ${s.name}` : ''}`);
  }
  // A spell writes one line per thing it has to say, and says nothing when it
  // has nothing: an empty list is the engine's own behaviour, and a row that
  // states it would read in the log as one that is in effect.
  for (const s of spells) {
    const comment = s.name ? `   # ${s.name}` : '';
    if (s.spares.length) lines.push(`spell ${s.spell} spares ${s.spares.join(' ')}${comment}`);
    if (s.area.length) {
      lines.push(`spell ${s.spell} area ${s.area.map((t) => `${t.x},${t.y}`).join(' ')}${comment}`);
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Read one back, ignoring comments and anything we do not understand. */
export function readEffects(text: string): EffectRow[] {
  const rows: EffectRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    // Everything after a `#` is the comment the writer put there, and the C
    // parser stops at it the same way — by finding no more digits.
    const body = line.split('#')[0] ?? '';
    const single = /^\s*(\w+)\s+artifact\s+(-?\d+)\s+(-?\d+)\s*$/.exec(body);
    const set = /^\s*(\w+)\s+set\s+(\d+)\s+(-?\d+)((?:\s+\d+)+)\s*$/.exec(body);
    const stat = (single ?? set)?.[1] as EffectStat | undefined;
    if (!stat || !EFFECT_STATS.includes(stat)) continue;
    if (single) rows.push({ stat, artifacts: [Number(single[2])], threshold: 1, amount: Number(single[3]) });
    else if (set) {
      rows.push({
        stat,
        artifacts: set[4]!.trim().split(/\s+/).map(Number),
        threshold: Number(set[2]),
        amount: Number(set[3]),
      });
    }
  }
  return rows;
}

/**
 * The specialization rows of the same file. A separate pass over the same text
 * because the two shapes share nothing but the file they live in, and each
 * reader here already ignores every line it does not understand.
 */
export function readSpecializations(text: string): SpecializationRow[] {
  const rows: SpecializationRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const body = line.split('#')[0] ?? '';
    const m = /^\s*(\w+)\s+specialization\s+(\d+)\s+(-?\d+)\s*$/.exec(body);
    if (m) rows.push({ stat: m[1]!, specialization: Number(m[2]), percentPerLevel: Number(m[3]) });
  }
  return rows;
}

/** The skill rows of the same file, read the same way and as separately. */
export function readSkillEffects(text: string): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const body = line.split('#')[0] ?? '';
    const m = /^\s*(\w+)\s+skill\s+(\d+)\s+(-?\d+)\s*$/.exec(body);
    const stat = m?.[1] as EffectStat | undefined;
    if (!m || !stat || !EFFECT_STATS.includes(stat)) continue;
    rows.push({ stat, skill: Number(m[2]), amountPerMastery: Number(m[3]) });
  }
  return rows;
}

/**
 * The spell rows of the same file, read the same way and as separately.
 *
 * The two lines about one spell are gathered back into one row, because that is
 * what they are: a spell that both spares the undead and covers a cross writes
 * two lines and is one thing.
 */
export function readSpellRows(text: string): SpellRow[] {
  const rows = new Map<number, SpellRow>();
  const row = (id: number): SpellRow => {
    const there = rows.get(id) ?? { spell: id, spares: [], area: [] };
    rows.set(id, there);
    return there;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const body = line.split('#')[0] ?? '';
    const spares = /^\s*spell\s+(\d+)\s+spares((?:\s+\d+)+)\s*$/.exec(body);
    if (spares) row(Number(spares[1])).spares.push(...spares[2]!.trim().split(/\s+/).map(Number));
    const area = /^\s*spell\s+(\d+)\s+area((?:\s+-?\d+,-?\d+)+)\s*$/.exec(body);
    if (area) {
      row(Number(area[1])).area.push(...area[2]!.trim().split(/\s+/).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      }));
    }
  }
  return [...rows.values()];
}

/** A spell of a mod, as far as the extension's file is concerned. */
export interface FilteredSpell {
  id: string;
  number: number;
  spares?: readonly string[];
  area?: readonly { x: number; y: number }[];
}

/**
 * The rows a mod's spells imply — one per spell that has anything to say.
 *
 * An ability name that types.xml does not know produces NO row at all, rather
 * than a row missing one kind. A filter that spares two of its three kinds is a
 * spell that damages the third, in game, silently — and that reads as the spell
 * being wrong rather than as a row that failed to resolve. Nothing written is
 * the louder failure: the extension prints how many rows it read.
 */
export function spellRowsOf(
  spells: readonly FilteredSpell[],
  numberOf: (ability: string) => number | undefined,
): SpellRow[] {
  const rows: SpellRow[] = [];
  for (const s of spells) {
    if (!s.spares?.length && !s.area?.length) continue;
    const spares = (s.spares ?? []).map(numberOf);
    if (spares.some((n) => n === undefined)) continue;
    rows.push({
      spell: s.number,
      spares: spares as number[],
      area: (s.area ?? []).map((t) => ({ x: t.x, y: t.y })),
      name: s.id,
    });
  }
  return rows;
}

/** A skill of a mod, as far as its effects are concerned. */
export interface EffectSkill {
  id: string;
  number: number;
  effects?: Partial<Record<EffectStat, number>>;
}

/** The rows a mod's skills imply — one per skill and stat that gives something. */
export function skillRowsOf(skills: readonly EffectSkill[]): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const s of skills) {
    for (const stat of EFFECT_STATS) {
      const amount = s.effects?.[stat];
      if (amount) rows.push({ stat, skill: s.number, amountPerMastery: amount, name: s.id });
    }
  }
  return rows;
}

/** A specialization of a mod, as far as its effect is concerned. */
export interface EffectSpecialization {
  id: string;
  number: number;
  effect?: { stat: string; percentPerLevel: number };
}

/** The rows a mod's specializations imply — one per specialization that gives something. */
export function specializationRowsOf(specs: readonly EffectSpecialization[]): SpecializationRow[] {
  const rows: SpecializationRow[] = [];
  for (const s of specs) {
    if (!s.effect?.percentPerLevel) continue;
    rows.push({
      stat: s.effect.stat,
      specialization: s.number,
      percentPerLevel: s.effect.percentPerLevel,
      name: s.id,
    });
  }
  return rows;
}

/**
 * A mod, as far as the extension's file is concerned — the four kinds together.
 *
 * Structural rather than the editor's own `CreatureMod`, because this module is
 * about the FILE: it is read by the app's install, by the e2e fixture and by the
 * tool that rebuilds the file alone, and none of them should have to agree on
 * anything but the four lists.
 */
export interface EffectsMod {
  artifacts?: readonly EffectArtifact[];
  sets?: readonly EffectSet[];
  specializations?: readonly EffectSpecialization[];
  skills?: readonly EffectSkill[];
  spells?: readonly FilteredSpell[];
}

/** An artifact of a mod, as far as its effects are concerned. */
export interface EffectArtifact {
  id: string;
  number: number;
  effects?: Partial<Record<EffectStat, number>>;
}

/** One thing a set gives, at a number of pieces worn. */
export interface SetEffect {
  stat: EffectStat;
  /** Pieces worn, at least this many. Two of three, for the Cloak. */
  threshold: number;
  amount: number;
}

/** A set of a mod, as far as its effects are concerned. */
export interface EffectSet {
  effect: string;
  /** Member ids — the mod's own or the game's, which is why they need looking up. */
  artifacts: string[];
  effects?: SetEffect[];
}

/**
 * The rows a mod implies: its artifacts first, then its sets.
 *
 * A member id is resolved to the number the engine knows it by — the mod's own
 * artifacts carry theirs, and a shipped member has to be looked up in
 * `types.xml` by the caller. A set with a member that does not resolve produces
 * NO row: half a set counted is a bonus that arrives early, which is worse than
 * one that does not arrive at all.
 */
export function effectsOf(
  artifacts: readonly EffectArtifact[],
  sets: readonly EffectSet[] = [],
  numberOf: (id: string) => number | undefined = () => undefined,
): EffectRow[] {
  const rows: EffectRow[] = [];
  const own = new Map(artifacts.map((a) => [a.id, a.number]));
  for (const a of artifacts) {
    for (const stat of EFFECT_STATS) {
      const amount = a.effects?.[stat];
      if (amount) rows.push({ stat, artifacts: [a.number], threshold: 1, amount, name: a.id });
    }
  }
  for (const s of sets) {
    if (!s.effects?.length) continue;
    const members = s.artifacts.map((id) => own.get(id) ?? numberOf(id));
    if (members.some((n) => n === undefined)) continue;
    for (const e of s.effects) {
      if (!e.amount) continue;
      rows.push({
        stat: e.stat,
        artifacts: members as number[],
        threshold: Math.max(1, e.threshold),
        amount: e.amount,
        name: `${s.effect} at ${e.threshold} worn`,
      });
    }
  }
  return rows;
}
