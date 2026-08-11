// Gelu's training, as a rule that can be reasoned about — and the Lua that runs it.
//
// The rule lives in the MAP'S OWN SCRIPT, which is the whole design: the
// extension gives the map moves it does not have (a count window, a spell page
// that answers to a script) and the script decides who may do what. That is
// right, and it has one cost — a rule written in the map's Lua can only be tried
// by launching the game, and every wrong version of it costs somebody a run.
//
// So the DECISION is written once here, in TypeScript, where a test can put a
// hundred armies through it in a second; and the Lua below is that same decision
// spelled out for the engine. They are twins and can drift, which is said out
// loud rather than papered over: the numbers cannot drift (both sides read them
// from `TRAINABLE`), and the shape is what `tools/test-training-plan.ts` pins
// down, by running the rule against a model of the engine's own habits.
//
// Those habits, each of which cost a run to learn (SLICE_gelu_training.md and
// docs/SCRIPT_API.md carry the addresses):
//
//   * seven slots, and adding a kind with no room for it makes the GAME stop and
//     ask the player what to throw away — so a rule that offers such a training
//     has already failed, whatever happens next;
//   * `RemoveHeroCreatures` will not empty a hero: when the kind asked for is
//     everything he has, it silently takes one less;
//   * neither add nor remove happens when it is called. Each queues a command
//     and the world runs it later, while `GetHeroCreatures` reads the army as it
//     is — so a script that does not wait sees the past, and the "leave one
//     behind" clamp is decided against the army as it was when the command was
//     made;
//   * a script cannot count SLOTS. `GetHeroCreaturesTypes` throws duplicates
//     away, so two stacks of archers read as one thing — which is exactly how a
//     full army looked roomy. `H5EArmySlots`, ours, answers that one honestly.

/** The mod's own creature. The game ships 180 of them, so this is the first id a
 *  mod can take, and the game's own CREATURE_SHARP_SHOOTER (147) is a different
 *  creature entirely — paying that one out is what elves came from. */
export const SHARPSHOOTER = 180;
export const SHARPSHOOTER_LUA = 'CREATURE_H3_SHARPSHOOTER';

/** How many stacks a hero can carry. */
export const ARMY_SLOTS = 7;

/**
 * The spell that offers the training.
 *
 * A NUMBER, and it has to be one the mod really assigned: the gate, both hooks
 * and the extension's remembered verdict all key on it. Stock Tribes of the East
 * ends at 352, so the mod's first spell is 353 — which is what this is until the
 * spell becomes something a person types in the editor and the number comes out
 * of the document instead.
 */
export const TRAINING_SPELL = 353;

/** What a training costs, by what is being trained — and, at the same time, the
 *  whole of what CAN be trained: the four shooters Gelu recruited from in
 *  Heroes 3. The engine keeps creature costs to itself, so these are ours. */
export interface Trainable {
  /** The constant the game's own script vocabulary knows it by. */
  lua: string;
  id: number;
  gold: number;
  /**
   * WHAT THE GAME CALLS IT, in the player's own language, read out of the
   * creature roster rather than guessed from the constant.
   *
   * Here because guessing is what went wrong: `CREATURE_LONGBOWMAN` was filed as
   * a second upgrade of the human line on the strength of its name, and the game
   * calls it "Стрелки" — the OTHER upgrade of the archer, the same tier as the
   * marksman. Same for the game's own sharp shooter: not a third step, the
   * alternative to the master hunter. Each line branches once; it does not climb.
   */
  name: string;
}

