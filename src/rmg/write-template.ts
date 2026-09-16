// An RMG template, written back the way the game's serialiser writes it.
//
// The reader (`template.ts`) turns the file into numbers; this turns the
// numbers into the file, and the shape it makes is the shape of the twenty-two
// shipped `.xdb` — the same tags in the same order, a tab per level, CRLF, one
// `<Item>` per line — so that reading a shipped template and writing it out
// again gives back the bytes it came from (`tools/test-rmg-write-template.ts`
// holds it to that over all 22). That is the whole reason for a writer of our
// own rather than a generic pretty-printer: a template the editor saves must
// be one the game's own parser would read the same, and the only proof of the
// shape is the game's files.
//
// Fields of OURS (`.h5et`: ZoneLayout, LayoutJitter, UniqueRaces; a zone's
// GuardMultiplier, TreasureBlocks, Objects; a connection's Road) are written
// only when they say something the engine's default does not — so a template
// with none of them writes as a plain `.xdb`, byte for byte, and one with them
// is the same file with a few tags more, each where `Jebus Cross.h5et` puts
// it. The DEAD fields (TwoWay, Guarded, Wide, GraalOnMap, Underground and the
// rest) are written like any other: the format carries them, and a writer
// that dropped them would write a different format.

import { encodeEntities as escape } from '../format/xml.ts';
import type { RmgConnection, RmgTemplate, RmgZone, RmgZoneObject } from './template.ts';

const EOL = '\r\n';

/**
 * Lines with their depth, joined at the end: each `line(depth, text)` is one
 * line of the file, and nothing here pretty-prints — the depth is spelled out
 * at every call, the way the serialiser's nesting spells it.
 */
class Lines {
  private readonly out: string[] = [];
  line(depth: number, text: string): void { this.out.push('\t'.repeat(depth) + text); }
  /** `<Name>value</Name>` on one line; an empty string is `<Name/>`, the serialiser's spelling. */
  field(depth: number, name: string, value: string | number | boolean): void {
    if (value === '') { this.line(depth, `<${name}/>`); return; }
    this.line(depth, `<${name}>${typeof value === 'string' ? escape(value) : String(value)}</${name}>`);
  }
  /**
   * `<Zones>…</Zones>` around what `body` writes a level deeper, or `<Zones/>`
   * when there is nothing — the serialiser's spelling, seen in a shipped
   * template (`S1-3P2Z7V3`, three zones with `<Dwellings/>`).
   */
  list(depth: number, name: string, count: number, body: () => void): void {
    if (!count) { this.line(depth, `<${name}/>`); return; }
    this.line(depth, `<${name}>`);
    body();
    this.line(depth, `</${name}>`);
  }
  /** `<Mines><Item>n</Item>…</Mines>` — the tier counts, as many as the list holds, one a line. */
  items(depth: number, name: string, values: readonly number[]): void {
    this.list(depth, name, values.length, () => { for (const v of values) this.field(depth + 1, 'Item', v); });
  }
  text(): string { return this.out.join(EOL) + EOL; }
}

function writeZone(w: Lines, z: RmgZone): void {
  const d = 2;
  w.line(d, '<Item>');
  w.field(d + 1, 'Index', z.index);
  w.field(d + 1, 'Setting', z.setting);
  w.field(d + 1, 'CanBeWater', z.canBeWater);
  w.field(d + 1, 'Size', z.size);
  w.field(d + 1, 'CanBePlayerStart', z.canBePlayerStart);
  w.field(d + 1, 'Town', z.town);
  w.field(d + 1, 'TownGuardStrenght', z.townGuardStrenght);
  // Written only where the file wrote it (template.ts, `shipyard`): the
  // engine defaults it true, and two shipped templates spell that out.
  if (z.shipyard !== null) w.field(d + 1, 'Shipyard', z.shipyard);
  // Ours, after the town's guard — it scales the guards the zone seats for itself.
  if (z.guardMultiplier !== 1) w.field(d + 1, 'GuardMultiplier', z.guardMultiplier);
  // As many tiers as the list holds: the length is the file's (template.ts, `mines`).
  w.items(d + 1, 'Mines', z.mines);
  w.field(d + 1, 'AbandonedMines', z.abandonedMines);
  w.items(d + 1, 'Dwellings', z.dwellings);
  w.field(d + 1, 'UpgBuildingsDensity', z.upgBuildingsDensity);
  w.field(d + 1, 'TreasureDensity', z.treasureDensity);
  w.field(d + 1, 'TreasureChestDensity', z.treasureChestDensity);
  w.field(d + 1, 'Prisons', z.prisons);
  w.field(d + 1, 'LandCartographer', z.landCartographer);
  w.field(d + 1, 'ShopPoints', z.shopPoints);
  w.field(d + 1, 'ShrinePoints', z.shrinePoints);
  w.field(d + 1, 'LuckMoralBuildingsDensity', z.luckMoralBuildingsDensity);
  w.field(d + 1, 'ResourceBuildingsDensity', z.resourceBuildingsDensity);
  w.field(d + 1, 'TreasureBuildingPoints', z.treasureBuildingPoints);
  w.field(d + 1, 'TreasureBlocksTotalValue', z.treasureBlocksTotalValue);
  // Ours, beside the total it replaces.
  if (z.treasureBlocks.length) {
    w.list(d + 1, 'TreasureBlocks', z.treasureBlocks.length, () => {
      for (const r of z.treasureBlocks) {
        w.line(d + 2, '<Item>');
        w.field(d + 3, 'Min', r.min);
        w.field(d + 3, 'Max', r.max);
        w.field(d + 3, 'Count', r.count);
        w.line(d + 2, '</Item>');
      }
    });
  }
  w.field(d + 1, 'DenOfThieves', z.denOfThieves);
  w.field(d + 1, 'RedwoodObservatoryDensity', z.redwoodObservatoryDensity);
  w.field(d + 1, 'BuffPoints', z.buffPoints);
  // Ours, last: the named objects.
  if (z.objects.length) w.list(d + 1, 'Objects', z.objects.length, () => { for (const o of z.objects) writeObject(w, d + 2, o); });
  w.line(d, '</Item>');
}

