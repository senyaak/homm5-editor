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

import { copyArt, dataPath, resolve } from './mod-art.ts';
import { UI_ROOT, mustRead, utf16 } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { EOL, hrefOf, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';

export const TOWN_CLASS = 'AdvMapTownShared';
export const BUILD_CLASS = 'TownBuildDefinition';

/** The random-town group: every town the game can put on a map by race. */
export const TOWN_GROUP = 'MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb';

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
  /** Source path → the copy's path, for whoever edits a building record next. */
  at: Map<string, string>;
  /** What the copy left in the game's data. */
  stopped: string[];
  missing: string[];
}

/**
 * Copy the donor and make it ours: the type, the name, the schools; the build
 * grid; the palette entry.
 */
export function buildTown(spec: TownSpec, donorOrdinal: number, read: DataReader): TownBuild {
  const p = townPaths(spec);
  const source = donorTown(spec.donor, read);
  const copy = copyArt([source], p.art, read, `town:${spec.file}`, { stopAt: TOWN_STOP_AT, leave: TOWN_LEAVE });
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
  if (spec.magicSchools) {
    for (const [i, school] of spec.magicSchools.entries()) {
      town = town.replace(new RegExp(`<MagicSchool_${i}>[^<]*</MagicSchool_${i}>`), `<MagicSchool_${i}>${school}</MagicSchool_${i}>`);
    }
  }
  files.set(p.shared, Buffer.from(town, 'latin1'));

  files.set(p.build, Buffer.from(mustRead(read, donorBuildDefinition(donorOrdinal, read)), 'latin1'));
  files.set(p.name, utf16(spec.name));

  // The palette tile names the town's own icon, as a dwelling's does.
  const icon = hrefOf(town, 'Icon55x55');
  files.set(p.link, Buffer.from(townLink(p, icon ? dataPath(icon) : ''), 'latin1'));

  return {
    files: [...files].map(([path, data]) => ({ path, data })),
    paths: p, at: copy.at, stopped: copy.stopped, missing: copy.missing,
  };
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
  /** For scripted maps only: never drawn for a random town. */
  scripted?: boolean;
}

export function namedTownId(faction: Pick<TownSpec, 'file'>, t: NamedTown): string {
  const up = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `TOWNSPEC_${up(faction.file)}_${t.scripted ? 'SCRIPT' : 'RANDOM'}_${up(t.file)}`;
}

export function namedTownPaths(faction: Pick<TownSpec, 'file'>, t: NamedTown): { doc: string; name: string; biography: string } {
  const dir = `${townPaths(faction).dir}/towns/${t.file}`;
  return { doc: `${dir}.xdb`, name: `${dir}_Name.txt`, biography: `${dir}_Bio.txt` };
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
      '\t<BonusDescriptionFileRef href=""/>',
      `\t<TownType>${faction.type}</TownType>`,
      `\t<RandomTown>${t.scripted ? 'TOWN_SCRIPT_ONLY' : 'TOWN_RANDOM'}</RandomTown>`,
      '</TownSpecialization>',
    ].join(EOL) + EOL;
    files.push({ path: p.doc, data: Buffer.from(doc, 'latin1') });
    files.push({ path: p.name, data: utf16(t.name) });
    files.push({ path: p.biography, data: utf16(t.biography) });
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
