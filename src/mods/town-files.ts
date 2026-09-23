// A faction's town: a shipped town copied whole under the faction's folder,
// and rewritten to be ours.
//
// A town is one `AdvMapTownShared` and everything it reaches: ten exterior
// stage models (village to capital, walls, magic guild), the town screen
// (`Interior`, an ArenaDesc with every building's model in it), the siege
// arena (`Combat`, walls and towers over a shipped arena), ~36 building
// records (`TownBuildingSharedStats`: cost, dependencies, the creature a
// dwelling hires, the names of its objects in the screen and on the build
// grid), the build grid itself (`TownBuildDefinition`), texts and icons —
// about 1300 files and 60 MB for Haven.
//
// All of it is COPIED, none of it referenced (see docs/FACTIONS.md — the
// rule is that everything of a faction lives in its folder, so a change to
// the faction changes nothing else). The copy keeps the donor's structure
// under `Factions/<file>/town/`, which is what lets every relative href
// inside it resolve unchanged, exactly as a creature's art does; only the
// top document moves out, to `Factions/<file>/<file>.(AdvMapTownShared).xdb`,
// with its hrefs made absolute into the tree.
//
// What the walk does NOT cross — `TOWN_STOP_AT`: the default camera set
// (which names every combat camera, hence every hero and creature), the
// creature that mans the siege towers and its shot, the siege scenery map
// and the arena's obstacle group. Those are other things: the faction's own
// creatures replace the first two, and the biome stock stays the game's.

import { buildingGlyph, buildingIcon, pictureIcon, raceIcon, specialButtonSkins, textureFiles, towerIcon, townIcon } from './faction-icons.ts';
import { captureMarkerFiles } from './capture-marker.ts';
import type { CaptureMarkerBuild } from './capture-marker.ts';
import type { TownButton } from './town-button.ts';
import type { RaceSpec } from './town-type-info.ts';
import type { IconPictures, IconTheme } from './faction-icons.ts';
import { grantedFeatures } from './town-features.ts';
import type { Grant, OwnFeature } from './town-features.ts';
import { copyArt, dataPath, resolve, uidFor } from './mod-art.ts';
import { UI_ROOT, mustRead, utf16 } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { donorObjectsOf, placeBuildingModel } from './town-screen.ts';
import { isOwnFile, mountOwn } from './own-files.ts';
import { placeSiegeParts } from './siege-parts.ts';
import type { OwnSiegePart, SiegePartName } from './siege-parts.ts';
import type { BuildingModel } from './town-screen.ts';
import { EOL, hrefOf, insertAfterLine, insertBeforeLine, once, retune, setHref } from './xml-edit.ts';
import { TOWN_GROUP } from './shared-groups.ts';
export { TOWN_GROUP };

export const TOWN_CLASS = 'AdvMapTownShared';
export const BUILD_CLASS = 'TownBuildDefinition';

/** Where the editor's object palette lists towns. */
export const TOWN_LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Towns';

/** Document kinds the town's copy leaves in the game's data. */
export const TOWN_STOP_AT: ReadonlySet<string> = new Set([
  'CamerasSet', 'Character', 'CreatureVisual', 'Shot', 'AdvMapDesc', 'ArenaObstaclesGroup',
]);

/**
 * Paths the town's copy leaves in the game's data, by what they are to the
 * engine rather than to the town.
 *
 * The exterior models carry a ground pad in the underground floor's texture:
 * the skin the object shows on the rock floor, hidden on the surface. What
 * the engine hides is not the texture but the MATERIAL — the one
 * `CragTerrain` document, shared by 458 models, is the engine's "underground
 * skin"; a copy of it under another path is a material like any other, and
 * its pad was a slab of rock under the town on grass (probe launch of
 * 2026-09-17: leaving the texture alone changed nothing, the material is
 * what it is known by). The terrain's own textures go with it.
 */
export const TOWN_LEAVE = (rel: string): boolean =>
  /^Textures\/Terrain\//i.test(rel) || /^_\(Material\)\/dev\/Test\/Malkovsky\/CragTerrain\./i.test(rel);

/** `TOWN_HEAVEN`'s ordinal: the first real town, after none/random/neutral. */
export const FIRST_REAL_TOWN = 3;

/** The eight shipped towns by `TownType` name — the ordinal `town_buildings_N` and the tables key on. */
export const SHIPPED_TOWN_ORDINALS: Readonly<Record<string, number>> = {
  TOWN_HEAVEN: 3, TOWN_PRESERVE: 4, TOWN_ACADEMY: 5, TOWN_DUNGEON: 6,
  TOWN_NECROMANCY: 7, TOWN_INFERNO: 8, TOWN_FORTRESS: 9, TOWN_STRONGHOLD: 10,
};

/** The guild's building type, and the hall's: Stronghold teaches its warcries from `TB_SPECIAL_1`, three levels. */
export const GUILD_BUILDING = 'TB_MAGIC_GUILD';
/** Whose guild records a town without magic takes: Stronghold's, five stubs with no cell. */
export const GUILD_STUB_DONOR = 'TOWN_STRONGHOLD';

export interface TownSpec {
  /** Folder and file stem inside the mod. */
  file: string;
  /** The faction's `TownType` — ours, out of the mod's `types.xml`. */
  type: string;
  /** The shipped town copied: its `TownType`, e.g. `TOWN_HEAVEN`. */
  donor: string;
  /** What a town of this faction is called on the map. */
  name: string;
  /** The two schools its magic guild teaches; the donor's when absent. */
  magicSchools?: readonly [string, string];
  /**
   * What its heroes learn in it. `'guild'` (the default) is a magic guild
   * teaching spells of `magicSchools`. `'none'` is a town WITHOUT magic: the
   * guild's five records become the stubs Stronghold's are — never built,
   * never shown, the engine wanting a record per level — and its slot on
   * the grid has no cell. The guild button stays dark, the window never
   * opens. What needed the guild has to be re-parented. A hero learns no
   * spell when his CLASS says so (hero-classes.ts, `magic: 'none'`).
   */
  magic?: 'guild' | 'none';
  /**
   * What the dwellings hire, by tier 1–7: the base creature for the dwelling
   * and its upgrade for the upgraded one (the expansion's second upgrade is
   * reached through the creature's own `Upgrades`, not through a building).
   * A tier left out keeps hiring the donor's.
   */
  dwellings?: Partial<Record<number, { base: string; upgrade: string }>>;
  /**
   * Whose siege to fight: the `TownType` of a shipped town whose `Combat`
   * block — arena, walls, towers, gate, moat, their effects and sounds, the
   * scenery and the ground — replaces the donor's; or a MIX, one town's
   * arena with another's walls, towers, gate or moat. The donor's own when
   * absent. The block is one self-contained element of the shared document,
   * and every building in it is one too, standing where every town's does
   * (the siege layout is the same eight times over), so the parts combine.
   */
  siege?: string | SiegeMix;
  /**
   * What the town looks like on the map: the `TownType` of a shipped town
   * whose `Exterior` — its ten stage models with their effects and its gate
   * geometry — replaces the donor's; or a MIX, a town per stage. The donor's
   * own when absent. Every shipped town lists the same ten stages in the
   * same order (`EXTERIOR_STAGES`), each one model and one effect, so the
   * stages combine.
   */
  exterior?: string | ExteriorMix;
  /**
   * Who mans the towers: the Character that stands on them and the Shot it
   * fires, as hrefs. Every tower with a shooter gets this one; the donor's
   * creature when absent.
   */
  siegeShooter?: { character: string; shot: string };
  /**
   * Draw the town's icons in this theme instead of keeping the donor's: the
   * building icons on the build screen, the town's own two, and a tile for
   * the race picker (`TownBuild.raceIcon`). See faction-icons.ts.
   */
  icons?: IconTheme;
  /**
   * Pictures of our own for any of those icons — files on disk, each fitted
   * to the icon's size. A slot given here wins over the theme; a slot left
   * out is the theme's when there is one, the donor's when there is not.
   */
  pictures?: IconPictures;
  /**
   * The building tree, edited: by building, what changes in its copied
   * record and on the build grid, or `null` to drop it — with every upgrade
   * above it, so `TB_SHIPYARD: null` is a slot gone and `'TB_TOWN_HALL/4':
   * null` a town without a Capitol. A dropped building is never copied: its
   * record, texts and icon stay the donor's. What depended on it has to be
   * re-parented (`requires`) or dropped too; the copy refuses otherwise.
   */
  buildings?: Readonly<Record<BuildingKey, BuildingEdit | null>>;
  /**
   * The race as such — its name, the silo's income, the native war machine,
   * the moat: the type's record in `TownTypesInfo` (town-type-info.ts). The
   * donor's record under our type when absent, its name included.
   */
  race?: RaceSpec;
  /**
   * The faction's adventure-map Lua, run on every map: where a building's
   * button function (`BuildingEdit.button.lua`) is defined. Loaded through
   * the mod's global script (town-button.ts, `factionScriptFile`).
   */
  script?: string;
}

