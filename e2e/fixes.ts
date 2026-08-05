// The Rules Test map: one battle per fix, and the plan that describes it.
//
// WHY IT EXISTS. Every rule fix in `native/qol/fix-*.c` is verified as BYTES —
// `tools/test-fixes.ts` reads the installed executable and says the patch is
// aimed where it says. Nothing in the suite can say "the barbarian loses the
// stats when he forgets the skill", because that is a thing to watch in a
// battle. This map is what you watch it in.
//
// HOW IT IS MEANT TO BE USED — the reason it is two stages and not one:
//
//   001  builds the map and packs it into the install with every fix OFF.
//        Play it: each hero below reproduces one shipped bug.
//   002  turns every fix ON, and touches nothing else. Play the SAME map:
//        each hero now shows the fixed behaviour.
//
// So the map is the constant and the flags are the variable, which is the only
// way "it is fixed" means anything. docs/FIX_TEST_MAP.md is the checklist —
// what to do with each hero, and what changes between the two runs.
//
// WHAT IS HERE is the plan: the literal constants that read like the map. The
// specs drive the app; nothing about which hero carries which perk lives in
// them.

import { join } from 'node:path';

import { REPO_ROOT } from './launch.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { liveHome } from './mods.ts';

/** The unpacked data the map is built against — the suite's own answer. */
export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The install the map is packed into: a sandbox, or the real one when live. */
export const GAME = liveHome('e2e-fix-game');

export const NAME = 'Rules Test';
export const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
export const ARCHIVE = modFile(GAME, 'map', NAME);
/** Room for eight heroes in a row with their foes in front of them. */
export const TILES = 72;

/**
 * Which of the `Editable` fields the game reads.
 *
 * Measured rather than guessed: across the shipped maps, `32` never appears
 * without skills, perks and primary stats, `16` never without a war machine,
 * and the four heroes carrying the full set — skills, perks, spells, artifacts,
 * stats and a ballista — all carry `120`. An army is written at mask 0 too, so
 * that one is not gated at all. A stat written without the mask changes
 * nothing, silently, which is the trap this constant exists to avoid.
 */
export const OVERRIDE_ALL = 120;

/**
 * The player slots the map uses, and the colours they take.
 *
 * A new map declares eight of them and every one is `ActivePlayer false`, which
 * is a map with NO PLAYERS: the game offers nothing to start it as. Placing a
 * hero owned by PLAYER_1 does not turn the slot on — the object says who owns
 * it, the slot says whether that owner exists. Measured against the shipped
 * missions, where the slots in use are the active ones (A2S4 has three active
 * and all of them still `PCOLOR_NEUTRAL`, so the colour is presentation and the
 * flag is the thing).
 */
export const PLAYERS = [
  { slot: 0, colour: 'PCOLOR_RED' },
  { slot: 1, colour: 'PCOLOR_BLUE' },
];

export interface Skill { id: string; mastery: string }

/** One hero, the bug he is standing there to show, and what he is made of. */
export interface Kit {
  /** Short name for the checklist and the test output. */
  key: string;
  /** Which fixes this hero is the test bed for. */
  fixes: string[];
  /** The shared hero record — the race decides which racial abilities work. */
  shared: string;
  at: { x: number; y: number };
  skills?: Skill[];
  perks?: string[];
  spells?: string[];
  army: { creature: string; count: number }[];
  /** Primary stats, high enough that a battle lasts long enough to watch. */
  stats?: { offence?: number; defence?: number; spellpower?: number; knowledge?: number };
  ballista?: boolean;
  /** What he fights: a stack standing in front of him. */
  foe?: { shared: string; at: { x: number; y: number } };
  /** An artifact on the ground beside him, for the fixes that need one. */
  artifact?: { shared: string; at: { x: number; y: number } };
}

const M = {
  basic: 'MASTERY_BASIC', advanced: 'MASTERY_ADVANCED', expert: 'MASTERY_EXPERT',
};

const hero = (race: string, name: string): string =>
  `/MapObjects/${race}/${name}.(AdvMapHeroShared).xdb`;
const monster = (race: string, name: string): string =>
  `/MapObjects/${race}/${name}.(AdvMapMonsterShared).xdb`;

/** Peasants: something to fight that will not end the battle in one turn. */
const PEASANTS = monster('Haven', 'Peasant');