export const TRAINABLE: readonly Trainable[] = [
  // Two lines, each branching once. Senya set the prices for the base and the
  // upgrade of each; an alternative upgrade is the same tier as its sibling and
  // costs the same, which is the whole of the arithmetic here.
  { lua: 'CREATURE_ARCHER', id: 3, gold: 300, name: 'Лучники' },
  { lua: 'CREATURE_MARKSMAN', id: 4, gold: 250, name: 'Арбалетчики' },
  { lua: 'CREATURE_LONGBOWMAN', id: 107, gold: 250, name: 'Стрелки' },
  { lua: 'CREATURE_WOOD_ELF', id: 47, gold: 200, name: 'Эльфийские лучники' },
  { lua: 'CREATURE_GRAND_ELF', id: 48, gold: 175, name: 'Мастера лука' },
  // The GAME's own sharp shooter — a different creature from the mod's, which is
  // why an early run paid out elves, and the elven line's other upgrade.
  { lua: 'CREATURE_SHARP_SHOOTER', id: 147, gold: 175, name: 'Лесные стрелки' },
];

export function priceOf(kind: number): number | null {
  return TRAINABLE.find((t) => t.id === kind)?.gold ?? null;
}

/** One question per kind, because each names its own price — and, now that the
 *  roster has been asked rather than guessed at, its own creature. */
export const questionFor = (kind: number) => `Text/H5E/TrainOne_${kind}.txt`;
export const questionText = (t: Trainable) =>
  `Обучить одного бойца из отряда «${t.name}» в снайперы за ${t.gold} золотых?`;

/** And one for the training that can only be the whole stack. It names no
 *  number, because a question is a FILE here and this game's Lua has no
 *  `format` to put one into it. */
export const QUESTION_ALL = 'Text/H5E/TrainAll.txt';
export const QUESTION_ALL_TEXT = 'Свободных мест в отряде нет, так что обучить можно только весь стек стрелков разом. Обучить?';

/**
 * Everything about a hero's army a SCRIPT can find out — and nothing more.
 *
 * Written as its own type on purpose. The rule reading a list of slots would be
 * a rule that cannot exist, and the bug that made this file necessary was
 * exactly that: `used` was taken from the deduplicated kinds, so an army of
 * seven stacks in six kinds counted as six.
 */
export interface ArmyView {
  /** `GetHeroCreaturesTypes` — distinct kinds, in slot order, no duplicates. */
  kinds: readonly number[];
  /** `H5EArmySlots` — how many slots are taken. Ours; the engine offers no way. */
  used: number;
  /** `GetHeroCreatures` — how many of a kind, over the whole army. */
  countOf(kind: number): number;
}

export interface Plan {
  /** What to train — the first trainable kind in SLOT order. */
  kind: number;
  /**
   * The FEWEST that may be trained, which is not always one.
   *
   * With no room, the sharpshooters have nowhere to go until the source stack
   * is gone, and it only goes if all of it is trained — so training fewer would
   * leave the slot taken and the game would stop to ask the player what to
   * throw away. A rule that says "all or nothing" and then offers a slider
   * starting at one has not said it.
   */
  least: number;
  /** How many may be trained: what he has, and what he can pay for. */
  most: number;
  /** How many of that kind he has in all. */
  have: number;
  used: number;
  /** Whether the sharpshooters have somewhere to land without anything leaving. */
  roomy: boolean;
}

/**
 * What may happen, decided once, so the page, the question and the work can
 * never disagree about it. `null` is what greys the spell's page.
 */
export function planTraining(army: ArmyView, gold: number): Plan | null {
  let kind: number | null = null;
  let roomy = army.used < ARMY_SLOTS;
  for (const k of army.kinds) {
    if (k === SHARPSHOOTER) roomy = true;      // they merge into a stack he has
    if (kind === null && priceOf(k) !== null) kind = k;
  }
  if (kind === null) return null;

  const price = priceOf(kind)!;
  const have = army.countOf(kind);
  const most = Math.min(have, Math.floor(gold / price));
  if (most < 1) return null;

  // No room means the source stack has to leave before they arrive, and it only
  // leaves whole. A training that cannot pay for all of it cannot happen — and
  // offering it anyway is what made the game ask which creature to drop.
  if (!roomy && most < have) return null;

  // Which also means `least` and `most` meet whenever there is no room: the
  // whole stack was the only training allowed, so there is nothing to slide.
  return { kind, least: roomy ? 1 : have, most, have, used: army.used, roomy };
}

