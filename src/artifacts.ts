// An artifact: the thing a hero wears, and the thing lying on the map.
//
// Two documents and one table entry, and the split matters:
//
//   the RECORD in `GameMechanics/RefTables/Artifacts.xdb` is the artifact — its
//     name, slot, price and the six hero stats it moves. The table inlines its
//     objects rather than pointing at files, so a new artifact is an entry
//     added to that one file, the same shape our creatures take.
//   the SHARED (`AdvMapArtifactShared`) is only the thing on the ground: a
//     model, a glow and two messages. Its last field NAMES the artifact, and
//     that is the whole link between the two.
//
// The name field is a trap with history. `AdvMapMonsterShared` names its
// creature the same way, and copying a shipped one without changing that line
// put someone else's creature on the map — see docs/NEW_CREATURES.md. The same
// mistake here would put a shipped artifact under our model.
//
// WHAT AN ARTIFACT CANNOT DO from data: the record carries six numbers and
// nothing else. Every special property the shipped artifacts have — the
// Necromancer's Pendant raising necromancy, a set's bonus — is compiled into
// the executable against a specific id, so a NEW artifact gets none of it and
// cannot be given any. Its behaviour has to come from a map or campaign script.
// See docs/ARTIFACTS.md.

import { allFields } from './typespec.ts';
import type { SpecType } from './typespec.ts';

/**
 * How many artifacts the game ships with — the number a mod's own start after.
 *
 * Counted in `GameMechanics/RefTables/Artifacts.xdb`, and the same number is
 * declared twice in types.xml as the table's `MinElements` AND `MaxElements`.
 * Unlike the creature ceiling this one is NOT in the executable: the twelve
 * compiled ref-table sizes are 7, 126, 5, 180, 5, 11, 1, 5, 9, 10, 5 and 23,
 * and 97 is not among them. So artifacts need no patched game.
 */
export const SHIPPED_ARTIFACTS = 97;

/** The document that puts an artifact on the ground. */
export const ARTIFACT_CLASS = 'AdvMapArtifactShared';

/** The record inside the reference table. */
export const ARTIFACT_RECORD = 'DBArtifact';

/** Where an artifact is worn. `INVENTORY` is the backpack — worn nowhere. */
export type ArtifactSlot =
  | 'HEAD' | 'NECK' | 'SHOULDERS' | 'CHEST' | 'PRIMARY' | 'SECONDARY'
  | 'FINGER' | 'FEET' | 'MISCSLOT1' | 'INVENTORY';

/** How rare it is. Decides which "random artifact" rolls can produce it. */
export type ArtifactRank = 'ARTF_CLASS_MINOR' | 'ARTF_CLASS_MAJOR' | 'ARTF_CLASS_RELIC';

/** The six numbers an artifact may move. Everything else needs a script. */
export interface HeroStats {
  Attack: number;
  Defence: number;
  Knowledge: number;
  SpellPower: number;
  Morale: number;
  Luck: number;
}

const STAT_NAMES: (keyof HeroStats)[] = [
  'Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck',
];

/** What the shipped artifacts point at for the fog-of-war name and the pickup sound. */
const VISIBILITY = '/Text/Visibility_Types/Arefacts.txt';
const PICKUP_SOUND = '/Sounds/_(Sound)/Interface/Events/Get_artf_res01.xdb#xpointer(/Sound)';
/** The animation every shipped artifact spins with on the map. */
const ANIM_SET = '/_(AnimSet)/Artefacts/General.(AnimSet).xdb#xpointer(/AnimSet)';
/** The glow. Green is what the shipped relics use; the folder has the other colours. */
const GLOW = '/Effects/_(Effect)/Artefacts/General/Green.xdb#xpointer(/Effect)';

const EOL = '\r\n';

