// Game-data registries — the *universe* each map-properties picker chooses from.
//
// The map file only stores the enabled subset (spellIDs, artifactIDs,
// AvailableHeroes…). The full list of what *exists* — every spell, artifact,
// hero, ambient-light preset — is not in the map; it lives in the game data.
//
// Deliberately DISCOVERED, never hardcoded. Each roster is read from the data
// tree at run time — a reference table or a folder scan — so anything a mod or a
// Lua script adds (a custom spell dropped into UndividedSpells, a new hero file
// under MapObjects) shows up on its own. The PDF ID lists in
// `Editor Documentation/` are a human cross-check, not the source here.
//
// `dataRoot` is the resolved asset root: the unpacked game data with the open
// project's own files layered on top, so a project that overrides a table is
// seen. Layering *several* roots (base game + separate mod paks) is the natural
// extension — the readers below take one root today; widening them to a resolver
// chain is where that goes.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { parse, find, children, childText } from './xml.ts';

/** One choice in a picker: an engine id (or a ref href) and a display label. */
export interface RosterEntry {
  /** What the map stores — an enum id (`SPELL_MAGIC_ARROW`) or a ref href. */
  id: string;
  /** Human label if cheaply known; the UI falls back to `id` when absent. */
  name?: string;
  /** href to the localized name file, resolved lazily by the UI if it wants it. */
  nameRef?: string;
  /** For file-based rosters, a grouping key (a hero's race folder). */
  group?: string;
}

/** Reference tables that back a roster, relative to the data root. */
const SPELL_TABLE = 'GameMechanics/RefTables/UndividedSpells.xdb';
const ARTIFACT_TABLE = 'GameMechanics/RefTables/Artifacts.xdb';
const CREATURE_TABLE = 'GameMechanics/RefTables/Creatures.xdb';
const SKILL_TABLE = 'GameMechanics/RefTables/Skills.xdb';
/**
 * Where object files live, scanned for the class rosters. Every serializable
 * object is stored one of two ways, and objectsOfClass() catches both:
 *   • a placed object — `Name.(ClassName).xdb` anywhere (heroes, monsters…);
 *   • a library entity — a plain `Name.xdb` inside a `_(ClassName)/` folder
 *     (birds, winds, weathers, ambient lights).
 * The class is also the root element and the xpointer (`#xpointer(/ClassName)`).
 */
const OBJECT_DIRS = ['MapObjects', 'Lights'];

/** Registry roster names that are really "every object of a class". */
const CLASS_OF_ROSTER: Record<string, string> = {
  heroes: 'AdvMapHeroShared',
  birds: 'AdvMapBirds',
  winds: 'Wind',
  weathers: 'AdvMapWeather',
  ambientLights: 'AmbientLight',
};

/**
 * Player races (`TOWN_*`). A closed engine enum, not a moddable file roster, so
 * it is listed here from the A2 ID PDF rather than discovered. `TOWN_NO_TYPE` is
 * the "unset / random" choice the shipped maps use.
 */
const RACES: RosterEntry[] = [
  { id: 'TOWN_NO_TYPE', name: 'No type (random)' },
  { id: 'TOWN_HEAVEN', name: 'Haven' },
  { id: 'TOWN_PRESERVE', name: 'Sylvan' },
  { id: 'TOWN_ACADEMY', name: 'Academy' },
  { id: 'TOWN_DUNGEON', name: 'Dungeon' },
  { id: 'TOWN_NECROMANCY', name: 'Necropolis' },
  { id: 'TOWN_INFERNO', name: 'Inferno' },
  { id: 'TOWN_FORTRESS', name: 'Fortress' },
  { id: 'TOWN_STRONGHOLD', name: 'Stronghold' },
];

export class Registry {
  private cache = new Map<string, RosterEntry[]>();
  private dataRoot: string;

  constructor(dataRoot: string) { this.dataRoot = dataRoot; }

  /** Compute a roster once, then serve it from cache. */
  private memo(key: string, build: () => RosterEntry[]): RosterEntry[] {
    const hit = this.cache.get(key);
    if (hit) return hit;
    let out: RosterEntry[];
    try { out = build(); } catch { out = []; }
    this.cache.set(key, out);
    return out;
  }

  /** Every spell (`UndividedSpells.xdb`) — 353 in stock Tribes of the East. */
  spells(): RosterEntry[] {
    return this.memo('spells', () => readRefTable(this.dataRoot, SPELL_TABLE));
  }

  /** Every artifact (`Artifacts.xdb`), each with its localized name ref. */
  artifacts(): RosterEntry[] {
    return this.memo('artifacts', () => readRefTable(this.dataRoot, ARTIFACT_TABLE));
  }

  /** Every creature (`Creatures.xdb`) — army stacks, garrisons, dwellings. */
  creatures(): RosterEntry[] {
    return this.memo('creatures', () => readRefTable(this.dataRoot, CREATURE_TABLE));
  }

  /** Every hero skill and perk (`Skills.xdb`) — hero editing. */
  skills(): RosterEntry[] {
    return this.memo('skills', () => readRefTable(this.dataRoot, SKILL_TABLE));
  }

  /** Player races — the fixed `TOWN_*` enum. */
  races(): RosterEntry[] { return RACES; }

  /**
   * Every object of a class — the type-constrained picker the original editor
   * offers (its "Objects: AdvMapHeroShared" list). Scans both storage styles
   * (`Name.(class).xdb` and `_(class)/Name.xdb`). This is the one primitive the
   * class-based rosters below and the tree's "…" browse picker share.
   */
  objectsOfClass(className: string): RosterEntry[] {
    return this.memo('class:' + className, () => scanClass(this.dataRoot, className));
  }

