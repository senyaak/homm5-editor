// The training rule, against a model of the engine's own habits.
//
//   node tools/test-training-plan.ts
//
// WHAT THIS CATCHES, and it is the only kind of mistake in this feature that
// cannot be caught any other way without launching the game: a rule that offers
// a training the engine will not carry out. Every one of them showed up as
// something ugly on somebody's screen — a live spell page with nothing to train,
// a training that left behind the very creature it was supposed to replace, and
// the game stopping to ask which creature to throw away.
//
// So the engine is modelled here, with the four habits that produced those:
//
//   1. seven slots, and adding a kind with nowhere to go is the drop question;
//   2. removing every one of a kind, when that kind is all he has, leaves one;
//   3. a script sees the army through `GetHeroCreaturesTypes`, which throws
//      duplicates away — so the model hands the rule a VIEW, not its slots, and
//      the rule physically cannot count what it is not allowed to know;
//   4. add and remove are queued, and the clamp in (2) is decided when the
//      command is made rather than when it runs.
//
// WHAT IT DOES NOT PROVE. The Lua that actually runs is a twin of `planTraining`
// rather than a translation of it — nothing here executes the engine's Lua. The
// numbers cannot drift (both sides read `TRAINABLE`); the shape can, and only a
// run of the game says otherwise. That is written down rather than hidden.

import {
  ARMY_SLOTS, SHARPSHOOTER, TRAINABLE, TRAINING_SPELL, type ArmyView, type Plan,
  planTraining, priceOf, questionFor, trainingLua,
} from '../src/mods/sharpshooter-training.ts';
import { luaDiagnostics } from '../src/script/lua-lint.ts';
import { Registry } from '../src/schema/registry.ts';
import { dataDir } from './game-dir.ts';
import { existsSync } from 'node:fs';

/** The editor's unpacked cache, when there is one — the names go unchecked
 *  rather than unmentioned when there is not. */
