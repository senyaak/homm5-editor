// The refugee camp's Lua — the whole feature, written where a feature belongs.
//
// The engine's own camp is a POOL of 38 creatures written into
// `MapObjects/Special/RefugeeCamp.xdb`, rolled once a week and sold through
// the hire screen (docs/FACTION_PLAN.md §2b). A camp of ours is the same idea
// and none of the same data: what the extension lends is two doors the map's
// Lua does not have —
//
//   H5ECreatures(minTier, maxTier)   every creature the table holds, the mod's
//                                    own included, so a roll is not a list
//                                    somebody has to keep up to date;
//   H5EHireScreen(creature, count,…) the game's own hire screen over a list of
//                                    ours, and `H5EHireBought(creature, count)`
//                                    back when the player buys.
//
// — and everything else is here: the week, the roll, the stock, the price, who
// pays and who receives. The extension holds no state and knows nothing about
// camps; the same two doors serve a caravan, a black market or a quest reward
// written tomorrow, in Lua, without a new DLL.
//
// WHERE THE STOCK LIVES. In the map's game variables, which a save carries.
// The purchase event arrives while the screen is still up (the extension runs
// the line and ticks the scheduler once, as the town button does), so what is
// left is written down at the moment it changes — a save taken in the town has
// the true numbers.
//
// WHY THE WEEK IS CHECKED ON THE CLICK, not on a new-day trigger. The stock is
// only ever looked at through the building, so rolling when it is opened is the
// same stock the player would have seen, and it needs no list of the towns on
// the map — the click brings the town's name.
//
// THE LEVELS. The building has three, and the level decides how many offers
// there are and what they cost: one at double price, two at the ordinary one,
// three at half (Senya, 2026-09-22). The price is the script's now — the
// engine pays nothing for a screen of ours — so the multiplier is real.

import { TOWN_BUILDINGS } from './town-button.ts';

/** What a camp of that level offers: how many creatures, and what they cost. */
export interface CampLevel {
  offers: number;
  price: number;
}

/** The three levels, in order. A building at level N takes `CAMP_LEVELS[N - 1]`. */
export const CAMP_LEVELS: readonly CampLevel[] = [
  { offers: 1, price: 2 },
  { offers: 2, price: 1 },
  { offers: 3, price: 0.5 },
];

/** How many offers a camp of that level makes — 0 when it is not built. */
export function campOffers(level: number): number {
  return level >= 1 && level <= CAMP_LEVELS.length ? CAMP_LEVELS[level - 1]!.offers : 0;
}

/**
 * The name the map's Lua knows a building by — NOT the one the data does.
 *
 * The xdb and this repo say `TB_SPECIAL_1`; `advmap-startup.lua` declares
 * `TOWN_BUILDING_SPECIAL_1`, and the two lists are the same enum in the same
 * order, so the ordinal converts one to the other. Launch 42 said what the
 * other spelling costs: "Value was NIL when getting global with name
 * 'TB_SPECIAL_1'", then "Wrong type of argument 2" from
 * `GetTownBuildingLevel`, once per click.
 */
export function luaBuildingName(building: string): string {
  const at = TOWN_BUILDINGS.indexOf(building);
  if (at < 0) throw new Error(`${building} is not an ETownBuilding`);
  return `TOWN_BUILDING_${building.slice('TB_'.length)}`;
}

export interface CampScript {
  /** The building whose click opens it (`TB_SPECIAL_1`…), as the button's Lua is named after. */
  lua: string;
  /** The building the level is read from — the same one, by its `TB_*` name. */
  building: string;
  /** The tiers the roll draws from. The shipped camp's pool is tiers three to six. */
  minTier?: number;
  maxTier?: number;
}

/**
 * The faction's camp, as Lua for `FactionSpec.script`.
 *
 * Written in Lua 4's own grammar: no `return` on its own, the comma inside a
 * table constructor, `nil` where a modern dialect would say `false` (there is
 * no `false` here), and none of the standard library — this engine registers
 * almost none of it (docs/NAMES_AND_SCRIPTING.md, src/script/lua-lint.ts).
 */
