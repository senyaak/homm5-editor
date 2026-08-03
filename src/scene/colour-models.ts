// Which body a hero wears — the owner's colour, not a colourless default.
//
// A `<Character>` names a `<Model>` and, for the eight hero classes plus the
// caravan and the entry point, a `<ColourModels>` list beside it:
//
//     <Model href="/_(Model)/Heroes/Knight.(Model).xdb"/>
//     <ColourModels>
//       <Item href="/_(Model)/Heroes/Knight_White.xdb"/>
//       <Item href="/_(Model)/Heroes/Knight_Red.xdb"/>
//       <Item href="/_(Model)/Heroes/Knight_Blue.xdb"/>
//       …nine of them
//
// The nine are not a palette applied to one mesh — they are nine whole models,
// each naming its own flag material and its own flag texture
// (`Knight-flag_Blue` → `Flags/Heroes/Haven/Flag_dark_blue.dds`). The top-level
// `<Model>` is the WHITE one, so drawing it gives every hero of every player a
// white banner. Under a warm preset that reads as a washed-out grey-blue, which
// is exactly what it looked like beside the game's bright blue.
//
// THE INDEX IS THE PLAYER-COLOUR ENUM, and the data says so twice: `Types.xml`
// declares nine `PCOLOR_*` values and every one of the 17 characters that has
// this list has exactly nine entries, in the same order — NEUTRAL/White, RED,
// BLUE, GREEN, YELLOW, ORANGE, TEAL, PURPLE, BROWN/Tan. Seven of the nine names
// match outright; the two that do not are synonyms for the same colour.

/** The `PCOLOR_*` values in declaration order — the order `<ColourModels>` is in. */
export const PLAYER_COLOURS = [
  'PCOLOR_NEUTRAL', 'PCOLOR_RED', 'PCOLOR_BLUE', 'PCOLOR_GREEN', 'PCOLOR_YELLOW',
  'PCOLOR_ORANGE', 'PCOLOR_TEAL', 'PCOLOR_PURPLE', 'PCOLOR_BROWN',
] as const;

/**
 * The colour a `PLAYER_n` flies, given the map's own player table.
 *
 * A map assigns colours as it likes — `A2M1` reads blue, teal, red, green — so
 * the table wins where it says anything. Where it says `PCOLOR_NEUTRAL`, which
 * is every player of every dialog-scene ARENA (all eight, all inactive), the
 * player's own number is what is left: PLAYER_1 red, PLAYER_2 blue, and so on
 * down the enum. That is the reading the game's own picture agrees with —
 * C1M1's opening stages Agrael as PLAYER_1 and Isabell as PLAYER_2 on an arena
 * that names no colours at all, and in the game she carries the blue banner.
 */
export function colourOfPlayer(playerId: string | null, table: string[] = []): string {
  const n = Number.parseInt(/PLAYER_(\d+)/.exec(playerId ?? '')?.[1] ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 'PCOLOR_NEUTRAL';
  const named = table[n - 1];
  if (named && named !== 'PCOLOR_NEUTRAL') return named;
  return PLAYER_COLOURS[n] ?? 'PCOLOR_NEUTRAL';
}

/**
 * The model href a character wears in that colour, or nothing if it has no
 * coloured bodies (which is all but 17 of the 6643 shipped characters).
 */
export function colourModelHref(characterXml: string, colour: string): string | null {
  const block = characterXml.match(/<ColourModels>([\s\S]*?)<\/ColourModels>/)?.[1];
  if (!block) return null;
  const items = [...block.matchAll(/<Item href="([^"]+)"/g)].map((m) => m[1]!);
  const i = PLAYER_COLOURS.indexOf(colour as typeof PLAYER_COLOURS[number]);
  // A list that is not the nine we measured is one we do not understand; the
  // colourless model is wrong but harmless, and guessing an index into it is
  // neither.
  if (i < 0 || items.length !== PLAYER_COLOURS.length) return null;
  return items[i] ?? null;
}
