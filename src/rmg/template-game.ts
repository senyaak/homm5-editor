// The game's RMG template — the base every template of ours extends.
//
// `data-unpacked/RMG/Templates/*.xdb` holds 22 of them, plain XML written by
// the game's serialiser from `SRMGTemplate`: a template's own few fields, a
// list of zones, a list of connections. THIS FILE IS THAT FORMAT AND NOTHING
// MORE — the three record types and, beside each, a table describing every
// field: the tag it is written under, what kind of value it holds, what it
// means, and whether the engine reads it at all. The tables are in FILE
// ORDER, which is how the writer knows where each tag goes, and `satisfies`
// holds each table to its type: a field added to one and not the other is a
// compile error, so the description cannot drift from the data.
//
// The field names are the game's own, spelling included: `TownGuardStrenght`
// and `LuckMoralBuildingsDensity` are what the files say, and renaming them on
// the way in would mean every reader of this port has to translate back before
// they can grep the data. See docs/RMG.md.
//
// EIGHT OF THESE FIELDS FEED NOTHING, and they are marked `dead` rather than
// dropped: the format carries them, so a reader that skipped them would be a
// reader of a different format, and a writer that dropped them would write a
// file the game's parser has never seen. They are kept OFF the records
// though, in a `carried` bag of each (`GameZoneCarried` and its two
// siblings), so that a phase or a panel walking a record's keys never meets
// one and nothing reads them by mistake. `GraalOnMap` and `Underground` are
// read by no instruction in either executable; `RedwoodObservatoryDensity`
// and `DenOfThieves` are handed to the step that places those objects, which
// never looks at them and decides both from the zone's tile count and a roll;
// `CanBeWater` is read by nothing and was probed on an island map to no
// effect. Each was checked twice — over the whole image, and by generating
// the same map with the field changed. A connection's `TwoWay`, `Guarded` and
// `Wide` are the other three, checked the same two ways. See "Which fields
// the engine actually reads" in docs/RMG.md.
//
// What is OURS — the fields an `.h5et` adds — lives in `template.ts`, which
// extends these three types and adds its own tables beside them.

/** Seven, one per creature tier — the most a `Mines` or `Dwellings` list holds. */
export const TIERS = 7;

/**
 * What kind of value a field holds — which decides how it is read, how it is
 * written, and what control the template editor shows for it.
 *
 *   int          `<Size>10</Size>`, a whole number; absent reads 0
 *   float        `<GuardMultiplier>0.5</GuardMultiplier>`; absent reads `default`
 *   bool         `<Town>true</Town>`; absent reads false — or null when
 *                `optional`, which keeps "not written" apart from false
 *   text         `<Name>S1P2Z2M1</Name>`, free text through the XML entities;
 *                an empty one is written `<Name/>`
 *   href         `<NameFileRef href="S1P2Z2M1.txt"/>` — a reference written as
 *                an attribute; absent reads null when `optional`, '' otherwise
 *   tiers        `<Mines><Item>1</Item>…</Mines>` — counts by creature tier, AS
 *                MANY AS WRITTEN: every shipped `Mines` has seven entries,
 *                `Dwellings` runs from none (`<Dwellings/>`) to seven, and the
 *                placers read a missing tier as nothing. The length is data.
 *   zones        the list of zone records; `connections` likewise
 *   layout       ours — a `ZoneLayoutKind` name; `ranges` and `objects` are the
 *                two structured lists of ours (`template.ts`)
 */
export type FieldKind =
  | 'int' | 'float' | 'bool' | 'text' | 'href' | 'tiers'
  | 'zones' | 'connections'
  | 'layout' | 'ranges' | 'objects';

