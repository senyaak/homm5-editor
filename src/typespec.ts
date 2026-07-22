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
  /** Id of the field's own type — another type's `__ServerPtr` for a structure,
   *  a small primitive id (`01000000` = int, `04000000` = bool) otherwise. */
  type?: string;
}

export interface SpecType {
  name: string;
  fields: SpecField[];
  /**
   * The base's id, or absent at the root of a chain. The id it names is the
   * base type's `__ServerPtr` — NOT its `TypeID`, which is a different number
   * entirely. `AdvMapMonster` points at `0b064c32`, which is the `__ServerPtr`
   * of `AdvMapObjectBase`, the type that declares Pos/Rot/Floor/Name/Shared.
   */
  baseType?: string;
  /** This type's own id, as `BaseType` elsewhere refers to it. */
  ptr?: string;
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
    for (const f of fieldsBlock.matchAll(/<Type>([0-9a-f]{8})<\/Type>\s*<Name>([^<]*)<\/Name>([\s\S]*?)<ComplexDefaultValue>/g)) {
      const meta = f[3]!;
      const dv = between(meta, '<DefaultValue>', '</DefaultValue>') ?? '';
      // Type 00000000 is "no default declared", not "default of type 0".
      const has = dv && !dv.includes('<Type>00000000</Type>');
      const data = has ? between(dv, '<Data>', '</Data>') : null;
      fields.push({ name: f[2]!, default: has ? (data ?? '').trim() : null, type: f[1]! });
    }
    const base = between(body, '<BaseType>', '</BaseType>');
    const typeId = between(body, '<TypeID>', '</TypeID>');
    // The id is BEFORE the name in the item, so it comes from the text ahead of
    // this type's declaration — the tail of the previous slice.
    // TYPE_TYPE_CLASS for an object, TYPE_TYPE_STRUCT for a value structure
    // (Vec3, CommonObjective) — both are types a field can point at.
    const ptr = /<__ServerPtr>([0-9a-f]+)<\/__ServerPtr>\s*<Type>TYPE_TYPE_(?:CLASS|STRUCT)<\/Type>\s*$/
      .exec(xml.slice(Math.max(0, from - 200), from))?.[1];
    out.set(name, {
      name,
      fields,
      // 00000000 is "no base", not a type whose id is zero.
      ...(base && base !== '00000000' ? { baseType: base } : {}),
      ...(ptr ? { ptr } : {}),
      ...(typeId ? { typeId } : {}),
    });
  }
  return out;
}

/**
 * Every field of a type INCLUDING the ones it inherits, base first — which is
 * also the order they are written in a file.
 *
 * `AdvMapMonster` declares twenty fields; an actual monster carries those plus
 * the five from `AdvMapObjectBase`. Reading the type alone and concluding a
 * monster has no `Pos` would be a plausible way to get this exactly wrong.
 */
export function allFields(spec: Map<string, SpecType>, typeName: string): SpecField[] {
  const t = spec.get(typeName);
  return t ? inherited(t, byPtr(spec)) : [];
}

/**
 * The field names a type carries, in order, with the same for each of its
 * structured fields — everything needed to add a missing field IN ITS PLACE,
 * at any depth. A seer hut's missing `CheckDelay` lives inside `Quest`, so a
 * flat list of the object's own fields would not have found it.
 */
export interface FieldOrder {
  names: string[];
  children: Record<string, FieldOrder>;
}

/** Index of every type by the id other types refer to it with. */
function byPtr(spec: Map<string, SpecType>): Map<string, SpecType> {
  const out = new Map<string, SpecType>();
  for (const t of spec.values()) if (t.ptr) out.set(t.ptr, t);
  return out;
}

/**
 * Build the order tree for a type.
 *
 * `depth` stops the walk before a type that contains itself (an objective's
 * dependencies are objectives) turns into an infinite structure; six levels is
 * deeper than anything a map object actually nests.
 */
export function fieldOrder(spec: Map<string, SpecType>, typeName: string, depth = 6): FieldOrder | null {
  const index = byPtr(spec);
  const build = (t: SpecType | undefined, left: number, seen: Set<string>): FieldOrder | null => {
    if (!t || left <= 0 || seen.has(t.name)) return null;
    const fields = inherited(t, index);
    const children: Record<string, FieldOrder> = {};
    for (const f of fields) {
      const sub = f.type ? index.get(f.type) : undefined;
      if (!sub) continue;
      const kid = build(sub, left - 1, new Set([...seen, t.name]));
      if (kid) children[f.name] = kid;
    }
    return { names: fields.map((f) => f.name), children };
  };
  return build(spec.get(typeName), depth, new Set());
}

/** A type's fields plus everything it inherits, base first. */
function inherited(t: SpecType, index: Map<string, SpecType>): SpecField[] {
  const chain: SpecType[] = [];
  const seen = new Set<string>();
  let cur: SpecType | undefined = t;
  while (cur && !seen.has(cur.name)) {
    seen.add(cur.name);
    chain.unshift(cur);
    cur = cur.baseType ? index.get(cur.baseType) : undefined;
  }
  return chain.flatMap((x) => x.fields);
}

/** Just the fields the spec gives a default for, as name -> value. */
export function declaredDefaults(t: SpecType): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of t.fields) if (f.default !== null) out.set(f.name, f.default);
  return out;
}