/**
 * A building's name in `TownSpec.buildings`: its `ETownBuilding` type, and
 * its upgrade level after a slash when past the first — `TB_SPECIAL_1`,
 * `TB_TOWN_HALL/4`, `TB_DWELLING_2/2`.
 */
export type BuildingKey = string;

export type Resource = 'Wood' | 'Ore' | 'Mercury' | 'Crystal' | 'Sulfur' | 'Gem' | 'Gold';
export const RESOURCES: readonly Resource[] = ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold'];

export interface BuildingEdit {
  /**
   * Take this building from another shipped town instead of the donor: the
   * `TownType` whose records of this type, at EVERY level, replace the
   * donor's in the list, with that town's slot on the build grid (cells and
   * all, or none when that town has none). On the whole building's key
   * (`TB_SPECIAL_1`), never a level's. What their records needed of their
   * own town they need of ours — the donor's building of the same type and
   * level, or the copy refuses until `requires` says otherwise. The rest of
   * the edit applies to the records taken.
   */
  from?: string;
  /**
   * What it DOES: the compiled effect of a shipped town's building, level
   * for level — the Library's spell, the Hall of Trial's warcry tiers
   * (town-features.ts). A building taken with `from` grants what it granted
   * there unless this says otherwise; `null` is a building with no effect.
   * A record with no such row does nothing whatever the engine has.
   */
  grants?: Grant | null;
  /** Its name on the build screen; the donor's when absent. */
  name?: string;
  description?: string;
  /** The resources named change; the rest keep the donor's price. */
  cost?: Partial<Record<Resource, number>>;
  /** The town level it asks for (`DevLevelNeeded`: 0, 3, 6, 9, 12, 15). */
  devLevel?: number;
  /** What has to stand first, replacing the donor's list; `[]` for nothing. */
  requires?: readonly BuildingKey[];
  /** Its cell on the build grid (`XSlotPos`/`YSlotPos`). */
  slot?: { x: number; y: number };
  /**
   * Its model in the town screen, from anywhere, placed where a dropped
   * building stood or at a spot given outright — see town-screen.ts. The
   * donor's model when absent.
   */
  model?: BuildingModel;
  /**
   * The town screen's centre button opens it: the map function the click
   * calls, with the town's script name. One building of a town at most — the
   * dial has one such button (town-button.ts).
   */
  button?: { lua: string };
}

export function buildingKey(type: string, level: number): BuildingKey {
  return level === 1 ? type : `${type}/${level}`;
}

export function parseBuildingKey(key: BuildingKey): { type: string; level: number } {
  const m = /^(TB_[A-Z0-9_]+?)(?:\/([1-9]))?$/.exec(key);
  if (!m) throw new Error(`${key}: a building is TB_<TYPE> or TB_<TYPE>/<level>`);
  if (m[2] === '1') throw new Error(`${key}: the first level is ${m[1]} alone`);
  return { type: m[1]!, level: m[2] ? Number(m[2]) : 1 };
}

/**
 * A siege assembled from several towns. `arena` gives the field — the scene,
 * the ground, the obstacles and every building not named below; each other
 * key names the town whose building of that kind stands on it.
 */
export interface SiegeMix {
  arena: string;
  /** A shipped town's, or models of ours for every piece of the part (siege-parts.ts). */
  walls?: string | OwnSiegePart;
  gate?: string | OwnSiegePart;
  towers?: string | OwnSiegePart;
  moat?: string | OwnSiegePart;
}

/** Which building types each part of a mix covers. */
const SIEGE_PARTS: Record<Exclude<keyof SiegeMix, 'arena'>, readonly string[]> = {
  walls: ['WALL'],
  gate: ['GATE'],
  towers: ['LEFT_TOWER', 'RIGHT_TOWER', 'BIG_TOWER'],
  moat: ['MOAT'],
};

/**
 * The ten stages of a town on the map, in the order every shipped town lists
 * them under `Exterior/upgrades` — named after the models' files
 * (`Heaven-town_mg_wall1.xdb`): the hall's level (town, city, capital),
 * the magic guild (`mg`) and the walls (1, 2).
 */
export const EXTERIOR_STAGES = [
  'town', 'town_wall1', 'town_wall2', 'town_mg', 'town_mg_wall1', 'town_mg_wall2',
  'city_mg', 'city_mg_wall1', 'city_mg_wall2', 'capital_mg_wall2',
] as const;
export type ExteriorStage = typeof EXTERIOR_STAGES[number];

/**
 * An exterior assembled from several towns: the town whose model and effect
 * stand at each stage, the donor's at a stage left out; and whose gate
 * geometry the AI walks through — the donor's when absent. A stage may
 * instead name a `Model` document of our own on disk (`C:\\…\\Town.xdb`,
 * own-files.ts): that model stands at the stage, with the donor's effect
 * for it.
 */
export interface ExteriorMix {
  stages: Partial<Record<ExteriorStage, string>>;
  /** Whose gate the AI walks through — a shipped town's, or an `AIGeometry` document of ours on disk. */
  gates?: string;
}

export interface TownPaths {
  dir: string;
  /** The town: `AdvMapTownShared`, ours. */
  shared: string;
  /** The donor's closure, structure preserved. */
  art: string;
  /** The build screen's grid. */
  build: string;
  /** The palette entry. */
  link: string;
  /** The name text. */
  name: string;
  /** Where drawn icons go. */
  icons: string;
}

export function townPaths(spec: Pick<TownSpec, 'file'>): TownPaths {
  const dir = `Factions/${spec.file}`;
  return {
    dir,
    shared: `${dir}/${spec.file}.(${TOWN_CLASS}).xdb`,
    art: `${dir}/town`,
    build: `${dir}/${spec.file}.(${BUILD_CLASS}).xdb`,
    link: `${TOWN_LINK_DIR}/${spec.file}.xdb`,
    name: `${dir}/${spec.file}_Name.txt`,
    icons: `${dir}/icons`,
  };
}

/** The shared document of the shipped town whose `Type` is `type`. */
export function donorTown(type: string, read: DataReader): string {
  const group = mustRead(read, TOWN_GROUP);
  for (const m of group.matchAll(/href="([^"]*)"/g)) {
    const rel = dataPath(m[1]!);
    const text = read(rel)?.toString('latin1');
    if (text?.includes(`<Type>${type}</Type>`)) return rel;
  }
  throw new Error(`no shipped town of type ${type} in ${TOWN_GROUP}`);
}

/**
 * The build grid of the shipped town numbered `ordinal`: `UIGameRoot` keys
 * them `town_buildings_<ordinal - 3>`, which is how the game asks for one.
 */
export function donorBuildDefinition(ordinal: number, read: DataReader): string {
  const root = mustRead(read, UI_ROOT);
  const id = `town_buildings_${ordinal - FIRST_REAL_TOWN}`;
  const at = once(root, `<ID>${id}</ID>`, 'build definition');
  const href = hrefOf(root.slice(at), 'TownDefinition');
  if (!href) throw new Error(`${UI_ROOT}: ${id} names no TownDefinition`);
  return resolve(UI_ROOT, href) ?? href;
}

