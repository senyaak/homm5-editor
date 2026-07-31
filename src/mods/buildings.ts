// A building on the adventure map: the mine, the dwelling, the Witch Hut, the
// Sphinx — anything a hero walks up to. See docs/mapPlaceables/buildings/.
//
// SELF-CONTAINED, ALWAYS. A building of ours points at nothing of the game's:
// its model, geometry, materials, textures, animations, effects, sounds, icon
// and every line of text it shows are COPIES living under its own folder in the
// mod (copyArt, src/mods/mod-art.ts). Borrowing a shipped document would be
// smaller and would make the building unchangeable — recolouring a texture or
// swapping a mesh would be editing the game's own file, which is the one thing
// a mod may not do.
//
// TWO WAYS A DOCUMENT IS BOUND TO A BEHAVIOUR, and they do not substitute for
// each other (measured in the game, see the doc):
//
//   the class carries <Type>   — the value picks one of the 128 compiled
//                                behaviours (AdvMapBuildingShared and eight
//                                more classes);
//   the class IS the behaviour — no <Type> at all, and putting that value on a
//                                generic document gets an object that answers
//                                "unknown object" (Prison, Sign, Sphinx, …).
//
// So the CLASS is the first choice a person makes, and everything else follows
// from it. What each class adds beyond the common base is not written out here
// either — it is read from the game's own `types.xml` (extraFields), so this
// file cannot drift from the spec.

import { allFields } from '../schema/typespec.ts';
import type { SpecType } from '../schema/typespec.ts';
import { footprintOf, refPath, tilesOf } from './footprint.ts';
import type { Footprint, Tile } from './footprint.ts';

export { footprintOf, refPath, tilesOf };
export type { Footprint, Tile };

const EOL = '\r\n';

/** The base every placed object shares; a class's own fields are what it adds. */
export const BASE_CLASS = 'AdvMapObjectBaseShared';

/** What the fog-of-war calls one of these. */
const VISIBILITY = '/Text/Visibility_Types/Buildings.txt';

/**
 * The classes a building can be, and what each is for.
 *
 * `placed` is the map-side element a placement of it uses — the editor needs it
 * to put one on a map, and it is not derivable from the class name in every
 * case (`AdvMapAbanMineShared` places as `AdvMapAbanMine`, but the shared name
 * is not always the placed name plus "Shared" in the other direction).
 */
export interface BuildingClass {
  /** Root element of the definition document. */
  shared: string;
  /** Root element of the `<Item>` body on a map. */
  placed: string;
  /** What to call it in a list of classes. */
  label: string;
  /** One line on what this class is, for the person choosing it. */
  about: string;
}

export const BUILDING_CLASSES: readonly BuildingClass[] = [
  {
    shared: 'AdvMapBuildingShared', placed: 'AdvMapBuilding', label: 'Building',
    about: 'the plain one: 77 of the behaviours, from Windmill to Dragon Utopia',
  },
  {
    shared: 'AdvMapDwellingShared', placed: 'AdvMapDwelling', label: 'Dwelling',
    about: 'hires creatures — the only class that names them',
  },
  {
    shared: 'AdvMapMineShared', placed: 'AdvMapMine', label: 'Mine',
    about: 'a resource a day, captured and held',
  },
  {
    shared: 'AdvMapTentShared', placed: 'AdvMapTent', label: 'Tent',
    about: 'border guard and keymaster: the colour is the key',
  },
  {
    shared: 'AdvMapGarrisonShared', placed: 'AdvMapGarrison', label: 'Garrison',
    about: 'an army that blocks the road',
  },
  {
    shared: 'AdvMapHillFortShared', placed: 'AdvMapHillFort', label: 'Hill fort',
    about: 'upgrades creatures in the visiting army',
  },
  {
    shared: 'AdvMapCartographerShared', placed: 'AdvMapCartographer', label: 'Cartographer',
    about: 'sells the map, for a price the placement sets',
  },
  {
    shared: 'AdvMapShrineShared', placed: 'AdvMapShrine', label: 'Shrine',
    about: 'teaches a spell; the class bounds the circle, the placement picks the spell',
  },
  {
    shared: 'AdvMapAbanMineShared', placed: 'AdvMapAbanMine', label: 'Abandoned mine',
    about: 'undead inside, and the resource is unknown until it is cleared',
  },
  {
    shared: 'AdvMapDwarvenWarrenShared', placed: 'AdvMapDwarvenWarren', label: 'Dwarven warren',
    about: 'a mine with a garrison: one random resource a day',
  },
  {
    shared: 'AdvMapPrisonShared', placed: 'AdvMapPrison', label: 'Prison',
    about: 'releases a captive hero into your service',
  },
  {
    shared: 'AdvMapSeerHutShared', placed: 'AdvMapSeerHut', label: 'Seer hut',
    about: 'a quest and its reward',
  },
  {
    shared: 'AdvMapSphinxShared', placed: 'AdvMapSphinx', label: 'Sphinx',
    about: 'a riddle: right rewards, wrong punishes',
  },
  {
    shared: 'AdvMapShipyardShared', placed: 'AdvMapShipyard', label: 'Shipyard',
    about: 'builds ships on the tile the placement names',
  },
  {
    shared: 'AdvMapSignShared', placed: 'AdvMapSign', label: 'Sign',
    about: 'a signpost carrying one message',
  },
];

