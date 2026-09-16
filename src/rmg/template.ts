// An RMG template of OURS — the game's, plus what an `.h5et` can say on top.
//
// `template-game.ts` is the base: the game's three records and a described
// table of every field, in file order. This extends each record with our own
// fields and describes them the same way, each with a `default` (what an
// absent tag reads as, and what the writer leaves unwritten) and an `after`
// (which field of the game's it is written behind, so ours land where `Jebus
// Cross.h5et` puts them). A template with nothing of ours is then the game's
// file, tag for tag; one with them is that file with a few tags more, and the
// game's own serialiser would not know them — which is why such a file is an
// `.h5et` kept out of the folder the game lists (`TEMPLATE_EXTENSIONS`).
//
// The reader walks the tables. Nothing here interprets a field — that is the
// phases' job; this only turns the file into numbers, and `write-template.ts`
// turns them back.

import { readFileSync } from 'node:fs';

import { childText, decodeEntities, find, findAll, parse, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { readText, toAssets } from './data.ts';
import type { DataRoot } from './data.ts';
import { zoneLayoutKind } from './layout.ts';
import type { ZoneLayoutKind } from './layout.ts';
import { GAME_CONNECTION_FIELDS, GAME_TEMPLATE_FIELDS, GAME_ZONE_FIELDS } from './template-game.ts';
import type { FieldSpec, GameConnection, GameConnectionCarried, GameTemplate, GameTemplateCarried, GameZone, GameZoneCarried, LiveKeys } from './template-game.ts';

export { GAME_CONNECTION_FIELDS, GAME_TEMPLATE_FIELDS, GAME_ZONE_FIELDS, TIERS, shipyardOf } from './template-game.ts';
export type {
  FieldKind, FieldSpec, GameConnection, GameConnectionCarried, GameTemplate, GameTemplateCarried, GameZone, GameZoneCarried, LiveKeys,
} from './template-game.ts';

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

/** A zone of ours: the game's, and what an `.h5et` adds. */
export interface RmgZone extends GameZone {
  /**
   * `<GuardMultiplier>`, a factor on the power of every guard the zone
   * seats for ITSELF — its mines, its upgrade buildings, its treasure
   * blocks, its named objects — the way a Heroes III zone is `weak` or
   * `strong`. 1 when absent, which is the engine's map. It does not touch
   * the guards between zones (the passages and teleports take the
   * connection's `GuardStrenght`) nor the town's (`TownGuardStrenght`).
   */
  guardMultiplier: number;
  /**
   * `<TreasureBlocks>` — the blocks' values as ranges with counts, Heroes
   * III's `Low / High / Density`, instead of one total split by distance.
   * Empty for the game's templates, and then the total rules. See
   * `RmgTreasureRange` and `valueBlocksByRanges`.
   */
  treasureBlocks: RmgTreasureRange[];
  /** `<Objects>` — objects this zone must have, or may not; see `RmgZoneObject`. */
  objects: RmgZoneObject[];
}

/** A connection of ours: the game's, and what an `.h5et` adds. */
export interface RmgConnection extends GameConnection {
  /**
   * `<Road>false</Road>` digs the passage and guards it but keeps it off
   * the roads phase — a back way, the way a Heroes III connection with
   * `Road -` is. True when absent, which is the engine's passage. A pair
   * written TWICE in a template of ours gets two passages, each with its
   * own guard and its own road flag (`connections.ts`).
   */
  road: boolean;
}

/** A template of ours: the game's, and what an `.h5et` adds. */
export interface RmgTemplate extends GameTemplate {
  zones: RmgZone[];
  connections: RmgConnection[];
  /**
   * `<ZoneLayout>` names how the zones are laid out — the engine's own way
   * when absent, or one of `layout.ts`'s.
   */
  zoneLayout: ZoneLayoutKind;
  /**
   * `<LayoutJitter>`, 0..1, how far the Voronoi layout wanders from its
   * bare geometry — the centres scattered, the borders bent — so the same
   * template is a different map every seed. 0 when absent: the shapes the
   * author drew are kept (the borders are always roughened a tile or two
   * for the passages' sake, which is not this). The engine's layout ignores it.
   */
  layoutJitter: number;
  /**
   * `<UniqueRaces>true</UniqueRaces>` — no two zones of a floor draw the
   * same race, so a five-zone map is five factions and the middle zone is
   * nobody's home ground (the terrain penalty, `docs/RMG.md`). A zone with
   * a concrete Setting, and a race the lobby fixed for a player, count as
   * taken. False when absent: the engine's draw, repeats and all.
   */
  uniqueRaces: boolean;
}

/** The fields of ours on a zone, each behind the game's field it follows. */
export const OUR_ZONE_FIELDS = {
  guardMultiplier: { tag: 'GuardMultiplier', kind: 'float', default: 1, after: 'townGuardStrenght', doc: 'A factor on the guards the zone seats for itself — mines, upgrade buildings, treasure blocks, named objects — on top of the map\'s monster level. 1 is the engine\'s.' },
  treasureBlocks: { tag: 'TreasureBlocks', kind: 'ranges', after: 'treasureBlocksTotalValue', doc: 'The treasure blocks by value ranges with counts, the richest farthest from the town; the total is then not read. 15000 and up is where the relics live.' },
  objects: { tag: 'Objects', kind: 'objects', after: 'buffPoints', doc: 'Named objects: a floor placed before the budgets, a ceiling the budgets honour (0 forbids), a guard if asked.' },
} as const satisfies Record<Exclude<keyof RmgZone, keyof GameZone>, FieldSpec>;

/** The fields of ours on a connection. */
export const OUR_CONNECTION_FIELDS = {
  road: { tag: 'Road', kind: 'bool', default: true, after: 'wide', doc: 'False keeps the passage off the roads — a guarded back way. A pair written twice is two passages.' },
} as const satisfies Record<Exclude<keyof RmgConnection, keyof GameConnection>, FieldSpec>;

/** The fields of ours on the template, all behind its name. */
export const OUR_TEMPLATE_FIELDS = {
  zoneLayout: { tag: 'ZoneLayout', kind: 'layout', default: 'Engine', after: 'name', doc: 'How the zones are laid out: Engine, the game\'s own; Voronoi, ours — centres settled by the connections, start zones at the corners.' },
  layoutJitter: { tag: 'LayoutJitter', kind: 'float', default: 0, min: 0, max: 1, after: 'name', doc: 'How far the Voronoi layout wanders from its bare geometry, 0..1; 0 keeps the shapes the graph gives.' },
  uniqueRaces: { tag: 'UniqueRaces', kind: 'bool', default: false, after: 'name', doc: 'No faction twice: each zone draws a race not yet taken, and the middle is nobody\'s home ground.' },
} as const satisfies Record<Exclude<keyof RmgTemplate, keyof GameTemplate | 'zones' | 'connections'>, FieldSpec>;

/** The three records' fields, the game's and ours together — the dead ones (`carried`) among them, by their own keys. */
export const ZONE_FIELDS: Record<LiveKeys<RmgZone> | keyof GameZoneCarried, FieldSpec> = { ...GAME_ZONE_FIELDS, ...OUR_ZONE_FIELDS };
export const CONNECTION_FIELDS: Record<LiveKeys<RmgConnection> | keyof GameConnectionCarried, FieldSpec> = { ...GAME_CONNECTION_FIELDS, ...OUR_CONNECTION_FIELDS };
export const TEMPLATE_FIELDS: Record<LiveKeys<RmgTemplate> | keyof GameTemplateCarried, FieldSpec> = { ...GAME_TEMPLATE_FIELDS, ...OUR_TEMPLATE_FIELDS };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const intText = (s: string): number => Number.parseInt(s, 10) || 0;

/** `<TreasureBlocks><Item><Min>15000</Min><Max>30000</Max><Count>4</Count></Item>…</TreasureBlocks>`. */
function treasureRanges(holder: XmlElement | null): RmgTreasureRange[] {
  if (!holder) return [];
  return findAll(holder, 'Item').map((r) => ({
    min: intText(childText(r, 'Min')), max: intText(childText(r, 'Max')), count: intText(childText(r, 'Count')),
  }));
}

/** `<Objects><Item><Href>…</Href><Min>1</Min><Max>1</Max></Item>…</Objects>`. */
function zoneObjects(holder: XmlElement | null): RmgZoneObject[] {
  if (!holder) return [];
  return findAll(holder, 'Item').map((o) => {
    const href = decodeEntities(childText(o, 'Href'));
    if (!href) throw new Error('a zone <Objects> item needs an <Href>');
    const max = childText(o, 'Max');
    return {
      href,
      min: intText(childText(o, 'Min')),
      max: max === '' ? Number.POSITIVE_INFINITY : intText(max),
      guardStrenght: intText(childText(o, 'GuardStrenght')),
    };
  });
}

/** One field's value out of its record's element, by its kind (`FieldKind`). */
function readField(el: XmlElement, f: FieldSpec): unknown {
  const child = find(el, f.tag);
  switch (f.kind) {
    case 'int': return intText(childText(el, f.tag));
    case 'float': {
      if (!child) return f.default ?? 0;
      let v = Number.parseFloat(text(child)) || 0;
      if (f.min !== undefined) v = Math.max(f.min, v);
      if (f.max !== undefined) v = Math.min(f.max, v);
      return v;
    }
    case 'bool':
      if (!child) return f.optional ? null : (f.default ?? false);
      return text(child) === 'true';
    case 'text': return decodeEntities(childText(el, f.tag));
    case 'href':
      if (!child) return f.optional ? null : '';
      return decodeEntities(child.attrs.href ?? '');
    case 'tiers': return child ? findAll(child, 'Item').map((i) => intText(text(i))) : [];
    case 'layout': return zoneLayoutKind(childText(el, f.tag));
    case 'ranges': return treasureRanges(child);
    case 'objects': return zoneObjects(child);
    // Only direct Items are records; `Mines`/`Dwellings` have Items too, so
    // a zone is told from a tier count by its Index.
    case 'zones': return child ? findAll(child, 'Item').filter((z) => find(z, 'Index') !== null).map((z) => readRecord<RmgZone>(z, ZONE_FIELDS)) : [];
    case 'connections': return child ? findAll(child, 'Item').map((c) => readRecord<RmgConnection>(c, CONNECTION_FIELDS)) : [];
  }
}

/** A record out of its element: every field of the table, by its kind — the dead ones into its `carried` bag. */
function readRecord<T extends object>(el: XmlElement, table: Record<string, FieldSpec>): T {
  const out: Record<string, unknown> = {};
  const carried: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(table)) (f.dead ? carried : out)[key] = readField(el, f);
  out.carried = carried;
  return out as T;
}

export function parseTemplate(xml: string): RmgTemplate {
  const root = parse(xml);
  const t = find(root, 'RMGTemplate');
  if (!t) throw new Error('not an RMGTemplate');
  return readRecord<RmgTemplate>(t, TEMPLATE_FIELDS);
}

/** A template by its full path on disk — the tests' door. */
export function readTemplate(path: string): RmgTemplate {
  return parseTemplate(readFileSync(path, 'utf8'));
}

/**
 * The two spellings of a template file. `.xdb` is the game's; `.h5et` is
 * OURS — the same document with the fields of our own the game's serialiser
 * would not know, kept out of the folder the game lists so that its own
 * generator never meets them. One name may exist in both; ours wins, the
 * way a mod's file wins over the shipped one.
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