// --- the same thing, for the engine -----------------------------------------

const price = (t: Trainable) => `\tif kind == ${t.lua} then return ${t.gold}; end;`;
const question = (t: Trainable) => `\tif kind == ${t.lua} then return "/${questionFor(t.id)}"; end;`;

/**
 * The map's side of the spell: the rule, the work, and the asking.
 *
 * NOTHING AT THE TOP LEVEL MAY NAME A CREATURE. `CREATURE_…` are made by
 * `createAdvmapAliases()`, which the engine calls AFTER it loads this, so a
 * top-level `X = CREATURE_ARCHER` stores nil. Inside a function they are there.
 *
 * And no `format`, no `type`, no `..` on a number: this game registers almost no
 * standard library, so a path is written out rather than built.
 */
export function trainingLua(): string {
  return [
    '',
    '-- The training spell, end to end. Generated from',
    '-- src/mods/sharpshooter-training.ts; the rule it spells out is tested there.',
    '',
    `${SHARPSHOOTER_LUA} = ${SHARPSHOOTER};`,
    '',
    '-- What one training costs, and at the same time WHICH creatures can be',
    '-- trained at all: a kind with no price is a kind the spell does not touch.',
    'function H5ETrainPrice(kind)',
    ...TRAINABLE.map(price),
    '\treturn nil;',
    'end;',
    '',
    '-- Which question to ask about one of them: each names its own price.',
    'function H5ETrainQuestion(kind)',
    ...TRAINABLE.map(question),
    '\treturn nil;',
    'end;',
    '',
    '-- THE WHOLE RULE, IN ONE PLACE. Answers the kind to train, how many, how',
    '-- many he has, how many slots are taken, and whether there is room; nil',
    '-- when nothing can be trained, and THAT is what greys the page.',
    '--',
    '-- GetHeroCreaturesTypes answers with SEVEN NUMBERS rather than a table -',
    '-- the distinct kinds in slot order, padded with zeroes - and it throws',
    '-- duplicates away, so it cannot say how many SLOTS are taken. H5EArmySlots',
    '-- is ours and answers that; without it a full army looked roomy and the',
    '-- game stopped to ask the player which creature to throw away.',
    '-- IT SAYS WHY IT REFUSES. A rule that only ever answers "no" looks exactly',
    '-- like a rule that works, and a page that is dead for a good reason looks',
    '-- exactly like one that is dead by mistake. The numbers are markers into the',
    '-- extension\'s log:  7001 no slot count  7002 nothing trainable in the army',
    '-- 7003 not enough gold for even one  7004 no room, and not all of them paid',
    '-- for  7005 allowed, followed by the kind, how many, and the slots taken.',
    'function H5EPlan(hero)',
    '\tlocal used = H5EArmySlots(hero);',
    '\tif used == nil then',
    '\t\tH5E_WHY = 7001;',
    '\t\treturn nil;',
    '\tend;',
    '\tlocal a, b, c, d, e, f, g = GetHeroCreaturesTypes(hero);',
    '\tlocal army = { a, b, c, d, e, f, g };',
    `\tlocal roomy = nil;`,
    `\tif used < ${ARMY_SLOTS} then roomy = 1; end;`,
    '\tlocal kind = nil;',
    '\tlocal slot, k;',
    '\tfor slot, k in army do',
    `\t\tif k == ${SHARPSHOOTER_LUA} then roomy = 1; end;`,
    '\t\tif kind == nil then',
    '\t\t\tif H5ETrainPrice(k) ~= nil then kind = k; end;',
    '\t\tend;',
    '\tend;',
    '\tif kind == nil then',
    '\t\tH5E_WHY = 7002;',
    '\t\treturn nil;',
    '\tend;',
    '',
    '\tlocal have = GetHeroCreatures(hero, kind);',
    '\tlocal most = floor(GetPlayerResource(PLAYER_1, GOLD) / H5ETrainPrice(kind));',
    '\tif have < most then most = have; end;',
    '\tif most < 1 then',
    '\t\tH5E_WHY = 7003;',
    '\t\treturn nil;',
    '\tend;',
    '\tlocal least = 1;',
    '\tif roomy == nil then',
    '\t\tif most < have then',
    '\t\t\tH5E_WHY = 7004;',
    '\t\t\treturn nil;',
    '\t\tend;',
    '\t\t-- All or nothing: fewer would leave the slot taken and the game would',
    '\t\t-- stop to ask the player which creature to throw away.',
    '\t\tleast = have;',
    '\tend;',
    '\tH5E_WHY = 7005;',
    '\tH5E_WHAT = kind;',
    '\tH5E_MOST = most;',
    '\treturn kind, least, most, have, used, roomy;',
    'end;',
    '',
    '-- WHOSE spell it is. A script only ever gets a list of the player\'s heroes',
    '-- and no way to ask which of them is casting - so the extension is asked,',
    '-- name by name, the other way round: it holds the hero the engine handed it',
    '-- and the map turns a name back into that same hero.',
    '--',
    '--',
    '-- WHEN A CASTER IS KNOWN AND NOT FOUND, THE ANSWER IS NO. The first version',
    '-- fell back to any hero who could train, which is how one hero\'s page came',
    '-- to be lit by another hero\'s archers - and then to train them. The only',
    '-- case worth falling back for is nobody casting at all, and H5ECasterKnown',
    '-- is what tells the two apart.',
    'function H5EWhoCanTrain()',
    '\tlocal heroes = GetPlayerHeroes(PLAYER_1);',
    '\tif heroes == nil then',
    '\t\tH5E_WHY = 9003;',
    '\t\treturn nil;',
    '\tend;',
    '\tlocal index, hero;',
    '\tif H5ECasterKnown() ~= nil then',
    '\t\tfor index, hero in heroes do',
    '\t\t\tif H5EIsCastingHero(hero) ~= nil then',
    '\t\t\t\t-- Remembered even when the plan refuses: a refusal is exactly when',
    '\t\t\t\t-- somebody wants to know whose army it was about.',
    '\t\t\t\tH5E_WHO = hero;',
    '\t\t\t\tif H5EPlan(hero) ~= nil then return hero; end;',
    '\t\t\t\treturn nil;',
    '\t\t\tend;',
    '\t\tend;',
    '\t\tH5E_WHY = 9002;',
    '\t\treturn nil;',
    '\tend;',
    '\tfor index, hero in heroes do',
    '\t\tif H5EPlan(hero) ~= nil then return hero; end;',
    '\tend;',
    '\treturn nil;',
    'end;',
    '',
    '-- The page is live exactly when a training could be carried out.',
    '-- THE SPELL\'S OWN TWO HOOKS, and the dispatch that reaches them.',
    '--',
    '-- A mod carries more than one spell, so both the question and the cast',
    '-- branch on the NUMBER. Without that a second spell would answer the',
    '-- first one\'s page and run the first one\'s cast - a fault that shows up',
    '-- in somebody else\'s mod, not in the one that introduced it.',
    'function H5ESpells()',
    `\treturn { ${TRAINING_SPELL} };`,
    'end;',
    '',
    '-- KEEPING THE VERDICTS CURRENT, because the gate cannot ask and be answered',
    '-- in one breath: every door into a map\'s Lua makes a thread, so a rule run',
    '-- from the moment of drawing answers after the page is already drawn. The',
    '-- extension starts this thread the first time it needs a page, hands it the',
    '-- spell\'s number, and reads whatever it last said.',
    '--',
    '-- It only speaks when the answer CHANGES, so the log stays a record of what',
    '-- happened rather than a tally of ticks - and the first few ticks always,',
    '-- because "it never spoke again" and "it died after one tick" look the same',
    '-- from outside and only one of them is a bug.',
    '--',
    '-- NOT ONE MEMORY FOR ALL OF THEM. The verdict is remembered per spell here',
    '-- exactly as it is on the extension\'s side; a single H5E_CASTABLE_WAS let',
    '-- the first spell\'s answer swallow the second\'s, since the second would',
    '-- find the number already equal to its own and say nothing.',
    'H5E_CASTABLE_WAS = {};',
    '',
    '-- INITIALISED WITH VALUES, NOT WITH NIL, and that is not tidiness.',
    '-- Assigning nil to a global does not CREATE it, so every one of these read',
    '-- before its first real value is a global that was never set - and this game',
    '-- says so on screen, in red, once per name. Five such lines is what a player',
    '-- saw. Zero and "" are values, so the names exist from the start and a nil',
    '-- in the log means something really went missing.',
    'H5E_WHY = 0;',
    'H5E_WHO = "";',
    'H5E_WHAT = 0;',
    'H5E_MOST = 0;',
    'H5E_SAID = 0;',
    'H5E_GOT = 0;',
    '',
    '-- WHAT THE ARMY ACTUALLY HELD, whenever the verdict moves. A refusal that',
    '-- only says "nothing to train" leaves the reader to take the rule\'s word',
    '-- for what the hero was carrying, and that is the one thing worth checking.',
    'function H5ESayArmy()',
    '\tif H5E_WHO == "" then return end;',
    '\tlocal a, b, c, d, e, f, g = GetHeroCreaturesTypes(H5E_WHO);',
    '\tlocal army = { a, b, c, d, e, f, g };',
    '\tlocal slot, k;',
    '\tH5ELog(7200);',
    '\tfor slot, k in army do',
    '\t\tif k ~= 0 then',
    '\t\t\tH5ELog(k);',
    '\t\t\tH5ELog(GetHeroCreatures(H5E_WHO, k));',
    '\t\tend;',
    '\tend;',
    '\tH5ELog(7201);',
    'end;',
    '',
    '-- One pass over every spell the mod carries. The verdict is remembered per',
    '-- spell on the extension\'s side too, so two spells cannot answer for each',
    '-- other; here it is only the LOGGING that is still about one, and it says',
    '-- which spell it is talking about.',
    'function H5ECastableWatch()',
    '\tlocal index, spell;',
    '\twhile 1 do',
    '\t\tfor index, spell in H5ESpells() do',
    '\t\t\tH5EWatchOne(spell);',
    '\t\tend;',
    '\t\tsleep(1);',
    '\tend;',
    'end;',
    '',
    '-- ONE SPELL, ONE TICK - and it says how far the rule got, not only what it',
    '-- decided. H5E_WHY is stamped at every step down the chain, so a "yes" that',
    '-- nothing computed is told apart from a yes the plan really made: the log',
    '-- of a run where the page stayed live showed the verdict answered while',
    '-- every reason was still unset, and the numbers below are what that reads',
    '-- off next time. 9000 the tick began  9010 the dispatch was entered',
    '-- 9011 the number is not one of ours  9012 the training hook was entered',
    '-- 9003 the player has no heroes  9002 the caster is not among them',
    '-- 7001..7005 the plan reached its own end and said so.',
    'function H5EWatchOne(spell)',
    '\tH5E_WHY = 9000;',
    '\tlocal now = 0;',
    '\tif checkSpellCastable(spell) then now = 1; end;',
    '\tlocal was = H5E_CASTABLE_WAS[spell];',
    '\tif now ~= was or H5E_SAID < 5 then',
    '\t\tH5E_SAID = H5E_SAID + 1;',
    '\t\tH5E_CASTABLE_WAS[spell] = now;',
    '\t\tH5EAnswer(spell, now);',
    '\t\tH5ELog(7000);',
    '\t\tH5ELog(spell);',
    '\t\tH5ELog(H5E_GOT);',
    '\t\tH5ELog(now);',
    '\t\tH5ELog(H5E_WHY);',
    '\t\tif now == 1 then',
    '\t\t\tH5ELog(H5E_WHAT);',
    '\t\t\tH5ELog(H5E_MOST);',
    '\t\tend;',
    '\t\tH5ESayArmy();',
    '\tend;',
    'end;',
    '',
    '-- Asked every tick by the watcher, so it says NOTHING as it goes: the reason',
    '-- for its answer is left in H5E_WHY and only written to the log when the',
    '-- answer changes. A log that repeats itself once a tick is not a log.',
    '-- ONE WAY OUT, AND THE CALL IS NOT IN IT. This dispatch is where the whole',
    '-- feature broke, and the shape is the bug:',
    '--',
    '--     if spell == 353 then return H5ETrainMayCast(); end;',
    '--',
    '-- Returning the RESULT OF A CALL from inside a nested block is a shape this',
    '-- engine\'s Lua does not carry out. The call happens and the block does not',
    '-- end: a run measured the plan reaching its own last line (the kind and the',
    '-- count both set, the army printed) and THEN the statement after the `if`',
    '-- running as well, so the value the caller got was never the rule\'s answer -',
    '-- it was whatever the second return left behind, which read as yes every',
    '-- time. Hence a live page over an army with nothing to train, and a click',
    '-- that does nothing because the rule inside refuses honestly.',
    '--',
    '-- The game\'s own 47 scripts settle what is safe: in 1096 functions they',
    '-- return a VALUE from a nested block 65 times and the result of a CALL',
    '-- exactly NEVER. So a call\'s result goes into a local and the function has a',
    '-- single exit - which is also what the version that worked did, by accident:',
    '-- `if H5EWhoCanTrain() == nil then return nil; end; return 1;` puts the call',
    '-- in the CONDITION, where it belongs.',
    'function checkSpellCastable(spell)',
    '\tH5E_WHY = 9010;',
    '\tH5E_GOT = spell;',
    '\tlocal verdict = nil;',
    `\tif spell == ${TRAINING_SPELL} then`,
    '\t\tH5E_WHY = 9013;',
    '\t\tverdict = H5ETrainMayCast();',
    '\telse',
    '\t\tH5E_WHY = 9011;',
    '\tend;',
    '\treturn verdict;',
    'end;',
    '',
    '-- THE SPELL\'S OWN "may it be cast". One of the two hooks a spell of a mod',
    '-- carries; the dispatcher above is what makes room for a second spell.',
    'function H5ETrainMayCast()',
    '\tH5E_WHY = 9012;',
    '\tif H5EWhoCanTrain() == nil then return nil; end;',
    '\treturn 1;',
    'end;',
    '',
    '-- Wait for a queued command to have happened. Bounded, and it says so in',
    '-- the log when it gives up, so a training that went nowhere cannot be',
    '-- mistaken for one that was never asked for.',
    'function H5EWaitArmy(hero, kind, was)',
    '\tlocal waited = 0;',
    '\twhile GetHeroCreatures(hero, kind) == was do',
    '\t\tif waited > 20 then',
    '\t\t\tH5ELog(9001);',
    '\t\t\treturn nil',
    '\t\tend;',
    '\t\tsleep(1);',
    '\t\twaited = waited + 1;',
    '\tend;',
    '\treturn 1;',
    'end;',
    '',
    '-- The work. Add before removing when there is room, remove before adding',
    '-- when there is not, and wait in between either way: the two calls only',
    '-- queue commands, and the engine decides how many to remove when the',
    '-- command is MADE.',
    'function H5ETrain(hero, kind, count)',
    '\tif count < 1 then return end;',
    '\tlocal plan, least, most, have, used, roomy = H5EPlan(hero);',
    '\tif plan == nil then return end;',
    '\tif count > most then count = most; end;',
    '\tif count < least then count = least; end;',
    `\tlocal sharp = GetHeroCreatures(hero, ${SHARPSHOOTER_LUA});`,
    '\tH5ELog(8001);',
    '\tH5ELog(kind);',
    '\tH5ELog(count);',
    '\tH5ELog(used);',
    '',
    '\tif roomy == nil then',
    '\t\tRemoveHeroCreatures(hero, kind, count);',
    '\t\tH5EWaitArmy(hero, kind, have);',
    `\t\tAddHeroCreatures(hero, ${SHARPSHOOTER_LUA}, count);`,
    `\t\tH5EWaitArmy(hero, ${SHARPSHOOTER_LUA}, sharp);`,
    '\telse',
    `\t\tAddHeroCreatures(hero, ${SHARPSHOOTER_LUA}, count);`,
    `\t\tH5EWaitArmy(hero, ${SHARPSHOOTER_LUA}, sharp);`,
    '\t\tRemoveHeroCreatures(hero, kind, count);',
    '\t\tH5EWaitArmy(hero, kind, have);',
    '\tend;',
    '',
    '\t-- The engine spares one when the kind asked for is all the hero has. It',
    '\t-- can only do that once - the army holds sharpshooters now - so one more',
    '\t-- pass finishes what was paid for, and costs nothing when nothing is left.',
    '\tlocal left = GetHeroCreatures(hero, kind);',
    '\tlocal want = have - count;',
    '\tif left > want then',
    '\t\tRemoveHeroCreatures(hero, kind, left - want);',
    '\t\tH5EWaitArmy(hero, kind, left);',
    '\tend;',
    '',
    '\t-- Paid for what really arrived, counted rather than assumed.',
    `\tlocal made = GetHeroCreatures(hero, ${SHARPSHOOTER_LUA}) - sharp;`,
    '\tH5ELog(8002);',
    '\tH5ELog(made);',
    '\tH5ELog(GetHeroCreatures(hero, kind));',
    '\tif made > 0 then',
    '\t\tlocal gold = GetPlayerResource(PLAYER_1, GOLD);',
    '\t\tSetPlayerResource(PLAYER_1, GOLD, gold - made * H5ETrainPrice(kind));',
    '\tend;',
    'end;',
    '',
    '-- When the fewest and the most are the same number there is nothing to',
    '-- slide, so it is a question rather than a window: one trainee, or a whole',
    '-- stack that has to go at once because his army is full.',
    'H5E_ASKED_HERO = "";',
    'H5E_ASKED_KIND = 0;',
    'H5E_ASKED_COUNT = 0;',
    '',
    'function H5ETrainAsked()',
    '\tH5ETrain(H5E_ASKED_HERO, H5E_ASKED_KIND, H5E_ASKED_COUNT);',
    'end;',
    '',
    '-- A thread of its own, because the work sleeps and this is the engine',
    '-- calling back into the script, not a script of ours running.',
    'function H5ETrainedAnswer()',
    '\tstartThread(H5ETrainAsked);',
    'end;',
    '',
    'function H5ETrainRun()',
    '\tlocal hero = H5EWhoCanTrain();',
    '\tif hero == nil then return end;',
    '\tlocal kind, least, most = H5EPlan(hero);',
    '\tif least == most then',
    '\t\tH5E_ASKED_HERO = hero;',
    '\t\tH5E_ASKED_KIND = kind;',
    '\t\tH5E_ASKED_COUNT = least;',
    '\t\tif least == 1 then',
    '\t\t\tQuestionBox(H5ETrainQuestion(kind), "H5ETrainedAnswer", "");',
    '\t\telse',
    `\t\t\tQuestionBox("/${QUESTION_ALL}", "H5ETrainedAnswer", "");`,
    '\t\tend;',
    '\telse',
    `\t\tlocal n = ShowSliderDialog(kind, ${SHARPSHOOTER_LUA}, most);`,
    '\t\tH5ETrain(hero, kind, n);',
    '\tend;',
    'end;',
    '',
    '-- And the other hook: what the click DOES, reached by the same dispatch.',
    'function onSpellCast(spell)',
    `\tif spell == ${TRAINING_SPELL} then startThread(H5ETrainRun); end;`,
    'end;',
    '',
  ].join('\r\n');
}