/** An artifact as the editor takes it in. */
export interface ArtifactSpec {
  /**
   * `ARTIFACT_…`. Its NUMBER is what a map, a save and a script store, and the
   * number comes from the enum in types.xml — see the mod builder.
   *
   * Half the shipped table uses this prefix and half does not
   * (`CLOAK_OF_MOURNING`), and both forms are referenced elsewhere. Ours all
   * carry it, so there is one rule here rather than two.
   */
  id: string;
  /** The stem of every file generated for it, and of its folder in the mod. */
  file: string;
  name: string;
  description: string;
  slot: ArtifactSlot;
  rank?: ArtifactRank;
  /** What a market sells it for. */
  cost: number;
  /** How much an AI hero wants it. The shipped relics sit around 500. */
  aiValue?: number;
  /** Whether "random artifact" may roll this one. Ours default to no: a set
   *  piece that turns up in a chest is not a set piece. */
  canBeGeneratedToSell?: boolean;
  /** The six stats it moves. Anything omitted is zero. */
  stats?: Partial<HeroStats>;
  /**
   * href of its 64x64 icon — the hero screen's, and the only picture it has.
   * Omitted, the mod builds one from `picture`.
   */
  icon?: string;
  /**
   * href of the `(Model)` lying on the map.
   *
   * Referenced, not copied — the same rule dwellings follow. Every install has
   * the shipped artifact models, and an artifact that wants its own can point
   * at one the mod carries; the href is the href either way.
   *
   * Omitted, the mod builds a board from the artifact's own icon — see `board`.
   */
  model?: string;
  /** href of the glow. Omitted: the green one the shipped relics use. */
  effect?: string;
  /**
   * A picture on disk to build the icon from — a `.gif`, which is what artwork
   * ported from an older game survives as.
   *
   * Given, the mod carries its own 64x64 texture made from it and `icon` may be
   * left out. Omitted, `icon` has to name a texture that already exists.
   */
  picture?: string;
  /**
   * Stand the artifact on the map as a FLAT BOARD showing its own icon, instead
   * of borrowing a shipped artifact's model.
   *
   * The game's developer posters are exactly this — a quad with one material —
   * so the board references their geometry and carries a material of its own.
   * Nothing artistic is borrowed: a rectangle is a rectangle. Set `model` and
   * this is ignored.
   *
   * How wide, in tiles. The quad is moved so its centre is the tile's centre and
   * it stands on the ground rather than floating where the poster hung.
   */
  board?: { tiles: number };
}

/** Where an artifact's files sit inside a mod. */
export interface ArtifactPaths {
  dir: string;
  /** The map object's document. */
  shared: string;
  /** The object-palette entry, so the editor can place one. */
  link: string;
  name: string;
  description: string;
  /** The 64x64 the hero screen shows, and its `.dds` beside it. */
  icon: string;
  iconDDS: string;
  /** Where a board's own model and material go, when the mod builds one. */
  board: string;
  boardMaterial: string;
}

/**
 * Under `Objects-Artifacts/` because the editor's Filter groups are folder
 * prefixes read from `Editor/MapFilters.xml`, which no mod can add to: an entry
 * outside a known prefix is filed under "Other" instead of with the artifacts.
 */
const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Objects-Artifacts';

export function artifactPaths(spec: Pick<ArtifactSpec, 'file'>): ArtifactPaths {
  const dir = `Artifacts/${spec.file}`;
  return {
    dir,
    shared: `${dir}/${spec.file}.(${ARTIFACT_CLASS}).xdb`,
    link: `${LINK_DIR}/${spec.file}.xdb`,
    name: `${dir}/${spec.file}_Name.txt`,
    description: `${dir}/${spec.file}_Description.txt`,
    // Beside the shipped icons rather than in our own folder: the hero screen
    // finds one by the href in the record, so either works, and sitting where
    // the other 97 sit is what someone looking for it will expect.
    icon: `Textures/HeroScreen/Artifacts/${spec.file}.(Texture).xdb`,
    iconDDS: `Textures/HeroScreen/Artifacts/${spec.file}.(Texture).dds`,
    board: `${dir}/${spec.file}_Board.(Model).xdb`,
    boardMaterial: `${dir}/${spec.file}_Board.(Material).xdb`,
  };
}

/**
 * The material a board wears: our texture, and two-sided.
 *
 * Two-sided because the shipped posters are not, and an artifact spins on the
 * adventure map — a one-sided board would vanish for half of every turn. The
 * alpha test is what the posters already use, so a picture with transparency
 * lies on the ground as a silhouette rather than a card.
 */