export interface TownBuild {
  files: ModFile[];
  paths: TownPaths;
  /** The effects the faction's buildings grant, for the buildings file (`featureLines`). */
  features: OwnFeature[];
  /** Source path → the copy's path, for whoever edits a building record next. */
  at: Map<string, string>;
  /** The building records that made it into the copy, by key. */
  records: Map<BuildingKey, string>;
  /** What the copy left in the game's data. */
  stopped: string[];
  missing: string[];
  /** The race picker's tile, when icons were drawn: a Texture document's path. */
  raceIcon?: string;
  /** The siege tower on the initiative bar, likewise — for `ATB_TOWER_ICONS`. */
  towerIcon?: string;
  /** The sign over an owned town and its flag, in every player's colour — for `patchColourSchemes` (capture-marker.ts). */
  captureMarker?: CaptureMarkerBuild;
  /** The centre button's building, function and skins, for the faction to register (town-button.ts). */
  button?: Omit<TownButton, 'town'>;
}

/**
 * The initiative bar's list of tower portraits by town-type NAME. A type of
 * ours goes in under the name the DLL answers for it, with its own picture.
 */
export const ATB_TOWER_ICONS = 'UI/CombatScreen-Heavy/ATBBar/AdditionalIcons.(WindowRelatedTextures).xdb';

/** The list with one more entry: `type` → the texture at `icon` (a data path). */
export function patchTowerIcons(list: string, type: string, icon: string): string {
  if (list.includes(`<TextureName>${type}</TextureName>`)) throw new Error(`${ATB_TOWER_ICONS} already lists ${type}`);
  return insertBeforeLine(list, once(list, '</textures>', 'tower icons list'), [
    '<Item>', `	<TextureName>${type}</TextureName>`,
    `	<Texture href="/${icon}#xpointer(/Texture)"/>`, '</Item>',
  ]);
}

/**
 * Copy the donor and make it ours: the type, the name, the schools; the build
 * grid; the palette entry.
 */
