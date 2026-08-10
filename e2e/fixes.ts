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
import type { QolName } from '../src/mods/qol.ts';

/** The unpacked data the map is built against — the suite's own answer. */
export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The install the map is packed into: a sandbox, or the real one when live. */
export const GAME = liveHome('e2e-fix-game');

export const NAME = 'Rules Test';
/**
 * A **Multiplayer Arena**, not a single scenario — the folder is the type.
 *
 * The snare test needs hotseat, and the game only offers a map for hotseat if
 * it is under `Maps/Multiplayer`. Nothing else about the map changes: it still
 * plays single-player against the computer, which is what the battle-AI test
 * wants, because both player slots are human-playable either way.
 */
export const MAP_DIR = join(DATA, 'Maps', 'Multiplayer', NAME);
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
  /**
   * Which fixes this hero is the test bed for — the panel's own names.
   *
   * Typed rather than loose so a flag that does not exist is a COMPILE error:
   * the whole point of a hero is that a fix has somebody watching it, and a
   * misspelt name is a fix with nobody, which reads as a fix with somebody.
   */
  fixes: QolName[];
  /** The shared hero record — the race decides which racial abilities work. */
  shared: string;
  /**
   * The class that record belongs to, so the kit can be CHECKED against the
   * game's own rules before the map is built: a perk names the class allowed to
   * take it, the skill it hangs off, and the perks that come before it, and a
   * hero handed one he does not qualify for simply does not get it — silently,
   * with the map looking perfectly fine. See `checkKits` in the spec.
   */
  heroClass: string;
  at: { x: number; y: number };
  /**
   * Secondary skills, **the class's racial one first**.
   *
   * `Editable/skills` REPLACES the shared hero's list, and the game reads it in
   * order into slots of which the first is the racial's. List War Machines
   * before Avenger and the ranger's hero screen shows the two swapped — which
   * is what happened, and what a play-through found rather than this file.
   *
   * Not a style rule: measured across every hero record the game ships. Of the
   * 118 with a skill list, 117 put the racial first and not one puts it
   * anywhere else; the 118th has no racial at all. `map-checks.ts` asks the
   * game's own table which skill that is, so the rule needs no list here.
   */
  skills?: Skill[];
  perks?: string[];
  spells?: string[];
  /**
   * Artifacts he WEARS — `Editable/artifactIDs`, and the mask already covers it.
   *
   * Worn rather than left on the ground (`artifact` below), because what is
   * being read off them happens in a battle and a thing in the backpack is not
   * worn: the engine counts pieces through `CountEquipped`, which is the worn
   * collection and nothing else.
   */
  artifacts?: string[];
  army: { creature: string; count: number }[];
  /** Primary stats, high enough that a battle lasts long enough to watch. */
  stats?: { offence?: number; defence?: number; spellpower?: number; knowledge?: number };
  ballista?: boolean;
  /**
   * What he fights: a stack standing in front of him.
   *
   * `count` pins the size. Without one the stack is written `Custom false` and
   * the game rolls its own number, which is fine for something to hit and no
   * good when the stack has to SURVIVE a spell to be read afterwards.
   */
  foe?: { shared: string; at: { x: number; y: number }; count?: number };
  /** An artifact on the ground beside him, for the fixes that need one. */
  artifact?: { shared: string; at: { x: number; y: number } };
  /**
   * Buildings standing behind him, for the fixes that need the hero CHANGED
   * rather than the battle watched — a mentor to forget a skill at, dolmens to
   * take a level from. Placed like anything else; they are only listed apart
   * because the row behind the heroes is where they fit.
   */
  nearby?: { shared: string; at: { x: number; y: number } }[];
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
 * The Mentor — «Ментор», *"здесь любой герой может полностью сменить все умения
 * и способности, полученные им прежде"*.
 *
 * Which is the only way to run the Barbarian Learning test at all: that fix is
 * about what a hero KEEPS after the skill is gone, and nothing else on a map
 * takes a skill back off him.
 */