function dataDirIfUnpacked(): string | null {
  const dir = dataDir();
  return existsSync(dir) ? dir : null;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- the engine, as far as an army is concerned -----------------------------

class DropQuestion extends Error {
  constructor() { super('the game stopped to ask which creature to throw away'); }
}

interface Slot { kind: number; count: number }

class Engine {
  slots: Slot[];
  gold: number;
  /** Commands wait their turn, exactly as the world's do. */
  private queued: Array<() => void> = [];

  constructor(slots: Slot[], gold: number) {
    this.slots = slots.map((s) => ({ ...s }));
    this.gold = gold;
  }

  /** `GetHeroCreatures` — a kind summed over the army, read live. */
  countOf(kind: number): number {
    return this.slots.filter((s) => s.kind === kind).reduce((n, s) => n + s.count, 0);
  }

  private slotsOf(kind: number): number {
    return this.slots.filter((s) => s.kind === kind).length;
  }

  /** What a script is allowed to know. */
  view(): ArmyView {
    const kinds: number[] = [];
    for (const s of this.slots) if (!kinds.includes(s.kind)) kinds.push(s.kind);
    return { kinds, used: this.slots.length, countOf: (k) => this.countOf(k) };
  }

  add(kind: number, count: number): void {
    const now = this.slots.length;
    const has = this.slotsOf(kind);
    this.queued.push(() => {
      const mine = this.slots.find((s) => s.kind === kind);
      if (mine) { mine.count += count; return; }
      if (this.slots.length >= ARMY_SLOTS) throw new DropQuestion();
      this.slots.push({ kind, count });
    });
    // The question is asked when the command RUNS, but a rule that queued it
    // with a full army has already lost — say so at once, so the test points at
    // the decision rather than at the queue.
    if (!has && now >= ARMY_SLOTS) throw new DropQuestion();
  }

  remove(kind: number, count: number): void {
    // Worked out NOW, against the army as it is — the whole trap.
    let take = Math.min(count, this.countOf(kind));
    if (take === this.countOf(kind) && this.slotsOf(kind) === this.slots.length) take--;
    this.queued.push(() => {
      let left = take;
      for (const s of this.slots) {
        if (s.kind !== kind || left <= 0) continue;
        const off = Math.min(left, s.count);
        s.count -= off;
        left -= off;
      }
      this.slots = this.slots.filter((s) => s.count > 0);
    });
  }

  /** What `sleep` buys: the world gets round to what was asked of it. */
  run(): void {
    const doing = this.queued;
    this.queued = [];
    for (const one of doing) one();
  }
}

// --- the work, as the Lua does it -------------------------------------------

function train(engine: Engine, plan: Plan, want: number): void {
  const count = Math.min(plan.most, Math.max(plan.least, want));
  const sharp = engine.countOf(SHARPSHOOTER);
  if (!plan.roomy) {
    engine.remove(plan.kind, count); engine.run();
    engine.add(SHARPSHOOTER, count); engine.run();
  } else {
    engine.add(SHARPSHOOTER, count); engine.run();
    engine.remove(plan.kind, count); engine.run();
  }
  const left = engine.countOf(plan.kind);
  const shouldRemain = plan.have - count;
  if (left > shouldRemain) { engine.remove(plan.kind, left - shouldRemain); engine.run(); }
  const made = engine.countOf(SHARPSHOOTER) - sharp;
  if (made > 0) engine.gold -= made * priceOf(plan.kind)!;
}

// --- what the rule should say -----------------------------------------------

const ARCHER = TRAINABLE[0]!.id, ARCHER_GOLD = TRAINABLE[0]!.gold;
const MARKSMAN = TRAINABLE[1]!.id;
const PEASANT = 1, GRIFFIN = 9, KNIGHT = 11, MONK = 13, CAVALIER = 15, ANGEL = 17;

console.log('=== when there is nothing to train ===');
check('an army of things we do not train',
  planTraining(new Engine([{ kind: PEASANT, count: 9 }], 99999).view(), 99999) === null);
check('an army of sharpshooters already',
  planTraining(new Engine([{ kind: SHARPSHOOTER, count: 9 }], 99999).view(), 99999) === null);
check('no gold for even one',
  planTraining(new Engine([{ kind: ARCHER, count: 9 }], 0).view(), 0) === null);

console.log('\n=== what is trained, and how many ===');
{
  const e = new Engine([{ kind: MARKSMAN, count: 5 }, { kind: ARCHER, count: 5 }], 99999);
  check('the FIRST trainable slot, not the first kind we happen to list',
    planTraining(e.view(), 99999)?.kind === MARKSMAN);
}
{
  const e = new Engine([{ kind: ARCHER, count: 100 }], ARCHER_GOLD * 7);
  check('never more than the gold pays for', planTraining(e.view(), e.gold)?.most === 7);
}
{
  // Senya's call: a kind, not a slot. Two stacks of one archer offer two,
  // because that is what a script can see and the honest reading of what he has.
  const e = new Engine([{ kind: ARCHER, count: 1 }, { kind: ARCHER, count: 1 }], 99999);
  check('two stacks of one archer offer two', planTraining(e.view(), 99999)?.most === 2);
}

console.log('\n=== a full army ===');
{
  // SEVEN SLOTS IN SIX KINDS — the shape that broke it. The view says six
  // things; only `used` knows better, which is why the extension answers it.
  const full = [
    { kind: ARCHER, count: 100 }, { kind: ARCHER, count: 100 },
    { kind: PEASANT, count: 1 }, { kind: GRIFFIN, count: 1 },
    { kind: KNIGHT, count: 1 }, { kind: MONK, count: 1 }, { kind: CAVALIER, count: 1 },
  ];
  const e = new Engine(full, 99999);
  check('the view really does hide the second stack', e.view().kinds.length === 6);
  const plan = planTraining(e.view(), 99999);
  check('and a training is still allowed, because all 200 can be paid for',
    plan !== null && plan.most === 200 && !plan.roomy);

  const poor = new Engine(full, ARCHER_GOLD * 5);
  check('but refused when only some of them can be',
    planTraining(poor.view(), poor.gold) === null);
}
{
  const e = new Engine([
    { kind: ARCHER, count: 100 }, { kind: SHARPSHOOTER, count: 1 },
    { kind: PEASANT, count: 1 }, { kind: GRIFFIN, count: 1 },
    { kind: KNIGHT, count: 1 }, { kind: MONK, count: 1 }, { kind: ANGEL, count: 1 },
  ], ARCHER_GOLD * 5);
  const plan = planTraining(e.view(), e.gold);
  check('a full army with sharpshooters in it takes any number — they merge',
    plan !== null && plan.most === 5 && plan.roomy);
}

console.log('\n=== the rule never asks for something the engine refuses ===');
{
  const kinds = [ARCHER, MARKSMAN, PEASANT, GRIFFIN, KNIGHT, MONK, CAVALIER, ANGEL, SHARPSHOOTER];
  let tried = 0, trained = 0, dropQuestions = 0, leftovers = 0, miscounts = 0, misgold = 0;
  // Every army of up to seven stacks that can be built from a few kinds and a
  // few sizes, at several purses. Exhaustive beats clever: the shape that broke
  // it was one nobody would have thought to write down.
  const sizes = [1, 2, 100];
  /** Nine kinds by three sizes over seven slots is more armies than there are
   *  seconds in a day, so each depth is thinned to a spread of this many —
   *  evenly, so the thinning cannot quietly favour the easy shapes. */
  const PER_DEPTH = 600;
  const armies: Slot[][] = [];
  let frontier: Slot[][] = [[]];
  for (let depth = 0; depth < ARMY_SLOTS; depth++) {
    const grown: Slot[][] = [];
    for (const army of frontier) {
      for (const kind of kinds) for (const count of sizes) grown.push([...army, { kind, count }]);
    }
    const stride = Math.max(1, Math.ceil(grown.length / PER_DEPTH));
    frontier = grown.filter((_, i) => i % stride === 0);
    armies.push(...frontier);
  }
  for (const army of armies) {
    if (!army.length) continue;
    for (const gold of [0, 175, 300, 1000, 60000]) {
      const engine = new Engine(army, gold);
      const plan = planTraining(engine.view(), gold);
      tried++;
      if (!plan) continue;
      // Both ends of what the player may ask for — and 1, which is what a
      // slider offers whether the rule meant to allow it or not. That last one
      // is how this test found the hole the game would have shown next.
      for (const want of [1, plan.least, plan.most]) {
        const e = new Engine(army, gold);
        const p = planTraining(e.view(), gold)!;
        const count = Math.min(p.most, Math.max(p.least, want));
        const had = e.countOf(p.kind), sharp = e.countOf(SHARPSHOOTER);
        try {
          train(e, p, want);
        } catch (err) {
          if (err instanceof DropQuestion) { dropQuestions++; continue; }
          throw err;
        }
        trained++;
        if (e.countOf(p.kind) !== had - count) leftovers++;
        if (e.countOf(SHARPSHOOTER) !== sharp + count) miscounts++;
        if (e.gold !== gold - count * priceOf(p.kind)!) misgold++;
      }
    }
  }
  console.log(`  (${tried} situations, ${trained} trainings carried out)`);
  check('the game is never made to ask what to throw away', dropQuestions === 0,
    dropQuestions ? `${dropQuestions} times` : '');
  check('what was trained really leaves the army', leftovers === 0,
    leftovers ? `${leftovers} trainings left some behind` : '');
  check('and arrives as sharpshooters, one for one', miscounts === 0,
    miscounts ? `${miscounts} came out wrong` : '');
  check('paid for exactly what was trained', misgold === 0,
    misgold ? `${misgold} charged wrongly` : '');
  check('the sweep actually swept', trained > 500, `${trained} trainings`);
}

console.log('\n=== the script the engine gets ===');
{
  const lua = trainingLua();
  const bad = luaDiagnostics(lua);
  check('it lints', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 2)) : '');
  check('every price reaches it',
    TRAINABLE.every((t) => lua.includes(`kind == ${t.lua} then return ${t.gold};`)));
  check('and every question, by the file it really writes',
    TRAINABLE.every((t) => lua.includes(`"/${questionFor(t.id)}"`)));
  check('it asks OUR count of taken slots, not one it worked out itself',
    lua.includes('H5EArmySlots(hero)'));
  check('and it asks whose spell it is before deciding anything',
    lua.includes('H5EIsCastingHero(hero)'));
  // The hole this closed: falling back to any hero at all lit one hero's page
  // for another hero's archers, and then trained them.
  check('a caster it cannot find among the heroes is a refusal, not a free pick',
    lua.includes('H5ECasterKnown()') && lua.includes('H5E_WHY = 9002;\r\n\t\treturn nil;'));
  check('the rule keeps itself current, because the gate cannot wait for it',
    lua.includes('function H5ECastableWatch()') && lua.includes('sleep(1);'));
  // A mod carries more than one spell, and both hooks are reached by number.
  // Without this a second spell would answer the first one's page and run the
  // first one's cast — a fault that shows up in somebody else's mod.
  check('both hooks branch on the spell\'s number',
    lua.includes(`function checkSpellCastable(spell)\r\n\tH5E_WHY = 9010;\r\n\tH5E_GOT = spell;\r\n\tlocal verdict = nil;\r\n\tif spell == ${TRAINING_SPELL} then`)
    // AND WITH ONE EXIT, the call's result never returned from inside the block.
    // This is the shape that broke the whole feature: the engine runs the call and
    // then falls through, so the caller gets a value the rule never chose.
    && lua.includes('\t\tverdict = H5ETrainMayCast();')
    && lua.includes('\treturn verdict;')
    && lua.includes(`function onSpellCast(spell)\r\n\tif spell == ${TRAINING_SPELL} then`));
  check('and the verdict is answered per spell, not one for all',
    lua.includes('H5EAnswer(spell, now);'));
  // Remembered per spell TOO, and that is not the same statement: with one
  // memory for every spell the second one finds the number already equal to its
  // own answer and says nothing, so its page keeps whatever the first one left.
  check('and remembered per spell, so one page cannot answer for another',
    lua.includes('H5E_CASTABLE_WAS = {};')
    && lua.includes('local was = H5E_CASTABLE_WAS[spell];')
    && lua.includes('H5E_CASTABLE_WAS[spell] = now;'));
  check('and it only speaks when the answer changes',
    lua.includes('if now ~= was or H5E_SAID < 5 then'));
  // Assigning nil to a global does not create it, so every one of these read
  // before its first real value is a global that was never set — and this game
  // prints that on screen in red. Five such lines is what a player saw.
  check('no global of ours is left uncreated, so the game has nothing to warn about',
    ['H5E_WHY = 0;', 'H5E_WHO = "";', 'H5E_WHAT = 0;', 'H5E_MOST = 0;', 'H5E_SAID = 0;', 'H5E_GOT = 0;']
      .every((line) => lua.includes(line))
    && !/^H5E_[A-Z_]+ = nil;$/m.test(lua));
  // A "yes" that no rule computed and a yes the plan really made look identical
  // in a log that only prints the decision — which is how a live page with every
  // reason still unset went unexplained for a run.
  check('the reason is stamped at every step down the chain, not only at the end',
    ['H5E_WHY = 9000;', 'H5E_WHY = 9010;', 'H5E_WHY = 9011;', 'H5E_WHY = 9012;', 'H5E_WHY = 9013;', 'H5E_GOT = spell;',
      'H5E_WHY = 9003;'].every((line) => lua.includes(line)));
  check('it waits after queueing each command',
    (lua.match(/H5EWaitArmy\(/g) ?? []).length >= 5);
  // The game's own sharp shooter is a SOURCE — the second upgrade of the elven
  // line, trainable like the rest — but it must never be what comes out. Paying
  // it out instead of the mod's own is what an early run did, and the check that
  // caught that banned the name outright; adding the second upgrades made that
  // ban wrong rather than the code, so it says what it means now: never added.
  check('it hands out the mod\'s creature, never the game\'s sharp shooter',
    lua.includes(`= ${SHARPSHOOTER};`)
    && !lua.includes('AddHeroCreatures(hero, CREATURE_SHARP_SHOOTER')
    && lua.includes('AddHeroCreatures(hero, CREATURE_H3_SHARPSHOOTER'));
  check('and both lines are trainable, branch and all', TRAINABLE.length === 6);
  check('nothing names a creature at the top level', lua.split('\r\n')
    .filter((l) => /^[A-Za-z]/.test(l) && !l.startsWith('function'))
    .every((l) => !/CREATURE_[A-Z_]+ *[^=]*$/.test(l.replace(/^CREATURE_H3_SHARPSHOOTER = \d+;/, ''))));
}

// --- and the one check that is against the game itself ----------------------
//
// EVERY CREATURE IN THE TABLE, NAMED BY THE GAME. The prices and the tiers were
// worked out from the constants' names, and the constants lie: `LONGBOWMAN` is
// "Стрелки", the archer's OTHER upgrade, not a step above the marksman. So the
// table carries the game's own name for each id, and this makes sure it is the
// game's and not a memory of it.
console.log('\n=== the creatures are who the game says they are ===');
{
  const data = dataDirIfUnpacked();
  if (!data) {
    console.log('  (no unpacked data — run `npm run unpack-data`; the names went unchecked)');
  } else {
    const roster = new Map(new Registry(data).creatures().map((c) => [c.id, c.name ?? '']));
    for (const t of TRAINABLE) {
      const said = roster.get(t.lua);
      check(`${t.lua} is ${t.name}`, said === t.name, said === undefined
        ? 'the game has no such creature' : said !== t.name ? `the game says ${said}` : '');
    }
  }
}

console.log(failures ? `\nFAILED: ${failures}` : '\nall good');
process.exit(failures ? 1 : 0);
