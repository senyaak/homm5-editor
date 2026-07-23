// The town-specialization bonuses — the effect a TownSpecialization grants.
//
// A closed set the game defines but does not declare in data/types.xml, so it is
// gathered from the 281 shipped `GameMechanics/TownSpecialization/**.xdb` files
// (every distinct <Bonus>). The labels are ours, for the picker; the ids are what
// the file stores. See docs — a specialization is a named town bonus.

export interface TownBonus { id: string; label: string; }

export const TOWN_BONUSES: TownBonus[] = [
  { id: 'TOWN_NO_BONUS', label: 'No bonus' },
  { id: 'TOWN_BONUS_TIER1_CREATURE', label: 'Tier 1 creature growth' },
  { id: 'TOWN_BONUS_TIER2_CREATURE', label: 'Tier 2 creature growth' },
  { id: 'TOWN_BONUS_TIER3_CREATURE', label: 'Tier 3 creature growth' },
  { id: 'TOWN_BONUS_TIER4_CREATURE', label: 'Tier 4 creature growth' },
  { id: 'TOWN_BONUS_250_GOLD', label: '+250 gold/day' },
  { id: 'TOWN_BONUS_EXTRA_WOOD', label: 'Extra wood' },
  { id: 'TOWN_BONUS_EXTRA_ORE', label: 'Extra ore' },
  { id: 'TOWN_BONUS_GEMS', label: 'Gems' },
  { id: 'TOWN_BONUS_CRYSTALS', label: 'Crystals' },
  { id: 'TOWN_BONUS_SULFUR', label: 'Sulfur' },
  { id: 'TOWN_BONUS_MERCURY', label: 'Mercury' },
  { id: 'TOWN_BONUS_MARKETPLACE', label: 'Marketplace' },
  { id: 'TOWN_BONUS_THIEVES_GUILD', label: 'Thieves guild' },
  { id: 'TOWN_BONUS_HEROES', label: 'Extra heroes' },
  { id: 'TOWN_BONUS_WALLS', label: 'Walls' },
  { id: 'TOWN_BONUS_TOWERS', label: 'Towers' },
  { id: 'TOWN_BONUS_BALLISTA', label: 'Ballista' },
  { id: 'TOWN_BONUS_AMMO_CART', label: 'Ammo cart' },
  { id: 'TOWN_BONUS_FIRST_AID_TENT', label: 'First aid tent' },
  { id: 'TOWN_BONUS_SHIPS', label: 'Ships' },
  { id: 'TOWN_BONUS_PLUS_MORALE', label: '+Morale' },
  { id: 'TOWN_BONUS_MINUS_MORALE', label: '-Morale' },
  { id: 'TOWN_BONUS_PLUS_LUCK', label: '+Luck' },
  { id: 'TOWN_BONUS_MINUS_LUCK', label: '-Luck' },
  { id: 'TOWN_BONUS_PLUS_DEFENCE', label: '+Defence' },
  { id: 'TOWN_BONUS_PLUS_DEFENCE_2', label: '+Defence (II)' },
  { id: 'TOWN_BONUS_PLUS_DEFENCE_OFFENCE', label: '+Defence & offence' },
  { id: 'TOWN_BONUS_PLUS_DEFENCE_OFFENCE_2', label: '+Defence & offence (II)' },
  { id: 'TOWN_BONUS_MINUS_OFFENCE', label: '-Offence' },
  { id: 'TOWN_BONUS_MINUS_OFFENCE_2', label: '-Offence (II)' },
  { id: 'TOWN_BONUS_MINUS_DEFENCE_OFFENCE', label: '-Defence & offence' },
  { id: 'TOWN_BONUS_MINUS_DEFENCE_OFFENCE_2', label: '-Defence & offence (II)' },
  { id: 'TOWN_BONUS_ELVEN_CAPITAL', label: 'Elven capital' },
];

/** Every valid bonus id, for validation. */
export const TOWN_BONUS_IDS = new Set(TOWN_BONUSES.map((b) => b.id));