const MENTOR = '/MapObjects/H5A2/SpellMentor.xdb';

/**
 * The Dolmen of Knowledge — «Дольмен знания», *"Единовременно добавляет +1000
 * единиц опыта герою"*. One visit each, so several.
 *
 * Levels are the instrument twice over: the scholar has to raise Education for
 * the Book of Power's bonus to move on its own, and the barbarian needs a level
 * before there is anything to forget.
 */
const DOLMEN = '/MapObjects/Learning_Stone.(AdvMapBuildingShared).xdb';

/** A row of dolmens behind a hero, two tiles apart so they do not overlap. */
const dolmens = (from: number, count: number, y = 13): { shared: string; at: { x: number; y: number } }[] =>
  Array.from({ length: count }, (_, i) => ({ shared: DOLMEN, at: { x: from + i * 2, y } }));

/**
 * A hundred zombies, for the two heroes who cast **Armageddon**.
 *
 * Peasants are wiped out by it before anything can be read off them, and both
 * Armageddon tests are about reading something off a stack that is still there
 * — a defence that should be half, war machines that should be hurt. Zombies
 * are slow and fat, and a hundred of them survive the spell and keep standing
 * for the second cast.
 *
 */
const ZOMBIES = { shared: monster('Necropolis', 'Zombie'), count: 100 };

/**
 * Five hundred Air Elementals, for the ranger — on BOTH sides.
 *
 * His fix is read off a turn bar, so what his battle needs is not length but
 * MOVEMENT: a bar that visibly churns between one ballista shot and the next.
 * Elementals have initiative 17 where a zombie has 7, so they take roughly two
 * and a half turns to the hero's one and the bar never sits still.
 *
 * The price is that the battle is shorter — five hundred of them hit for about
 * 3000, which is a fifth of the other five hundred (30 health each), so it runs
 * five rounds or so against the zombies' eight. Five ballista shots is still
 * more than enough for what the log has to say, and a bar that moves is worth
 * more here than three extra rounds of a bar that does not.
 */
const AIR_ELEMENTALS = { shared: monster('Neutral', 'Air_Elemental'), count: 500 };

/**
 * **Волна смерти on four heroes, three of them with Dark Magic** — the first
 * spell of ours, and the experiment it is here for.
 *
 * The four are one variable held at four values, so a single battle each says
 * what a spell the executable never heard of actually does:
 *
 *   knight    the spell and NO Dark Magic — the school it belongs to is not his,
 *             so this is what an unschooled caster gets, and whether the book
 *             offers it at all
 *   wizard    Dark Magic at BASIC
 *   scholar   at ADVANCED
 *   warlock   at EXPERT (his, already, for Payback)
 *
 * A spell's numbers are four, one per mastery, and the engine picks by the
 * school the caster holds — so if our damage ever lands, these three say whether
 * it is picked by mastery or always read from the first entry.
 *
 * AND THE QUESTION UNDER ALL OF IT: a spell with nobody to hit is greyed out in
 * this game. If the engine decides that from a target list it builds itself, our
 * spell may be unclickable however right its document is — which would be an
 * answer about the mechanism rather than about the spell, and is the reason the
 * knight is in the list at all.
 */
const DEATH_RIPPLE = 'SPELL_H3_DEATH_RIPPLE';
/** The control: Armageddon's every field under a number of ours. */
const TEST_ARMAGEDDON = 'SPELL_H3_TEST_ARMAGEDDON';
/**
 * And the same Armageddon with the two flags that pick a SHAPE changed.
 *
 * The engine has three damage shapes and one branch each, and what chooses
 * between them is `IsAimed` and `IsAreaAttack` — the two the document already
 * carries, which separate the shipped spells with nothing left over. These three
 * differ in those two booleans and in nothing else, so one battle says whether
 * the flags are really the choice: the plain one should cover the field, `_AREA`
 * a patch around where it is pointed, `_TARGET` the single stack under it.
 */
