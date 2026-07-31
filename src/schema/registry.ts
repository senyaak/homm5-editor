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
// The rosters read the MOUNTED asset chain (src/assets.ts), not one folder: the
// unpacked game data with the installed mods and the open project layered over
// it. That is what makes a creature a mod adds show up in the army picker —
// `Creatures.xdb` is not one file, it is whichever copy wins, and the mod's copy
// is the one with 181 entries in it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { parse, find, children, childText } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { toAssets } from '../game/assets.ts';
import type { Assets } from '../game/assets.ts';
import { readStats } from '../mods/creatures.ts';
import type { CreatureStats } from '../mods/creatures.ts';

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
  /**
   * The entry's place in the SOURCE — the reference table's id order. Rosters
   * are served sorted by label because that is how a picker reads, but a list
   * the map stores (enabled spells, enabled artifacts) is written in this
   * order, the one the game's own files use.
   */
  order?: number;
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
  private data: Assets;

  constructor(root: string | Assets) { this.data = toAssets(root); }

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
    return this.memo('spells', () => byLabel(readRefTable(this.data, SPELL_TABLE)));
  }

  /** Every artifact (`Artifacts.xdb`), each with its localized name ref. */
  artifacts(): RosterEntry[] {
    return this.memo('artifacts', () => byLabel(readRefTable(this.data, ARTIFACT_TABLE)));
  }

  /** Every creature (`Creatures.xdb`) — army stacks, garrisons, dwellings. */
  creatures(): RosterEntry[] {
    return this.memo('creatures', () => byLabel(creatureRoster(this.data)));
  }

  /** Every hero skill and perk (`Skills.xdb`) — hero editing. */
  skills(): RosterEntry[] {
    return this.memo('skills', () => byLabel(readRefTable(this.data, SKILL_TABLE)));
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
    return this.memo('class:' + className, () => scanClass(this.data, className));
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
 *
 * Where the table names a text file the name is READ, because a picker showing
 * `ARTIFACT_SKULL_HELMET` is a picker you have to translate in your head. The
 * spell table names none, so spells stay on their ids until their own objects
 * are followed the way creatureRoster follows a creature's.
 */
function readRefTable(data: Assets, rel: string): RosterEntry[] {
  const text = data.text(rel);
  if (text === null) return [];
  const doc = parse(text);
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
    const name = nameRef ? gameText(data, nameRef) : '';
    out.push({ id, ...(name ? { name } : {}), ...(nameRef ? { nameRef } : {}) });
  }
  return out;
}

/**
 * The creature roster, with each creature's real name.
 *
 * The name is not in the table and not in the creature's record either: the
 * record points at a `CreatureVisual` and the VISUAL points at the text file.
 * Three hops per creature, 228 ms for all 181, paid once per session — and the
 * picker is barely usable without it, because a list of raw ids reads
 * `CREATURE_SHARP_SHOOTER` where the player knows "Лесные стрелки", and a
 * creature a mod adds is just one more id at the bottom of an unsorted 181.
 *
 * A creature the mod added carries its record INLINE in the table while the
 * shipped ones point at a file; both are followed here, which is the only reason
 * this cannot reuse readRefTable.
 */
function creatureRoster(data: Assets): RosterEntry[] {
  const text = data.text(CREATURE_TABLE);
  if (text === null) return [];
  const root = children(parse(text))[0];
  const objects = root ? find(root, 'objects') : null;
  if (!objects) return [];
  const out: RosterEntry[] = [];
  for (const item of children(objects)) {
    if (item.name !== 'Item') continue;
    const id = childText(item, 'ID');
    if (!id) continue;
    const name = creatureName(data, find(item, 'Obj'));
    out.push(name ? { id, name } : { id });
  }
  return out;
}