/** One field of a record: how it is spelled, what it holds, what it means. */
export interface FieldSpec {
  /** The tag in the file. */
  tag: string;
  kind: FieldKind;
  /** What the field means — the editor's tooltip, and the reader's note. */
  doc: string;
  /**
   * Read by no instruction of the engine; carried because the format does.
   * A dead field lives in the record's `carried` bag, not on the record —
   * the reader puts it there and the writer takes it from there.
   */
  dead?: true;
  /**
   * Absent is "not written" (null), kept apart from a value: `Shipyard` in
   * twenty templates, `NameFileRef` in three. The writer emits the tag only
   * when the value is not null.
   */
  optional?: true;
  /**
   * OURS only: what an absent tag reads as, and the value the writer leaves
   * unwritten — so a template with nothing of ours writes as the game's file.
   */
  default?: number | boolean | string;
  /** The value's bounds, clamped on reading (`LayoutJitter` is 0..1). */
  min?: number;
  max?: number;
  /**
   * OURS only: the key of the game's field this one is written after, so a
   * field of ours lands where `Jebus Cross.h5et` puts it rather than at the
   * end. Several after one key go in their table's order.
   */
  after?: string;
}

/** A record's own keys, the `carried` bag aside — what a table names beside the bag's. */
export type LiveKeys<T> = Exclude<keyof T, 'carried'>;

/** A zone as the game's file describes it — one `<Item>` of `<Zones>`. */
export interface GameZone {
  index: number;
  /** `RACE_RANDOM_TYPE`, or a specific town — the zone's flavour. */
  setting: string;
  /** Relative, not tiles: zones divide the map in proportion to these. */
  size: number;
  canBePlayerStart: boolean;
  town: boolean;
  townGuardStrenght: number;
  /**
   * In the schema (item+0x1C, default TRUE); two shipped templates write it
   * explicitly (S0-1P2Z2K3.2T and S3-5P2-8Z8K2M, every zone, always true),
   * the rest rely on the default. A water-bordered zone copies it to its own
   * +0x164; nothing else reads it yet. `null` is the tag not written — the
   * engine's default, true — kept apart from an explicit true so the writer
   * puts the file back the way it was. Readers wanting the value take
   * `shipyardOf(zone)`.
   */
  shipyard: boolean | null;
  /** Per tier, as written (`FieldKind`, `tiers`): how many mines of that resource the zone wants. */
  mines: number[];
  abandonedMines: number;
  /** Per tier, as written: dwellings of that tier. */
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
  carried: GameZoneCarried;
}

/**
 * The zone's DEAD fields, kept out of the zone's own shape: they are read
 * and written so the file comes back as it went, and that is all they are
 * for — no phase and no panel has business with them, so `keyof GameZone`
 * does not name them and nothing reaches them but by way of `carried`.
 */
export interface GameZoneCarried {
  /** Read by nothing, probed on an island map to no effect (docs/RMG.md). */
  canBeWater: boolean;
  /** The step rolls 2-in-10 for a den and never reads this. */
  denOfThieves: number;
  /** The step places the zone's tiles / 1000 + 1, whatever this says. */
  redwoodObservatoryDensity: number;
  /** Read, and handed to a worker whose whole body is `ret 4`. */
  buffPoints: number;
}

/**
 * A connection as the game's file describes it — one `<Item>` of
 * `<Connections>`. Read at three of its six fields — the two zones and the
 * guard's strength — by the land digger and the teleport pass alike, in both
 * builds; the three flags are registered by the serialiser and read by no
 * instruction, and flipping each on every connection of the reference
 * template changes no byte of the map (docs/RMG.md, "The template's
 * CONNECTION"). Whether a pair gets a guarded land passage or a teleport is
 * geometry's decision alone, which is why a switch for it has to be a field
 * of ours (`template.ts`), not a reading of these.
 */
export interface GameConnection {
  sourceZoneIndex: number;
  destZoneIndex: number;
  /** How strong the army sitting on the passage is. */
  guardStrenght: number;
  carried: GameConnectionCarried;
}

/** The connection's dead fields — see `GameZoneCarried`. */
export interface GameConnectionCarried {
  /** Varies across the shipped templates, and nothing reads it. */
  twoWay: boolean;
  /** True on all 150 shipped connections; false takes no guard off. */
  guarded: boolean;
  /** False on all 150 shipped connections; true widens nothing. */
  wide: boolean;
}