export function buildTown(spec: TownSpec, donorOrdinal: number, read: DataReader): TownBuild {
  const p = townPaths(spec);
  const source = donorTown(spec.donor, read);
  // Another town's siege is spliced into the donor's document BEFORE the copy
  // walks it, so what the siege reaches is copied along with everything else.
  // A mix also rewrites the arena's own object list, so the field lists the
  // buildings that stand on it; both documents are served to the walk edited.
  const seeded = new Map<string, string>();
  const mix: SiegeMix | null = typeof spec.siege === 'string' ? { arena: spec.siege } : spec.siege ?? null;
  if (mix) {
    const shared = (type: string): string => (type === spec.donor ? mustRead(read, source) : mustRead(read, donorTown(type, read)));
    let combat = combatOf(shared(mix.arena), mix.arena);
    const swapped: { ours: string; theirs: string }[] = [];
    for (const [part, types] of Object.entries(SIEGE_PARTS) as [keyof typeof SIEGE_PARTS, readonly string[]][]) {
      const from = mix[part];
      // A part of ours goes in after the walk, over the arena's own piece.
      if (!from || from === mix.arena || typeof from !== 'string') continue;
      const theirs = buildingsOf(combatOf(shared(from), from));
      for (const type of types) {
        const ours = buildingsOf(combat).filter((b) => b.type === type);
        const replacements = theirs.filter((b) => b.type === type);
        if (ours.length !== replacements.length) throw new Error(`${from}'s siege has ${replacements.length} ${type}, ${mix.arena}'s ${ours.length}`);
        for (const [i, b] of ours.entries()) {
          combat = combat.replace(b.text, replacements[i]!.text);
          swapped.push({ ours: b.text, theirs: replacements[i]!.text });
        }
      }
    }
    const donor = mustRead(read, source);
    const [ds, de] = combatSpan(donor, spec.donor);
    seeded.set(source, donor.slice(0, ds) + combat + donor.slice(de));
    // The arena's list: the objects the arena's own building named (its model,
    // its shooter's stand — a wall has no stand) give way to the ones the
    // swapped-in building names, by absolute path. By what the building
    // says, not by name: Dungeon's big tower is `s_central_tower`.
    if (swapped.length) {
      const arenaHref = hrefOf(combat, 'ArenaDesc');
      const arenaPath = arenaHref && resolve(source, arenaHref);
      if (!arenaPath) throw new Error(`${mix.arena}'s siege names no ArenaDesc`);
      let arena = mustRead(read, arenaPath);
      for (const { ours, theirs } of swapped) {
        for (const field of ['Object', 'Locator']) {
          const was = hrefOf(ours, field), now = hrefOf(theirs, field);
          if (!was || !now) continue;
          const base = was.replace(/#.*$/, '').split('/').pop()!;
          const own = new RegExp(`<Item href="${base.replace(/[.()]/g, '\\$&')}#[^"]*"/>`);
          if (!own.test(arena)) throw new Error(`${arenaPath} lists no ${base}`);
          arena = arena.replace(own, `<Item href="${now}"/>`);
        }
      }
      seeded.set(arenaPath, arena);
    }
  }
  // Another town's exterior goes in the same way, before the walk: the whole
  // `AdvMapTownExterior`, or the donor's with a stage swapped for another
  // town's item — every href in a part taken from elsewhere made absolute
  // first, so the walk copies what the part names as it copies the rest.
  // Folders of ours mounted for the walk: a stage model on disk is read
  // through these, by its mounted path, and copied under the town like
  // anything else the exterior names.
  const owns: DataReader[] = [];
  if (spec.exterior) {
    const whole = typeof spec.exterior === 'string' ? spec.exterior : null;
    const mix: ExteriorMix = typeof spec.exterior === 'string' ? { stages: {} } : spec.exterior;
    const exteriorFrom = (type: string): string => exteriorOf(type === spec.donor ? source : donorTown(type, read), read, type);
    let exterior = exteriorFrom(whole ?? spec.donor);
    const ours = stagesOf(exterior, whole ?? spec.donor);
    for (const [stage, from] of Object.entries(mix.stages) as [ExteriorStage, string][]) {
      const i = EXTERIOR_STAGES.indexOf(stage);
      if (i < 0) throw new Error(`no exterior stage ${stage} — the ten are ${EXTERIOR_STAGES.join(', ')}`);
      if (from === spec.donor) continue;
      if (isOwnFile(from)) {
        // A model of ours at the stage; the effect stays the one the stage had.
        const own = mountOwn(read, from);
        owns.push(own.local);
        const effect = /<Effect[^>]*\/>/.exec(ours[i]!)?.[0] ?? '<Effect/>';
        const item = ours[i]!.replace(/<Model[^>]*\/>/, `<Model href="/${own.rel}#xpointer(/Model)"/>`).replace(/<Effect[^>]*\/>/, effect);
        if (item === ours[i]) throw new Error(`${spec.file}: the exterior's ${stage} names no <Model> to replace`);
        exterior = exterior.replace(ours[i]!, item);
        continue;
      }
      exterior = exterior.replace(ours[i]!, stagesOf(exteriorFrom(from), from)[i]!);
    }
    if (mix.gates && mix.gates !== spec.donor) {
      if (isOwnFile(mix.gates)) {
        // An AIGeometry document of ours — the hull the hero walks into — mounted
        // like a stage model, copied by the walk with its binary.
        const own = mountOwn(read, mix.gates);
        owns.push(own.local);
        exterior = exterior.replace(gatesOf(exterior, spec.donor), `<Gates href="/${own.rel}#xpointer(/AIGeometry)"/>`);
      } else {
        exterior = exterior.replace(gatesOf(exterior, spec.donor), gatesOf(exteriorFrom(mix.gates), mix.gates));
      }
    }
    const donor = seeded.get(source) ?? mustRead(read, source);
    const [es, ee] = exteriorSpan(donor, spec.donor);
    const id = `item_${uidFor(`exterior:${spec.file}`).toLowerCase()}`;
    seeded.set(source, `${donor.slice(0, es)}<Exterior href="#n:inline(AdvMapTownExterior)" id="${id}">${EOL}\t\t${exterior}${EOL}\t</Exterior>${donor.slice(ee)}`);
  }
  // A dropped building leaves the donor's list BEFORE the walk too, so its
  // record, its texts and its icon are never copied; and a re-parented one
  // has its dependencies rewritten before the walk as well, or the walk
  // would reach the dropped record through the old list. The grid loses
  // the building's cell here too (and the slot, when it was the last).
  let build = mustRead(read, donorBuildDefinition(donorOrdinal, read));
  const edits = buildingEdits(spec);
  if (edits) {
    let donor = seeded.get(source) ?? mustRead(read, source);
    // A building taken from another town goes into the donor's list BEFORE
    // the walk, by absolute href, so the walk copies their records with the
    // rest — structure preserved, so what they name of each other (the
    // hall's second level needs its first) still resolves in the copy. What
    // they name of THEIR town is repointed at the donor's building of the
    // same type and level, or refused. The grid takes their slot whole.
    for (const [key, edit] of Object.entries(edits)) {
      if (!edit?.from || edit.from === spec.donor) continue;
      const { type, level } = parseBuildingKey(key);
      if (level !== 1) throw new Error(`${key}: \`from\` takes the whole building — name ${type}, not a level of it`);
      const fromSource = donorTown(edit.from, read);
      const theirs = listedBuildings(mustRead(read, fromSource), fromSource, read).filter((b) => b.type === type);
      if (!theirs.length) throw new Error(`${edit.from} has no ${type} to take`);
      const mine = listedBuildings(donor, source, read);
      for (const b of theirs) {
        let record = mustRead(read, b.path);
        for (const dep of dependencyItems(record, b.path)) {
          const [t, l] = typeAndLevel(mustRead(read, dep.path), dep.path);
          if (t === type) continue;
          const on = mine.find((m) => m.type === t && m.level === l);
          if (!on) throw new Error(`${edit.from}'s ${b.key} needs ${buildingKey(t, l)}, which ${spec.donor} has not — re-parent it (requires)`);
          record = record.replace(`href="${dep.href}"`, `href="/${on.path}#xpointer(/${BUILDING_RECORD})"`);
        }
        seeded.set(b.path, record);
      }
      // And the other way round: what needed the donor's building needs the
      // one taken, at the same level — or the walk would still reach the
      // donor's record through the dependency, and the copy would hold both.
      const ours = mine.filter((b) => b.type === type);
      for (const b of mine) {
        if (b.type === type) continue;
        let record = seeded.get(b.path) ?? mustRead(read, b.path);
        let changed = false;
        for (const dep of dependencyItems(record, b.path)) {
          const was = ours.find((o) => o.path === dep.path);
          if (!was) continue;
          const now = theirs.find((t) => t.level === was.level);
          if (!now) throw new Error(`${b.key} needs ${was.key}, and ${edit.from}'s ${type} has no level ${was.level} — re-parent it (requires)`);
          record = record.replace(`href="${dep.href}"`, `href="/${now.path}#xpointer(/${BUILDING_RECORD})"`);
          changed = true;
        }
        if (changed) seeded.set(b.path, record);
      }
      donor = swapListed(donor, ours, theirs.map((b) => `<Item href="/${b.path}#xpointer(/${BUILDING_RECORD})"/>`), `${type} in ${spec.donor}'s list`);
      const fromOrdinal = SHIPPED_TOWN_ORDINALS[edit.from];
      if (!fromOrdinal) throw new Error(`${edit.from} is not a shipped town — a building comes from one of ${Object.keys(SHIPPED_TOWN_ORDINALS).join(', ')}`);
      build = replaceGridSlot(build, type, gridSlotText(mustRead(read, donorBuildDefinition(fromOrdinal, read)), type));
    }
    seeded.set(source, donor);
    const listed = listedBuildings(donor, source, read);
    const byKey = new Map(listed.map((b) => [b.key, b]));
    const dropped = new Set<string>();
    for (const [key, edit] of Object.entries(edits)) {
      const { type, level } = parseBuildingKey(key);
      if (!byKey.has(key)) throw new Error(`${spec.donor} has no building ${key} — it has ${[...byKey.keys()].join(', ')}`);
      if (edit !== null) continue;
      for (const b of listed) if (b.type === type && b.level >= level) dropped.add(b.path);
    }
    // A town without magic has no guild to build: the records stay (stubs,
    // like Stronghold's) but nothing may need them, exactly as if dropped.
    const unbuildable = new Set(spec.magic === 'none' ? listed.filter((b) => b.type === GUILD_BUILDING).map((b) => b.path) : []);
    const keyOf = new Map(listed.map((b) => [b.path, b.key]));
    let town = donor;
    for (const b of listed) {
      if (dropped.has(b.path)) {
        town = dropLine(town, once(town, b.item, `${b.key} in ${spec.donor}'s list`));
        build = dropGridCell(build, b.type, b.level);
        continue;
      }
      const requires = edits[b.key]?.requires;
      if (requires) {
        const items = requires.map((dep) => {
          const on = byKey.get(dep);
          if (!on || dropped.has(on.path)) throw new Error(`${b.key} requires ${dep}, which the town has not`);
          return `\t\t<Item href="/${on.path}#xpointer(/TownBuildingSharedStats)"/>`;
        });
        const block = items.length ? ['\t<dependencies>', ...items, '\t</dependencies>'].join(EOL) : '\t<dependencies/>';
        const re = /[ \t]*<dependencies(?:\/>|>[\s\S]*?<\/dependencies>)/;
        const record = mustRead(read, b.path);
        if (!re.test(record)) throw new Error(`${b.key}: no <dependencies> in ${b.path}`);
        seeded.set(b.path, record.replace(re, block));
        continue;
      }
      for (const dep of dependenciesOf(seeded.get(b.path) ?? mustRead(read, b.path), b.path)) {
        if (dropped.has(dep)) throw new Error(`${b.key} needs ${keyOf.get(dep)}, which is dropped — re-parent it (requires) or drop it too`);
        if (unbuildable.has(dep)) throw new Error(`${b.key} needs ${keyOf.get(dep)}, which a town without magic never builds — re-parent it (requires)`);
      }
    }
    if (dropped.size) seeded.set(source, town);
  }
  const readSeeded: DataReader = (rel) => {
    const text = seeded.get(rel);
    if (text) return Buffer.from(text, 'latin1');
    for (const own of owns) {
      const data = own(rel);
      if (data) return data;
    }
    return read(rel);
  };
  const copy = copyArt([source], p.art, readSeeded, `town:${spec.file}`, { stopAt: TOWN_STOP_AT, leave: TOWN_LEAVE });
  // A document a model of ours names and its folder has not is a refusal,
  // not a note: the game's data is not looked in for a mounted path, and a
  // model that reaches a texture nobody has is a model with no texture.
  for (const m of copy.missing) {
    if (m.startsWith('own/') && m.toLowerCase().endsWith('.xdb')) throw new Error(`${spec.file}: a model of yours reaches ${m}, which its folder has not`);
  }
  const copied = copy.at.get(source)!;
  const files = new Map(copy.files);

  // The top document leaves the tree, so what was relative in it is absolute now.
  let town = files.get(copied)!.toString('latin1');
  files.delete(copied);
  town = town.replace(/href="([^"#][^"]*)"/g, (whole, href: string) => {
    if (href.startsWith('/') || href.startsWith('\\')) return whole;
    const target = resolve(source, href);
    if (!target) return whole;
    const hash = href.indexOf('#');
    const fragment = hash < 0 ? '' : href.slice(hash);
    return `href="/${copy.at.get(target) ?? target}${fragment}"`;
  });

  town = town.replace(`<Type>${spec.donor}</Type>`, `<Type>${spec.type}</Type>`);
  once(town, `<Type>${spec.type}</Type>`, 'town type');
  town = town.replace(
    /<messagesFileRef>[\s\S]*?<\/messagesFileRef>/,
    `<messagesFileRef>${EOL}\t\t<Item href="/${p.name}"/>${EOL}\t</messagesFileRef>`,
  );
  if (spec.magicSchools && spec.magic === 'none') throw new Error(`${spec.file}: a town without magic has no guild to teach ${spec.magicSchools.join(' and ')}`);
  if (spec.magicSchools) {
    for (const [i, school] of spec.magicSchools.entries()) {
      town = town.replace(new RegExp(`<MagicSchool_${i}>[^<]*</MagicSchool_${i}>`), `<MagicSchool_${i}>${school}</MagicSchool_${i}>`);
    }
  }
  if (spec.siegeShooter) {
    const { character, shot } = spec.siegeShooter;
    town = town.replace(
      /<Shooter href="[^"]+"\/>(\s*)<Shot href="[^"]+"\/>/g,
      (_, gap: string) => `<Shooter href="${character}"/>${gap}<Shot href="${shot}"/>`,
    );
  }
  files.set(p.shared, Buffer.from(town, 'latin1'));

  // The building records in the copy, by key — the ones the town's LIST
  // names, which after a drop is the tree as the spec has it. The list and
  // not every record the walk reached: Necropolis's Ruined Tower depends on
  // PRESERVE's fort (shipped data), so the walk copies a second TB_FORT the
  // town never lists, and which no screen draws.
  const records = new Map<BuildingKey, string>();
  {
    const start = once(town, '<buildings>', `${spec.file}'s building list`);
    const end = once(town, '</buildings>', `${spec.file}'s building list end`);
    for (const m of town.slice(start, end).matchAll(/<Item href="([^"]+)"\/>/g)) {
      const path = resolve(p.shared, m[1]!);
      const data = path ? files.get(path) : undefined;
      if (!path || !data) throw new Error(`${spec.file}: the copy lists ${m[1]}, which it does not hold`);
      const key = buildingKey(...typeAndLevel(data.toString('latin1'), path));
      if (records.has(key)) throw new Error(`${spec.donor} lists ${key} twice: ${records.get(key)} and ${path}`);
      records.set(key, path);
    }
  }

  // The dwellings' creatures: every building record in the copy whose Type is
  // a dwelling of a tier we were given, by its upgrade level.
  for (const path of records.values()) {
    const text = files.get(path)!.toString('latin1');
    const tier = /<Type>TB_DWELLING_(\d)<\/Type>/.exec(text);
    const level = /<Upgrade>BLD_UPG_(\d)<\/Upgrade>/.exec(text);
    const hires = tier && level && spec.dwellings?.[Number(tier[1])];
    if (!hires) continue;
    const creature = level[1] === '1' ? hires.base : hires.upgrade;
    once(text, '<Creature>', `${path} creature`);
    files.set(path, Buffer.from(text.replace(/<Creature>[^<]*<\/Creature>/, `<Creature>${creature}</Creature>`), 'latin1'));
  }

  // The tree's edits: what a record says, and where its cell is on the grid.
  for (const [key, edit] of Object.entries(edits ?? {})) {
    if (!edit) continue;
    const path = records.get(key);
    if (!path) throw new Error(`${key} is dropped, nothing to edit`);
    let text = files.get(path)!.toString('latin1');
    // The texts are the copy's own files, one per record: ours go in their place.
    for (const [field, value] of [['NameFileRef', edit.name], ['DescriptionFileRef', edit.description]] as const) {
      if (value === undefined) continue;
      const href = hrefOf(text, field);
      const target = href && dataPath(href);
      if (!target || !files.has(target)) throw new Error(`${key}: ${field} names no text in the copy (${href})`);
      files.set(target, utf16(value));
    }
    for (const [resource, amount] of Object.entries(edit.cost ?? {})) {
      if (!RESOURCES.includes(resource as Resource)) throw new Error(`${key}: no such resource as ${resource}`);
      const at = once(text, `<${resource}>`, `${key} cost`);
      text = text.slice(0, at) + text.slice(at).replace(new RegExp(`<${resource}>\\d+</${resource}>`), `<${resource}>${amount}</${resource}>`);
    }
    if (edit.devLevel !== undefined) {
      once(text, '<DevLevelNeeded>', `${key} town level`);
      text = text.replace(/<DevLevelNeeded>\d+<\/DevLevelNeeded>/, `<DevLevelNeeded>${edit.devLevel}</DevLevelNeeded>`);
    }
    // `requires` went into the donor's record before the walk.
    if (edit.slot) {
      const { type, level } = parseBuildingKey(key);
      build = moveGridCell(build, type, level, edit.slot);
    }
    files.set(path, Buffer.from(text, 'latin1'));
  }

  // After every drop, swap and move: no two buildings on one cell.
  checkGridCells(build, spec.file);

  // What the buildings do: a row per level of the shipped building each
  // grant names, under our slot. A building taken from another town keeps
  // its effect unless told otherwise.
  const features: OwnFeature[] = [];
  for (const [key, edit] of Object.entries(edits ?? {})) {
    if (!edit) continue;
    const { type, level } = parseBuildingKey(key);
    if (edit.grants === undefined && !edit.from) continue;
    if (level !== 1) throw new Error(`${key}: an effect is the whole building's — name ${type}, not a level of it`);
    if (edit.grants === null) continue;
    features.push(...grantedFeatures(type, edit.grants ?? { like: edit.from! }, `${spec.file}: ${key}`, edit.grants === undefined));
  }

  // Models of ours in the town screen: placed, named, and every level of the
  // building pointed at the name.
  let donorObjects: Map<string, string> | null = null;
  for (const [key, edit] of Object.entries(edits ?? {})) {
    if (!edit?.model) continue;
    const { type } = parseBuildingKey(key);
    const interiorHref = hrefOf(town, 'Interior');
    if (!interiorHref) throw new Error(`${spec.donor} names no Interior`);
    const ofType = [...records].filter(([k]) => parseBuildingKey(k).type === type).map(([, path]) => path);
    const name = `${spec.file}_${type.slice(3).toLowerCase()}`;
    donorObjects ??= donorObjectsOf(mustRead(read, source), source, read);
    // A model of our own on disk is the same thing from another root: its
    // folder is mounted and the copier reads it as it reads the game's.
    const own = isOwnFile(edit.model.source) ? mountOwn(read, edit.model.source) : null;
    const placed = placeBuildingModel({
      name, levels: ofType.length, model: own ? { ...edit.model, source: own.rel } : edit.model,
      interior: dataPath(interiorHref), files, read: own?.read ?? read,
      dir: `${p.dir}/buildings/${name}`,
      donorObject: /<ModObjectName>([^<]*)<\/ModObjectName>/.exec(files.get(records.get(key)!)!.toString('latin1'))?.[1] ?? '',
      donorObjects,
    });
    for (const [path, data] of placed.files) files.set(path, data);
    for (const path of ofType) {
      const text = files.get(path)!.toString('latin1');
      once(text, '<ModObjectName>', `${key} model object`);
      files.set(path, Buffer.from(text.replace(/<ModObjectName>[^<]*<\/ModObjectName>/, `<ModObjectName>${placed.name}</ModObjectName>`), 'latin1'));
    }
  }

  // Siege parts of ours: the models copied and stood where the arena's
  // pieces stand, the records and the arena's list pointed at them.
  {
    const own: Partial<Record<SiegePartName, OwnSiegePart>> = {};
    const siegeMix: SiegeMix | null = typeof spec.siege === 'string' ? null : spec.siege ?? null;
    for (const part of ['walls', 'towers', 'gate', 'moat'] as const) {
      const v = siegeMix?.[part];
      if (v && typeof v !== 'string') own[part] = v;
    }
    if (Object.keys(own).length) placeSiegeParts({ faction: spec.file, parts: own, files, shared: p.shared, dir: p.dir, read });
  }

  // The icons: one per building record, the town's two, the race's, the
  // tower's, the sign over a captured town — each a picture of ours when
  // given, drawn from the theme when there is one, the donor's otherwise.
  let race: string | undefined, tower: string | undefined, captureMarker: CaptureMarkerBuild | undefined;
  const theme = spec.icons;
  const pictures = spec.pictures ?? {};
  if (theme || spec.pictures) {
    const put = (name: string, image: ReturnType<typeof townIcon>): string => {
      const path = `${p.icons}/${name}.xdb`;
      for (const f of textureFiles(path, image)) files.set(f.path, f.data);
      return `/${path}#xpointer(/Texture)`;
    };
    /** The picture given for a slot, or what the theme draws, or nothing. */
    const icon = (file: string | undefined, size: number, drawn: () => ReturnType<typeof townIcon>): ReturnType<typeof townIcon> | null =>
      file ? pictureIcon(file, size) : theme ? drawn() : null;
    for (const [key, path] of records) {
      const text = files.get(path)!.toString('latin1');
      const [type, level] = typeAndLevel(text, path);
      // A stub — Stronghold's guild records, never shown — has no icon and keeps none.
      if (/<Icon\/>/.test(text)) continue;
      const image = icon(pictures.buildings?.[key], 128, () => buildingIcon(buildingGlyph(type, level), theme!));
      if (!image) continue;
      const href = put(`${type.slice(3).toLowerCase()}_${level}`, image);
      files.set(path, Buffer.from(setHref(text, 'Icon', href, `${path} icon`), 'latin1'));
    }
    const plain = icon(pictures.town, 55, () => townIcon(theme!, false));
    if (plain) town = setHref(town, 'Icon55x55', put('town', plain), 'town icon');
    const fortified = icon(pictures.townFort, 55, () => townIcon(theme!, true));
    if (fortified) town = setHref(town, 'IconWithFort55x55', put('town_fort', fortified), 'town icon with fort');
    files.set(p.shared, Buffer.from(town, 'latin1'));
    const raceTile = icon(pictures.race, 55, () => raceIcon(theme!));
    if (raceTile) race = put('race', raceTile).replace(/#.*$/, '').slice(1);
    const towerTile = icon(pictures.tower, 128, () => towerIcon(theme!));
    if (towerTile) tower = put('tower', towerTile).replace(/#.*$/, '').slice(1);
    if (theme || pictures.capture) {
      captureMarker = captureMarkerFiles(spec, theme ?? null, read, pictures.capture);
      for (const f of captureMarker.files) files.set(f.path, f.data);
    }
  }

  // The centre button: one building's, its skins pictures of ours or drawn from the theme.
  let button: Omit<TownButton, 'town'> | undefined;
  for (const [key, edit] of Object.entries(edits ?? {})) {
    if (!edit?.button) continue;
    if (button) throw new Error(`${spec.file}: two buildings want the centre button; the dial has one`);
    const { type } = parseBuildingKey(key);
    const given = pictures.button;
    const skins = given
      ? { normal: pictureIcon(given.normal, 82), pushed: pictureIcon(given.pushed, 82), disabled: pictureIcon(given.disabled, 82) }
      : theme ? specialButtonSkins(buildingGlyph(type, 1), theme) : null;
    if (!skins) throw new Error(`${spec.file}: a button needs its three skins — pictures of yours, or the icon theme to draw them`);
    button = { building: type, lua: edit.button.lua, skins, dir: p.icons };
  }

  files.set(p.build, Buffer.from(build, 'latin1'));
  files.set(p.name, utf16(spec.name));

  // The palette tile names the town's own icon, as a dwelling's does.
  const icon = hrefOf(town, 'Icon55x55');
  files.set(p.link, Buffer.from(townLink(p, icon ? dataPath(icon) : ''), 'latin1'));

  return {
    files: [...files].map(([path, data]) => ({ path, data })),
    paths: p, at: copy.at, records, stopped: copy.stopped, missing: copy.missing, features,
    ...(race ? { raceIcon: race } : {}),
    ...(tower ? { towerIcon: tower } : {}),
    ...(captureMarker ? { captureMarker } : {}),
    ...(button ? { button } : {}),
  };
}

/** Where a town document's `Combat` element begins and ends. */
function combatSpan(text: string, what: string): [number, number] {
  const start = once(text, '<Combat ', `${what} siege`);
  const end = once(text, '</Combat>', `${what} siege end`) + '</Combat>'.length;
  return [start, end];
}

function combatOf(text: string, what: string): string {
  const [s, e] = combatSpan(text, what);
  return text.slice(s, e);
}

/** The siege's buildings: each inline `ArenaBuilding` item, whole, with its type. */
function buildingsOf(combat: string): { type: string; text: string }[] {
  const out: { type: string; text: string }[] = [];
  for (const m of combat.matchAll(/<Item href="#n:inline\(ArenaBuilding\)"[^>]*>[\s\S]*?<\/ArenaBuilding>\s*<\/Item>/g)) {
    const type = /<Type>(\w+)<\/Type>/.exec(m[0])?.[1];
    if (type) out.push({ type, text: m[0] });
  }
  return out;
}

/** Where a town document's `Exterior` element begins and ends — inline with a body, or one line with an href. */
function exteriorSpan(text: string, what: string): [number, number] {
  const start = once(text, '<Exterior ', `${what} exterior`);
  const oneLine = text.indexOf('/>', start), body = text.indexOf('>', start);
  if (oneLine === body - 1) return [start, oneLine + '/>'.length];
  return [start, once(text, '</Exterior>', `${what} exterior end`) + '</Exterior>'.length];
}

/**
 * A town's `AdvMapTownExterior` element, whole, with every href in it made
 * absolute — so it can stand in another document. Seven shipped towns write
 * it inline in the shared document; Stronghold keeps it in a document of its
 * own beside it.
 */
function exteriorOf(sharedPath: string, read: DataReader, what: string): string {
  const shared = mustRead(read, sharedPath);
  const href = hrefOf(shared, 'Exterior');
  if (!href) throw new Error(`${what}: no <Exterior> in ${sharedPath}`);
  let text: string, from: string;
  if (href.startsWith('#n:inline')) {
    const s = once(shared, '<AdvMapTownExterior', `${what} exterior`);
    const e = once(shared, '</AdvMapTownExterior>', `${what} exterior end`) + '</AdvMapTownExterior>'.length;
    text = shared.slice(s, e);
    from = sharedPath;
  } else {
    const path = resolve(sharedPath, href);
    if (!path) throw new Error(`${what}: the exterior's href ${href} names nothing`);
    from = path;
    const doc = mustRead(read, path);
    const s = once(doc, '<AdvMapTownExterior', `${what} exterior`);
    const e = once(doc, '</AdvMapTownExterior>', `${what} exterior end`) + '</AdvMapTownExterior>'.length;
    text = doc.slice(s, e);
  }
  return text.replace(/href="([^"#][^"]*)"/g, (whole, h: string) => {
    if (h.startsWith('/') || h.startsWith('\\')) return whole;
    const target = resolve(from, h);
    if (!target) return whole;
    const hash = h.indexOf('#');
    return `href="/${target}${hash < 0 ? '' : h.slice(hash)}"`;
  });
}

