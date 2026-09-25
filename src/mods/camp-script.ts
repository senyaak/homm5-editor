// The refugee camp's Lua — the whole feature, written where a feature belongs.
//
// The engine's own camp is a POOL of 38 creatures written into
// `MapObjects/Special/RefugeeCamp.xdb`, rolled once a week and sold through
// the hire screen (docs/FACTION_PLAN.md §2b; the mod's creatures join that
// pool through refugee-camp.ts). A camp of ours is the same idea and none of
// the same data: what the extension lends is two doors the map's Lua does not
// have —
//
//   H5ECreatureCount(minTier, maxTier) and H5ECreatureAt(n, minTier, maxTier)
//                                    every creature the table holds, the mod's
//                                    own included, so a roll is not a list
//                                    somebody has to keep up to date — asked as
//                                    a count and an index, because a table built
//                                    out of one call's many results keeps only
//                                    the first of them in this dialect (launch
//                                    49: 119 ids pushed, a pool of 1 counted);
//   H5EHireScreen("bought=<fn>", "tag=<town>", creature, count, price, …)
//                                    the game's own hire screen over a list of
//                                    ours, each line at its own price (percent
//                                    of the creature's cost), and
//                                    `<fn>(creature, count, town)` back when the
//                                    player presses hire — the screen has
//                                    already checked the stock, the room in the
//                                    army and the money, the engine's own way;
//                                    the function and the tag are the script's
//                                    words, so four towns with the building
//                                    share one function and no global;
//   H5EHireCost / H5EHireLeft        what the screen charged, per resource, and
//                                    what the script says is left after it sold.
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
// three at half (Senya, 2026-09-22). The price is the script's — handed to the
// screen with each line, which shows it, paints it red and refuses a purchase
// the player cannot pay, as the engine's own screen does (launch 51 bought five
// executioners the script then refused to sell). A line could as well be free
// for a hero with some skill: the script decides per opening.

import { TOWN_BUILDINGS } from './town-button.ts';

/** What a camp of that level offers: how many creatures, and what they cost. */
export interface CampLevel {
  offers: number;
  /** In percent of the creature's own cost — the screen's unit (native/ui/hire-screen.c). */
  price: number;
}

/** The three levels, in order. A building at level N takes `CAMP_LEVELS[N - 1]`. */
export const CAMP_LEVELS: readonly CampLevel[] = [
  { offers: 1, price: 200 },
  { offers: 2, price: 100 },
  { offers: 3, price: 50 },
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
    '-- A week of a creature: what its dwelling would stock, and never nothing.',
    `function ${n}_Week(creature)`,
    '  local count = H5ECreatureGrowth(creature);',
    '  if count < 1 then',
    '    count = 1;',
    '  end;',
    '  return count;',
    'end;',
    '',
    '-- A new week replaces the stock: ALL THREE of it, whatever the camp is',
    '-- built to. The level only decides how many are open, so paying for one',
    '-- shows one more of what the week already rolled.',
    '--',
    '-- Three DIFFERENT creatures: the screen tells its lines apart by the',
    '-- creature alone, so a second line of the same one is sold out of the',
    '-- first. Drawn without putting back — each draw picks among the indices',
    '-- left and steps over the ones already taken, smallest first.',
    `function ${n}_Roll(town)`,
    `  local size = H5ECreatureCount(${n}_MIN_TIER, ${n}_MAX_TIER);`,
    '  local t1, t2 = 0, 0;',
    '  local i = 1;',
    '  while i <= 3 do',
    '    local creature, count = 0, 0;',
    '    if size >= i then',
    '      local k = random(size - i + 1) + 1;',
    '      if i == 2 and k >= t1 then',
    '        k = k + 1;',
    '      end;',
    '      if i == 3 then',
    '        local lo, hi = t1, t2;',
    '        if hi < lo then',
    '          lo, hi = t2, t1;',
    '        end;',
    '        if k >= lo then',
    '          k = k + 1;',
    '        end;',
    '        if k >= hi then',
    '          k = k + 1;',
    '        end;',
    '      end;',
    '      if i == 1 then',
    '        t1 = k;',
    '      end;',
    '      if i == 2 then',
    '        t2 = k;',
    '      end;',
    `      creature = H5ECreatureAt(k, ${n}_MIN_TIER, ${n}_MAX_TIER);`,
    '      if creature == nil then',
    '        creature = 0;',
    '      else',
    `        count = ${n}_Week(creature);`,
    '      end;',
    '    end;',
    `    ${n}_Set(town, "c" .. i, creature);`,
    `    ${n}_Set(town, "n" .. i, count);`,
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
    '  local p = rule.price;',
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
    // The purchase comes back to THIS camp's function with THIS town's name —
    // the screen's own words, not a global of the script's, so any number of
    // towns with the building share one function and never a variable.
    `  H5EHireScreen("bought=${n}_Bought", "tag=" .. town, c1, n1, p, c2, n2, p, c3, n3, p);`,
    'end;',
    '',
    '-- The purchase, said by the extension while the screen is still up — the',
    '-- screen has already asked what is left, the room in the army and the',
    '-- money, with the price it showed. This is the whole transaction: that',
    '-- price (H5EHirePay takes it the engine\'s way, so the resource bar of the',
    '-- screen hears it — a resource call of the script is a queued command',
    '-- that bar never hears);',
    '-- the creatures; and what is left, written down and told to the screen.',
    '-- The creatures are QUEUED, not added: `AddObjectCreatures` hands the map',
    '-- a command, and the world runs its queue once the screen is closed.',
    `function ${n}_Bought(creature, count, town)`,
    '  if town == nil or town == "" then',
    '    return nil;',
    '  end;',
    '  if H5EHirePay(creature, count) ~= 1 then',
    '    return nil;',
    '  end;',
    '  AddObjectCreatures(town, creature, count);',
    // The FIRST slot of that creature only. The roll draws three different
    // ones, but a stock written down before it did (launch 49) holds the same
    // creature twice, and taking from both sold one purchase twice.
    '  local i = 1;',
    '  while i <= 3 do',
    `    if ${n}_Get(town, "c" .. i) == creature then`,
    `      local left = ${n}_Get(town, "n" .. i) - count;`,
    '      if left < 0 then',
    '        left = 0;',
    '      end;',
    `      ${n}_Set(town, "n" .. i, left);`,
    // The screen's own list, in the same breath: the window reads it again
    // the moment this event returns.
    '      H5EHireLeft(creature, left);',
    '      i = 3;',
    '    end;',
    '    i = i + 1;',
    '  end;',
    'end;',
  ].join('\n');
}
