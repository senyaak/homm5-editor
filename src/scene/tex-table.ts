// Sending each texture once.
//
// A payload embeds its textures as PNG data URIs (src/format/png.ts says why),
// and a scene wears the same texture over and over: C1M1's opening dialog names
// 4659 of them and there are 299 distinct ones behind those. Built, that is one
// shared string per texture — `textureDataUri` caches — but the structured
// clone across the IPC boundary does not care that two fields point at one
// string. It copies the bytes 4659 times: 85 MB where 21 MB is the whole truth.
//
// So the payload is PACKED on its way out of the main process — every data URI
// replaced by a handle into a table sent beside it — and UNPACKED as it
// arrives. In between it is not a payload anybody can draw, which is why both
// calls sit at the very edges and nothing between them knows this happened.
//
// The walk is generic rather than a list of the fields that hold textures
// (a geom's parts, an actor's rig, a shot's effects, the splat's layers, a
// particle frame table) because that list has grown every time the payload has,
// and a field this forgets is a texture that arrives as a handle: not a wrong
// picture, no picture at all.
//
// It assumes the payload is acyclic, which it is — it exists to be JSON.

/**
 * What a packed texture looks like in the payload.
 *
 * NUL-prefixed so it cannot collide with anything real. A data URI cannot hold
 * one, and neither can any other string a payload carries, so the unpack side
 * can be sure that what looks like a handle is one.
 */
const HANDLE = /^\0tex(\d+)$/;

/**
 * Rebuild `node` with `swap` applied to its strings, sharing everything it did
 * not have to change.
 *
 * COPYING rather than writing through, and only along the spine down to a
 * string that moved. The main process KEEPS what it hands out: a map's geoms
 * stay alive in the geom resolver, so that an object placed later can be meshed
 * without rebuilding the scene. Packing those in place would leave the resolver
 * holding handles into a table that was sent once and never again — and the
 * object placed an hour later would come back with no texture at all.
 *
 * Arrays of NUMBERS are returned untouched, which is less an optimisation than
 * the difference between a walk that finishes and one that does not: vertex
 * positions, indices, bone weights and baked animation keys are almost the
 * whole of a payload by size, and none of them has ever held a string.
 *
 * `done` keeps identity: a geom named by fifty instances is rebuilt once and
 * the fifty go on sharing it, here and after the clone.
 */
function rebuild(node: unknown, swap: (s: string) => string | null, done: Map<object, unknown>): unknown {
  if (typeof node === 'string') return swap(node) ?? node;
  if (!node || typeof node !== 'object' || ArrayBuffer.isView(node)) return node;
  const known = done.get(node);
  if (known !== undefined) return known;
  let out: unknown = node;
  if (Array.isArray(node)) {
    if (typeof node[0] !== 'number') {
      let copy: unknown[] | null = null;
      for (let i = 0; i < node.length; i++) {
        const to = rebuild(node[i], swap, done);
        if (to !== node[i] && !copy) copy = node.slice();
        if (copy) copy[i] = to;
      }
      if (copy) out = copy;
    }
  } else {
    let copy: Record<string, unknown> | null = null;
    const from = node as Record<string, unknown>;
    for (const key of Object.keys(from)) {
      const to = rebuild(from[key], swap, done);
      if (to !== from[key] && !copy) copy = { ...from };
      if (copy) copy[key] = to;
    }
    if (copy) out = copy;
  }
  done.set(node, out);
  return out;
}

/**
 * The payload with every embedded picture replaced by a handle, and the table
 * those handles point into.
 *
 * The payload given is left as it was — see `rebuild`.
 */
export function packTextures<T>(payload: T): { payload: T; textures: string[] } {
  const textures: string[] = [];
  const at = new Map<string, number>();
  const packed = rebuild(payload, (s) => {
    if (!s.startsWith('data:image/')) return null;
    let i = at.get(s);
    if (i === undefined) {
      i = textures.length;
      textures.push(s);
      at.set(s, i);
    }
    return `\0tex${i}`;
  }, new Map()) as T;
  return { payload: packed, textures };
}

/**
 * Put the pictures back, in place, so what the renderer holds is what the
 * builder made.
 *
 * In place because this side OWNS its payload: it arrived as a fresh clone
 * addressed to this window, and copying 200 MB to change a few thousand fields
 * would cost more than the packing saved.
 *
 * A handle with no entry is left as it is rather than blanked: an unresolved
 * texture already has a `null` of its own, so a string that reaches a loader is
 * worth the console line it draws.
 */
export function unpackTextures(payload: unknown, textures: string[]): void {
  if (!textures.length) return;
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || ArrayBuffer.isView(node) || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node) && typeof node[0] === 'number') return;
    const from = node as Record<string, unknown>;
    for (const key of Object.keys(from)) {
      const v = from[key];
      if (typeof v === 'string') {
        const m = HANDLE.exec(v);
        if (m) from[key] = textures[+m[1]!] ?? v;
      } else walk(v);
    }
  };
  walk(payload);
}