/** The exterior's stage items, whole, in the shipped order — exactly ten. */
function stagesOf(exterior: string, what: string): string[] {
  const s = once(exterior, '<upgrades>', `${what} exterior stages`);
  const e = once(exterior, '</upgrades>', `${what} exterior stages end`);
  const items = [...exterior.slice(s, e).matchAll(/<Item>[\s\S]*?<\/Item>/g)].map((m) => m[0]);
  if (items.length !== EXTERIOR_STAGES.length) throw new Error(`${what}'s exterior has ${items.length} stages, not ${EXTERIOR_STAGES.length}`);
  return items;
}

/** The exterior's gate geometry element, whole — inline with a body, or one line with an href. */
function gatesOf(exterior: string, what: string): string {
  const start = once(exterior, '<Gates', `${what} exterior gates`);
  const oneLine = exterior.indexOf('/>', start), body = exterior.indexOf('>', start);
  if (oneLine === body - 1) return exterior.slice(start, oneLine + '/>'.length);
  return exterior.slice(start, once(exterior, '</Gates>', `${what} exterior gates end`) + '</Gates>'.length);
}

// --- the building tree --------------------------------------------------------
//
// The tree is the town's `buildings` list — one `TownBuildingSharedStats`
// each: type, upgrade level, cost, town level, dependencies (hrefs to other
// records), texts, icon — and the build grid (`TownBuildDefinition`): one
// slot per type, one cell per level, both written by the game's editor with
// tabs, so a slot is a line at two tabs and a cell one at four.