/** The template as the game's file describes it — `SRMGTemplate`. */
export interface GameTemplate {
  /**
   * `<NameFileRef href="…"/>` — the localised name's text file, which the
   * game's dialog shows in place of `Name`. Nineteen shipped templates name
   * one, three carry no tag at all: `null` is the tag absent, `''` an empty
   * href, and the writer keeps the two apart.
   */
  nameFileRef: string | null;
  /** `<DescriptionFileRef href="…"/>` — every shipped template writes it empty. */
  descriptionFileRef: string;
  name: string;
  zones: GameZone[];
  connections: GameConnection[];
  /** The four `CreateMap` reads to decide players and size. */
  minPlayers: number;
  maxPlayers: number;
  minMapSize: number;
  maxMapSize: number;
  /** Read by the editor's template list, to hide a template from the dialog. */
  testTemplate: boolean;
  carried: GameTemplateCarried;
}

/** The template's dead fields — see `GameZoneCarried`. */
export interface GameTemplateCarried {
  /** Parsed, defaulted, copied, and branched on by no instruction. */
  graalOnMap: boolean;
  /** The ORDER decides the underground, never the template. */
  underground: boolean;
}

/** The zone's fields, in file order. */
export const GAME_ZONE_FIELDS = {
  index: { tag: 'Index', kind: 'int', doc: 'The zone\'s number — what a connection names, 1-based; zones are built in ascending order.' },
  setting: { tag: 'Setting', kind: 'text', doc: 'RACE_RANDOM_TYPE draws a faction; a town name fixes one.' },
  canBeWater: { tag: 'CanBeWater', kind: 'bool', dead: true, doc: 'Dead: no instruction reads it, and a probe with it flipped on every zone of an island map changed nothing — water is the order\'s, not the zone\'s.' },
  size: { tag: 'Size', kind: 'int', doc: 'Relative, not tiles: the zones divide the map in proportion to these.' },
  canBePlayerStart: { tag: 'CanBePlayerStart', kind: 'bool', doc: 'A start zone: a player\'s town and hero go here.' },
  town: { tag: 'Town', kind: 'bool', doc: 'The zone holds a town.' },
  townGuardStrenght: { tag: 'TownGuardStrenght', kind: 'int', doc: 'The guard at the town\'s gate, in the game\'s units.' },
  shipyard: { tag: 'Shipyard', kind: 'bool', optional: true, doc: 'A shipyard when the zone is water-bordered; the engine\'s default is true.' },
  mines: { tag: 'Mines', kind: 'tiers', doc: 'Mines wanted, one count per type in the engine\'s order: Sawmill, Ore_Pit, Alchemist_Lab, Crystal_Cavern, Sulfur_Dune, Gem_Pond, Gold_Mine. SEVEN, always — the step reads seven counts from the list\'s start whatever its length, and every shipped template writes seven.' },
  abandonedMines: { tag: 'AbandonedMines', kind: 'int', doc: 'Abandoned mines wanted.' },
  dwellings: { tag: 'Dwellings', kind: 'tiers', doc: 'Dwellings wanted, one count per creature tier, as many tiers as written — a missing tier is none (the shipped templates stop anywhere from none to seven).' },
  upgBuildingsDensity: { tag: 'UpgBuildingsDensity', kind: 'int', doc: 'How densely the upgrade buildings are sown.' },
  treasureDensity: { tag: 'TreasureDensity', kind: 'int', doc: 'How densely the loose treasure is sown.' },
  treasureChestDensity: { tag: 'TreasureChestDensity', kind: 'int', doc: 'How densely the chests are sown.' },
  prisons: { tag: 'Prisons', kind: 'int', doc: 'Prisons wanted.' },
  landCartographer: { tag: 'LandCartographer', kind: 'int', doc: 'Cartographers wanted.' },
  shopPoints: { tag: 'ShopPoints', kind: 'int', doc: 'Points to spend on shops from the race\'s pool.' },
  shrinePoints: { tag: 'ShrinePoints', kind: 'int', doc: 'Points to spend on shrines.' },
  luckMoralBuildingsDensity: { tag: 'LuckMoralBuildingsDensity', kind: 'int', doc: 'How densely the luck and morale buildings are sown.' },
  resourceBuildingsDensity: { tag: 'ResourceBuildingsDensity', kind: 'int', doc: 'How densely the resource buildings are sown.' },
  treasureBuildingPoints: { tag: 'TreasureBuildingPoints', kind: 'int', doc: 'Points to spend on treasuries.' },
  treasureBlocksTotalValue: { tag: 'TreasureBlocksTotalValue', kind: 'int', doc: 'The zone\'s treasure blocks\' worth, split by distance from the town.' },
  denOfThieves: { tag: 'DenOfThieves', kind: 'int', dead: true, doc: 'Dead: the step rolls 2-in-10 for a den and never reads this.' },
  redwoodObservatoryDensity: { tag: 'RedwoodObservatoryDensity', kind: 'int', dead: true, doc: 'Dead: the step places the zone\'s tiles / 1000 + 1, whatever this says.' },
  buffPoints: { tag: 'BuffPoints', kind: 'int', dead: true, doc: 'Dead: read, and handed to a worker whose whole body is `ret 4`.' },
} as const satisfies Record<LiveKeys<GameZone> | keyof GameZoneCarried, FieldSpec>;

