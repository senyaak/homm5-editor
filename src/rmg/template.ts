// An RMG template, as the generator reads it.
//
// A template is the whole design of a map minus the dice: how many zones, which
// of them hold a town, how densely each is stocked, and which are joined to
// which. `data-unpacked/RMG/Templates/*.xdb` holds 22 of them, plain XML, and
// nothing here interprets any of it — that is the phases' job. This only turns
// the file into numbers.
//
// The field names are the game's own, spelling included: `TownGuardStrenght`
// and `LuckMoralBuildingsDensity` are what the files say, and renaming them on
// the way in would mean every reader of this port has to translate back before
// they can grep the data. See docs/RMG.md.
//
// SEVEN OF THESE FIELDS FEED NOTHING, and they are marked below rather than
// dropped: the format carries them, so a reader that skipped them would be a
// reader of a different format. `GraalOnMap` and `Underground` are read by no
// instruction in either executable; `RedwoodObservatoryDensity` and
// `DenOfThieves` are handed to the step that places those objects, which never
// looks at them and decides both from the zone's tile count and a roll. Each
// was checked twice — over the whole image, and by generating the same map with
// the field changed. A connection's `TwoWay`, `Guarded` and `Wide` are the
// other three, checked the same two ways. See "Which fields the engine
// actually reads".

import { readFileSync } from 'node:fs';