const RECORD_ITEM = /<Item href="([^"]+)"\/>/g;

/** A record's type and upgrade level; a record without them is not one. */
function typeAndLevel(text: string, what: string): [string, number] {
  const type = /<Type>(TB_\w+)<\/Type>/.exec(text)?.[1];
  const level = /<Upgrade>BLD_UPG_(\d)<\/Upgrade>/.exec(text)?.[1];
  if (!type || !level) throw new Error(`${what}: no <Type>/<Upgrade> in the building record`);
  return [type, Number(level)];
}

interface ListedBuilding {
  key: BuildingKey;
  type: string;
  level: number;
  /** The record's data path. */
  path: string;
  /** The `<Item href=…/>` that lists it in the town document. */
  item: string;
}

/** Every record a town document lists, read for its type and level. */
function listedBuildings(town: string, from: string, read: DataReader): ListedBuilding[] {
  const start = once(town, '<buildings>', 'town buildings');
  const end = once(town, '</buildings>', 'town buildings end');
  const out: ListedBuilding[] = [];
  for (const m of town.slice(start, end).matchAll(RECORD_ITEM)) {
    const path = resolve(from, m[1]!);
    if (!path) throw new Error(`${from}: building href ${m[1]} resolves nowhere`);
    const [type, level] = typeAndLevel(mustRead(read, path), path);
    out.push({ key: buildingKey(type, level), type, level, path, item: m[0] });
  }
  return out;
}

