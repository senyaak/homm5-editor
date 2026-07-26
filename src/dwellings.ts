// A dwelling: the adventure-map building a hero hires creatures from.
//
// Unlike a creature, a dwelling costs the game NOTHING global. There is no
// dwelling reference table, no compiled ceiling and no patched executable: an
// `AdvMapDwellingShared` document is just an object, referenced by the map
// objects that stand on it, and the four fields that make it a dwelling are
//
//   Type        a BUILDING_* value. Reused freely — all seven random dwellings
//               declare BUILDING_ABANDONED_MINE — so a new dwelling does not
//               need a new one, and could not have one anyway.
//   creatures   what it hires. One for a per-tier dwelling; the shipped
//               "military posts" list four, tiers 4 to 7 in one building.
//   guards      WHO guards it. Only who: the format carries no amount and a
//               placed dwelling has no army field either (its fields are
//               Shared/PlayerID/CaptureTrigger/RandomCreatures/creaturesEnabled/
//               RndSource/LinkToPlayer/LinkToTown), so the engine sizes the
//               stacks. Exact numbers need a monster stack on the map instead.
//   RandomType  DWELLING_TYPE_SPECIFIC, or one of the DWELLING_TYPE_RANDOM_nL
//               that resolve to some faction's tier n when the map starts.
//
// Everything else it inherits from AdvMapObjectBaseShared: a model, a footprint
// in tiles, six message files, an icon.
//
// SCALE. A model must be adventure-map art: 1 tile = 2 world units (see
// footprintOf). The town-screen buildings under `Arenas/Town/<race>/` are the
// same buildings at 2-3x that size and standing on a slab of town ground —
// High Cabins is 3x3 tiles on the map and 5.5x10.3 in the town screen — and
// nothing in the format scales a model: neither AdvMapObjectBaseShared nor
// Model declares a scale. Using one means rewriting its geometry.

import { posix } from 'node:path';
import { readGeometryRefFromModelXdb } from './geometry.ts';
import { allFields } from './typespec.ts';
import type { SpecType } from './typespec.ts';

/** The document's own type, and the one whose fields it is written from. */
export const DWELLING_CLASS = 'AdvMapDwellingShared';

/** Every dwelling on the map reports one of these; ours defaults to it. */
const DEFAULT_TYPE = 'BUILDING_ABANDONED_MINE';

/** What the shipped dwellings put in `ObjectTypeFileRef` — the fog-of-war name. */
const VISIBILITY = '/Text/Visibility_Types/Buildings.txt';

/** World units per map tile. Heights use the same scale. */
const UNITS_PER_TILE = 2;

const EOL = '\r\n';

/** A dwelling as the editor takes it in. */
export interface DwellingSpec {
  /** The stem of every file generated for it, and of its folder in the mod. */
  file: string;
  /** What it hires. One creature is a per-tier dwelling; four is a post. */
  creatures: readonly string[];
  /** Who guards it, if anybody. The engine decides how many — see above. */
  guards?: readonly string[];
  /** href of the `(Model)` that stands on the map. Adventure-map art only. */
  model: string;
  /** href of its 128x128 icon. */
  icon?: string;
  /** The `BUILDING_*` it reports as. */
  type?: string;
  /**
   * Its name, and the five other strings a dwelling shows.
   *
   * A value starting with `/` is taken as an href to a text file that already
   * exists — which is how a dwelling gets the game's OWN name for it, in
   * whatever language the install speaks, without shipping a word. Anything
   * else is text the mod ships as its own file.
   */
  name: string;
  description: string;
  firstVisit?: string;
  secondVisit?: string;
  firstVisitNoHire?: string;
  secondVisitNoHire?: string;
  /**
   * What the building BLOCKS, in tiles. Omitted: the whole of its art, which is
   * right for a building that is all building.
   *
   * Big art has a skirt a hero walks over: the shipped Dragon Utopia's model is
   * 8x8 tiles of rock and blocks the 4x4 in the middle of it.
   */
  footprint?: Footprint;
  /**
   * What its art covers — the terrain it replaces with its own ground. Omitted:
   * measured off the model, which is what this is.
   *
   * `null` cuts no hole at all, leaving the terrain to show through and to hide
   * anything below it. Three of the shipped dwellings are written this way, and a
   * baked town building has to be: its pedestal is under the map.
   */
  ground?: Footprint | null;
  /** hrefs for the flourishes: particles, and an animation for a moving model. */
  effect?: string;
  animSet?: string;
  /**
   * Bring a TOWN-SCREEN building down to the map, at this many tiles across.
   *
   * The town screen is where the real per-tier buildings are — Stonehenge, the
   * Unicorn Glade, the Treant Arches, the Dragon Altar, each in a basic and an
   * upgraded version, under `Arenas/Town/<race>/<name>_u1r0.xdb` — and the
   * adventure map has no art for any of them. They cannot be used as they are:
   * they are two to three times map scale AND stand where they sit in the town
   * scene (the Unicorn Glade's centre is at 280, 328), so a model dropped on the
   * map is both giant and nowhere near the tile that placed it.
   *
   * With this set the mod carries its own copy, moved to the origin and scaled to
   * the size asked for. The footprint is then measured off THAT, so it is the
   * size the building really is.
   */
  bake?: {
    /** How many tiles across the result should be, at its widest. */
    tiles: number;
    /**
     * Where the ground is in the SOURCE model's own coordinates, when the
     * measurement gets it wrong. Everything below goes under the map, which the
     * terrain then hides. Omitted: found from the model — see groundLevel.
     */
    ground?: number;
  };
}