  /**
   * Every hero — one `*.(AdvMapHeroShared).xdb` under `MapObjects/`. The id is
   * the ref the map stores; the label is the file's base name, the race its
   * folder. Localized names are a later pass.
   */
  heroes(): RosterEntry[] { return this.objectsOfClass('AdvMapHeroShared'); }

  /**
   * Every ambient-light preset — `Lights/_(AmbientLight)/**` — as referenced by
   * `GroundAmbientLights`. The label is the preset's `<InternalName>`.
   */
  ambientLights(): RosterEntry[] { return this.objectsOfClass('AmbientLight'); }

  /** The shipped bird flocks — `MapObjects/_(AdvMapBirds)/` (Birds). */
  birds(): RosterEntry[] { return this.objectsOfClass('AdvMapBirds'); }

  /** The shipped wind presets — `MapObjects/_(Wind)/` (Wind). */
  winds(): RosterEntry[] { return this.objectsOfClass('Wind'); }

  /** The shipped weather presets — `MapObjects/_(AdvMapWeather)/` (Weather items). */
  weathers(): RosterEntry[] { return this.objectsOfClass('AdvMapWeather'); }

  /** The class a named roster resolves to, if it is a class scan; else null. */
  static classOfRoster(name: string): string | null { return CLASS_OF_ROSTER[name] ?? null; }
}

/**
 * Read a `Table_*` reference file into a roster. Each `<objects><Item>` carries
 * an `<ID>` and, nested under `<Obj>` (spells) or `<obj>` (artifacts), the
 * definition ref and an optional `<NameFileRef>`. `ARTIFACT_NONE` / `SPELL_NONE`
 * are kept: they are legal values the map uses.
 */
function readRefTable(dataRoot: string, rel: string): RosterEntry[] {
  const path = join(dataRoot, rel);
  if (!existsSync(path)) return [];
  const doc = parse(readFileSync(path, 'utf8'));
  // The table's root element name varies (Table_Spell_SpellID,
  // Table_DBArtifact_ArtifactEffect), so reach <objects> under the root rather
  // than by a fixed path. find() is direct-children only.
  const root = children(doc)[0];
  const objects = root ? find(root, 'objects') : null;
  if (!objects) return [];
  const out: RosterEntry[] = [];
  for (const item of children(objects)) {
    if (item.name !== 'Item') continue;
    const id = childText(item, 'ID');
    if (!id) continue;
    // The table's <ID> is exactly what the map stores (the same inconsistent
    // prefixing — SWORD_OF_RUINS but ARTIFACT_SKULL_HELMET — as the map), which
    // is why the table beats the PDF as the source. Case of the definition
    // wrapper differs by table: <Obj> (spells) vs <obj> (artifacts).
    const obj = find(item, 'Obj') || find(item, 'obj');
    const nameRef = obj ? find(obj, 'NameFileRef')?.attrs.href : undefined;
    out.push(nameRef ? { id, nameRef } : { id });
  }
  return out;
}

/** Walk a directory tree, yielding files whose name matches `test`. */
function walkFiles(dir: string, test: (name: string) => boolean, out: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const name of ents) {
    const full = join(dir, name);
    let dirent = false;
    try { dirent = statSync(full).isDirectory(); } catch { continue; }
    if (dirent) walkFiles(full, test, out);
    else if (test(name)) out.push(full);
  }
  return out;
}

/** A data-root-relative fs path as a leading-slash href the map uses. */
function toHref(dataRoot: string, path: string, xpointer: string): string {
  const rel = relative(dataRoot, path).split(sep).join('/');
  return `/${rel}#xpointer(${xpointer})`;
}

/**
 * Every object of `className`, across both storage styles:
 *   • placed objects — `Name.(className).xdb` anywhere under the object dirs;
 *     the label is the base name, grouped by its top folder (a hero's race).
 *   • library entities — plain `Name.xdb` inside a `_(className)/` folder;
 *     labelled by `<InternalName>` when present, else the base name.
 * A map can also point at a custom entity saved in its own folder; once that
 * folder is layered onto the data root, this picks it up like any other.
 */
function scanClass(dataRoot: string, className: string): RosterEntry[] {
  const suffix = `.(${className}).xdb`;
  const libSeg = `_(${className})`;
  const xpointer = '/' + className;
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const dir of OBJECT_DIRS) {
    const base = join(dataRoot, dir);
    for (const f of walkFiles(base, (n) => n.endsWith('.xdb'))) {
      if (seen.has(f)) continue;
      const bn = basename(f);
      const parts = relative(base, f).split(sep);
      const bySuffix = bn.endsWith(suffix);
      const inLib = parts.includes(libSeg);
      if (!bySuffix && !inLib) continue;
      seen.add(f);
      let name: string;
      let group: string | undefined;
      if (bySuffix) {
        // A placed-object definition: base name, grouped by its top folder.
        name = bn.slice(0, -suffix.length);
        group = parts[0] && !parts[0].endsWith('.xdb') ? parts[0] : undefined;
      } else {
        // A library entity: prefer its InternalName label.
        let internal = '';
        try { internal = childText(parse(readFileSync(f, 'utf8')), 'InternalName'); } catch { /* keep basename */ }
        name = internal || bn.replace(/\.xdb$/, '');
      }
      out.push(group ? { id: toHref(dataRoot, f, xpointer), name, group } : { id: toHref(dataRoot, f, xpointer), name });
    }
  }
  out.sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || ''));
  return out;
}
