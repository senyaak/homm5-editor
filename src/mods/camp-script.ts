// The refugee camp's Lua: a building of a faction that hires whatever it rolled.
//
// The engine's own camp is a POOL of 38 creatures written into
// `MapObjects/Special/RefugeeCamp.xdb`, rolled once a week, sold through the
// hire screen (docs/FACTION_PLAN.md §2b). A camp of ours is the same idea with
// none of the data: the roll is over every creature the game has — the mod's
// own included — because the extension reads the creature table to its ceiling
// (`H5ECreatures`), and the screen is the game's own over a source of ours
// (`H5ECampScreen`, native/faction/refugee-camp.c).
//
// WHERE THE STOCK LIVES. In the map's game variables, which a save carries and
// the DLL's memory does not. One variable per number, rather than one string
// parsed back — a stock is six numbers and a week, and a format is a thing to
// get wrong in a dialect with no tests.
//
// WHY THE WEEK IS CHECKED ON THE CLICK, not on a new-day trigger. The stock is
// only ever looked at through the building, so rolling when it is opened is the
// same stock the player would have seen, and it needs no list of the towns on
// the map — the click brings the town's name. A week that has already been
// rolled is read back, so two clicks in a week show one stock.
//
// THE LEVELS. The building has three, and the level decides HOW MANY offers
// there are and what the price is worth: one at double, two at the ordinary
// price, three at half (Senya, 2026-09-22). The price is the creature's own
// until the extension can multiply it — a term of its own, next — so the
// multiplier is written down here and does nothing yet.

/** What a camp of that level offers: how many creatures, and the price they go at. */
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

export interface CampScript {
  /** The building whose click opens it (`TB_SPECIAL_1`…), as the button's Lua is named after. */
  lua: string;
  /** The building the level is read from — the same one. */
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
 * no `false` here — see docs/NAMES_AND_SCRIPTING.md and src/script/lua-lint.ts).
 */
export function campScript(spec: CampScript): string {
  const min = spec.minTier ?? 1;
  const max = spec.maxTier ?? 7;
  const levels = CAMP_LEVELS.map((l) => `{ offers = ${l.offers}, price = ${l.price} }`).join(', ');
  return [
    `-- The refugee camp of ${spec.lua}: what it sells, rolled once a week.`,
    `${spec.lua}_LEVELS = { ${levels} };`,
    `${spec.lua}_MIN_TIER = ${min};`,
    `${spec.lua}_MAX_TIER = ${max};`,
    '',
    '-- One number of the town\'s stock, and where it is kept.',
    `function ${spec.lua}_Var(town, what)`,
    `  return "h5e.${spec.lua}." .. town .. "." .. what;`,
    'end;',
    '',
    `function ${spec.lua}_Get(town, what)`,
    `  local said = GetGameVar(${spec.lua}_Var(town, what));`,
    // NO `tonumber`: this engine registers almost none of the standard library
    // and that is one of the names it does not have (src/script/lua-lint.ts).
    // A variable never set answers with the empty string — what the shipped
    // scripts test for — and arithmetic on a numeric string is the dialect's
    // own coercion.
    '  if said == "" then',
    '    return 0;',
    '  end;',
    '  return said + 0;',
    'end;',
    '',
    `function ${spec.lua}_Set(town, what, value)`,
    `  SetGameVar(${spec.lua}_Var(town, what), value);`,
    'end;',
    '',
    '-- A creature of the tiers this camp draws from, and how many of it a week brings.',
    `function ${spec.lua}_Roll(pool, poolSize)`,
    '  local at = random(poolSize) + 1;',
    '  local creature = pool[at];',
    '  local count = H5ECreatureGrowth(creature);',
    '  if count < 1 then',
    '    count = 1;',
    '  end;',
    '  return creature, count;',
    'end;',
    '',
    '-- The week this town was last rolled for; a new one replaces the stock.',
    `function ${spec.lua}_Stock(town, offers)`,
    '  local week = GetDate(WEEK) + GetDate(MONTH) * 4;',
    `  if ${spec.lua}_Get(town, "week") == week then`,
    '    return nil;',
    '  end;',
    `  local pool = { H5ECreatures(${spec.lua}_MIN_TIER, ${spec.lua}_MAX_TIER) };`,
    // The same again: no `getn` here either, so the pool is counted by walking it.
    '  local poolSize = 0;',
    '  while pool[poolSize + 1] ~= nil do',
    '    poolSize = poolSize + 1;',
    '  end;',
    '  if poolSize < 1 then',
    '    return nil;',
    '  end;',
    '  local i = 1;',
    '  while i <= 3 do',
    '    local creature = 0;',
    '    local count = 0;',
    '    if i <= offers then',
    `      creature, count = ${spec.lua}_Roll(pool, poolSize);`,
    '    end;',
    `    ${spec.lua}_Set(town, "c" .. i, creature);`,
    `    ${spec.lua}_Set(town, "n" .. i, count);`,
    '    i = i + 1;',
    '  end;',
    `  ${spec.lua}_Set(town, "week", week);`,
    'end;',
    '',
    '-- The screen, and what is left of the stock once it closes.',
    `function ${spec.lua}(town)`,
    `  local level = GetTownBuildingLevel(town, ${spec.building});`,
    `  local rule = ${spec.lua}_LEVELS[level];`,
    '  if rule == nil then',
    '    return nil;',
    '  end;',
    `  ${spec.lua}_Stock(town, rule.offers);`,
    '  H5ECampScreen(town,',
    `    ${spec.lua}_Get(town, "c1"), ${spec.lua}_Get(town, "n1"),`,
    `    ${spec.lua}_Get(town, "c2"), ${spec.lua}_Get(town, "n2"),`,
    `    ${spec.lua}_Get(town, "c3"), ${spec.lua}_Get(town, "n3"));`,
    '  while H5ECampOpen() == 1 do',
    '    sleep(1);',
    '  end;',
    '  local c1, n1, c2, n2, c3, n3 = H5ECampOffers(town);',
    `  ${spec.lua}_Set(town, "c1", c1);`,
    `  ${spec.lua}_Set(town, "n1", n1);`,
    `  ${spec.lua}_Set(town, "c2", c2);`,
    `  ${spec.lua}_Set(town, "n2", n2);`,
    `  ${spec.lua}_Set(town, "c3", c3);`,
    `  ${spec.lua}_Set(town, "n3", n3);`,
    'end;',
  ].join('\n');
}