/** How many tiles a dwelling covers. */
export interface Footprint {
  w: number;
  h: number;
}

/** Where a dwelling's files sit inside a mod. */
export interface DwellingPaths {
  dir: string;
  shared: string;
  link: string;
  /** Where a baked model's own art goes, keeping its original folder structure. */
  art: string;
  /** One per message that is text rather than a reference. */
  text: Record<MessageSlot, string>;
}

/** The six messages, in the order `messagesFileRef` lists them. */
export const MESSAGE_SLOTS = [
  'name', 'description', 'firstVisit', 'secondVisit', 'firstVisitNoHire', 'secondVisitNoHire',
] as const;
export type MessageSlot = typeof MESSAGE_SLOTS[number];

/**
 * Where the editor's object palette looks for dwellings.
 *
 * Under `Objects-Dwellings/` because the Filter dropdown's groups are folder
 * prefixes read from `Editor/MapFilters.xml`, which no mod can add to: an entry
 * outside a known prefix is filed under "Other" instead of with the dwellings.
 */
const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Objects-Dwellings/Units';

export function dwellingPaths(spec: DwellingSpec): DwellingPaths {
  const dir = `Dwellings/${spec.file}`;
  const text = {} as Record<MessageSlot, string>;
  for (const slot of MESSAGE_SLOTS) {
    text[slot] = `${dir}/${spec.file}_${slot[0]!.toUpperCase()}${slot.slice(1)}.txt`;
  }
  return {
    dir,
    shared: `${dir}/${spec.file}.(${DWELLING_CLASS}).xdb`,
    link: `${LINK_DIR}/${spec.file}.xdb`,
    art: `${dir}/art`,
    text,
  };
}

/** True when a message is a reference to a text file rather than text. */
export const isRef = (message: string): boolean => message.startsWith('/');

/**
 * The footprint a model needs, measured off its geometry's bounding box.
 *
 * A tile is two world units, so a 6.00 x 6.07 model is 3x3 tiles — which is
 * exactly what the shipped High Cabins declares, and the same arithmetic gets
 * the Sylvan Military Post's 4x4 from its 8.00 x 8.08. Measuring beats guessing
 * because a footprint that does not match the art is a building a hero walks
 * through, or an entrance nothing can reach.
 */
export function footprintOf(model: string, read: (rel: string) => string | null): Footprint | null {
  const path = refPath(model);
  const xml = read(path);
  if (!xml) return null;
  const got = readGeometryRefFromModelXdb(xml, (href) => read(
    href.startsWith('/') ? refPath(href) : posix.join(posix.dirname(path), refPath(href)),
  ));
  if (!got) return null;
  const tiles = (size: number): number => Math.max(1, Math.round(Math.abs(size) / UNITS_PER_TILE));
  return { w: tiles(got.bbox.sx), h: tiles(got.bbox.sy) };
}

/**
 * The tiles a footprint becomes, in the shipped objects' own convention.
 *
 * Both areas are CENTRED on the object's own origin, which is where its model's
 * centre sits: a run of n tiles starts at -floor((n-1)/2), so 3 covers -1..1,
 * 4 covers -1..2 and 8 covers -3..4. Getting that wrong does not merely misplace
 * a tile — the art and the tiles it blocks drift apart.
 *
 * The ENTRANCE, where the hero stands to visit, is the middle of the top row.
 * Which row depends on whether the art is bigger than the building:
 *
 *   all building (High Cabins: 3x3 art, 3x3 blocked) — the entrance is one of
 *     the building's own tiles, left unblocked. 8 blocked of 9, active (0,-1).
 *   art with a skirt (Dragon Utopia: 8x8 of rock, 4x4 blocked) — everything the
 *     building covers is blocked and the entrance is the tile above it, standing
 *     on the skirt. 16 blocked, 64 hole, and (0,-2) is one of its own entrances.
 *
 * The possession marker, the flag a captured dwelling flies, sits at (0,0).
 */
export function tilesOf(blocked: Footprint, ground: Footprint = blocked): {
  blocked: Tile[]; hole: Tile[]; active: Tile[];
} {
  const from = (n: number): number => -Math.floor((n - 1) / 2);
  const area = (f: Footprint): Tile[] => {
    const out: Tile[] = [];
    for (let y = from(f.h); y < from(f.h) + f.h; y++) {
      for (let x = from(f.w); x < from(f.w) + f.w; x++) out.push({ x, y });
    }
    return out;
  };
  const hole = area(ground);
  const core = area(blocked);
  const top = from(blocked.h);
  const skirted = ground.w > blocked.w || ground.h > blocked.h;
  const active: Tile[] = [{ x: 0, y: skirted ? top - 1 : top }];
  const isActive = (t: Tile): boolean => active.some((a) => a.x === t.x && a.y === t.y);
  return { blocked: core.filter((t) => !isActive(t)), hole, active };
}