const TEST_ARMAGEDDON_AREA = 'SPELL_H3_TEST_ARMAGEDDON_AREA';
const TEST_ARMAGEDDON_TARGET = 'SPELL_H3_TEST_ARMAGEDDON_TARGET';
/**
 * The ripple aimed at one stack — the reading for a cast that would REACH
 * NOBODY, which nothing else on this map can show.
 *
 * The gate now refuses a spell of ours that would touch nothing, and everything
 * else here covers the field or a patch of it, where somebody unspared is always
 * standing. Pointed at the wizard's zombies this one has nothing to do and must
 * be refused with the mana intact; pointed at anything living it must hit.
 */
const DEATH_RIPPLE_TARGET = 'SPELL_H3_DEATH_RIPPLE_TARGET';
/** The same aimed spell with its ELEMENT changed — the reading for the ice mark. */
const TEST_ICE_TARGET = 'SPELL_H3_TEST_ICE_TARGET';
/** And with its element AIR — the third Master's mark, and the last unwatched one. */
const TEST_AIR_TARGET = 'SPELL_H3_TEST_AIR_TARGET';
/** Exactly 100 fire, whoever throws it — so a term reads without arithmetic. */
const TEST_FLAT_FIRE = 'SPELL_H3_TEST_FLAT_FIRE';
/** The mod's own artifact: +10% to every element's damage, −10% taken. */
const PRISM = 'ARTIFACT_H3_ELEMENTAL_PRISM';
/** And the magic pair on its own, so the ruler can tell the two kinds apart. */
const FOCUS = 'ARTIFACT_H3_MAGIC_FOCUS';
/** And one that TRADES: +4 Attack the game writes, −10% magic we do. */
const HELM = 'ARTIFACT_H3_WAR_MAGE_HELM';

/** Dark Magic, at the three masteries the four heroes spread across. */
const DARK = (mastery: string): Skill => ({ id: 'HERO_SKILL_DARK_MAGIC', mastery });

/**
 * The row of heroes, west to east.
 *
 * Each stands two tiles south of the stack he is meant to fight, so a battle is
 * one click away and no hero can wander into another's foe by accident.
 */