/** Follow a table entry to its creature record, then to its visual's name. */
function creatureName(data: Assets, obj: XmlElement | null): string {
  if (!obj) return '';
  let record = find(obj, 'Creature');
  const href = obj.attrs.href;
  if (!record && href && !href.startsWith('#')) {
    const body = data.text(refPath(href));
    if (!body) return '';
    const doc = parse(body);
    record = doc.name === 'Creature' ? doc : find(doc, 'Creature');
  }
  const visual = record ? find(record, 'Visual')?.attrs.href : undefined;
  if (!visual) return '';
  const vx = data.text(refPath(visual));
  if (!vx) return '';
  const vdoc = parse(vx);
  const vroot = vdoc.name === 'CreatureVisual' ? vdoc : find(vdoc, 'CreatureVisual');
  const nameRef = vroot ? find(vroot, 'CreatureNameFileRef')?.attrs.href : undefined;
  return nameRef ? gameText(data, nameRef) : '';
}

/** The data path an href names: no fragment, no leading slash. */
function refPath(href: string): string {
  return href.split('#')[0]!.replace(/^\/+/, '');
}

/** A creature's `Creature` record, found through the reference table. */
function creatureRecord(data: Assets, id: string): XmlElement | null {
  const text = data.text('GameMechanics/RefTables/Creatures.xdb');
  if (text === null) return null;
  const root = children(parse(text))[0];
  const objects = root ? find(root, 'objects') : null;
  if (!objects) return null;
  for (const item of children(objects)) {
    if (item.name !== 'Item' || childText(item, 'ID') !== id) continue;
    const obj = find(item, 'Obj');
    if (!obj) return null;
    const record = find(obj, 'Creature');
    if (record) return record;
    const href = obj.attrs.href;
    if (!href || href.startsWith('#')) return null;
    const body = data.text(refPath(href));
    if (!body) return null;
    const doc = parse(body);
    return doc.name === 'Creature' ? doc : find(doc, 'Creature');
  }
  return null;
}

/**
 * A creature's two source documents — what a new creature's art starts from.
 *
 * The units mod takes a `visualSource` (CreatureVisual) and a `monsterSource`
 * (AdvMapMonsterShared); a person picking a donor knows the creature, not those
 * two paths. This follows the table entry to its record and reads both refs, so
 * the picker can offer creatures and the mod still gets documents.
 */
export function creatureSources(data: Assets, id: string): { visual: string; monster: string } | null {
  const record = creatureRecord(data, id);
  if (!record) return null;
  const visual = find(record, 'Visual')?.attrs.href;
  const monster = find(record, 'MonsterShared')?.attrs.href;
  if (!visual || !monster) return null;
  return { visual: refPath(visual), monster: refPath(monster) };
}

/** Everything a donor creature can seed a new one with — the form's preset. */
export interface CreaturePreset {
  stats: CreatureStats;
  name: string;
  description: string;
  abilitiesText: string;
  visualSource: string;
  monsterSource: string;
  /**
   * What each art slot resolves to in the game's data — the files the new
   * creature will copy, and the handles for swapping one (a recolour, another
   * model) without touching the rest.
   */
  art: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>>;
}

/**
 * The donor, read whole: stats off its record, texts off its visual's refs, and
 * the four art documents both source documents point at. This is what "make a
 * creature that looks like X" starts from — the form shows every field and the
 * person edits the difference.
 */
export function creaturePreset(data: Assets, id: string): CreaturePreset | null {
  const record = creatureRecord(data, id);
  if (!record) return null;
  const visualHref = find(record, 'Visual')?.attrs.href;
  const monsterHref = find(record, 'MonsterShared')?.attrs.href;
  if (!visualHref || !monsterHref) return null;

  const art: CreaturePreset['art'] = {};
  let name = '', description = '', abilitiesText = '';
  const vx = data.text(refPath(visualHref));
  if (vx) {
    const vdoc = parse(vx);
    const vroot = vdoc.name === 'CreatureVisual' ? vdoc : find(vdoc, 'CreatureVisual');
    if (vroot) {
      const ref = (tag: string): string => find(vroot, tag)?.attrs.href ?? '';
      name = ref('CreatureNameFileRef') ? gameText(data, ref('CreatureNameFileRef')) : '';
      description = ref('DescriptionFileRef') ? gameText(data, ref('DescriptionFileRef')) : '';
      abilitiesText = ref('CreatureAbilitiesFileRef') ? gameText(data, ref('CreatureAbilitiesFileRef')) : '';
      if (ref('AnimCharacter')) art.character = refPath(ref('AnimCharacter'));
      if (ref('Icon128')) art.icon = refPath(ref('Icon128'));
    }
  }
  const mx = data.text(refPath(monsterHref));
  if (mx) {
    const mdoc = parse(mx);
    const mroot = mdoc.name === 'AdvMapMonsterShared' ? mdoc : find(mdoc, 'AdvMapMonsterShared');
    if (mroot) {
      const model = find(mroot, 'Model')?.attrs.href;
      const animSet = find(mroot, 'AnimSet')?.attrs.href;
      if (model) art.model = refPath(model);
      if (animSet) art.animSet = refPath(animSet);
    }
  }

  return {
    stats: readStats(record),
    name, description, abilitiesText,
    visualSource: refPath(visualHref), monsterSource: refPath(monsterHref),
    art,
  };
}