/**
 * The row of heroes, west to east.
 *
 * Each stands two tiles south of the stack he is meant to fight, so a battle is
 * one click away and no hero can wander into another's foe by accident.
 */
export const HEROES: Kit[] = [
  {
    key: 'wizard',
    fixes: ['master-of-fire-fix', 'empowered-armageddon-fix'],
    shared: hero('Academy', 'Astral'),
    at: { x: 8, y: 10 },
    skills: [{ id: 'HERO_SKILL_DESTRUCTIVE_MAGIC', mastery: M.expert }],
    // Master of Fire is the perk under test; Empowered Spells is the Academy
    // racial that casts the second Armageddon, the one with an id of its own.
    perks: ['HERO_SKILL_MASTER_OF_FIRE', 'HERO_SKILL_EMPOWERED_SPELLS',
      'HERO_SKILL_SECRETS_OF_DESTRUCTION'],
    // Armageddon to hit everything including the war machines, Fireball for a
    // single stack, Stone Skin to move a defence AFTER the fire landed on it —
    // which is the whole point of the Master of Fire fix.
    spells: ['SPELL_ARMAGEDDON', 'SPELL_FIREBALL', 'SPELL_STONESKIN'],
    stats: { offence: 5, defence: 5, spellpower: 20, knowledge: 30 },
    // A tent of his own, so an Armageddon has a war machine to prove itself on.
    ballista: true,
    army: [
      { creature: 'CREATURE_MARKSMAN', count: 30 },
      { creature: 'CREATURE_SWORDSMAN', count: 30 },
    ],
    foe: { shared: PEASANTS, at: { x: 8, y: 7 } },
  },
  {
    key: 'knight',
    fixes: ['encourage-fix'],
    shared: hero('Haven', 'Alaric'),
    at: { x: 16, y: 10 },
    // Encourage is the Knight's own; the Black Dragons are what he cannot use
    // it on until the fix, being immune to magic.
    perks: ['HERO_SKILL_ENCOURAGE'],
    stats: { offence: 10, defence: 10, spellpower: 5, knowledge: 5 },
    army: [
      { creature: 'CREATURE_BLACK_DRAGON', count: 3 },
      { creature: 'CREATURE_SWORDSMAN', count: 30 },
    ],
    foe: { shared: PEASANTS, at: { x: 16, y: 7 } },
  },
  {
    key: 'warlock',
    fixes: ['payback-fix', 'snare-crash-fix'],
    shared: hero('Dungeon', 'Almegir'),
    at: { x: 24, y: 10 },
    skills: [{ id: 'HERO_SKILL_SUMMONING_MAGIC', mastery: M.expert }],
    perks: ['HERO_SKILL_PAYBACK'],
    // The three spells that put an obstacle on the field — all of them free,
    // every time, until the payback fix.
    spells: ['SPELL_ARCANE_CRYSTAL', 'SPELL_SUMMON_HIVE', 'SPELL_BLADE_BARRIER'],
    stats: { offence: 5, defence: 5, spellpower: 15, knowledge: 30 },
    army: [
      { creature: 'CREATURE_MARKSMAN', count: 30 },
      // HIS OWN trappers, which is the whole trick. A snare is invisible to
      // whoever it is laid against, so trappers on the other side put them on
      // tiles you cannot see and there is nothing to aim a crystal at. Your own
      // you can see — lay one, then summon onto it.
      { creature: 'CREATURE_GOBLIN_TRAPPER', count: 20 },
    ],
    // Anything to fight; the snare comes from his own side of the field.
    foe: { shared: monster('Stronghold', 'Goblin_Trapper'), at: { x: 24, y: 7 } },
  },
  {
    key: 'runemage',
    fixes: ['dragon-form-fix'],
    shared: hero('Dwarves', 'Bersy'),
    at: { x: 32, y: 10 },
    skills: [{ id: 'HERO_SKILL_RUNELORE', mastery: M.expert }],
    stats: { offence: 10, defence: 10, spellpower: 10, knowledge: 10 },
    // The four the engine's table names, each a BASE creature — the ones it
    // cannot catch — plus an Archangel, which is tier 7 and not a dragon.
    army: [
      { creature: 'CREATURE_BONE_DRAGON', count: 3 },
      { creature: 'CREATURE_GREEN_DRAGON', count: 3 },
      { creature: 'CREATURE_DEEP_DRAGON', count: 3 },
      { creature: 'CREATURE_FIRE_DRAGON', count: 3 },
      { creature: 'CREATURE_ARCHANGEL', count: 3 },
    ],
    foe: { shared: PEASANTS, at: { x: 32, y: 7 } },
  },
  {
    key: 'ranger',
    fixes: ['imbue-ballista (not ported — the bug is what you are watching)'],
    shared: hero('Preserve', 'Diraya'),
    at: { x: 40, y: 10 },
    skills: [{ id: 'HERO_SKILL_WAR_MACHINES', mastery: M.expert }],
    perks: ['HERO_SKILL_IMBUE_ARROW', 'HERO_SKILL_IMBUE_BALLISTA'],
    spells: ['SPELL_FIREBALL'],
    stats: { offence: 10, defence: 5, spellpower: 10, knowledge: 30 },
    ballista: true,
    army: [{ creature: 'CREATURE_MARKSMAN', count: 30 }],
    foe: { shared: PEASANTS, at: { x: 40, y: 7 } },
  },
  {
    key: 'barbarian',
    fixes: ['barbarian-learning-fix'],
    shared: hero('Stronghold', 'Hero1'),
    at: { x: 48, y: 10 },
    perks: ['HERO_SKILL_BARBARIAN_LEARNING'],
    stats: { offence: 10, defence: 10, spellpower: 1, knowledge: 1 },
    army: [{ creature: 'CREATURE_GOBLIN', count: 40 }],
    foe: { shared: PEASANTS, at: { x: 48, y: 7 } },
  },
  {
    key: 'scholar',
    fixes: ['book-of-power-fix'],
    shared: hero('Haven', 'Axel'),
    at: { x: 56, y: 10 },
    // Learning at BASIC: the book gives +1 while he has no Education and +2 at
    // Advanced, so raising it is what makes the mana move — or fail to.
    skills: [{ id: 'HERO_SKILL_LEARNING', mastery: M.basic }],
    stats: { offence: 5, defence: 5, spellpower: 10, knowledge: 10 },
    army: [{ creature: 'CREATURE_SWORDSMAN', count: 30 }],
    // Picked up rather than worn, so the mana can be read before and after.
    artifact: { shared: '/MapObjects/Artifacts/H5A2/Book_Of_Power.xdb', at: { x: 57, y: 10 } },
    foe: { shared: PEASANTS, at: { x: 56, y: 7 } },
  },
];