export function boardMaterial(texture: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Material>',
    `\t<Texture href="${texture}#xpointer(/Texture)"/>`,
    '\t<Bump/>',
    '\t<SpecFactor>0</SpecFactor>',
    '\t<SpecColor>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</SpecColor>',
    '\t<Gloss/>',
    '\t<MetalMirror>0</MetalMirror>',
    '\t<DielMirror>0</DielMirror>',
    '\t<Mirror/>',
    '\t<CastShadow>false</CastShadow>',
    '\t<ReceiveShadow>false</ReceiveShadow>',
    '\t<Priority>0</Priority>',
    '\t<TranslucentColor>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t\t<z>0</z>', '\t</TranslucentColor>',
    '\t<FloatParam>0</FloatParam>',
    '\t<DetailTexture/>',
    '\t<DetailScale>5</DetailScale>',
    '\t<ProjectOnTerrain>false</ProjectOnTerrain>',
    // Unlit: an icon is a picture, not a surface, and shading it makes it muddy
    // at the times of day the adventure map goes dark.
    '\t<LightingMode>L_SELFILLUM</LightingMode>',
    '\t<DynamicMode>DM_DONT_CARE</DynamicMode>',
    '\t<Is2Sided>true</Is2Sided>',
    '\t<Effect>M_GENERIC</Effect>',
    '\t<AlphaMode>AM_ALPHA_TEST</AlphaMode>',
    '\t<AffectedByFog>true</AffectedByFog>',
    '\t<AddPlaced>false</AddPlaced>',
    '\t<IgnoreZBuffer>false</IgnoreZBuffer>',
    '\t<BackFaceCastShadow>false</BackFaceCastShadow>',
  ].join(EOL) + `${EOL}</Material>${EOL}`;
}

/** The model that hangs that material on a geometry. */
export function boardModel(material: string, geometry: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Model>',
    '\t<Materials>',
    `\t\t<Item href="${material}#xpointer(/Material)"/>`,
    '\t</Materials>',
    '\t<Skeleton/>',
    `\t<Geometry href="${geometry}#xpointer(/Geometry)"/>`,
    '\t<Animations/>',
    '\t<WindPower>0</WindPower>',
  ].join(EOL) + `${EOL}</Model>${EOL}`;
}

/** `<Field href="…"/>`, or an empty field when there is nothing to point at. */
function href(field: string, value: string | undefined, type: string): string {
  if (!value) return `<${field}/>`;
  const full = value.includes('#') ? value : `${value}#xpointer(/${type})`;
  return `<${field} href="${full}"/>`;
}

/**
 * The document that puts the artifact on the ground.
 *
 * The field ORDER comes from types.xml rather than from this file, for the same
 * reason dwellings take it from there: the type carries 22 fields across itself
 * and its bases, and a hardcoded order is one more thing to keep in step with
 * the game. Fields we say nothing about are written empty, which is what the
 * shipped documents do too.
 *
 * `activeTiles` is the one tile it lies on and `blockedTiles` is empty: an
 * artifact is walked onto, not walked around.
 */
