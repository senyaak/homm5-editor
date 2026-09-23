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
// WHERE THE STOCK LIVES. In the map's game variables, which a save carries, and
// THIS SCRIPT writes them — the extension keeps no stock of its own. It only
// opens the screen and says what happened in it: every purchase comes back as
// `H5ECampBought(town, creature, count)` while the screen is still up, which is
// what makes the arithmetic the script's and lets a save taken in the town have
// the true numbers. Nothing here waits for a thread to be resumed; under a town
// screen the map's scheduler does not run.
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
    '-- One creature of the tiers this camp draws from, and how many of it a week brings.',
    `function ${spec.lua}_One(pool, poolSize)`,
    '  local at = random(poolSize) + 1;',
    '  local creature = pool[at];',
    '  local count = H5ECreatureGrowth(creature);',
    '  if count < 1 then',
    '    count = 1;',
    '  end;',
    '  return creature, count;',
    'end;',
    '',
    '-- A new week replaces the stock, and the script writes it down.',
    `function ${spec.lua}_Roll(town, offers)`,
    `  local pool = { H5ECreatures(${spec.lua}_MIN_TIER, ${spec.lua}_MAX_TIER) };`,
    // No `getn` in this engine's Lua either, so the pool is counted by walking it.
    '  local poolSize = 0;',
    '  while pool[poolSize + 1] ~= nil do',
    '    poolSize = poolSize + 1;',
    '  end;',
    '  if poolSize < 1 then',
    '    return nil;',
    '  end;',
    '  local c1, n1 = 0, 0;',
    '  local c2, n2 = 0, 0;',
    '  local c3, n3 = 0, 0;',
    `  c1, n1 = ${spec.lua}_One(pool, poolSize);`,
    '  if offers > 1 then',
    `    c2, n2 = ${spec.lua}_One(pool, poolSize);`,
    '  end;',
    '  if offers > 2 then',
    `    c3, n3 = ${spec.lua}_One(pool, poolSize);`,
    '  end;',
    `  ${spec.lua}_Set(town, "c1", c1);`,
    `  ${spec.lua}_Set(town, "n1", n1);`,
    `  ${spec.lua}_Set(town, "c2", c2);`,
    `  ${spec.lua}_Set(town, "n2", n2);`,
    `  ${spec.lua}_Set(town, "c3", c3);`,
    `  ${spec.lua}_Set(town, "n3", n3);`,
    'end;',
    '',
    '-- The click: a stock for this week if there is none, then the screen.',
    `function ${spec.lua}(town)`,
    `  local level = GetTownBuildingLevel(town, ${spec.building});`,
    `  local rule = ${spec.lua}_LEVELS[level];`,
    '  if rule == nil then',
    '    return nil;',
    '  end;',
    '  local week = GetDate(WEEK) + GetDate(MONTH) * 4;',
    `  if ${spec.lua}_Get(town, "week") ~= week then`,
    `    ${spec.lua}_Set(town, "week", week);`,
    `    ${spec.lua}_Roll(town, rule.offers);`,
    '  end;',
    '  H5ECampScreen(town,',
    `    ${spec.lua}_Get(town, "c1"), ${spec.lua}_Get(town, "n1"),`,
    `    ${spec.lua}_Get(town, "c2"), ${spec.lua}_Get(town, "n2"),`,
    `    ${spec.lua}_Get(town, "c3"), ${spec.lua}_Get(town, "n3"));`,
    'end;',
    '',
    '-- A purchase, said by the extension while the screen is still up. The',
    '-- creature says which offer it was; what is left is written down at once,',
    '-- so a save taken in the town has it.',
    'function H5ECampBought(town, creature, count)',
    '  local i = 1;',
    '  while i <= 3 do',
    `    if ${spec.lua}_Get(town, "c" .. i) == creature then`,
    `      local left = ${spec.lua}_Get(town, "n" .. i) - count;`,
    '      if left < 0 then',
    '        left = 0;',
    '      end;',
    `      ${spec.lua}_Set(town, "n" .. i, left);`,
    '    end;',
    '    i = i + 1;',
    '  end;',
    'end;',
  ].join('\n');
}