/** The records a record depends on, as data paths. */
function dependenciesOf(text: string, from: string): string[] {
  const m = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(text);
  if (!m) return [];
  return [...m[1]!.matchAll(RECORD_ITEM)].map((i) => resolve(from, i[1]!)).filter((x): x is string => x !== null);
}

/** A record's dependency items: the href as written, and where it points. */
function dependencyItems(text: string, from: string): { href: string; path: string }[] {
  const m = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(text);
  if (!m) return [];
  const out: { href: string; path: string }[] = [];
  for (const i of m[1]!.matchAll(RECORD_ITEM)) {
    const path = resolve(from, i[1]!);
    if (path) out.push({ href: i[1]!, path });
  }
  return out;
}

/** The record class a building list names. */
const BUILDING_RECORD = 'TownBuildingSharedStats';

/**
 * The town document's list with `ours` — the donor's items of one type —
 * replaced by `lines`, in the first one's place; at the list's end when the
 * donor had none of the type.
 */
function swapListed(town: string, ours: readonly ListedBuilding[], lines: readonly string[], what: string): string {
  let out = town;
  if (ours.length) {
    const first = once(out, ours[0]!.item, what);
    out = insertAfterLine(out, first, [...lines]);
    for (const b of ours) out = dropLine(out, once(out, b.item, what));
    return out;
  }
  return insertBeforeLine(out, once(out, '</buildings>', what), [...lines]);
}

/**
 * The spec's building edits with what `magic` implies: a town without magic
 * takes Stronghold's guild — five stubs and an empty slot — unless the spec
 * says where its own come from.
 */
function buildingEdits(spec: TownSpec): Readonly<Record<BuildingKey, BuildingEdit | null>> | undefined {
  if (spec.magic !== 'none') return spec.buildings;
  const guild = spec.buildings?.[GUILD_BUILDING];
  if (guild === null) throw new Error(`${spec.file}: a town without magic keeps the guild's records as stubs — do not drop ${GUILD_BUILDING}`);
  // The stubs name texts the game does not ship: nothing shows them.
  for (const [key, edit] of Object.entries(spec.buildings ?? {})) {
    if (parseBuildingKey(key).type !== GUILD_BUILDING || !edit) continue;
    if (edit.name !== undefined || edit.description !== undefined) throw new Error(`${spec.file}: a town without magic never shows its guild — ${key} has no name to give`);
  }
  return { ...spec.buildings, [GUILD_BUILDING]: { from: GUILD_STUB_DONOR, ...guild } };
}

/** The text without the line `at` falls on. */
function dropLine(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at) + 1;
  return text.slice(0, start) + (end ? text.slice(end) : '');
}

/** Where a grid slot's `<Item>` begins and ends (the line after `</Item>` included). */
function gridSlot(build: string, type: string): [number, number] | null {
  const at = build.indexOf(`<BuildingType>${type}</BuildingType>`);
  if (at < 0) return null;
  const start = build.lastIndexOf('\n\t\t<Item>', at) + 1;
  const close = build.indexOf('\n\t\t</Item>', at);
  if (!start || close < 0) throw new Error(`build grid: slot ${type} is not laid out as the game writes it`);
  return [start, build.indexOf('\n', close + 1) + 1];
}

/** A slot's cell for `level`, as a span inside the slot's text. */
function gridCell(slot: string, type: string, level: number): [number, number] {
  const at = slot.indexOf(`<Upgrade>BLD_UPG_${level}</Upgrade>`);
  if (at < 0) throw new Error(`build grid: slot ${type} has no cell for level ${level}`);
  const start = slot.lastIndexOf('\n\t\t\t\t<Item>', at) + 1;
  const close = slot.indexOf('\n\t\t\t\t</Item>', at);
  if (!start || close < 0) throw new Error(`build grid: ${type} level ${level} is not laid out as the game writes it`);
  return [start, slot.indexOf('\n', close + 1) + 1];
}

/** The grid without the cell for `type` at `level`, and without the slot when that was its last cell. */
export function dropGridCell(build: string, type: string, level: number): string {
  const span = gridSlot(build, type);
  if (!span) return build;
  const [s, e] = span;
  let slot = build.slice(s, e);
  if (!slot.includes(`<Upgrade>BLD_UPG_${level}</Upgrade>`)) return build;
  const [cs, ce] = gridCell(slot, type, level);
  slot = slot.slice(0, cs) + slot.slice(ce);
  return build.slice(0, s) + (slot.includes('<Upgrade>') ? slot : '') + build.slice(e);
}

/** Where a cell sits, out of its own text. */
function cellPosition(cell: string): string | null {
  const m = /<XSlotPos>(\d+)<\/XSlotPos>\s*<YSlotPos>(\d+)<\/YSlotPos>/.exec(cell);
  return m ? `${m[1]},${m[2]}` : null;
}

/**
 * The grid with the cell for `type` at `level` moved to `to` — AND WITH THE
 * LEVELS THAT STOOD ON IT, because they are the same building.
 *
 * A building's upgrades either stack on its cell (Stronghold's Hall of Trial:
 * three levels, all at 4,2) or take cells of their own down a column (Haven's
 * town hall). Moving the building means moving the pile; moving one level of a
 * building whose levels stand apart means moving that one. Both come out of
 * the same rule: the cells that shared this one's place go with it.
 *
 * Launch 44 is why the rule is written down. `slot` moved level one and left
 * levels two and three at the donor's coordinates, where the magic guild
 * stood; the build refused, the probe's town lost those cells, and the camp
 * could be built and never upgraded — the screen had nowhere to click.
 */
