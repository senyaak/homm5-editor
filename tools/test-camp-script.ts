// The refugee camp's Lua — that it is Lua 4, that every name in it exists, and
// that it says what it must.
//
//   node tools/test-camp-script.ts

// needs: data
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campScript, campOffers, CAMP_LEVELS, luaBuildingName } from '../src/mods/camp-script.ts';
import { luaDiagnostics } from '../src/script/lua-lint.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const lua = campScript({ lua: 'BonePit', building: 'TB_SPECIAL_1', minTier: 3, maxTier: 6 });

console.log('the camp script');
{
  const problems = luaDiagnostics(lua);
  check('it passes the linter', problems.length === 0, JSON.stringify(problems.slice(0, 2)));
  // The dialect's two traps, both paid for in game runs (docs/PANDORA_BOX.md):
  // inside a table constructor the separator is the comma, and `return;` alone
  // kills the file.
  check('no bare return', !/\breturn\s*;/.test(lua));
  check('the table constructors use commas', !/\{[^}]*;[^}]*\}/.test(lua));
  check('no `false` — this dialect has none', !/\bfalse\b/.test(lua));
}

console.log('what it asks the extension for — two doors and no more');
{
  check("the pool is every creature of the tiers, the mod's own included",
    lua.includes('H5ECreatureCount(BonePit_MIN_TIER, BonePit_MAX_TIER)')
    && lua.includes('H5ECreatureAt(k, BonePit_MIN_TIER, BonePit_MAX_TIER)'));
  // Launch 49: `{ H5ECreatures(3, 6) }` — 119 ids pushed, a pool of 1 counted.
  // A table gathered out of one call's many results keeps the first of them
  // in this dialect, so nothing may be built that way.
  check("no table is gathered out of one call's results", !/\{\s*H5E\w+\(/.test(lua));
  check('no probe left in the script', !lua.includes('H5ELog('));
  check('the tiers are the ones asked for', lua.includes('BonePit_MIN_TIER = 3;') && lua.includes('BonePit_MAX_TIER = 6;'));
  check('a week of the creature is what it stocks', lua.includes('H5ECreatureGrowth(creature)'));
  check('the screen is given a list and nothing else', lua.includes('H5EHireScreen(c1, n1, c2, n2, c3, n3);') && !lua.includes('H5EHireScreen(town'));
  // The week rolls all three; the level only opens them.
  check('the week rolls the whole stock', lua.includes('function BonePit_Roll(town)') && !lua.includes('BonePit_Roll(town, rule.offers)'));
  check('the level opens what the week rolled', lua.includes('if rule.offers > 1 then') && lua.includes('if rule.offers > 2 then'));
  check('nothing waits for a thread that cannot run', !lua.includes('sleep(') && !lua.includes('H5EHireOpen'));
  check("the function the button calls is the building's", /\nfunction BonePit\(town\)\n/.test(lua));
  check("the level is the building's", lua.includes('GetTownBuildingLevel(town, TOWN_BUILDING_SPECIAL_1)'));
}

console.log("the purchase is the script's whole business");
{
  check('it hears the event', lua.includes('function H5EHireBought(creature, count)'));
  check('it charges the price, by the level', lua.includes('H5ECreatureCost(creature) * count * BonePit_PRICE')
    && lua.includes('SetPlayerResource(player, GOLD, purse - price);'));
  check('it refuses what the player cannot afford', lua.includes('if purse < price then'));
  check('it gives the creatures to the town', lua.includes('AddObjectCreatures(town, creature, count);'));
  check('and writes down what is left', lua.includes('local left = BonePit_Get(town, "n" .. i) - count;'));
  // Launch 49: the same creature in two slots, one purchase taken from both.
  check('out of the first slot of that creature only', /BonePit_Set\(town, "n" \.\. i, left\);\n\s*i = 3;/.test(lua));
}

console.log('the week draws three different creatures');
{
  // The rule the roll writes in Lua, as a model: draw N picks among the
  // size-N+1 indices left and steps over the ones taken, smallest first. Every
  // outcome `random` could give is tried, for every pool size up to eight, and
  // each must be three different indices inside the pool — or, for a pool
  // smaller than three, as many different ones as there are.
  const rolls = (size: number, draws: number[]): number[] => {
    const taken: number[] = [];
    for (let i = 1; i <= 3 && i <= size; i++) {
      let k = draws[i - 1]! + 1;
      if (i === 2 && k >= taken[0]!) k++;
      if (i === 3) {
        const [lo, hi] = taken[0]! < taken[1]! ? [taken[0]!, taken[1]!] : [taken[1]!, taken[0]!];
        if (k >= lo) k++;
        if (k >= hi) k++;
      }
      taken.push(k);
    }
    return taken;
  };
  let wrong = '';
  for (let size = 1; size <= 8 && !wrong; size++) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < Math.max(1, size - 1); b++) {
        for (let c = 0; c < Math.max(1, size - 2); c++) {
          const got = rolls(size, [a, b, c]);
          const inside = got.every((k) => k >= 1 && k <= size);
          if (new Set(got).size !== got.length || !inside || got.length !== Math.min(3, size)) {
            wrong = `pool ${size}, draws ${a},${b},${c} gave ${got.join(',')}`;
          }
        }
      }
    }
  }
  check('never the same one twice, never outside the pool', !wrong, wrong);
  // And the Lua is that model, line for line where it matters.
  check('the Lua draws among what is left', lua.includes('local k = random(size - i + 1) + 1;'));
  check('and steps over what is taken', lua.includes('if i == 2 and k >= t1 then')
    && lua.includes('if hi < lo then') && lua.includes('if k >= lo then') && lua.includes('if k >= hi then'));
}