/** The connection's fields, in file order. */
export const GAME_CONNECTION_FIELDS = {
  sourceZoneIndex: { tag: 'SourceZoneIndex', kind: 'int', doc: 'One end.' },
  destZoneIndex: { tag: 'DestZoneIndex', kind: 'int', doc: 'The other end.' },
  twoWay: { tag: 'TwoWay', kind: 'bool', dead: true, doc: 'Dead: varies across the shipped templates, and nothing reads it.' },
  guardStrenght: { tag: 'GuardStrenght', kind: 'int', doc: 'How strong the army sitting on the passage is.' },
  guarded: { tag: 'Guarded', kind: 'bool', dead: true, doc: 'Dead: true on all 150 shipped connections; false takes no guard off.' },
  wide: { tag: 'Wide', kind: 'bool', dead: true, doc: 'Dead: false on all 150 shipped connections; true widens nothing.' },
} as const satisfies Record<LiveKeys<GameConnection> | keyof GameConnectionCarried, FieldSpec>;

/** The template's own fields, in file order — the zones and connections among them. */
export const GAME_TEMPLATE_FIELDS = {
  nameFileRef: { tag: 'NameFileRef', kind: 'href', optional: true, doc: 'The localised name\'s text file; the dialog shows it in place of Name.' },
  descriptionFileRef: { tag: 'DescriptionFileRef', kind: 'href', doc: 'The localised description\'s text file; every shipped template leaves it empty.' },
  name: { tag: 'Name', kind: 'text', doc: 'The template\'s name.' },
  zones: { tag: 'Zones', kind: 'zones', doc: 'The zones.' },
  connections: { tag: 'Connections', kind: 'connections', doc: 'Which zones are joined, and how strongly the passage is guarded.' },
  graalOnMap: { tag: 'GraalOnMap', kind: 'bool', dead: true, doc: 'Dead: parsed, defaulted, copied, and branched on by no instruction — the order decides the grail.' },
  minPlayers: { tag: 'MinPlayers', kind: 'int', doc: 'The fewest players the template seats.' },
  maxPlayers: { tag: 'MaxPlayers', kind: 'int', doc: 'The most players the template seats.' },
  minMapSize: { tag: 'MinMapSize', kind: 'int', doc: 'The smallest map, in the dialog\'s units (tiles squared over a thousand).' },
  maxMapSize: { tag: 'MaxMapSize', kind: 'int', doc: 'The largest map, in the same units.' },
  underground: { tag: 'Underground', kind: 'bool', dead: true, doc: 'Dead: the order decides the underground, never the template.' },
  testTemplate: { tag: 'TestTemplate', kind: 'bool', doc: 'Hidden from the dialog\'s list when true.' },
} as const satisfies Record<LiveKeys<GameTemplate> | keyof GameTemplateCarried, FieldSpec>;

/** The zone's Shipyard bit as the engine holds it: written, or the constructor's true. */
export function shipyardOf(zone: GameZone): boolean {
  return zone.shipyard ?? true;
}