export function moveGridCell(build: string, type: string, level: number, to: { x: number; y: number }): string {
  const span = gridSlot(build, type);
  if (!span) throw new Error(`build grid: no slot for ${type}`);
  const [s, e] = span;
  let slot = build.slice(s, e);
  const [cs, ce] = gridCell(slot, type, level);
  const was = cellPosition(slot.slice(cs, ce));
  const moved = (cell: string): string => cell
    .replace(/<XSlotPos>\d+<\/XSlotPos>/, `<XSlotPos>${to.x}</XSlotPos>`)
    .replace(/<YSlotPos>\d+<\/YSlotPos>/, `<YSlotPos>${to.y}</YSlotPos>`);
  slot = slot.slice(0, cs) + moved(slot.slice(cs, ce)) + slot.slice(ce);
  for (const other of [...slot.matchAll(/<Upgrade>BLD_UPG_(\d)<\/Upgrade>/g)].map((m) => Number(m[1]))) {
    if (other === level) continue;
    const [os, oe] = gridCell(slot, type, other);
    if (cellPosition(slot.slice(os, oe)) !== was) continue;
    slot = slot.slice(0, os) + moved(slot.slice(os, oe)) + slot.slice(oe);
  }
  return build.slice(0, s) + slot + build.slice(e);
}

/** A grid's slot for `type` as text, lines and all; null when it has none. */
export function gridSlotText(build: string, type: string): string | null {
  const span = gridSlot(build, type);
  return span ? build.slice(span[0], span[1]) : null;
}

/** The grid with its slot for `type` replaced by `slot` — added at the end when it had none, removed when `slot` is null. */
export function replaceGridSlot(build: string, type: string, slot: string | null): string {
  const span = gridSlot(build, type);
  if (span) return build.slice(0, span[0]) + (slot ?? '') + build.slice(span[1]);
  if (!slot) return build;
  const end = build.indexOf('\n\t</slots>');
  if (end < 0) throw new Error('build grid: no </slots>');
  return build.slice(0, end + 1) + slot + build.slice(end + 1);
}

/** Every cell on the grid: two buildings on one cell is a grid the screen cannot draw. */
export function checkGridCells(build: string, what: string): void {
  const at = new Map<string, string>();
  const slots = /<BuildingType>(TB_\w+)<\/BuildingType>\s*(?:<buildings\/>|<buildings>([\s\S]*?)<\/buildings>)/g;
  for (const slot of build.matchAll(slots)) {
    const type = slot[1]!;
    for (const cell of (slot[2] ?? '').matchAll(/<XSlotPos>(\d+)<\/XSlotPos>\s*<YSlotPos>(\d+)<\/YSlotPos>/g)) {
      const pos = `${cell[1]},${cell[2]}`;
      const other = at.get(pos);
      if (other && other !== type) throw new Error(`${what}: ${type} and ${other} share grid cell ${pos} — move one (slot)`);
      at.set(pos, type);
    }
  }
}

/** The palette entry: a link file pointing at our town. */
export function townLink(p: TownPaths, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.shared}#xpointer(/${TOWN_CLASS})"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
  ].join(EOL) + `${EOL}</AdvMapObjectLink>${EOL}`;
}

// --- the named towns ----------------------------------------------------------
//
// A town on the map is not "a Haven town": it is Alexandretta, or Millfield —
// a `TownSpecialization` with a name, a history and a bonus, drawn for every
// random town of the race (the least-used first, 0xB543E0) from the
// `TownSpecs` table, where each is listed under an `ETownSpec` id. A race
// with none has no town to draw, and a player with no town is out before
// turn one. Haven ships twenty for random towns and sixteen for scripts.
//
// The bonus is one of the compiled `TOWN_BONUS_*` — what each does lives in
// the executable; the text is the author's.

/** The town-specializations table and its enum, both grown by the mod. */
export const TOWN_SPECS = 'GameMechanics/RefTables/TownSpecs.xdb';
export const SHIPPED_TOWN_SPECS = 255;
export const LAST_SHIPPED_TOWN_SPEC = 'TOWNSPEC_STRONGHOLD_SCRIPT_FAKE';

export interface NamedTown {
  /** File stem; the id is made of it, upper-cased. */
  file: string;
  name: string;
  biography: string;
  /** A `TOWN_BONUS_*` out of `types.xml`, or `TOWN_NO_BONUS`. */
  bonus: string;
  /** What the bonus is described as, in the town's own words; the game's blank when absent. */
  bonusText?: string;
  /** For scripted maps only: never drawn for a random town. */
  scripted?: boolean;
}

export function namedTownId(faction: Pick<TownSpec, 'file'>, t: NamedTown): string {
  const up = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `TOWNSPEC_${up(faction.file)}_${t.scripted ? 'SCRIPT' : 'RANDOM'}_${up(t.file)}`;
}

export function namedTownPaths(faction: Pick<TownSpec, 'file'>, t: NamedTown): { doc: string; name: string; biography: string; bonus: string } {
  const dir = `${townPaths(faction).dir}/towns/${t.file}`;
  return { doc: `${dir}.xdb`, name: `${dir}_Name.txt`, biography: `${dir}_Bio.txt`, bonus: `${dir}_Bonus.txt` };
}

/** Each named town's document and two texts. */
export function buildNamedTowns(faction: TownSpec, towns: readonly NamedTown[]): ModFile[] {
  const files: ModFile[] = [];
  for (const t of towns) {
    const p = namedTownPaths(faction, t);
    const doc = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<TownSpecialization>',
      `\t<NameFileRef href="/${p.name}"/>`,
      `\t<BiographyFileRef href="/${p.biography}"/>`,
      `\t<Bonus>${t.bonus}</Bonus>`,
      `\t<BonusDescriptionFileRef href="${t.bonusText ? `/${p.bonus}` : ''}"/>`,
      `\t<TownType>${faction.type}</TownType>`,
      `\t<RandomTown>${t.scripted ? 'TOWN_SCRIPT_ONLY' : 'TOWN_RANDOM'}</RandomTown>`,
      '</TownSpecialization>',
    ].join(EOL) + EOL;
    files.push({ path: p.doc, data: Buffer.from(doc, 'latin1') });
    files.push({ path: p.name, data: utf16(t.name) });
    files.push({ path: p.biography, data: utf16(t.biography) });
    if (t.bonusText) files.push({ path: p.bonus, data: utf16(t.bonusText) });
  }
  return files;
}

/** The table with ours appended, in the order given. */
export function patchTownSpecTable(table: string, faction: TownSpec, towns: readonly NamedTown[]): string {
  const at = once(table, '</objects>', 'town specs table');
  return insertBeforeLine(table, at, towns.flatMap((t) => [
    '<Item>', `\t<ID>${namedTownId(faction, t)}</ID>`, '\t<obj>',
    `\t\t<Spec href="/${namedTownPaths(faction, t).doc}#xpointer(/TownSpecialization)"/>`,
    '\t</obj>', '</Item>',
  ]));
}

/**
 * `types.xml` with ours in the `ETownSpec` enum — both shapes — and the
 * table's declared size moved past them. `first` is the ordinal of the first;
 * a mod that already added some passes the next free one.
 */
export function patchTownSpecTypes(types: string, faction: TownSpec, towns: readonly NamedTown[], first = SHIPPED_TOWN_SPECS): string {
  let t = types;
  const ids = towns.map((town) => namedTownId(faction, town));
  t = insertAfterLine(t, once(t, `<Item>${LAST_SHIPPED_TOWN_SPEC}</Item>`, 'types.xml town spec enum'), ids.map((id) => `<Item>${id}</Item>`));
  const map = once(t, `<Name>${LAST_SHIPPED_TOWN_SPEC}</Name>`, 'types.xml town spec name→number map');
  t = insertAfterLine(t, t.indexOf('</Item>', map), ids.flatMap((id, i) => [
    '<Item>', `\t<Name>${id}</Name>`, `\t<Value>${first + i}</Value>`, '</Item>',
  ]));
  const table = once(t, '<TypeName>Table_TownSpecRef_TownSpec</TypeName>', 'types.xml town spec table');
  const to = first + ids.length;
  t = retune(t, table, 'Data', first, to, 'types.xml town spec ref_table_num_objs');
  t = retune(t, table, 'MinElements', first, to, 'types.xml town spec MinElements');
  t = retune(t, table, 'MaxElements', first, to, 'types.xml town spec MaxElements');
  return t;
}