export interface Tile {
  x: number;
  y: number;
}

/**
 * Write the dwelling document.
 *
 * The field ORDER comes from types.xml rather than from this file: a shipped
 * dwelling carries all 24 fields of `AdvMapDwellingShared` and its four bases in
 * declaration order, and hardcoding that order here would be one more thing to
 * keep in step with the game. Fields we say nothing about are written empty,
 * which is what the shipped documents do too.
 */
export function dwellingDoc(
  spec: DwellingSpec,
  p: DwellingPaths,
  types: Map<string, SpecType>,
  measured: Footprint,
): string {
  const t = tilesOf(spec.footprint ?? measured, spec.ground === null ? undefined : spec.ground ?? measured);
  if (spec.ground === null) t.hole.length = 0;
  // A message the spec leaves out is left out of the list too, rather than
  // pointing at a file that is not there.
  const messages: string[] = [];
  for (const slot of MESSAGE_SLOTS) {
    const message = spec[slot];
    if (message) messages.push(isRef(message) ? message : `/${p.text[slot]}`);
  }

  const values: Record<string, string[]> = {
    Model: [href('Model', spec.model, 'Model')],
    AnimSet: [href('AnimSet', spec.animSet, 'AnimSet')],
    blockedTiles: [list('blockedTiles', t.blocked.map(tile))],
    holeTiles: [list('holeTiles', t.hole.map(tile))],
    activeTiles: [list('activeTiles', t.active.map(tile))],
    passableTiles: ['<passableTiles/>'],
    PossessionMarkerTile: [`<PossessionMarkerTile>${EOL}\t\t<x>0</x>${EOL}\t\t<y>0</y>${EOL}\t</PossessionMarkerTile>`],
    Effect: [href('Effect', spec.effect, 'Effect')],
    EffectWhenOwned: [href('EffectWhenOwned', spec.effect, 'Effect')],
    messagesFileRef: [list('messagesFileRef', messages.map((h) => `<Item href="${h}"/>`))],
    WaterBased: ['<WaterBased>false</WaterBased>'],
    ApplyHeroTrace: ['<ApplyHeroTrace>false</ApplyHeroTrace>'],
    SoundEffect: ['<SoundEffect/>'],
    flybyMessageFileRef: ['<flybyMessageFileRef href=""/>'],
    ObjectTypeFileRef: [`<ObjectTypeFileRef href="${VISIBILITY}"/>`],
    TerrainAligned: ['<TerrainAligned>false</TerrainAligned>'],
    FlyPassable: ['<FlyPassable>true</FlyPassable>'],
    AdventureSoundEffect: ['<AdventureSoundEffect/>'],
    RazedStatic: ['<RazedStatic/>'],
    Icon128: [href('Icon128', spec.icon, 'Texture')],
    Type: [`<Type>${spec.type ?? DEFAULT_TYPE}</Type>`],
    guards: [list('guards', (spec.guards ?? []).map((c) => `<Item>${c}</Item>`))],
    creatures: [list('creatures', spec.creatures.map((c) => `<Item>${c}</Item>`))],
    RandomType: ['<RandomType>DWELLING_TYPE_SPECIFIC</RandomType>'],
  };

  const fields = allFields(types, DWELLING_CLASS);
  if (!fields.length) throw new Error(`types.xml declares no ${DWELLING_CLASS}`);
  const body: string[] = [];
  for (const f of fields) body.push(...(values[f.name] ?? [`<${f.name}/>`]));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${DWELLING_CLASS}>`,
    ...body.map((line) => `\t${line}`),
    `</${DWELLING_CLASS}>`,
  ].join(EOL) + EOL;
}

/** The palette entry: a link file pointing at our dwelling. */
export function dwellingLink(p: DwellingPaths, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.shared}#xpointer(/${DWELLING_CLASS})"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
  ].join(EOL) + `${EOL}</AdvMapObjectLink>${EOL}`;
}

/** The data path an href names: no fragment, no leading slash. */
export function refPath(href: string): string {
  return href.split('#')[0]!.replace(/^\/+/, '');
}

/** `<Field href="…#xpointer(/Type)"/>`, or an empty field when there is nothing. */
function href(field: string, value: string | undefined, type: string): string {
  if (!value) return `<${field}/>`;
  const full = value.includes('#') ? value : `${value}#xpointer(/${type})`;
  return `<${field} href="${full}"/>`;
}

/** A list field: empty when it has no items, one indented line each when it has. */
function list(field: string, items: string[]): string {
  if (!items.length) return `<${field}/>`;
  return [`<${field}>`, ...items.map((i) => `\t\t${i}`), `\t</${field}>`].join(EOL);
}

function tile(t: Tile): string {
  return [`<Item>`, `\t\t\t<x>${t.x}</x>`, `\t\t\t<y>${t.y}</y>`, `\t\t</Item>`].join(EOL);
}