import { childText, find, findAll, parse, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { readText, toAssets } from './data.ts';
import type { DataRoot } from './data.ts';
import { zoneLayoutKind } from './layout.ts';
import type { ZoneLayoutKind } from './layout.ts';

/** Seven, one per creature tier — the shape of `Mines` and `Dwellings`. */
export const TIERS = 7;

export interface RmgZone {
  index: number;
  /** `RACE_RANDOM_TYPE`, or a specific town — the zone's flavour. */
  setting: string;
  canBeWater: boolean;
  /** Relative, not tiles: zones divide the map in proportion to these. */
  size: number;
  canBePlayerStart: boolean;
  town: boolean;
  townGuardStrenght: number;
  /**
   * In the schema (item+0x1C, default TRUE); two shipped templates write it
   * explicitly (S0-1P2Z2K3.2T and S3-5P2-8Z8K2M, every zone, always true),
   * the rest rely on the default. A water-bordered zone copies it to its own
   * +0x164; nothing else reads it yet.
   */
  shipyard: boolean;
  /** Per tier: how many mines of that resource the zone wants. */
  mines: number[];
  abandonedMines: number;
  /** Per tier: dwellings of that tier. */
  dwellings: number[];
  upgBuildingsDensity: number;
  treasureDensity: number;
  treasureChestDensity: number;
  prisons: number;
  landCartographer: number;
  shopPoints: number;
  shrinePoints: number;
  luckMoralBuildingsDensity: number;
  resourceBuildingsDensity: number;
  treasureBuildingPoints: number;
  treasureBlocksTotalValue: number;
  /** DEAD: the step rolls 2-in-10 for a den and never reads this. */
  denOfThieves: number;
  /** DEAD: the step places the zone's tiles / 1000 + 1, whatever this says. */
  redwoodObservatoryDensity: number;
  /** Read, and handed to a worker whose whole body is `ret 4`. */
  buffPoints: number;
  /**
   * OURS (`.h5et`): objects this zone must have, or may not — see
   * `RmgZoneObject`. Empty for every template of the game's.
   */
  objects: RmgZoneObject[];
  /**
   * OURS (`.h5et`): `<GuardMultiplier>`, a factor on the power of every
   * guard the zone seats for ITSELF — its mines, its upgrade buildings,
   * its treasure blocks, its named objects — the way a Heroes III zone is
   * `weak` or `strong`. 1 when absent, which is the engine's map. It does
   * not touch the guards between zones (the passages and teleports take the
   * connection's `GuardStrenght`) nor the town's (`TownGuardStrenght`).
   */
  guardMultiplier: number;
  /**
   * OURS (`.h5et`): `<TreasureBlocks>` — the blocks' values as ranges with
   * counts, Heroes III's `Low / High / Density`, instead of one total split
   * by distance. Empty for the game's templates, and then the total rules.
   * See `RmgTreasureRange` and `valueBlocksByRanges`.
   */
  treasureBlocks: RmgTreasureRange[];
}

/**
 * One line of a zone's `<TreasureBlocks>`: `Count` blocks worth a draw in
 * `[Min, Max]` each. The richest range takes the seats farthest from the
 * town. A block's guard and artifact follow from its value the engine's
 * way — 2.5× of power, the artifact whose cost fits the window — so the
 * range is what decides between relics and trinkets: at 15000..30000 only
 * the dear ones fit; above about 39000 nothing does, and the block is piles.
 */
export interface RmgTreasureRange {
  min: number;
  max: number;
  count: number;
}

/**
 * One line of a zone's `<Objects>` — what Heroes III's templates say with
 * `+95 0 d d d 3 d` and the game's format cannot say at all: a NAMED object
 * with a floor and a ceiling. The game's zone carries counts by tier (mines,
 * dwellings) and point budgets by category (shops, shrines, treasuries…),
 * each spent over a per-race pool from the preset table; which building the
 * budget buys is the draw's business. This names one.
 *
 *   Min   placed before the budgets are spent — guaranteed, candidates
 *         permitting; 0 by default
 *   Max   the most of it the zone gets, forced ones counted — the budgets
 *         skip it once reached; 0 strikes it from the zone's pools;
 *         absent means no ceiling
 *   GuardStrenght  a guard on each forced one, × BasicLeverGuardPower the
 *         way an upgrade building's is; absent or 0 means none — the way
 *         the treasuries, shops and the rest come unguarded from the engine
 */
export interface RmgZoneObject {
  /** The document, `/MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb`, xpointer or not. */
  href: string;
  min: number;
  max: number;
  guardStrenght: number;
}

/**
 * A connection is read at three of its six fields — the two zones and the
 * guard's strength — by the land digger and the teleport pass alike, in both
 * builds; the three flags are registered by the serialiser and read by no
 * instruction, and flipping each on every connection of the reference
 * template changes no byte of the map (docs/RMG.md, "The template's
 * CONNECTION"). Whether a pair gets a guarded land passage or a teleport is
 * geometry's decision alone, which is why a switch for it has to be our own
 * field in our own template format, not a reading of these.
 */
export interface RmgConnection {
  sourceZoneIndex: number;
  destZoneIndex: number;
  /** DEAD: varies across the shipped templates, and nothing reads it. */
  twoWay: boolean;
  /** How strong the army sitting on the passage is. */
  guardStrenght: number;
  /** DEAD: true on all 150 shipped connections; false takes no guard off. */
  guarded: boolean;
  /** DEAD: false on all 150 shipped connections; true widens nothing. */
  wide: boolean;
  /**
   * OURS (`.h5et`): `<Road>false</Road>` digs the passage and guards it but
   * keeps it off the roads phase — a back way, the way a Heroes III
   * connection with `Road -` is. True when absent, which is the engine's
   * passage. A pair written TWICE in a template of ours gets two passages,
   * each with its own guard and its own road flag (`connections.ts`).
   */
  road: boolean;
}

export interface RmgTemplate {
  name: string;
  zones: RmgZone[];
  connections: RmgConnection[];
  /** DEAD: parsed, defaulted, copied, and branched on by no instruction. */
  graalOnMap: boolean;
  /** The four `CreateMap` reads to decide players and size. */
  minPlayers: number;
  maxPlayers: number;
  minMapSize: number;
  maxMapSize: number;
  /** DEAD as well: the ORDER decides the underground, never the template. */
  underground: boolean;
  /** Read by the editor's template list, to hide a template from the dialog. */
  testTemplate: boolean;
  /**
   * OURS, not the game's: `<ZoneLayout>` names how the zones are laid out —
   * the engine's own way when absent, or one of `layout.ts`'s. The game's
   * serialiser does not know the tag, which is why a template that carries
   * it is an `.h5et` of ours rather than an `.xdb` in its folder.
   */
  zoneLayout: ZoneLayoutKind;
  /**
   * OURS: `<LayoutJitter>`, 0..1, how far the Voronoi layout wanders from
   * its bare geometry — the centres scattered, the borders bent — so the
   * same template is a different map every seed. 0 when absent: the shapes
   * the author drew are kept (the borders are always roughened a tile or two
   * for the passages' sake, which is not this). The engine's layout ignores it.
   */
  layoutJitter: number;
}

const int = (el: XmlElement, name: string): number => Number.parseInt(childText(el, name), 10) || 0;
const bool = (el: XmlElement, name: string): boolean => childText(el, name) === 'true';

/** `<Mines><Item>1</Item>…</Mines>` — a fixed-length list of counts. */
function items(el: XmlElement, name: string, length = TIERS): number[] {
  const holder = find(el, name);
  const out = holder ? findAll(holder, 'Item').map((i) => Number.parseInt(text(i), 10) || 0) : [];
  // Padded rather than trusted: a short list would otherwise read as undefined
  // at a tier the phases index blindly.
  while (out.length < length) out.push(0);
  return out;
}

/** `<TreasureBlocks><Item><Min>15000</Min><Max>30000</Max><Count>4</Count></Item>…</TreasureBlocks>`, ours. */
function treasureRanges(z: XmlElement): RmgTreasureRange[] {
  const holder = find(z, 'TreasureBlocks');
  if (!holder) return [];
  return findAll(holder, 'Item').map((r) => ({ min: int(r, 'Min'), max: int(r, 'Max'), count: int(r, 'Count') }));
}

/** `<Objects><Item><Href>…</Href><Min>1</Min><Max>1</Max></Item>…</Objects>`, ours. */
function zoneObjects(z: XmlElement): RmgZoneObject[] {
  const holder = find(z, 'Objects');
  if (!holder) return [];
  return findAll(holder, 'Item').map((o) => {
    const href = childText(o, 'Href');
    if (!href) throw new Error('a zone <Objects> item needs an <Href>');
    const max = childText(o, 'Max');
    return {
      href,
      min: int(o, 'Min'),
      max: max === '' ? Number.POSITIVE_INFINITY : Number.parseInt(max, 10) || 0,
      guardStrenght: int(o, 'GuardStrenght'),
    };
  });
}

export function parseTemplate(xml: string): RmgTemplate {
  const root = parse(xml);
  const t = find(root, 'RMGTemplate');
  if (!t) throw new Error('not an RMGTemplate');

  const zonesEl = find(t, 'Zones');
  const zones = (zonesEl ? findAll(zonesEl, 'Item') : [])
    // Only direct children are zones; `Mines`/`Dwellings` have Items too.
    .filter((z) => find(z, 'Index') !== null)
    .map((z): RmgZone => ({
      index: int(z, 'Index'),
      setting: childText(z, 'Setting'),
      canBeWater: bool(z, 'CanBeWater'),
      size: int(z, 'Size'),
      canBePlayerStart: bool(z, 'CanBePlayerStart'),
      town: bool(z, 'Town'),
      townGuardStrenght: int(z, 'TownGuardStrenght'),
      // Defaulted TRUE like the engine's item constructor (0xBA71D0) — the
      // one field no shipped template writes, so absence is the normal case.
      shipyard: childText(z, 'Shipyard') !== 'false',
      mines: items(z, 'Mines'),
      abandonedMines: int(z, 'AbandonedMines'),
      dwellings: items(z, 'Dwellings'),
      upgBuildingsDensity: int(z, 'UpgBuildingsDensity'),
      treasureDensity: int(z, 'TreasureDensity'),
      treasureChestDensity: int(z, 'TreasureChestDensity'),
      prisons: int(z, 'Prisons'),
      landCartographer: int(z, 'LandCartographer'),
      shopPoints: int(z, 'ShopPoints'),
      shrinePoints: int(z, 'ShrinePoints'),
      luckMoralBuildingsDensity: int(z, 'LuckMoralBuildingsDensity'),
      resourceBuildingsDensity: int(z, 'ResourceBuildingsDensity'),
      treasureBuildingPoints: int(z, 'TreasureBuildingPoints'),
      treasureBlocksTotalValue: int(z, 'TreasureBlocksTotalValue'),
      denOfThieves: int(z, 'DenOfThieves'),
      redwoodObservatoryDensity: int(z, 'RedwoodObservatoryDensity'),
      buffPoints: int(z, 'BuffPoints'),
      objects: zoneObjects(z),
      guardMultiplier: childText(z, 'GuardMultiplier') === '' ? 1 : Number.parseFloat(childText(z, 'GuardMultiplier')) || 0,
      treasureBlocks: treasureRanges(z),
    }));

  const connectionsEl = find(t, 'Connections');
  const connections = (connectionsEl ? findAll(connectionsEl, 'Item') : []).map((c): RmgConnection => ({
    sourceZoneIndex: int(c, 'SourceZoneIndex'),
    destZoneIndex: int(c, 'DestZoneIndex'),
    twoWay: bool(c, 'TwoWay'),
    guardStrenght: int(c, 'GuardStrenght'),
    guarded: bool(c, 'Guarded'),
    wide: bool(c, 'Wide'),
    road: childText(c, 'Road') !== 'false',
  }));

  return {
    name: childText(t, 'Name'),
    zones,
    connections,
    graalOnMap: bool(t, 'GraalOnMap'),
    minPlayers: int(t, 'MinPlayers'),
    maxPlayers: int(t, 'MaxPlayers'),
    minMapSize: int(t, 'MinMapSize'),
    maxMapSize: int(t, 'MaxMapSize'),
    underground: bool(t, 'Underground'),
    testTemplate: bool(t, 'TestTemplate'),
    zoneLayout: zoneLayoutKind(childText(t, 'ZoneLayout')),
    layoutJitter: Math.min(1, Math.max(0, Number.parseFloat(childText(t, 'LayoutJitter')) || 0)),
  };
}

/** A template by its full path on disk — the tests' door. */
export function readTemplate(path: string): RmgTemplate {
  return parseTemplate(readFileSync(path, 'utf8'));
}

/**
 * The two spellings of a template file. `.xdb` is the game's; `.h5et` is
 * OURS — the same document with the fields of our own the game's serialiser
 * would not know (`ZoneLayout`), kept out of the folder the game lists so
 * that its own generator never meets them. One name may exist in both;
 * ours wins, the way a mod's file wins over the shipped one.
 */
export const TEMPLATE_EXTENSIONS = ['.h5et', '.xdb'] as const;

/** `RMG/Templates/<name>.h5et` or `.xdb`, whichever the mounted chain has first. */
export function templateFile(dataRoot: DataRoot, name: string): string {
  const data = toAssets(dataRoot);
  for (const ext of TEMPLATE_EXTENSIONS) {
    const rel = `RMG/Templates/${name}${ext}`;
    if (data.text(rel) !== null) return rel;
  }
  throw new Error(`RMG/Templates/${name}: neither .h5et nor .xdb in any mounted root (${data.roots.join(', ')})`);
}

/** A template by name through the mounted chain — the generator's door. */
export function readTemplateNamed(dataRoot: DataRoot, name: string): RmgTemplate {
  return parseTemplate(readText(dataRoot, templateFile(dataRoot, name)));
}