/**
 * One `<Objects>` line. `Max` absent is "no ceiling" (the reader gives
 * Infinity), so Infinity writes no tag; a guard of 0 is the reader's default
 * for an absent tag and writes none either.
 */
function writeObject(w: Lines, d: number, o: RmgZoneObject): void {
  w.line(d, '<Item>');
  w.field(d + 1, 'Href', o.href);
  w.field(d + 1, 'Min', o.min);
  if (Number.isFinite(o.max)) w.field(d + 1, 'Max', o.max);
  if (o.guardStrenght) w.field(d + 1, 'GuardStrenght', o.guardStrenght);
  w.line(d, '</Item>');
}

function writeConnection(w: Lines, c: RmgConnection): void {
  const d = 2;
  w.line(d, '<Item>');
  w.field(d + 1, 'SourceZoneIndex', c.sourceZoneIndex);
  w.field(d + 1, 'DestZoneIndex', c.destZoneIndex);
  w.field(d + 1, 'TwoWay', c.twoWay);
  w.field(d + 1, 'GuardStrenght', c.guardStrenght);
  w.field(d + 1, 'Guarded', c.guarded);
  w.field(d + 1, 'Wide', c.wide);
  // Ours: true is the engine's passage and needs no tag.
  if (!c.road) w.field(d + 1, 'Road', false);
  w.line(d, '</Item>');
}

/** The template as the file's text — CRLF, tabs, the game's tag order. */
export function writeTemplate(t: RmgTemplate): string {
  const w = new Lines();
  w.line(0, '<?xml version="1.0" encoding="UTF-8"?>');
  w.line(0, '<RMGTemplate>');
  if (t.nameFileRef !== null) w.line(1, `<NameFileRef href="${escape(t.nameFileRef)}"/>`);
  w.line(1, `<DescriptionFileRef href="${escape(t.descriptionFileRef)}"/>`);
  w.field(1, 'Name', t.name);
  // Ours, after the name: how the zones are laid out and what the races may do.
  if (t.zoneLayout !== 'Engine') w.field(1, 'ZoneLayout', t.zoneLayout);
  if (t.layoutJitter !== 0) w.field(1, 'LayoutJitter', t.layoutJitter);
  if (t.uniqueRaces) w.field(1, 'UniqueRaces', true);
  w.list(1, 'Zones', t.zones.length, () => { for (const z of t.zones) writeZone(w, z); });
  w.list(1, 'Connections', t.connections.length, () => { for (const c of t.connections) writeConnection(w, c); });
  w.field(1, 'GraalOnMap', t.graalOnMap);
  w.field(1, 'MinPlayers', t.minPlayers);
  w.field(1, 'MaxPlayers', t.maxPlayers);
  w.field(1, 'MinMapSize', t.minMapSize);
  w.field(1, 'MaxMapSize', t.maxMapSize);
  w.field(1, 'Underground', t.underground);
  w.field(1, 'TestTemplate', t.testTemplate);
  w.line(0, '</RMGTemplate>');
  return w.text();
}

/**
 * Whether a template needs the `.h5et` spelling: any field of ours that
 * says something the engine's default does not. A template without one is
 * a plain `.xdb` the game's own generator could read — the editor may still
 * save it as `.h5et`, but the answer tells it when the two are the same file.
 */
export function usesOwnFields(t: RmgTemplate): boolean {
  return t.zoneLayout !== 'Engine' || t.layoutJitter !== 0 || t.uniqueRaces
    || t.zones.some((z) => z.guardMultiplier !== 1 || z.treasureBlocks.length > 0 || z.objects.length > 0)
    || t.connections.some((c) => !c.road);
}