console.log('the levels');
{
  check('three of them, more offers and a lower price each time',
    CAMP_LEVELS.length === 3
    && CAMP_LEVELS.every((l, i) => l.offers === i + 1)
    && CAMP_LEVELS[0]!.price === 2 && CAMP_LEVELS[1]!.price === 1 && CAMP_LEVELS[2]!.price === 0.5);
  check('a building not built offers nothing', campOffers(0) === 0 && campOffers(4) === 0);
  check('and a built one offers its level\'s', campOffers(1) === 1 && campOffers(3) === 3);
  check('the table is in the script', lua.includes('BonePit_LEVELS = { { offers = 1, price = 2 }, { offers = 2, price = 1 }, { offers = 3, price = 0.5 } };'));
}

console.log('the stock is the map\'s, per town');
{
  check('kept in game variables under the town\'s name', lua.includes('"h5e.BonePit." .. town .. "." .. what'));
  check('a week already rolled is not rolled again', lua.includes('BonePit_Get(town, "week") ~= week'));
  check("the stock is the script's own to write", /_Set\(town, "c" \.\. i, creature\);/.test(lua) && /_Set\(town, "n" \.\. i, left\);/.test(lua));
  check('and a month is four weeks on, so the week is not four forever', lua.includes('GetDate(WEEK) + GetDate(MONTH) * 4'));
}

console.log("every name of the game's the script reads is declared");
{
  // WHAT THIS CATCHES, and it caught it the expensive way first: the data
  // calls a building `TB_SPECIAL_1` and the map's Lua calls it
  // `TOWN_BUILDING_SPECIAL_1`. The script said the data's name, the engine
  // answered "Value was NIL when getting global with name 'TB_SPECIAL_1'" and
  // then "Wrong type of argument 2" once per click, and the structural linter
  // had nothing to say — it checks grammar, not vocabulary.
  //
  // So: every SHOUTED name the script READS has to be declared by
  // `advmap-startup.lua`, which is the vocabulary a map is written against.
  // Ours are the ones the script assigns itself.
  const startup = join(dataDir(), 'scripts', 'advmap-startup.lua');
  if (!existsSync(startup)) {
    console.log(`  skip  no unpacked data at ${dataDir()} — the game's vocabulary is not here to check against`);
  } else {
    const text = readFileSync(startup, 'latin1');
    const declared = new Set([...text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]!));
    const ours = new Set([...lua.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]!));
    // WHOLE WORDS: a word boundary each side, or H5ECreatures reads as the
    // unknown name H5EC and the check drowns in its own noise. It was written
    // through a heredoc once, which ate the escape and left a real backspace
    // byte — the check then matched nothing at all and passed everything.
    // COMMENTS ARE NOT CODE: a sentence in capitals inside one is not a name
    // the game has to know (it read "ALL THREE" as two of them).
    const code = lua.split(String.fromCharCode(10)).map((l) => l.replace(/--.*$/, '')).join(String.fromCharCode(10));
    const used = new Set([...code.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]!));
    const unknown = [...used].filter((name) => !declared.has(name) && !ours.has(name));
    check('no name the game has never heard of', unknown.length === 0, unknown.join(', '));
    check('the building is named the way a map names one', lua.includes(`GetTownBuildingLevel(town, ${luaBuildingName('TB_SPECIAL_1')})`));
    check("and that name is the game's own", declared.has('TOWN_BUILDING_SPECIAL_1'));
  }
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
