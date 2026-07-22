// The game's own type system — `<game>/data/types.xml`, 2.4 MB, 775 types.
//
// This is the spec everything else in the data tree is an instance of: every
// type's field list, each field's type id, chunk id, constraints (min/max) and,
// where the engine has one, its DEFAULT VALUE. Types inherit through `BaseType`,
// which is why `AdvMapMonster` declares twenty fields and not the twenty-four an
// object carries — `Pos`, `Rot`, `Floor`, `Name` come from the base.
//
// What it is good for, and what it is not:
//
//   * It is authoritative about SHAPE — which fields a type has, in what order,
//     with what constraints. Better than anything we can infer from maps, which
//     is how docs/OBJECT_FIELDS.md was built.
//   * It is NOT a complete source of DEFAULTS. Only 17 fields across the 21 map
//     object types carry a DefaultValue; the rest of what a new object gets —
//     a town's town hall, a shipyard's boat four tiles out, a monster's
//     Amount 0 — is the EDITOR's behaviour, not the type system's, and only a
//     map the editor saved can testify to it (docs/OBJECT_DEFAULTS.md).
//
// So the two sources check each other rather than replace each other: where the
// spec speaks, tools/test-defaults.ts asserts we agree with it; where it is
// silent, the measurement stands. They have never yet disagreed.
//
// Read at test time from the installed game, so nothing copyrighted is copied
// into the repository.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** One field of a type, as the spec declares it. */
export interface SpecField {
  name: string;
  /** The engine's default, verbatim, or null when it declares none. */
  default: string | null;
}

export interface SpecType {
  name: string;
  fields: SpecField[];
  /** Type id of the base this inherits from, when it has one. */
  baseType?: string;
  typeId?: string;
}

/** Where types.xml lives under a data root, if it is there at all. */
export function typesXmlPath(dataRoot: string): string | null {
  const p = join(dataRoot, 'types.xml');
  return existsSync(p) ? p : null;
}

const between = (s: string, open: string, close: string): string | null => {
  const a = s.indexOf(open);
  if (a < 0) return null;
  const b = s.indexOf(close, a + open.length);
  return b < 0 ? null : s.slice(a + open.length, b);
};

/**
 * Parse types.xml into a type -> spec map.
 *
 * Split on `<TypeName>` rather than on the enclosing `<Item>`: the file nests
 * items several levels deep (fields, constraints, nested types) and matching
 * the wrapper means counting them. Each type's text runs to the next type name,
 * which is exact for a flat list and harmless for the nested ones — a nested
 * type simply becomes an entry of its own.
 */
export function readTypeSpec(path: string): Map<string, SpecType> {
  const xml = readFileSync(path, 'utf8');
  const out = new Map<string, SpecType>();
  const names = [...xml.matchAll(/<TypeName>([^<]+)<\/TypeName>/g)];
  for (let i = 0; i < names.length; i++) {
    const name = names[i]![1]!;
    const from = names[i]!.index!;
    const to = i + 1 < names.length ? names[i + 1]!.index! : xml.length;
    const body = xml.slice(from, to);
    const fieldsBlock = between(body, '<Fields>', '</Fields>') ?? '';
    const fields: SpecField[] = [];
    // A field is <Name>…</Name> followed by its metadata up to the
    // <ComplexDefaultValue> that closes it.
    for (const f of fieldsBlock.matchAll(/<Name>([^<]*)<\/Name>([\s\S]*?)<ComplexDefaultValue>/g)) {
      const meta = f[2]!;
      const dv = between(meta, '<DefaultValue>', '</DefaultValue>') ?? '';
      // Type 00000000 is "no default declared", not "default of type 0".
      const has = dv && !dv.includes('<Type>00000000</Type>');
      const data = has ? between(dv, '<Data>', '</Data>') : null;
      fields.push({ name: f[1]!, default: has ? (data ?? '').trim() : null });
    }
    out.set(name, {
      name,
      fields,
      ...(between(body, '<BaseType>', '</BaseType>') ? { baseType: between(body, '<BaseType>', '</BaseType>')! } : {}),
      ...(between(body, '<TypeID>', '</TypeID>') ? { typeId: between(body, '<TypeID>', '</TypeID>')! } : {}),
    });
  }
  return out;
}

/** Just the fields the spec gives a default for, as name -> value. */
export function declaredDefaults(t: SpecType): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of t.fields) if (f.default !== null) out.set(f.name, f.default);
  return out;
}