export const HEROES: Kit[] = [
  {
    key: 'wizard',
    heroClass: 'HERO_CLASS_WIZARD',
    fixes: ['master-of-fire-fix'],
    shared: hero('Academy', 'Astral'),
    at: { x: 8, y: 10 },
    // Dark Magic at BASIC — his half of the Death Ripple experiment; his own
    // test needs Destructive, and the two live side by side.
    skills: [{ id: 'HERO_SKILL_DESTRUCTIVE_MAGIC', mastery: M.expert }, DARK(M.basic)],
    // Master of Fire only. Empowered Spells is the WARLOCK's class perk, not
    // the Academy's — it went to the warlock with the Armageddon test, because
    // a perk whose class does not match is a perk the game does not grant.
    // AND MASTER OF ICE, so the mod's ice spell has somebody to leave its mark
    // for. The two Master perks are one skill's, so a wizard with Destructive at
    // expert may hold both, and the fire test is unaffected: each mark is left by
    // the applier for that spell's own element.
    perks: ['HERO_SKILL_MASTER_OF_FIRE', 'HERO_SKILL_MASTER_OF_ICE',
      'HERO_SKILL_MASTER_OF_LIGHTNINGS'],
    // Armageddon to hit everything including the war machines, Fireball for a
    // single stack. Stone Skin is in the book to read the spell's own numbers
    // from, but it is not what moves the defence in this test — see the druids.
    // …and the three shapes of our own Armageddon, so the comparison is made by
    // one hero in one battle: his own Armageddon and Fireball are right beside
    // them in the book to hold each against the shipped spell it copies.
    spells: [
      // AND TWO OF THE GAME'S OWN ICE, which are here to be watched rather than
      // played: the mod's spells leave the Master's mark through the engine's
      // own applier, and the ICE one takes an argument nothing in its code
      // names. These two put a value in it that is right by construction — Ice
      // Bolt through the single-target site with a divisor of 1, Frost Ring
      // through the area one with the number of stacks hit — so one cast of each
      // says what it is. Take them out again when it has a name.
      'SPELL_ICE_BOLT', 'SPELL_FROST_RING', 'SPELL_LIGHTNING_BOLT',
      'SPELL_CHAIN_LIGHTNING', 'SPELL_STONE_SPIKES', 'SPELL_METEOR_SHOWER',
      // And OUR ice, which is what the mark is really being asked about: the
      // aimed Armageddon with one field changed, its element.
      TEST_ICE_TARGET, TEST_AIR_TARGET, TEST_FLAT_FIRE,
      'SPELL_ARMAGEDDON', 'SPELL_FIREBALL', 'SPELL_STONESKIN', DEATH_RIPPLE,
      TEST_ARMAGEDDON, TEST_ARMAGEDDON_AREA, TEST_ARMAGEDDON_TARGET,
      // And the aimed ripple, on the hero whose foe is UNDEAD: the zombies are
      // what it must refuse to be cast at, and his own marksmen what it must
      // still hit.
      DEATH_RIPPLE_TARGET,
    ],
    stats: { offence: 5, defence: 5, spellpower: 20, knowledge: 30 },
    // BOTH KINDS, because both halves of the pattern are read on this map and
    // both heroes cast. The four on the left are the engine's own "add to the
    // damage of one element", asked for beside `SpellElement`; the three on the
    // right are the same shape one door along, on the side that is being hit.
    // They are the CONTROL a term of ours is put beside.
    artifacts: [
      // The ids are inconsistently prefixed in the game's own enum and these are
      // its spellings, checked against types.xml rather than tidied.
      'PHOENIX_FEATHER_CAPE', 'EVERCOLD_ICICLE', 'TITANS_TRIDENT',
      'ARTIFACT_EARTHSLIDERS',
      'ICEBERG_SHIELD', 'RING_OF_LIGHTING_PROTECTION', 'DRAGON_FLAME_TONGUE',
      // And the mod's own, which is the one the engine cannot answer for.
      // The helm is there for two questions again: it carries a number the
      // game's own record holds (+4 Attack) beside one only the extension
      // knows, so the hero screen and the spell book are read for the same
      // artifact — and the one it knows is NEGATIVE, which is the only place a
      // term of ours is asked to take something away rather than add it.
      PRISM, FOCUS, HELM,
    ],
    // A tent of his own, so an Armageddon has a war machine to prove itself on.
    ballista: true,
    army: [
      { creature: 'CREATURE_MARKSMAN', count: 30 },
      { creature: 'CREATURE_SWORDSMAN', count: 30 },
      // THE DRUIDS ARE THE INSTRUMENT. Master of Fire takes the defence for one
      // TURN, and a hero casts once a turn — so the hero who cast the
      // Armageddon cannot also raise a defence while the effect is still on,
      // and the difference the fix is about never appears. A creature caster
      // can: `CREATURE_DRUID` knows `SPELL_STONESKIN` (with Lightning Bolt),
      // checked in GameMechanics/Creature/Creatures/Preserve/Druid.xdb, and it
      // acts in the same round on its own initiative.
      { creature: 'CREATURE_DRUID', count: 1000 },
    ],
    // Zombies, because peasants do not survive an Armageddon and this test is
    // read off a stack that is still standing.
    // A THOUSAND PEASANTS, and both halves of that are the experiment.
    //
    // LIVING, because he is the hero the three Master marks are read on and the
    // first attempt was made on zombies — a mark that did not appear then says
    // nothing, since undead answer several rules of their own. And a THOUSAND,
    // because a mark is read off a stack that is still standing: his casts deal
    // six hundred and thirty apiece, which is two hundred peasants.
    //
    // The undead readings moved to the warlock, whose foe is zombies — see his
    // spells below.
    foe: { shared: PEASANTS, at: { x: 8, y: 7 }, count: 1000 },
  },
  {
    key: 'knight',
    heroClass: 'HERO_CLASS_KNIGHT',
    fixes: ['encourage-fix'],
    shared: hero('Haven', 'Alaric'),
    at: { x: 16, y: 10 },
    // Encourage hangs off Leadership, and for a Knight it wants Recruitment
    // (Leadership) and Holy Charge (Training) before it — so both skills are
    // here, and the two perks in front of it.
    skills: [
      // The racial FIRST — see the note on Kit.skills.
      { id: 'HERO_SKILL_TRAINING', mastery: M.expert },
      { id: 'HERO_SKILL_LEADERSHIP', mastery: M.expert },
    ],
    // The Black Dragons are what he cannot use it on until the fix, being
    // immune to magic.
    perks: ['HERO_SKILL_RECRUITMENT', 'HERO_SKILL_HOLY_CHARGE', 'HERO_SKILL_ENCOURAGE'],
    // The unschooled caster: our spell and no Dark Magic behind it. A knight
    // still gets a spellbook, so the book is the thing being asked about here —
    // whether the page appears, and whether the button can be pressed.
    spells: [DEATH_RIPPLE],
    // Knowledge enough for a couple of casts; he had five of each because
    // Encourage needs no mana at all.
    stats: { offence: 10, defence: 10, spellpower: 5, knowledge: 10 },
    army: [
      { creature: 'CREATURE_BLACK_DRAGON', count: 3 },
      { creature: 'CREATURE_SWORDSMAN', count: 30 },
    ],
    foe: { shared: PEASANTS, at: { x: 16, y: 7 } },
  },
  {
    key: 'warlock',
    heroClass: 'HERO_CLASS_WARLOCK',
    // Empowered Armageddon is HIS, not the wizard's: Empowered Spells is the
    // Warlock's class perk. Three fixes on one hero, which is fine — they are
    // three different spells.
    // Four now: the elemental one is read off the SAME cast as the empowered
    // Armageddon, because that spell is the one the game already has whose
    // damage lands with no element at all.
    fixes: ['payback-fix', 'snare-crash-fix', 'empowered-armageddon-fix', 'mass-spell-element-fix'],
    shared: hero('Dungeon', 'Almegir'),
    at: { x: 24, y: 10 },
    skills: [
      // Empowered Spells hangs off the Warlock's own Invocation, which is his
      // racial and so goes first — see the note on Kit.skills.
      { id: 'HERO_SKILL_INVOCATION', mastery: M.expert },
      { id: 'HERO_SKILL_SUMMONING_MAGIC', mastery: M.expert },
      // Payback hangs off Dark Magic and wants Master of Curses before it.
      { id: 'HERO_SKILL_DARK_MAGIC', mastery: M.expert },
    ],
    perks: ['HERO_SKILL_MASTER_OF_CURSES', 'HERO_SKILL_PAYBACK', 'HERO_SKILL_EMPOWERED_SPELLS'],
    // The three that put an obstacle on the field — free every time until the
    // payback fix — and the Armageddon that Empowered Spells turns into the
    // second one, with an id of its own.
    // …and the Death Ripple at the top of the school: his Dark Magic is already
    // Expert, so he is the fourth reading with no kit of his own to change.
    spells: ['SPELL_ARCANE_CRYSTAL', 'SPELL_SUMMON_HIVE', 'SPELL_BLADE_BARRIER',
      'SPELL_ARMAGEDDON', DEATH_RIPPLE,
      // AND THE PAIR THAT READS THE REFUSAL, here because his foe is UNDEAD.
      // The aimed ripple passes the undead over, so pointed at his zombies it
      // must be refused with the mana intact; the aimed Armageddon passes over
      // nobody, so at the same stack it must hit. Same shape, same target, and
      // the only difference is what each spares. They used to be the wizard's,
      // whose foe is a thousand peasants now.
      DEATH_RIPPLE_TARGET, TEST_ARMAGEDDON_TARGET],
    stats: { offence: 5, defence: 5, spellpower: 15, knowledge: 40 },
    // A war machine of his own, so an empowered Armageddon has one to prove
    // itself on — that is the half of the fix you can see.
    ballista: true,
    army: [
      { creature: 'CREATURE_MARKSMAN', count: 30 },
      // AND FIRE ELEMENTALS, which are immune to fire — the instrument for the
      // elemental fix, and it has to be a stack of HIS: an Armageddon hits its
      // own side too, so both readings come off one cast. With the fix off the
      // empowered Armageddon burns them, because its damage carries no element
      // for the immunity to answer; with it on they take nothing, exactly as
      // they already do from the plain Armageddon he also carries.
      { creature: 'CREATURE_FIRE_ELEMENTAL', count: 20 },
    ],
    // Zombies as well: he casts the empowered Armageddon, and it has to leave
    // something standing to be read. The snare does NOT come from here — see
    // OPPONENT below, and the two things measured in a real battle that between
    // them rule out every simpler arrangement.
    foe: { ...ZOMBIES, at: { x: 24, y: 7 } },
  },
  {
    key: 'runemage',
    heroClass: 'HERO_CLASS_RUNEMAGE',
    fixes: ['dragon-form-fix'],
    shared: hero('Dwarves', 'Bersy'),
    at: { x: 32, y: 10 },
    skills: [{ id: 'HERO_SKILL_RUNELORE', mastery: M.expert }],
    // THE RUNE ITSELF. Runelore says he may cast runes; it does not give him
    // one, any more than Destructive Magic gives a hero Fireball. A rune is a
    // spell — `MAGIC_SCHOOL_RUNIC`, level 5, so Runelore at Expert — and it is
    // learnt like one. Without this line he stands there with the skill and
    // nothing to cast, which is how this hero went out the first time.
    //
    // It costs a resource per cast rather than mana (1 wood, 1 sulfur), and the
    // map declares no starting resources — the game's own starting amounts
    // cover it many times over.
    spells: ['SPELL_RUNE_OF_DRAGONFORM'],
    stats: { offence: 10, defence: 10, spellpower: 10, knowledge: 10 },
    // MEASURED IN A BATTLE: a rune can only be cast on a creature of the
    // DWARVES. So of the four base dragons the engine's table names — Bone
    // (41), Green (55), Deep (83), Fire (104) — only the **Fire Dragon** can
    // ever be handed one, and it is the only one the fix is visible on. The
    // other three are here so that claim can be re-checked rather than
    // remembered; if a rune is offered on them, this comment is wrong.
    //
    // Then the dwarven controls, which is what this hero was missing:
    //   Magma («Лавовые драконы») and Lava («Драконы Арката») are the two
    //     upgrades, whose base IS Fire — refused before the fix and after;
    //   Thane is no dragon at all and must stay castable, or the fix would
    //     have broken the rune rather than aimed it.
    army: [
      { creature: 'CREATURE_FIRE_DRAGON', count: 3 },
      { creature: 'CREATURE_MAGMA_DRAGON', count: 3 },
      { creature: 'CREATURE_LAVA_DRAGON', count: 3 },
      { creature: 'CREATURE_THANE', count: 3 },
      { creature: 'CREATURE_BONE_DRAGON', count: 3 },
      { creature: 'CREATURE_GREEN_DRAGON', count: 3 },
      { creature: 'CREATURE_DEEP_DRAGON', count: 3 },
    ],
    foe: { shared: PEASANTS, at: { x: 32, y: 7 } },
  },
  {
    key: 'ranger',
    heroClass: 'HERO_CLASS_RANGER',
    fixes: ['imbue-ballista-fix'],
    shared: hero('Preserve', 'Diraya'),
    at: { x: 40, y: 10 },
    // Imbue Ballista wants Ballista (War Machines) and Imbue Arrow (Avenger)
    // before it, so both trees are here.
    skills: [
      // Avenger is the Ranger's racial and goes first — listed second, the game
      // put War Machines in the racial's place and the hero screen showed the
      // two swapped. See the note on Kit.skills.
      { id: 'HERO_SKILL_AVENGER', mastery: M.expert },
      { id: 'HERO_SKILL_WAR_MACHINES', mastery: M.expert },
    ],
    perks: ['HERO_SKILL_BALLISTA', 'HERO_SKILL_IMBUE_ARROW', 'HERO_SKILL_IMBUE_BALLISTA'],
    spells: ['SPELL_FIREBALL'],
    stats: { offence: 10, defence: 5, spellpower: 10, knowledge: 30 },
    ballista: true,
    // THE TURN BAR is the instrument here, and only here. Every other hero on
    // this map has one thing to see and sees it in a turn; this one is read off
    // a log a ballista writes once per shot, and off where the hero sits on the
    // bar between one shot and the next. Peasants and thirty marksmen were over
    // before the ballista had said anything twice; seven hundred zombies lasted
    // but barely moved the bar, and the hero's reading came back identical on
    // all six shots — which is exactly what a value we were misreading would
    // also do. Elementals at initiative 17 against his 10 keep it turning.
    army: [{ creature: 'CREATURE_AIR_ELEMENTAL', count: 500 }],
    foe: { ...AIR_ELEMENTALS, at: { x: 40, y: 7 } },
  },
  {
    key: 'barbarian',
    heroClass: 'HERO_CLASS_BARBARIAN',
    fixes: ['barbarian-learning-fix'],
    shared: hero('Stronghold', 'Hero1'),
    at: { x: 48, y: 10 },
    // A SKILL, not a perk — `SKILLTYPE_SKILL`, with no parent. Listed among the
    // perks it was simply not granted.
    skills: [{ id: 'HERO_SKILL_BARBARIAN_LEARNING', mastery: M.expert }],
    stats: { offence: 10, defence: 10, spellpower: 1, knowledge: 1 },
    army: [{ creature: 'CREATURE_GOBLIN', count: 40 }],
    foe: { shared: PEASANTS, at: { x: 48, y: 7 } },
    // The MENTOR is what makes this test possible at all — the fix is about
    // what he keeps after the skill is taken back off him, and nothing else on
    // a map takes a skill off a hero. The dolmens are for the level he needs
    // before there is anything to forget.
    nearby: [{ shared: MENTOR, at: { x: 48, y: 13 } }, ...dolmens(42, 3)],
  },
  {
    key: 'scholar',
    heroClass: 'HERO_CLASS_KNIGHT',
    fixes: ['book-of-power-fix'],
    shared: hero('Haven', 'Axel'),
    at: { x: 56, y: 10 },
    // Learning at BASIC: the book gives +1 while he has no Education and +2 at
    // Advanced, so raising it is what makes the mana move — or fail to.
    // Dark Magic at ADVANCED — the middle reading of the Death Ripple.
    skills: [{ id: 'HERO_SKILL_LEARNING', mastery: M.basic }, DARK(M.advanced)],
    spells: [DEATH_RIPPLE],
    stats: { offence: 5, defence: 5, spellpower: 10, knowledge: 10 },
    army: [{ creature: 'CREATURE_SWORDSMAN', count: 30 }],
    // Picked up rather than worn, so the mana can be read before and after.
    artifact: { shared: '/MapObjects/Artifacts/H5A2/Book_Of_Power.xdb', at: { x: 57, y: 10 } },
    foe: { shared: PEASANTS, at: { x: 56, y: 7 } },
    // Six dolmens, because the step that shows this fix is a LEVEL: Education
    // going from Basic to Advanced moves the book's bonus from +1 to +2 on its
    // own, and that is where the mana was left behind.
    nearby: dolmens(54, 6),
  },
];