/** A donor artifact, read whole off the reference table — the form's preset. */
export interface ArtifactPreset {
  slot: string;
  rank: string;
  cost: number;
  aiValue: number;
  canBeGeneratedToSell: boolean;
  /** The six numbers it moves: Attack, Defence, Knowledge, SpellPower, Morale, Luck. */
  stats: Record<string, number>;
  /** href of its 64x64 icon — reusable as-is by a new artifact. */
  icon: string;
  /** href of the model lying on the map (referenced, never copied). */
  model: string;
  name: string;
  description: string;
}

/**
 * The artifact table keeps everything INLINE in each `<Item>`, so a preset is
 * one lookup: slot, rank, prices, the six stats, the icon and model hrefs, and
 * the texts behind the name refs.
 */
export function artifactPreset(data: Assets, id: string): ArtifactPreset | null {
  const text = data.text('GameMechanics/RefTables/Artifacts.xdb');
  if (text === null) return null;
  const root = children(parse(text))[0];
  const objects = root ? find(root, 'objects') : null;
  if (!objects) return null;
  for (const item of children(objects)) {
    if (item.name !== 'Item' || childText(item, 'ID') !== id) continue;
    const obj = find(item, 'obj') ?? find(item, 'Obj');
    if (!obj) return null;
    const stats: Record<string, number> = {};
    const mods = find(obj, 'HeroStatsModif');
    if (mods) {
      for (const s of ['Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck']) {
        stats[s] = Number(childText(mods, s) || 0);
      }
    }
    const href = (tag: string): string => {
      const h = find(obj, tag)?.attrs.href ?? '';
      return h ? refPath(h) : '';
    };
    const nameRef = find(obj, 'NameFileRef')?.attrs.href ?? '';
    const descRef = find(obj, 'DescriptionFileRef')?.attrs.href ?? '';
    return {
      slot: childText(obj, 'Slot') || 'PRIMARY',
      rank: childText(obj, 'Type') || 'ARTF_CLASS_MINOR',
      cost: Number(childText(obj, 'CostOfGold') || 0),
      aiValue: Number(childText(obj, 'AIValue') || 0),
      canBeGeneratedToSell: childText(obj, 'CanBeGeneratedToSell') === 'true',
      stats,
      icon: href('Icon'),
      model: href('Model'),
      name: nameRef ? gameText(data, nameRef) : '',
      description: descRef ? gameText(data, descRef) : '',
    };
  }
  return null;
}

/**
 * Every `ABILITY_…` the game's type registry names — the choices a creature's
 * ability list can hold. Read off types.xml rather than curated: the enum is
 * the engine's own, and a mod cannot add to it anyway.
 */
export function creatureAbilities(data: Assets): string[] {
  const text = data.text('types.xml');
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/ABILITY_[A-Z0-9_]+/g)) out.add(m[0]);
  return [...out].sort();
}

/**
 * The same list, with the names a PLAYER sees.
 *
 * `GameMechanics/RefTables/CombatAbilities.xdb` pairs each id with the text
 * files the game prints, so an ability can be offered as "Стрелок" instead of
 * ABILITY_SHOOTER — and the line a creature's hire dialog shows can be built
 * from the abilities it actually has, instead of being typed out by hand and
 * drifting from them.
 *
 * Ids the table does not name (the enum is larger than the table) keep their
 * id as the label rather than disappearing: an ability the engine knows is a
 * choice even when nobody wrote a caption for it.
 */