// NOT OFFERED: `AdvMapStandShared`. Its one shipped object is Tieru's Hut, a
// prop a campaign script switches between states — it names itself nowhere, does
// nothing on its own, and what anybody actually wants from it is a building plus
// a Lua trigger on the visit, which every class above already gives them. So the
// game declares sixteen classes and the editor offers fifteen.

export const buildingClass = (shared: string): BuildingClass | null =>
  BUILDING_CLASSES.find((c) => c.shared === shared) ?? null;

/**
 * The fields this class adds on top of the shared base, from the game's spec.
 *
 * This is what a form for the class has to offer beyond the common art and
 * texts: `creatures`/`guards`/`RandomType` for a dwelling, `Level` and the runic
 * pair for a shrine, `Color` for a tent, `GuardsVariants` for an abandoned mine,
 * `States`/`StateChanges` for a stand — and `Type` for the nine classes that
 * choose a behaviour rather than being one.
 */
export function extraFields(types: Map<string, SpecType>, shared: string): string[] {
  const base = new Set(allFields(types, BASE_CLASS).map((f) => f.name));
  return allFields(types, shared).map((f) => f.name).filter((n) => !base.has(n));
}

/** Whether this class picks a behaviour with `<Type>`, or is one. */
export const takesType = (types: Map<string, SpecType>, shared: string): boolean =>
  extraFields(types, shared).includes('Type');

/**
 * Which of the class's own fields hold a LIST, per the spec.
 *
 * The difference is not cosmetic and cannot be guessed from the value: a
 * dwelling's `creatures` written as text is `<creatures>CREATURE_X</creatures>`
 * where the engine expects `<Item>`s, and it hires nothing. Arrays are declared
 * anonymously in types.xml and collected under `array:<ptr>` (src/schema/
 * typespec.ts), so a field is a list exactly when its type is one of those.
 */
export function listFields(types: Map<string, SpecType>, shared: string): string[] {
  const base = new Set(allFields(types, BASE_CLASS).map((f) => f.name));
  return allFields(types, shared)
    .filter((f) => !base.has(f.name) && types.has(`array:${f.type}`))
    .map((f) => f.name);
}

/**
 * The class's own fields a building cannot do without.
 *
 * Not "everything the spec declares": a tent without a `Color` is a border guard
 * of no colour, which is a thing the game will happily show. This is the shorter
 * list of fields whose emptiness makes the building POINTLESS — a dwelling with
 * no creatures hires nothing, and that is not a building, it is a decoration
 * somebody meant as a building.
 */
export const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  AdvMapDwellingShared: ['creatures'],
};

export const requiredFields = (shared: string): readonly string[] => REQUIRED_FIELDS[shared] ?? [];

/**
 * The messages a class shows, in the order `messagesFileRef` lists them.
 *
 * Read off the shipped documents of each class. The list is what the engine
 * indexes into, so a class with five means the fifth line is the fifth entry —
 * writing four and hoping is how a building shows the wrong sentence.
 */