export function artifactSharedDoc(spec: ArtifactSpec, p: ArtifactPaths, types: Map<string, SpecType>): string {
  const values: Record<string, string> = {
    Model: href('Model', spec.model ?? `/${p.board}`, 'Model'),
    AnimSet: `<AnimSet href="${ANIM_SET}"/>`,
    activeTiles: [
      '<activeTiles>', '\t\t<Item>', '\t\t\t<x>0</x>', '\t\t\t<y>0</y>', '\t\t</Item>', '\t</activeTiles>',
    ].join(EOL),
    PossessionMarkerTile: [
      '<PossessionMarkerTile>', '\t\t<x>0</x>', '\t\t<y>0</y>', '\t</PossessionMarkerTile>',
    ].join(EOL),
    Effect: href('Effect', spec.effect ?? GLOW, 'Effect'),
    messagesFileRef: [
      '<messagesFileRef>',
      `\t\t<Item href="/${p.name}"/>`,
      `\t\t<Item href="/${p.description}"/>`,
      '\t</messagesFileRef>',
    ].join(EOL),
    WaterBased: '<WaterBased>false</WaterBased>',
    ApplyHeroTrace: '<ApplyHeroTrace>false</ApplyHeroTrace>',
    SoundEffect: `<SoundEffect href="${PICKUP_SOUND}"/>`,
    flybyMessageFileRef: '<flybyMessageFileRef href=""/>',
    ObjectTypeFileRef: `<ObjectTypeFileRef href="${VISIBILITY}"/>`,
    TerrainAligned: '<TerrainAligned>false</TerrainAligned>',
    FlyPassable: '<FlyPassable>true</FlyPassable>',
    // The one that matters: this line, and only this line, says WHICH artifact
    // is lying here. A copied document with someone else's id in it is a
    // convincing-looking object that hands over the wrong thing.
    Type: '<Type>ARTF_RANDOM_SPECIFIC</Type>',
    ArtifactID: `<ArtifactID>${spec.id}</ArtifactID>`,
  };

  const fields = allFields(types, ARTIFACT_CLASS);
  if (!fields.length) throw new Error(`types.xml declares no ${ARTIFACT_CLASS}`);
  const body = fields.map((f) => values[f.name] ?? `<${f.name}/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${ARTIFACT_CLASS}>`,
    ...body.map((line) => `\t${line}`),
    `</${ARTIFACT_CLASS}>`,
  ].join(EOL) + EOL;
}

/**
 * The artifact's entry in the reference table, as the lines of one `<Item>`.
 *
 * Returned as lines rather than a document because it is not one: it goes
 * inside `Artifacts.xdb`, indented to sit with the other 97.
 */
export function artifactRecord(spec: ArtifactSpec, p: ArtifactPaths, types: Map<string, SpecType>): string[] {
  const stats = STAT_NAMES.map((s) => `\t\t<${s}>${spec.stats?.[s] ?? 0}</${s}>`);
  const values: Record<string, string[]> = {
    NameFileRef: [`<NameFileRef href="/${p.name}"/>`],
    DescriptionFileRef: [`<DescriptionFileRef href="/${p.description}"/>`],
    // The record's own <Model> is empty on every shipped artifact — what lies on
    // the map is the SHARED's model, and this field is not the same one.
    Model: ['<Model/>'],
    Type: [`<Type>${spec.rank ?? 'ARTF_CLASS_RELIC'}</Type>`],
    Slot: [`<Slot>${spec.slot}</Slot>`],
    Icon: [href('Icon', spec.icon ?? `/${p.icon}`, 'Texture')],
    CostOfGold: [`<CostOfGold>${spec.cost}</CostOfGold>`],
    AIValue: [`<AIValue>${spec.aiValue ?? 500}</AIValue>`],
    CanBeGeneratedToSell: [`<CanBeGeneratedToSell>${spec.canBeGeneratedToSell ?? false}</CanBeGeneratedToSell>`],
    HeroStatsModif: ['<HeroStatsModif>', ...stats, '\t</HeroStatsModif>'],
    ArtifactShared: [`<ArtifactShared href="/${p.shared}#xpointer(/${ARTIFACT_CLASS})"/>`],
    AvailableForPresets: ['<AvailableForPresets>true</AvailableForPresets>'],
    PresetPrice: [`<PresetPrice>${Math.round(spec.cost / 10)}</PresetPrice>`],
  };

  const fields = allFields(types, ARTIFACT_RECORD);
  if (!fields.length) throw new Error(`types.xml declares no ${ARTIFACT_RECORD}`);
  const body: string[] = [];
  for (const f of fields) body.push(...(values[f.name] ?? [`<${f.name}/>`]));
  return body;
}

/** The object-palette entry: a link file pointing at our artifact's shared. */
export function artifactLink(p: ArtifactPaths, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.shared}#xpointer(/${ARTIFACT_CLASS})"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
  ].join(EOL) + `${EOL}</AdvMapObjectLink>${EOL}`;
}
