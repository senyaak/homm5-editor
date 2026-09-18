// The race's record in `GameMechanics/RefTables/TownTypesInfo.xdb`: what the
// game says and does about a TOWN TYPE as such, apart from any one town.
//
// Its texts are the race's name — the "Race:" line of the town window, the
// kingdom overview, every place a type is written out — and the names of the
// three walls; its pictures are the four kingdom-overview icons (a town at
// each hall level, 128×128); its values are the race's neutral creature (the
// tier-2 base creature in every shipped record: Archer, Blade Juggler, Stone
// Gargoyle, Witch, Walking Dead, Demon, Axe Thrower, Centaur), the resource
// silo's weekly income, the native war machine, and the moat (damage, the
// spells it casts, the mines under it). The hero-path arrows (`plotting`,
// six models) stay the donor's — a style, not an identity.
//
// A faction's record is the donor's, copied whole under the faction's type
// and rewritten field by field from the spec — never the donor's own text
// files, which is how a clone of Haven came to call itself the Order of
// Light. The table's size is data (`types.xml`, `Table_TownTypeInfo_TownType`)
// and moves with the type; that is the mod's business, not this file's.

import { buildingGlyph, buildingIcon, textureFiles } from './faction-icons.ts';
import type { IconTheme } from './faction-icons.ts';
import { utf16 } from './mod-files.ts';
import type { ModFile } from './mod-files.ts';
import { EOL, hrefOf, once, setHref } from './xml-edit.ts';
import { RESOURCES } from './town-files.ts';
import type { Resource, TownBuild, TownSpec } from './town-files.ts';

export const TOWN_TYPES_INFO = 'GameMechanics/RefTables/TownTypesInfo.xdb';
/** The music and sounds of a race, by TownType: town, tavern, dwellings, battle, siege, win, loss, retreat, the AI's wait. */
export const RACE_MUSIC = 'Sounds/_(Music)/TableRaceMusic.xdb';

/** The race as such — what `TownSpec.race` says. */
export interface RaceSpec {
  /** What the race is called: "Race:" in the town window, the overview, the reports. */
  name: string;
  /** The resource silo's weekly income; the donor's when absent. */
  siloIncome?: Partial<Record<Resource, number>>;
  /** `WAR_MACHINE_BALLISTA` | `WAR_MACHINE_FIRST_AID_TENT` | `WAR_MACHINE_AMMO_CART` | `WAR_MACHINE_NONE`; the donor's when absent. */
  warMachine?: string;
  /** The moat: its damage per turn and the spells it casts on those in it; the donor's when absent. */
  moat?: { damage?: number; spells?: readonly MoatSpell[] };
  /** Whose music the race plays — a shipped TownType's whole set (RACE_MUSIC); the donor's when absent. A race without a row is silent. */
  music?: string;
}

/** One spell a moat casts: which, how likely (percent), at what mastery and power. */
export interface MoatSpell {
  spell: string;
  chance: number;
  mastery: 'MASTERY_NONE' | 'MASTERY_BASIC' | 'MASTERY_ADVANCED' | 'MASTERY_EXPERT';
  power: number;
}

/** The files a race's record names that are the faction's own. */
export interface RaceFiles {
  files: ModFile[];
  /** The race's name text. */
  name: string;
  /** The four kingdom-overview icons' texture documents, by hall level. */
  kingdomIcons: string[];
}

/** The race's name text and its four overview icons, drawn in the theme. */
export function raceFiles(spec: Pick<TownSpec, 'file'>, race: RaceSpec, theme: IconTheme | undefined): RaceFiles {
  const dir = `Factions/${spec.file}`;
  const name = `${dir}/race.txt`;
  const files: ModFile[] = [{ path: name, data: utf16(race.name) }];
  const kingdomIcons: string[] = [];
  if (theme) {
    for (let level = 1; level <= 4; level++) {
      const path = `${dir}/icons/kingdom_${level}.xdb`;
      files.push(...textureFiles(path, buildingIcon(buildingGlyph('TB_TOWN_HALL', level), theme)));
      kingdomIcons.push(path);
    }
  }
  return { files, name, kingdomIcons };
}

/** The `<Item>…</Item>` around a record's ID, at any depth of nested items. */
export function recordAround(table: string, id: string): [number, number] {
  const idAt = once(table, `<ID>${id}</ID>`, `${TOWN_TYPES_INFO} record ${id}`);
  const start = table.lastIndexOf('<Item>', idAt);
  if (start < 0) throw new Error(`${id}: no enclosing <Item>`);
  const tag = /<Item(?:\s[^>]*)?>|<\/Item>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(table); m; m = tag.exec(table)) {
    if (m[0] === '</Item>') {
      if (--depth === 0) return [start, m.index + m[0].length];
    } else if (!m[0].endsWith('/>')) depth++;
  }
  throw new Error(`${id}: unbalanced <Item>`);
}

/** The name text a copied building record reads, as an absolute href. */
function buildingName(build: TownBuild, key: string): string {
  const path = build.records.get(key);
  if (!path) throw new Error(`${build.paths.dir}: the copy has no ${key} record to take the wall's name from`);
  const text = build.files.find((f) => f.path === path)?.data.toString('latin1');
  const href = text && hrefOf(text, 'NameFileRef');
  if (!href) throw new Error(`${path}: no <NameFileRef> to name the wall by`);
  return href;
}