export const MESSAGE_SLOTS: Record<string, readonly string[]> = {
  AdvMapDwellingShared: ['name', 'description', 'firstVisit', 'secondVisit', 'firstVisitNoHire', 'secondVisitNoHire'],
  AdvMapPrisonShared: ['name', 'description', 'prisonEmpty', 'prisonCantHire', 'noExit'],
  AdvMapMineShared: ['name', 'description', 'firstVisit', 'captured'],
  AdvMapSignShared: ['name', 'description'],
};

/** What a class shows when it declares nothing of its own. */
export const DEFAULT_SLOTS = ['name', 'description', 'firstVisit', 'alreadyVisited'] as const;

export const messageSlots = (shared: string): readonly string[] =>
  MESSAGE_SLOTS[shared] ?? DEFAULT_SLOTS;

/** A building as the editor takes it in. */
export interface BuildingSpec {
  /** The stem of every file made for it, and of its folder in the mod. */
  file: string;
  /** Which class it is. */
  className: string;
  /** The `BUILDING_*` it reports as, for the classes that take one. */
  type?: string;
  /**
   * Every line it shows, by slot — TEXT, never a reference. A building of ours
   * ships its own strings so they can be edited and translated; pointing at the
   * game's `Text/Game/Buildings/…` would be free and would tie the mod to the
   * install's language and to a file we do not own.
   */
  messages: Record<string, string>;
  /**
   * The art, as data paths into the game. Nothing here ends up in the document:
   * every one is copied into the mod first and the document names the copy.
   */
  model: string;
  animSet?: string;
  effect?: string;
  effectWhenOwned?: string;
  sound?: string;
  icon?: string;
  /** What it blocks, in tiles. Omitted: the whole of its art. */
  footprint?: Footprint;
  /** What its art covers. `null` cuts no hole; omitted: measured off the model. */
  ground?: Footprint | null;
  /**
   * Bring a TOWN-SCREEN model down to the map, at this many tiles across.
   *
   * The per-tier dwellings the town screen has — Stonehenge, the Unicorn Glade,
   * the Treant Arches — have no adventure-map art at all, and cannot be used as
   * they ship: they are two to three times map scale AND stand where they sit in
   * the town scene, so a model dropped on the map is both giant and nowhere near
   * the tile that placed it. With this set the copy is moved to the origin and
   * scaled, and the footprint is measured off THAT. See bake-model.ts.
   */
  bake?: { tiles: number; ground?: number };
  /** The class's own fields, by name — see extraFields(). */
  fields?: Record<string, string | string[]>;
  /** Recolouring, recorded here and reapplied by every build. */
  recolor?: import('../format/recolor.ts').RecolorOps;
}

/** Where a building's files sit inside a mod. */
export interface BuildingPaths {
  dir: string;
  shared: string;
  link: string;
  /** The copied art tree — models, textures, sounds, effects, all of it. */
  art: string;
  /** One file per message slot. */
  text: Record<string, string>;
}

/**
 * Where the editor's object palette looks for these.
 *
 * The Filter dropdown's groups are folder prefixes read from
 * `Editor/MapFilters.xml`, which no mod can add to — an entry outside a known
 * prefix is filed under "Other" rather than with its own kind.
 */
const LINK_DIR: Record<string, string> = {
  AdvMapDwellingShared: 'MapObjects/_(AdvMapObjectLink)/Objects-Dwellings/Units',
};
const LINK_DIR_DEFAULT = 'MapObjects/_(AdvMapObjectLink)/Objects-All-Terra';