/**
 * The computer's hero, and the only one on the map that is not the player's.
 *
 * The battle AI's three bugs are about what a hero the AI drives decides to
 * cast, so there has to be one: a full spell book, a stack worth defending and
 * enough mana to keep casting. Nothing about him is special otherwise.
 */
export const OPPONENT: Kit = {
  key: 'opponent',
  fixes: ['combat-ai-fix'],
  shared: hero('Preserve', 'Elleshar'),
  at: { x: 64, y: 10 },
  skills: [
    { id: 'HERO_SKILL_DESTRUCTIVE_MAGIC', mastery: M.expert },
    { id: 'HERO_SKILL_SUMMONING_MAGIC', mastery: M.expert },
  ],
  spells: [
    // Mass spells and a summon — the plans the AI ranked below every targeted
    // one and so never cast — and Deflect Arrows, whose stack it valued at the
    // square of its size.
    'SPELL_ARMAGEDDON', 'SPELL_MASS_HASTE', 'SPELL_MASS_SLOW',
    'SPELL_SUMMON_ELEMENTALS', 'SPELL_DEFLECT_ARROWS', 'SPELL_FIREBALL',
  ],
  stats: { offence: 10, defence: 10, spellpower: 20, knowledge: 40 },
  army: [
    // The Grand Elf is the stack that carries Deflect Arrows, which is the one
    // the AI valued at the SQUARE of its size.
    { creature: 'CREATURE_GRAND_ELF', count: 30 },
    { creature: 'CREATURE_DRUID', count: 20 },
  ],
};

/** Every fix flag the map is a test bed for, in the order the heroes stand. */
export const FIXES_UNDER_TEST = [
  'combat-ai-fix', 'snare-crash-fix', 'encourage-fix', 'barbarian-learning-fix',
  'payback-fix', 'dragon-form-fix', 'empowered-armageddon-fix', 'book-of-power-fix',
  'master-of-fire-fix',
];