/**
 * The computer's hero, and the only one on the map that is not the player's.
 *
 * The battle AI's three bugs are about what a hero the AI drives decides to
 * cast, so there has to be one: a full spell book, a stack worth defending and
 * enough mana to keep casting. Nothing about him is special otherwise.
 */
/**
 * **A SECOND hero of the other player's, and he casts back.**
 *
 * The artifact half of a spell is two-sided — one hero's cape adds to the fire
 * he throws, the other hero's shield takes from the fire he is thrown — and a
 * single caster can only ever show one side of it. So this one carries the same
 * two sets as the wizard and stands where he can be walked into.
 *
 * Spell power 20, the wizard's own, so the two are comparable and neither is
 * the small number a percentage cannot be read off. Two thousand peasants,
 * because both of them are casting now and the stack has to outlive the pair.
 */
export const ENEMY_CASTER: Kit = {
  key: 'enemycaster',
  heroClass: 'HERO_CLASS_WIZARD',
  fixes: [],
  shared: hero('Academy', 'Nur'),
  // TWO TILES EAST OF THE WIZARD, not across the map. He was put at the far end
  // first and playing it meant chasing him: this is a stand, and the battle
  // being watched should be one step away.
  at: { x: 12, y: 10 },
  skills: [{ id: 'HERO_SKILL_DESTRUCTIVE_MAGIC', mastery: M.expert }],
  // One per element, EARTH included — the Earthsliders are worn and had nothing
  // to be read on.
  spells: ['SPELL_FIREBALL', 'SPELL_ICE_BOLT', 'SPELL_LIGHTNING_BOLT',
    'SPELL_STONE_SPIKES', 'SPELL_METEOR_SHOWER', TEST_FLAT_FIRE],
  artifacts: [
    'PHOENIX_FEATHER_CAPE', 'EVERCOLD_ICICLE', 'TITANS_TRIDENT',
    'ARTIFACT_EARTHSLIDERS',
    'ICEBERG_SHIELD', 'RING_OF_LIGHTING_PROTECTION', 'DRAGON_FLAME_TONGUE',
    PRISM, FOCUS, HELM,
  ],
  stats: { offence: 5, defence: 5, spellpower: 20, knowledge: 30 },
  army: [{ creature: 'CREATURE_PEASANT', count: 2000 }],
};