export function buildingPaths(spec: BuildingSpec): BuildingPaths {
  const dir = `Buildings/${spec.file}`;
  const text: Record<string, string> = {};
  for (const slot of messageSlots(spec.className)) {
    text[slot] = `${dir}/${spec.file}_${slot[0]!.toUpperCase()}${slot.slice(1)}.txt`;
  }
  return {
    dir,
    shared: `${dir}/${spec.file}.(${spec.className}).xdb`,
    link: `${LINK_DIR[spec.className] ?? LINK_DIR_DEFAULT}/${spec.file}.xdb`,
    art: `${dir}/art`,
    text,
  };
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

const tileXml = (t: Tile): string =>
  ['<Item>', `\t\t\t<x>${t.x}</x>`, `\t\t\t<y>${t.y}</y>`, '\t\t</Item>'].join(EOL);

/**
 * Write the definition document.
 *
 * The field ORDER comes from types.xml rather than from this file: a shipped
 * object carries every field of its class and its bases in declaration order,
 * and hardcoding that order would be one more thing to keep in step with the
 * game. Fields we say nothing about are written empty, which is what the
 * shipped documents do too.
 *
 * `art` maps each of the spec's art paths to where its COPY landed in the mod;
 * without an entry a slot is written empty rather than pointing outside.
 */
export function buildingDoc(
  spec: BuildingSpec,
  p: BuildingPaths,
  types: Map<string, SpecType>,
  measured: Footprint,
  art: (path: string | undefined) => string | undefined,
): string {
  const t = tilesOf(spec.footprint ?? measured, spec.ground === null ? undefined : spec.ground ?? measured);
  if (spec.ground === null) t.hole.length = 0;

  const messages: string[] = [];
  for (const slot of messageSlots(spec.className)) {
    if (spec.messages[slot]) messages.push(`/${p.text[slot]}`);
  }

  const values: Record<string, string[]> = {
    Model: [href('Model', art(spec.model), 'Model')],
    AnimSet: [href('AnimSet', art(spec.animSet), 'AnimSet')],
    blockedTiles: [list('blockedTiles', t.blocked.map(tileXml))],
    holeTiles: [list('holeTiles', t.hole.map(tileXml))],
    activeTiles: [list('activeTiles', t.active.map(tileXml))],
    passableTiles: ['<passableTiles/>'],
    PossessionMarkerTile: [`<PossessionMarkerTile>${EOL}\t\t<x>0</x>${EOL}\t\t<y>0</y>${EOL}\t</PossessionMarkerTile>`],
    Effect: [href('Effect', art(spec.effect), 'Effect')],
    EffectWhenOwned: [href('EffectWhenOwned', art(spec.effectWhenOwned ?? spec.effect), 'Effect')],
    messagesFileRef: [list('messagesFileRef', messages.map((h) => `<Item href="${h}"/>`))],
    WaterBased: ['<WaterBased>false</WaterBased>'],
    ApplyHeroTrace: ['<ApplyHeroTrace>false</ApplyHeroTrace>'],
    SoundEffect: [href('SoundEffect', art(spec.sound), 'Sound')],
    flybyMessageFileRef: ['<flybyMessageFileRef href=""/>'],
    // The one reference that stays the game's: it names a fog-of-war CATEGORY,
    // not art — a copy of it would be a second category with the same name.
    ObjectTypeFileRef: [`<ObjectTypeFileRef href="${VISIBILITY}"/>`],
    TerrainAligned: ['<TerrainAligned>false</TerrainAligned>'],
    FlyPassable: ['<FlyPassable>true</FlyPassable>'],
    AdventureSoundEffect: ['<AdventureSoundEffect/>'],
    RazedStatic: ['<RazedStatic/>'],
    Icon128: [href('Icon128', art(spec.icon), 'Texture')],
  };

  // The class's own fields. A list value becomes `<Item>`s, a plain one text —
  // which covers every extra field these classes declare.
  if (spec.type) values.Type = [`<Type>${spec.type}</Type>`];
  for (const [name, value] of Object.entries(spec.fields ?? {})) {
    values[name] = [Array.isArray(value)
      ? list(name, value.map((v) => `<Item>${v}</Item>`))
      : `<${name}>${value}</${name}>`];
  }

  const fields = allFields(types, spec.className);
  if (!fields.length) throw new Error(`types.xml declares no ${spec.className}`);
  const body: string[] = [];
  for (const f of fields) body.push(...(values[f.name] ?? [`<${f.name}/>`]));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${spec.className}>`,
    ...body.map((l) => `\t${l}`),
    `</${spec.className}>`,
  ].join(EOL) + EOL;
}

/** The palette entry: a link file pointing at our building. */
export function buildingLink(spec: BuildingSpec, p: BuildingPaths, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.shared}#xpointer(/${spec.className})"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
  ].join(EOL) + `${EOL}</AdvMapObjectLink>${EOL}`;
}