export function creatureAbilityNames(data: Assets): RosterEntry[] {
  const table = data.text('GameMechanics/RefTables/CombatAbilities.xdb') ?? '';
  const named = new Map<string, string>();
  for (const m of table.matchAll(/<ID>(ABILITY_[A-Z0-9_]+)<\/ID>[\s\S]*?<NameFileRef href="([^"]*)"/g)) {
    const name = m[2] ? gameText(data, m[2]) : '';
    if (name) named.set(m[1]!, name);
  }
  return creatureAbilities(data)
    .filter((id) => id !== 'ABILITY_NONE')
    .map((id) => ({ id, name: named.get(id) ?? id }));
}

/**
 * The line the hire dialog prints, built from what the creature has.
 *
 * Every shipped creature's is its abilities in words, and ours were typed into
 * a box beside the ability picker — two places saying the same thing, which is
 * one place too many: a creature that gained an ability kept the old sentence.
 */
export function abilitiesLine(data: Assets, abilities: readonly string[]): string {
  const names = new Map(creatureAbilityNames(data).map((a) => [a.id, a.name!]));
  return abilities.map((id) => names.get(id) ?? id).join(', ');
}

/**
 * A HoMM5 text file's contents — UTF-16 LE with a byte-order mark. Read through
 * the chain, so a mod's own text wins the way the game reads it. Missing or
 * unreadable is '' rather than an error: a roster entry without a name still
 * shows, under its id.
 */
function gameText(data: Assets, href: string): string {
  const b = data.bytes(refPath(href));
  if (!b || !b.length) return '';
  const s = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8');
  return s.replace(/\0+$/, '').trim();
}

/**
 * Sort a roster the way a picker has to show it: by what the user READS.
 *
 * Table order is the id order, which is chronological — the addon's creatures
 * after the original's, and a mod's after those. Fine for the engine, useless
 * for finding "Снайперы" in a dropdown of 181.
 */
function byLabel(entries: RosterEntry[]): RosterEntry[] {
  // The source order is about to be sorted away, and it is the order a stored
  // list is written back in — so it rides along on each entry.
  entries.forEach((e, i) => { e.order = i; });
  // The "unset" member stays on top — it is a legal value and the one a picker
  // is opened to choose about as often as any other, so alphabetising it into
  // the middle would be a small cruelty.
  const unset = (e: RosterEntry): number => (/_(NONE|UNKNOWN)$/.test(e.id) ? 0 : 1);
  return entries.sort((a, b) => unset(a) - unset(b)
    || (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true }));
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

/**
 * An fs path as the leading-slash href the map stores. Relative to the ROOT, so
 * two mounted roots holding the same definition produce the same href — which is
 * how the scan dedupes them.
 */
function toHref(root: string, path: string, xpointer: string): string {
  const rel = relative(root, path).split(sep).join('/');
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
function scanClass(data: Assets, className: string): RosterEntry[] {
  const suffix = `.(${className}).xdb`;
  const libSeg = `_(${className})`;
  const xpointer = '/' + className;
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  // Every mounted root, and each object folder inside it. Keyed by the HREF, so
  // a definition a mod overrides is listed once — under the topmost root, which
  // is the copy the game will read.
  for (const root of data.roots) {
    for (const dir of OBJECT_DIRS) {
      const base = join(root, dir);
      for (const f of walkFiles(base, (n) => n.endsWith('.xdb'))) {
        const href = toHref(root, f, xpointer);
        if (seen.has(href)) continue;
        const bn = basename(f);
        const parts = relative(base, f).split(sep);
        const bySuffix = bn.endsWith(suffix);
        const inLib = parts.includes(libSeg);
        if (!bySuffix && !inLib) continue;
        seen.add(href);
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
        out.push(group ? { id: href, name, group } : { id: href, name });
      }
    }
  }
  out.sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || ''));
  return out;
}
