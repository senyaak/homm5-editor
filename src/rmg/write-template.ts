// An RMG template, written back the way the game's serialiser writes it.
//
// The reader (`template.ts`) turns the file into numbers; this turns the
// numbers into the file, and the shape it makes is the shape of the twenty-two
// shipped `.xdb` — the same tags in the same order, a tab per level, CRLF, one
// `<Item>` per line, an empty list self-closed — so that reading a shipped
// template and writing it out again gives back the bytes it came from
// (`tools/test-rmg-write-template.ts` holds it to that over all 22). That is
// the whole reason for a writer of our own rather than a generic
// pretty-printer: a template the editor saves must be one the game's own
// parser would read the same, and the only proof of the shape is the game's
// files.
//
// The order comes from the field tables (`template-game.ts`): the game's
// fields in the order they stand there, and after each the fields of ours
// that name it in `after` — written only when they say something the default
// does not, so a template with none of them writes as a plain `.xdb`, byte
// for byte. The DEAD fields (TwoWay, Guarded, Wide, GraalOnMap, Underground
// and the rest) are written like any other: the format carries them, and a
// writer that dropped them would write a different format.

import { encodeEntities as escape } from '../format/xml.ts';
import { GAME_CONNECTION_FIELDS, GAME_TEMPLATE_FIELDS, GAME_ZONE_FIELDS, OUR_CONNECTION_FIELDS, OUR_TEMPLATE_FIELDS, OUR_ZONE_FIELDS } from './template.ts';
import type { FieldSpec, RmgConnection, RmgDiagramNode, RmgTemplate, RmgTreasureRange, RmgZone, RmgZoneObject } from './template.ts';

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
  text(): string { return this.out.join(EOL) + EOL; }
}

/** `<Item><Min>…</Min><Max>…</Max><Count>…</Count></Item>` per range. */
function writeRanges(w: Lines, d: number, ranges: RmgTreasureRange[]): void {
  for (const r of ranges) {
    w.line(d, '<Item>');
    w.field(d + 1, 'Min', r.min);
    w.field(d + 1, 'Max', r.max);
    w.field(d + 1, 'Count', r.count);
    w.line(d, '</Item>');
  }
}

/**
 * One `<Objects>` line each. `Max` absent is "no ceiling" (the reader gives
 * Infinity), so Infinity writes no tag; a guard of 0 is the reader's default
 * for an absent tag and writes none either.
 */
function writeObjects(w: Lines, d: number, objects: RmgZoneObject[]): void {
  for (const o of objects) {
    w.line(d, '<Item>');
    w.field(d + 1, 'Href', o.href);
    w.field(d + 1, 'Min', o.min);
    if (Number.isFinite(o.max)) w.field(d + 1, 'Max', o.max);
    if (o.guardStrenght) w.field(d + 1, 'GuardStrenght', o.guardStrenght);
    w.line(d, '</Item>');
  }
}

/** `<Item><Index>…</Index><X>…</X><Y>…</Y></Item>` per zone drawn. */
function writeDiagram(w: Lines, d: number, nodes: RmgDiagramNode[]): void {
  for (const n of nodes) {
    w.line(d, '<Item>');
    w.field(d + 1, 'Index', n.index);
    w.field(d + 1, 'X', n.x);
    w.field(d + 1, 'Y', n.y);
    w.line(d, '</Item>');
  }
}

/** Whether a field of ours says something: not its default, or a list with entries. */
function speaks(f: FieldSpec, value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== f.default;
}

/** One field, by its kind, at `depth`. */
function writeField(w: Lines, depth: number, f: FieldSpec, value: unknown): void {
  switch (f.kind) {
    case 'int':
    case 'float':
    case 'bool':
    case 'text':
    case 'layout':
      // An optional bool left unwritten (`Shipyard` in twenty templates).
      if (value === null) return;
      w.field(depth, f.tag, value as string | number | boolean);
      return;
    case 'href':
      if (value === null) return;
      w.line(depth, `<${f.tag} href="${escape(value as string)}"/>`);
      return;
    case 'tiers': {
      const counts = value as number[];
      w.list(depth, f.tag, counts.length, () => { for (const n of counts) w.field(depth + 1, 'Item', n); });
      return;
    }
    case 'ranges': {
      const ranges = value as RmgTreasureRange[];
      w.list(depth, f.tag, ranges.length, () => writeRanges(w, depth + 1, ranges));
      return;
    }
    case 'objects': {
      const objects = value as RmgZoneObject[];
      w.list(depth, f.tag, objects.length, () => writeObjects(w, depth + 1, objects));
      return;
    }
    case 'diagram': {
      const nodes = value as RmgDiagramNode[];
      w.list(depth, f.tag, nodes.length, () => writeDiagram(w, depth + 1, nodes));
      return;
    }
    case 'zones': {
      const zones = value as RmgZone[];
      w.list(depth, f.tag, zones.length, () => {
        for (const z of zones) writeRecord(w, depth + 1, z, GAME_ZONE_FIELDS, OUR_ZONE_FIELDS);
      });
      return;
    }
    case 'connections': {
      const connections = value as RmgConnection[];
      w.list(depth, f.tag, connections.length, () => {
        for (const c of connections) writeRecord(w, depth + 1, c, GAME_CONNECTION_FIELDS, OUR_CONNECTION_FIELDS);
      });
      return;
    }
  }
}

/**
 * A record's fields at `depth`: the game's in their table's order, and after
 * each the fields of ours that follow it, when they speak.
 */
function writeFields(w: Lines, depth: number, record: object, game: Record<string, FieldSpec>, ours: Record<string, FieldSpec>): void {
  const values = record as Record<string, unknown>;
  for (const [key, f] of Object.entries(game)) {
    // A dead field is on a record read from a file and absent from one the
    // editor made; the table's default is the shipped files' value.
    writeField(w, depth, f, f.dead && values[key] === undefined ? f.default : values[key]);
    for (const [ourKey, o] of Object.entries(ours)) {
      if (o.after === key && speaks(o, values[ourKey])) writeField(w, depth, o, values[ourKey]);
    }
  }
}

function writeRecord(w: Lines, depth: number, record: object, game: Record<string, FieldSpec>, ours: Record<string, FieldSpec>): void {
  w.line(depth, '<Item>');
  writeFields(w, depth + 1, record, game, ours);
  w.line(depth, '</Item>');
}

/** The template as the file's text — CRLF, tabs, the game's tag order. */
export function writeTemplate(t: RmgTemplate): string {
  const w = new Lines();
  w.line(0, '<?xml version="1.0" encoding="UTF-8"?>');
  w.line(0, '<RMGTemplate>');
  writeFields(w, 1, t, GAME_TEMPLATE_FIELDS, OUR_TEMPLATE_FIELDS);
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
  const any = (record: object, ours: Record<string, FieldSpec>): boolean =>
    Object.entries(ours).some(([key, f]) => speaks(f, (record as Record<string, unknown>)[key]));
  return any(t, OUR_TEMPLATE_FIELDS)
    || t.zones.some((z) => any(z, OUR_ZONE_FIELDS))
    || t.connections.some((c) => any(c, OUR_CONNECTION_FIELDS));
}
