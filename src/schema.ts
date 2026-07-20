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

export type RegistryName = 'spells' | 'artifacts' | 'heroes' | 'races' | 'ambientLights';
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
  properties?: Record<string, FieldSchema>;
  $ref?: string;
  'x-registry'?: RegistryName;
  'x-ref'?: boolean;
  'x-file'?: boolean;
  'x-widget'?: WidgetKind;
  'x-tab'?: TabName;
  'x-mapObjects'?: 'town' | 'hero';
  'x-readonly'?: boolean;
  'x-advanced'?: boolean;
}

export interface MapSchema extends FieldSchema {
  properties: Record<string, FieldSchema>;
  $defs?: Record<string, FieldSchema>;
}

/** The parsed schema, typed. */
export const mapSchema = mapSchemaJson as unknown as MapSchema;

/**
 * Resolve a local `$ref` (`#/$defs/Player`) against the root. Returns null for
 * anything that is not a local $defs pointer — we author no remote refs.
 */
export function resolveRef(root: MapSchema, ref: string): FieldSchema | null {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  return m ? root.$defs?.[m[1]!] ?? null : null;
}

/**
 * A field with its `$ref` followed. Keywords written beside a `$ref` (a `title`,
 * `x-advanced`) win over the referenced def, so a shared def can be reused under
 * a field-specific label. Non-$ref schemas are returned unchanged.
 */
export function deref(root: MapSchema, f: FieldSchema): FieldSchema {
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