export function campScript(spec: CampScript): string {
  const min = spec.minTier ?? 1;
  const max = spec.maxTier ?? 7;
  const levels = CAMP_LEVELS.map((l) => `{ offers = ${l.offers}, price = ${l.price} }`).join(', ');
  const n = spec.lua;
  const building = luaBuildingName(spec.building);
  return [
    `-- The refugee camp of ${n}: what it sells, rolled once a week.`,
    `${n}_LEVELS = { ${levels} };`,
    `${n}_MIN_TIER = ${min};`,
    `${n}_MAX_TIER = ${max};`,
    '-- The town whose camp is open, and its price, for the purchase that comes back.',
    `${n}_TOWN = "";`,
    `${n}_PRICE = 1;`,
    '',
    "-- One number of the town's stock, and where it is kept.",
    `function ${n}_Var(town, what)`,
    `  return "h5e.${n}." .. town .. "." .. what;`,
    'end;',
    '',
    `function ${n}_Get(town, what)`,
    `  local said = GetGameVar(${n}_Var(town, what));`,
    // NO `tonumber`: this engine registers almost none of the standard library
    // and that is one of the names it does not have. A variable never set
    // answers with the empty string — what the shipped scripts test for — and
    // arithmetic on a numeric string is the dialect's own coercion.
    '  if said == "" then',
    '    return 0;',
    '  end;',
    '  return said + 0;',
    'end;',
    '',
    `function ${n}_Set(town, what, value)`,
    `  SetGameVar(${n}_Var(town, what), value);`,
    'end;',
    '',
    '-- One creature of the tiers this camp draws from, and a week of it.',
    `function ${n}_One(pool, poolSize)`,
    '  local at = random(poolSize) + 1;',
    '  local creature = pool[at];',
    '  local count = H5ECreatureGrowth(creature);',
    '  if count < 1 then',
    '    count = 1;',
    '  end;',
    '  return creature, count;',
    'end;',
    '',
    '-- A new week replaces the stock: ALL THREE of it, whatever the camp is',
    '-- built to. The level only decides how many are open, so paying for one',
    '-- shows one more of what the week already rolled.',
    `function ${n}_Roll(town)`,
    `  local pool = { H5ECreatures(${n}_MIN_TIER, ${n}_MAX_TIER) };`,
    // No `getn` here either, so the pool is counted by walking it.
    '  local poolSize = 0;',
    '  while pool[poolSize + 1] ~= nil do',
    '    poolSize = poolSize + 1;',
    '  end;',
    '  if poolSize < 1 then',
    '    return nil;',
    '  end;',
    // WHILE THIS IS BEING MADE TO WORK: how big the pool actually is, and one
    // raw draw. Launch 47 drew the same creature three times running out of a
    // hundred and nineteen, which is either a generator that does not advance
    // or a table that holds one element — `H5ECreatures` pushes 119 values and
    // `{ … }` has to keep them all. These two lines say which.
    '  H5ELog(poolSize);',
    '  H5ELog(random(100));',
    '  local i = 1;',
    '  while i <= 3 do',
    '    local creature = 0;',
    '    local count = 0;',
    `    creature, count = ${n}_One(pool, poolSize);`,
    `    ${n}_Set(town, "c" .. i, creature);`,
    `    ${n}_Set(town, "n" .. i, count);`,
    // WHILE THIS IS BEING MADE TO WORK: the three creatures the week drew.
    // Launch 46 showed the same footman every game, and a camp built at level
    // one only ever SHOWS the first of the three — so whether the roll is stuck
    // or only its first draw is, the other two say it in one launch.
    '    H5ELog(creature);',
    '    i = i + 1;',
    '  end;',
    'end;',
    '',
    '-- The click: a stock for this week if there is none, then the screen.',
    `function ${n}(town)`,
    `  local level = GetTownBuildingLevel(town, ${building});`,
    `  local rule = ${n}_LEVELS[level];`,
    '  if rule == nil then',
    '    return nil;',
    '  end;',
    '  local week = GetDate(WEEK) + GetDate(MONTH) * 4;',
    `  if ${n}_Get(town, "week") ~= week then`,
    `    ${n}_Set(town, "week", week);`,
    `    ${n}_Roll(town);`,
    '  end;',
    `  ${n}_TOWN = town;`,
    `  ${n}_PRICE = rule.price;`,
    // The level OPENS what the week rolled — one, two or all three — so an
    // upgrade shows one more of the same stock rather than rolling a new one
    // (Senya, launch 45).
    `  local c1, n1 = ${n}_Get(town, "c1"), ${n}_Get(town, "n1");`,
    '  local c2, n2 = 0, 0;',
    '  local c3, n3 = 0, 0;',
    '  if rule.offers > 1 then',
    `    c2, n2 = ${n}_Get(town, "c2"), ${n}_Get(town, "n2");`,
    '  end;',
    '  if rule.offers > 2 then',
    `    c3, n3 = ${n}_Get(town, "c3"), ${n}_Get(town, "n3");`,
    '  end;',
    // WHILE THIS IS BEING MADE TO WORK: what the town already holds of the
    // creature on offer. It is read HERE and not after the purchase because
    // `AddObjectCreatures` does not add — it queues a command on the adventure
    // map (0x5DAA50 ends by handing one to the map's `vt+0x04`), and the world
    // does not run its queue while a screen is up. Asked a line later it always
    // answers with the old number; asked on the next visit it answers with the
    // truth about the last one.
    '  if c1 > 0 then',
    '    H5ELog(GetObjectCreatures(town, c1));',
    '  end;',
    '  H5EHireScreen(c1, n1, c2, n2, c3, n3);',
    'end;',
    '',
    '-- The purchase, said by the extension while the screen is still up. The',
    '-- engine pays nothing and gives nothing for a screen of ours, so this is',
    '-- the whole transaction: the gold, the creatures, and what is left.',
    'function H5EHireBought(creature, count)',
    `  local town = ${n}_TOWN;`,
    '  if town == "" then',
    '    return nil;',
    '  end;',
    '  local player = GetObjectOwner(town);',
    `  local price = H5ECreatureCost(creature) * count * ${n}_PRICE;`,
    '  local purse = GetPlayerResource(player, GOLD);',
    // WHILE THIS IS BEING MADE TO WORK: the three numbers that decide the
    // purchase, into the extension's log, because a script that quietly does
    // nothing looks exactly like a screen that quietly sold nothing.
    '  H5ELog(price);',
    '  H5ELog(purse);',
    '  if purse < price then',
    '    H5ELog(-1);',
    '    return nil;',
    '  end;',
    '  SetPlayerResource(player, GOLD, purse - price);',
    '  AddObjectCreatures(town, creature, count);',
    '  local i = 1;',
    '  while i <= 3 do',
    `    if ${n}_Get(town, "c" .. i) == creature then`,
    `      local left = ${n}_Get(town, "n" .. i) - count;`,
    '      if left < 0 then',
    '        left = 0;',
    '      end;',
    `      ${n}_Set(town, "n" .. i, left);`,
    '    end;',
    '    i = i + 1;',
    '  end;',
    'end;',
  ].join('\n');
}
