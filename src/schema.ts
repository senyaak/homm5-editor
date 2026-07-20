// Typed-editing schema for the map header — the single declaration both the
// tree and the dialog build their controls from, and the source docs can be
// generated from. The data lives in map.schema.json (portable JSON Schema, so
// external tools and people can read it); this module gives it TypeScript types
// and the small helpers the UI needs.
//
// Standard JSON Schema describes the shape; a handful of x- keywords carry the
// game-specific intent the vocabulary can't:
//   x-registry   which dynamic roster supplies the values (see src/registry.ts)
//   x-ref        the value is an href — offer a picker, never a free-text box
//   x-file       the href points at a sibling text file (name/description/rumour)
//   x-widget     the control to use
//   x-tab        which dialog tab the field belongs to
//   x-mapObjects pick from the map's own objects of a type (town/hero)
//   x-readonly   shown, not edited (dimensions, format version, fixed colours)
//   x-advanced   deep/rare structure — the tree edits it, the dialog skips it
//
// The schema is authored toward completeness; anything it does not yet describe
// falls back to the generic value-shape inference in map.ts, so the editor is
// always usable while the schema fills in.

import mapSchemaJson from './map.schema.json' with { type: 'json' };
import objectsSchemaJson from './objects.schema.json' with { type: 'json' };

export type RegistryName =
  | 'spells' | 'artifacts' | 'heroes' | 'races' | 'ambientLights' | 'creatures' | 'skills'
  | 'birds' | 'winds' | 'weathers';
export type WidgetKind =
  | 'checklist' | 'dropdown' | 'teamgrid' | 'textfile' | 'script' | 'herolevel';
export type TabName =
  | 'general' | 'players' | 'teams' | 'heroes' | 'spells' | 'artifacts' | 'script' | 'rumours';
export type JsonType = 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object';

/** One node of the schema — a field, an array's items, or a $def. */
export interface FieldSchema {
  type?: JsonType;
  title?: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: FieldSchema;
  /** Bounds on a list's length — gate add/remove; absent means unbounded. */
  minItems?: number;
  maxItems?: number;
  /** Value a freshly-built item's field takes (JSON Schema default). */
  default?: string | number | boolean;
  properties?: Record<string, FieldSchema>;
  $ref?: string;
  /** Composition: a base ($ref) plus type-specific properties. See objectProps(). */
  allOf?: FieldSchema[];
  'x-registry'?: RegistryName;
  'x-ref'?: boolean;
  'x-file'?: boolean;
  /** The Shared identity ref — picked from the object catalogue for this type. */
  'x-shared'?: boolean;
  /** This field DEFINES a name other entities reference (an objective's Name). */
  'x-nameOf'?: string;
  /** This field REFERENCES a name defined elsewhere in the map — offer those as
   *  hints. The kind ('objective', 'object') says which names apply. */
  'x-nameRef'?: string;
  'x-widget'?: WidgetKind;
  'x-tab'?: TabName;
  'x-mapObjects'?: 'town' | 'hero';
  'x-readonly'?: boolean;
  'x-advanced'?: boolean;
}

/** Anything carrying local `$defs` a `$ref` can resolve against. */
export interface HasDefs { $defs?: Record<string, FieldSchema>; }

export interface MapSchema extends FieldSchema {
  properties: Record<string, FieldSchema>;
  $defs?: Record<string, FieldSchema>;
}

/** Object-type schemas, keyed by element name, sharing one $defs pool. */
export interface ObjectsSchema extends HasDefs {
  types: Record<string, FieldSchema>;
}

/** The parsed schemas, typed. */
export const mapSchema = mapSchemaJson as unknown as MapSchema;
export const objectSchema = objectsSchemaJson as unknown as ObjectsSchema;

/**
 * Resolve a local `$ref` (`#/$defs/Player`) against a root's `$defs`. Returns
 * null for anything that is not a local $defs pointer — we author no remote refs.
 */
export function resolveRef(root: HasDefs, ref: string): FieldSchema | null {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  return m ? root.$defs?.[m[1]!] ?? null : null;
}

/**
 * A field with its `$ref` followed. Keywords written beside a `$ref` (a `title`,
 * `x-advanced`) win over the referenced def, so a shared def can be reused under
 * a field-specific label. Non-$ref schemas are returned unchanged.
 */
export function deref(root: HasDefs, f: FieldSchema): FieldSchema {
  if (!f.$ref) return f;
  const target = resolveRef(root, f.$ref);
  if (!target) return f;
  const { $ref, ...local } = f;
  return { ...target, ...local };
}

/** The schema for a top-level `<AdvMapDesc>` field, or null if undeclared. */
export function fieldOf(root: MapSchema, name: string): FieldSchema | null {
  return root.properties[name] ?? null;
}

/**
 * The schema at a data path, following properties (string steps) and array items
 * (number steps), resolving $refs along the way. Lets the main process find the
 * schema for a node it only knows by path — e.g. what a list's items look like.
 */
export function resolveSchemaAtPath(root: MapSchema, path: (string | number)[]): FieldSchema | null {
  let cur: FieldSchema | null = { type: 'object', properties: root.properties };
  for (const step of path) {
    if (!cur) return null;
    cur = deref(root, cur);
    cur = typeof step === 'number'
      ? (cur.items ? deref(root, cur.items) : null)
      : (cur.properties?.[step] ? deref(root, cur.properties[step]!) : null);
  }
  return cur;
}

/**
 * The flattened property set of an object type — the shared CommonObject base
 * (composed via allOf) merged with the type's own fields. Later branches win, so
 * a type could refine a common field. Returns {} for an unknown type, so the
 * panel falls back to generic inference.
 */
export function objectProps(type: string): Record<string, FieldSchema> {
  const root = objectSchema.types[type];
  if (!root) return {};
  const out: Record<string, FieldSchema> = {};
  for (const branch of root.allOf ?? [root]) {
    const d = branch.$ref ? resolveRef(objectSchema, branch.$ref) : branch;
    if (d?.properties) Object.assign(out, d.properties);
  }
  return out;
}

/** The control a field wants — the one decision both surfaces share. */
export type Control =
  | 'checkbox' | 'number' | 'text' | 'enum'   // simple values
  | 'dropdown' | 'checklist' | 'teamgrid' | 'textfile' | 'script' // widgets
  | 'ref' | 'readonly' | 'group';             // refs / structures

/**
 * Decide the control for a (already de-ref'd) field. Explicit `x-widget` wins;
 * otherwise it follows from the type and the ref/registry flags. Structures
 * (objects, and arrays of objects) become a `group` the surface recurses into.
 */
export function controlOf(f: FieldSchema): Control {
  if (f['x-readonly']) return 'readonly';
  if (f['x-widget']) {
    switch (f['x-widget']) {
      case 'dropdown': return 'dropdown';
      case 'checklist': return 'checklist';
      case 'teamgrid': return 'teamgrid';
      case 'textfile': return 'textfile';
      case 'script': return 'script';
      case 'herolevel': return 'number';
    }
  }
  if (f['x-registry']) return f.type === 'array' ? 'checklist' : 'dropdown';
  if (f['x-ref']) return 'ref';
  switch (f.type) {
    case 'boolean': return 'checkbox';
    case 'integer':
    case 'number': return 'number';
    case 'array': return 'group';
    case 'object': return 'group';
    default: return f.enum ? 'enum' : 'text';
  }
}
