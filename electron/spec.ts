// The game's own type spec (types.xml), read once and answered from.
//
// 2.4 MB of XML: parsed on first use, never at startup, and only when the data
// folder actually has it. What it buys is honesty — the legal values of a field
// come from the game rather than from a list frozen into our source, so a text
// box becomes a dropdown that refuses nothing the game accepts.

import { gameData } from '#electron/paths.ts';
import { fieldOrder, fieldValues, readTypeSpec, typesXmlPath } from '#src/schema/typespec.ts';
import type { FieldOrder, SpecType } from '#src/schema/typespec.ts';
import { objectProps } from '#src/schema/schema.ts';

/**
 * The game's own type spec, read once per run.
 *
 * 2.4 MB of XML, so it is parsed on first use rather than at startup, and only
 * when the data folder actually has it — a data root without types.xml simply
 * means no field can be created, which is the old behaviour.
 */
let typeSpec: Map<string, SpecType> | null | undefined;

const orderCache = new Map<string, FieldOrder | null>();

export function orderFor(type: string): FieldOrder | undefined {
  if (typeSpec === undefined) {
    const p = typesXmlPath(gameData());
    const t0 = performance.now();
    typeSpec = p ? readTypeSpec(p) : null;
    if (p) console.log(`[spec] types.xml ${(performance.now() - t0) | 0}ms · ${typeSpec!.size} types`);
  }
  if (!typeSpec) return undefined;
  if (!orderCache.has(type)) orderCache.set(type, fieldOrder(typeSpec, type));
  return orderCache.get(type) ?? undefined;
}

/**
 * Every field of a type whose values the spec closes, with the full legal set.
 *
 * This is what turns a text box into a dropdown honestly. The panel used to
 * show enum fields as free text, with a comment saying the legal set lives in
 * the game's data and a guessed list would refuse values the game accepts —
 * true then, and the spec is that data. `AttackType` is `ATTACK_ANY` on all
 * 6377 monsters ever shipped, and the type also has `ATTACK_RANGE` and
 * `ATTACK_MELEE`.
 *
 * Cached per type: the parse is 2.4 MB and the answer never changes.
 */
const valuesCache = new Map<string, Record<string, string[]>>();

export function valuesFor(type: string): Record<string, string[]> {
  const hit = valuesCache.get(type);
  if (hit) return hit;
  orderFor(type); // parses types.xml on first use
  const out: Record<string, string[]> = {};
  if (typeSpec) {
    // Only the fields our own schema knows about: an option list for a field
    // the editor never shows is payload for nothing.
    for (const name of Object.keys(objectProps(type))) {
      const v = fieldValues(typeSpec, type, name);
      if (v && v.length) out[name] = v;
    }
  }
  valuesCache.set(type, out);
  return out;
}

/**
 * The legal values of named fields of a type, straight from the spec.
 *
 * Not through valuesFor(): that answers for the fields OUR schema knows, and
 * the schema knows AdvMapHero — the thing on a map — not AdvMapHeroShared, the
 * character behind it. A class the editor never places has none of its fields
 * declared and would come back empty.
 */
export function enumValues(type: string, fields: string[]): Record<string, string[]> {
  orderFor(type); // parses types.xml on first use
  const out: Record<string, string[]> = {};
  if (!typeSpec) return out;
  for (const field of fields) {
    const v = fieldValues(typeSpec, type, field);
    if (v && v.length) out[field] = v;
  }
  return out;
}
