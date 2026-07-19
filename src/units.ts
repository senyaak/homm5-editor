// The one number that relates the game's two coordinate systems.
//
// Kept in its own module because both sides need it and they cannot share
// much else: scene.ts reads files and so never enters the renderer bundle.

/**
 * World units per map tile: the spacing of the tile grid inside the coordinate
 * space the game's own data is authored in.
 *
 * Model geometry, terrain heights and particle bounds are all in world units.
 * Object positions and the terrain grid are indexed in TILES — a 320x320 map
 * places objects at 1..318. Nothing in the data layer converts between them:
 * the scene is handed over exactly as stored, and the RENDERER multiplies tile
 * indices by this when it lays out its world. Everything drawn then shares one
 * space, and the numbers held in memory are the numbers in the file.
 *
 * Measured over the 396 shared objects that declare both a `blockedTiles`
 * footprint and a model `<Size>`: across 792 samples the 25th percentile and
 * the median are both exactly 2.000, and 67% land within 0.2 of 2.0. The upper
 * tail (p75 = 2.202) is expected, since `<Size>` is a bounding box and a tree's
 * canopy overhangs the tiles it blocks. Mountain10x10 is the clean case:
 * `<Size>` 20x20 against a `blockedTiles` span of exactly 10x10.
 *
 * The heightmap agrees. On Senya's lightly-sculpted map 12 the base ground sits
 * at 2.000 (83% of vertices), water at 0.000, and every raise he made landed on
 * 4.000, 6.000, 8.000, 10.000 — one editor step is 2.000, exactly one tile.
 * Shipped maps are too smoothed to show it (1702 and 4446 distinct heights
 * against map 12's 66).
 *
 * Note that only X and Y are tile-indexed. Heights are already world units, so
 * anything converting a grid position multiplies X and Y and leaves Z alone.
 */
export const UNITS_PER_TILE = 2;
