// THE FIELD MAP OF AN XDB-SERIALISED STRUCTURE, out of the serialiser itself.
//
// Every structure the engine reads from a `.xdb` has one function that walks
// its fields, and that function says the two things a field map needs in the
// same breath: `lea eax,[edi+<offset>]` — where the value goes — and
// `push <"Name">` — what the file calls it. So the map is not inferred from
// the XML, or from the order fields appear in, or from sizes guessed by type:
// it is READ, name beside offset, out of the code that does the reading.
//
// `struct-fields.ts` prints it; `struct-use.ts` joins a sweep against it.

import { PEFile } from '../../src/exe/pe.ts';
import { functionBody } from '../../src/exe/disasm.ts';

export interface XdbField {
  /** Null when the pairing found no address for the name — see below. */
  offset: number | null;
  name: string;
  /** Where the name is pushed, so a doubtful pairing can be looked at. */
  at: number;
}

/** A name is a printable ASCII identifier — anything else is not a field name. */
function fieldName(pe: PEFile, va: number): string | null {
  const s = pe.stringAt(va, 64);
  return s && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : null;
}

interface Event { kind: 'lea' | 'name'; index: number; offset?: number; name?: string; at: number }

/**
 * Read one serialiser's field map.
 *
 * TWO IDIOMS, and the difference decides which `lea` a name belongs to.
 *
 *   a plain field   lea eax,[edi+48h] … push "Mine1LevelMinRadius" … call
 *   a nested one    push "MapName" / call <enter> … lea eax,[edi+0D0h] … call
 *
 * The first pushes the address as an argument, so the `lea` comes BEFORE the
 * name; the second opens a block named by the string and only then writes into
 * the field, so the `lea` comes AFTER. Pairing on "the last lea" alone reads
 * the second kind one field out of step — every text reference in
 * `SRMGParameters` came out shifted by twelve bytes — and the listing looks
 * perfectly reasonable while being wrong from `MapName` onward. So each name
 * takes the nearest unclaimed address in either direction, the one before
 * first, and an address is claimed only once.
 */
export function xdbFields(pe: PEFile, at: number, maxBytes = 0x2000): XdbField[] {
  const offsetAt = pe.offsetOf(at);
  if (offsetAt === null) return [];

  const NEAR = 8;
  const events: Event[] = [];
  let index = 0;
  for (const ins of functionBody(pe.buf.subarray(offsetAt), at, maxBytes)) {
    index++;
    if (ins.mnemonic === 'lea' && ins.memory && ins.memory.base !== 'None' && ins.memory.index === 'None') {
      events.push({ kind: 'lea', index, offset: ins.memory.displacement | 0, at: ins.address });
      continue;
    }
    if (ins.mnemonic !== 'push') continue;
    for (const imm of ins.immediates) {
      const name = fieldName(pe, imm);
      if (name) events.push({ kind: 'name', index, name, at: ins.address });
    }
  }

  const claimed = new Set<Event>();
  const fields: XdbField[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind !== 'name') continue;
    let chosen: Event | undefined;
    for (let j = i - 1; j >= 0 && e.index - events[j]!.index <= NEAR; j--) {
      const c = events[j]!;
      if (c.kind === 'lea' && !claimed.has(c)) { chosen = c; break; }
    }
    if (!chosen) {
      for (let j = i + 1; j < events.length && events[j]!.index - e.index <= NEAR; j++) {
        const c = events[j]!;
        if (c.kind === 'lea' && !claimed.has(c)) { chosen = c; break; }
      }
    }
    if (chosen) claimed.add(chosen);
    fields.push({ offset: chosen?.offset ?? null, name: e.name!, at: e.at });
  }
  return fields;
}

/**
 * Which field an offset falls in.
 *
 * A field OWNS the bytes up to the next one: an href is eight bytes with a
 * flag in its second word, a vector twelve with `end` and `capacity` behind
 * `begin`, and a read of `+0x154` is a read of the `DeepWaterTile` at `+0x150`
 * — not of an unnamed hole. Sorting and taking the last field at or before the
 * offset is the whole of it.
 */
export function fieldAt(fields: XdbField[], offset: number): { field: XdbField; within: number } | null {
  let best: XdbField | null = null;
  for (const f of fields) {
    if (f.offset === null || f.offset > offset) continue;
    if (!best || f.offset > best.offset!) best = f;
  }
  return best ? { field: best, within: offset - best.offset! } : null;
}