function setValue(record: string, tag: string, value: string | number, what: string): string {
  const re = new RegExp(`<${tag}>[^<]*</${tag}>`);
  if (!re.test(record)) throw new Error(`${what}: no <${tag}> in the type record`);
  return record.replace(re, `<${tag}>${value}</${tag}>`);
}

/**
 * The table with the faction's record: the donor's, copied under the
 * faction's type at the end, its texts, icons and values made ours. Refused
 * when the type is there already.
 */
export function patchTownTypesInfo(table: string, spec: TownSpec, build: TownBuild, race: RaceFiles): string {
  if (table.includes(`<ID>${spec.type}</ID>`)) throw new Error(`${TOWN_TYPES_INFO} already has ${spec.type}`);
  const [s, e] = recordAround(table, spec.donor);
  let record = table.slice(s, e).replace(`<ID>${spec.donor}</ID>`, `<ID>${spec.type}</ID>`);
  const what = `${spec.file}'s type record`;
  record = setHref(record, 'textType', `/${race.name}`, what);
  record = setHref(record, 'textFort', buildingName(build, 'TB_FORT'), what);
  record = setHref(record, 'textCitadel', buildingName(build, 'TB_FORT/2'), what);
  record = setHref(record, 'textCaste', buildingName(build, 'TB_FORT/3'), what);
  if (race.kingdomIcons.length) {
    const icons = once(record, '<kingdomTownIcons>', what);
    const end = once(record, '</kingdomTownIcons>', what) + '</kingdomTownIcons>'.length;
    const indent = '\t\t\t\t';
    const block = [
      '<kingdomTownIcons>', '\t<textures>',
      ...race.kingdomIcons.map((p) => `\t\t<Item href="/${p}#xpointer(/Texture)"/>`),
      '\t</textures>', '</kingdomTownIcons>',
    ].map((l, i) => (i ? indent : '') + l).join(EOL);
    record = record.slice(0, icons) + block + record.slice(end);
  }
  const tier2 = spec.dwellings?.[2]?.base;
  if (tier2) record = setValue(record, 'NeutralCreature', tier2, what);
  const r = spec.race;
  if (r?.siloIncome) for (const res of RESOURCES) {
    const n = r.siloIncome[res];
    if (n !== undefined) record = setValue(record, res, n, what);
  }
  if (r?.warMachine) record = setValue(record, 'NativeWarMachine', r.warMachine, what);
  if (r?.moat?.damage !== undefined) record = setValue(record, 'MoatMaxDamage', r.moat.damage, what);
  if (r?.moat?.spells) {
    const spells = r.moat.spells.length
      ? ['<MoatSpells>', ...r.moat.spells.flatMap((sp) => [
        '\t<Item>', `\t\t<Spell>${sp.spell}</Spell>`, `\t\t<Chance>${sp.chance}</Chance>`,
        `\t\t<SpellMastery>${sp.mastery}</SpellMastery>`, `\t\t<SpellPower>${sp.power}</SpellPower>`, '\t</Item>',
      ]), '</MoatSpells>'].map((l, i) => (i ? '\t\t\t\t\t' : '') + l).join(EOL)
      : '<MoatSpells/>';
    if (!/<MoatSpells(\/>|>[\s\S]*?<\/MoatSpells>)/.test(record)) throw new Error(`${what}: no <MoatSpells> in the type record`);
    record = record.replace(/<MoatSpells(\/>|>[\s\S]*?<\/MoatSpells>)/, spells);
  }
  const close = table.lastIndexOf('</objects>');
  if (close < 0) throw new Error(`${TOWN_TYPES_INFO}: no </objects>`);
  const lineStart = table.lastIndexOf('\n', close) + 1;
  return `${table.slice(0, lineStart)}\t\t${record}${EOL}${table.slice(lineStart)}`;
}

/**
 * The music table with a row for the faction: the row of `spec.race.music`
 * (the donor's when unsaid) under our type, at the end. The rows are looked
 * up by `<race>`; a type without one has no music anywhere — the battle,
 * the town, the tavern all silent (launch 33). Refused when the type is there.
 */
export function patchRaceMusic(table: string, spec: TownSpec): string {
  if (table.includes(`<race>${spec.type}</race>`)) throw new Error(`${RACE_MUSIC} already has ${spec.type}`);
  const from = spec.race?.music ?? spec.donor;
  const at = table.indexOf(`<race>${from}</race>`);
  if (at < 0) throw new Error(`${RACE_MUSIC}: no row for ${from} to take the music from`);
  const start = table.lastIndexOf('<Item>', at);
  const info = table.indexOf('</musicInfo>', at);
  const end = info < 0 ? -1 : table.indexOf('</Item>', info) + '</Item>'.length;
  if (start < 0 || end < '</Item>'.length) throw new Error(`${RACE_MUSIC}: the row of ${from} is not laid out as shipped`);
  const row = table.slice(start, end).replace(`<race>${from}</race>`, `<race>${spec.type}</race>`);
  const close = table.lastIndexOf('</objects>');
  if (close < 0) throw new Error(`${RACE_MUSIC}: no </objects>`);
  const lineStart = table.lastIndexOf('\n', close) + 1;
  return `${table.slice(0, lineStart)}\t\t${row}${EOL}${table.slice(lineStart)}`;
}

