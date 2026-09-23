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
  check("the pool is every creature of the tiers, the mod's own included", lua.includes('H5ECreatures(BonePit_MIN_TIER, BonePit_MAX_TIER)'));
  check('the tiers are the ones asked for', lua.includes('BonePit_MIN_TIER = 3;') && lua.includes('BonePit_MAX_TIER = 6;'));
  check('a week of the creature is what it stocks', lua.includes('H5ECreatureGrowth(creature)'));
  check('the screen is given a list and nothing else', lua.includes('H5EHireScreen(\n') && !lua.includes('H5EHireScreen(town'));
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
    const used = new Set([...lua.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]!));
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