export const OPPONENT: Kit = {
  key: 'opponent',
  heroClass: 'HERO_CLASS_RANGER',
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
    // The trappers, and this is the ONLY place they work. Two things were
    // measured in a real battle and between them they close off everything
    // simpler:
    //
    //   a snare does not fire on its own side — the warlock's own trappers laid
    //     one and his crystal stood on top of it, both on the tile, nothing;
    //   a NEUTRAL stack of trappers does not lay snares at all.
    //
    // So the snare has to be laid by a stack that belongs to the other PLAYER,
    // and it has to be laid where you can aim at it. Start the map as HOTSEAT
    // and both halves are yours: lay the snare with this stack, take the
    // warlock's turn, summon onto that tile.
    { creature: 'CREATURE_GOBLIN_TRAPPER', count: 20 },
  ],
};

/**
 * Every fix flag the map is a test bed for, in the order the heroes stand.
 *
 * Typed the same way and for the same reason: this list is what `002` asserts
 * went on, and a typo in it would assert nothing about a flag nobody has.
 */
export const FIXES_UNDER_TEST: QolName[] = [
  'combat-ai-fix', 'snare-crash-fix', 'encourage-fix', 'barbarian-learning-fix',
  'payback-fix', 'dragon-form-fix', 'empowered-armageddon-fix', 'book-of-power-fix',
  'master-of-fire-fix', 'imbue-ballista-fix', 'mass-spell-element-fix',
];
