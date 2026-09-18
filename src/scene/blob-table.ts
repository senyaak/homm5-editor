// Sending the big typed arrays out of band.
//
// A payload's bytes are its typed arrays — a texture's DXT levels, a particle
// frame's texels — and the IPC reply that carries the payload moves them at
// 60–95 MB/s with both JS threads waiting (electron/blobs.ts has the
// numbers). Fetched over the blob scheme instead they move at ~450 MB/s and
// block nobody. So, at the payload's edge, every typed array of any size is
// replaced by a HANDLE saying where in the map's one blob it sits, and put
// back from the fetched bytes.
//
// Sharing is kept: a picture worn by fifty parts is one object in the
// payload, and it becomes one handle, one slice of the blob, one array again.
// The walk is generic for the same reason tex-table's is — the list of fields
// that hold bytes has grown every time the payload has — and it assumes the
// payload is acyclic, which it is.

/** A typed array that left the payload: which blob, where in it, and what to rebuild. */
export interface BlobHandle {
  /** NUL-prefixed key so no real field can be mistaken for a handle. */
  '\0blob': string;
  /** Byte offset into the blob; aligned for `kind`. */
  at: number;
  kind: TypedKind;
  length: number;
}
type TypedKind = 'Uint8Array' | 'Uint8ClampedArray' | 'Int8Array' | 'Uint16Array' | 'Int16Array' | 'Uint32Array' | 'Int32Array' | 'Float32Array' | 'Float64Array';
type Typed = ArrayBufferView & { length: number; slice(): Typed };
const KINDS: Record<TypedKind, (new (b: ArrayBuffer, at: number, length: number) => Typed) & { BYTES_PER_ELEMENT: number }> = {
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
};

function isHandle(v: unknown): v is BlobHandle {
  return !!v && typeof v === 'object' && typeof (v as BlobHandle)['\0blob'] === 'string';
}

/**
 * Below this a view stays in the payload: a handle is an object of four
 * fields, and a few dozen bytes of bone weights are cheaper as themselves.
 * (A cache entry on disk passes 0: its header is JSON, which holds no typed
 * array at all.)
 */
const MIN_BYTES = 256;

/** Every array in a blob starts on a multiple of this — Float64Array is the widest element the payload holds. */
export const BLOB_ALIGN = 8;

/** Where the packer puts bytes: one blob, its URL, and the offset each addition lands at. */
export interface BlobSink { url: string; add(bytes: Uint8Array): number }

/**
 * The payload with every typed array of MIN_BYTES or more replaced by a
 * handle into `sink`; the payload given is left as it was — the main process
 * keeps what it hands out (tex-table.ts `rebuild` says why), so the copy runs
 * along the spine down to each array that moved and shares the rest.
 */
export function packBlobs<T>(payload: T, sink: BlobSink, minBytes = MIN_BYTES): { payload: T; count: number; bytes: number } {
  let count = 0, bytes = 0;
  const done = new Map<object, unknown>();
  const rebuild = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const known = done.get(node);
    if (known !== undefined) return known;
    let out: unknown = node;
    if (ArrayBuffer.isView(node)) {
      const view = node as ArrayBufferView & { length: number };
      if (view.byteLength >= minBytes && view.constructor.name in KINDS) {
        const handle: BlobHandle = {
          '\0blob': sink.url,
          at: sink.add(new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)),
          kind: view.constructor.name as TypedKind,
          length: view.length,
        };
        count++; bytes += view.byteLength;
        out = handle;
      }
    } else if (Array.isArray(node)) {
      if (typeof node[0] !== 'number') {
        let copy: unknown[] | null = null;
        for (let i = 0; i < node.length; i++) {
          const to = rebuild(node[i]);
          if (to !== node[i] && !copy) copy = node.slice();
          if (copy) copy[i] = to;
        }
        if (copy) out = copy;
      }
    } else {
      let copy: Record<string, unknown> | null = null;
      const from = node as Record<string, unknown>;
      for (const key of Object.keys(from)) {
        const to = rebuild(from[key]);
        if (to !== from[key] && !copy) copy = { ...from };
        if (copy) copy[key] = to;
      }
      if (copy) out = copy;
    }
    done.set(node, out);
    return out;
  };
  return { payload: rebuild(payload) as T, count, bytes };
}

/**
 * Fetch the blob(s) the handles in `payload` name and put the arrays back, in
 * place, each in a buffer of its own — this side owns its payload, which
 * arrived as a clone addressed to it. `fetchBytes` answers a blob's URL; a
 * fetch that fails fails the whole unpack, since a scene with a texture
 * missing is not a scene to draw.
 */
export async function unpackBlobs(
  payload: unknown, fetchBytes: (url: string) => Promise<ArrayBuffer>,
): Promise<{ count: number; bytes: number }> {
  // Every place a handle sits, by blob.
  const sites = new Map<string, { handle: BlobHandle; holder: Record<string, unknown> | unknown[]; key: string | number }[]>();
  const seen = new Set<object>();
  const views = new Map<BlobHandle, Typed>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || ArrayBuffer.isView(node) || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      if (typeof node[0] === 'number') return;
      for (let i = 0; i < node.length; i++) visit(node, i, node[i]);
    } else {
      const from = node as Record<string, unknown>;
      for (const key of Object.keys(from)) visit(from, key, from[key]);
    }
  };
  const visit = (holder: Record<string, unknown> | unknown[], key: string | number, v: unknown): void => {
    if (isHandle(v)) {
      const url = v['\0blob'];
      (sites.get(url) ?? sites.set(url, []).get(url)!).push({ handle: v, holder, key });
    } else walk(v);
  };
  walk(payload);
  let bytes = 0;
  await Promise.all([...sites.entries()].map(async ([url, at]) => {
    const buf = await fetchBytes(url);
    bytes += buf.byteLength;
    for (const { handle, holder, key } of at) {
      // A handle shared by many fields is one view for all of them, as the array was one object.
      let view = views.get(handle);
      if (!view) {
        if (handle.at + handle.length * bytesPer(handle.kind) > buf.byteLength) throw new Error(`blob ${url}: ${handle.length} ${handle.kind} at ${handle.at} is past its ${buf.byteLength} bytes`);
        // Its OWN buffer, not a view onto the blob: a view drags the whole blob
        // along wherever it is cloned — the bake worker is posted one kind's clip
        // and would receive the map's 150 MB with it, once per kind (it ran out
        // of memory doing so) — and keeps the blob alive for as long as any one
        // array lives. The copy is a memcpy of what arrived, once.
        view = new KINDS[handle.kind](buf, handle.at, handle.length).slice();
        views.set(handle, view);
      }
      (holder as Record<string | number, unknown>)[key] = view;
    }
  }));
  return { count: views.size, bytes };
}

function bytesPer(kind: TypedKind): number {
  return KINDS[kind].BYTES_PER_ELEMENT;
}

/**
 * The same, with the bytes already in hand: `buffer` answers a handle's URL
 * with the blob's bytes, and the arrays are put back as VIEWS onto it — for a
 * reader in one process (a cache entry read off disk, geom-cache.ts), where
 * the buffer is nobody else's and a copy would only double it.
 */
export function unpackBlobsSync(payload: unknown, buffer: (url: string) => ArrayBuffer): { count: number; bytes: number } {
  const seen = new Set<object>();
  const views = new Map<BlobHandle, Typed>();
  const buffers = new Map<string, ArrayBuffer>();
  let bytes = 0;
  const bufferFor = (url: string): ArrayBuffer => {
    let b = buffers.get(url);
    if (!b) { b = buffer(url); buffers.set(url, b); bytes += b.byteLength; }
    return b;
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || ArrayBuffer.isView(node) || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      if (typeof node[0] === 'number') return;
      for (let i = 0; i < node.length; i++) visit(node, i, node[i]);
    } else {
      const from = node as Record<string, unknown>;
      for (const key of Object.keys(from)) visit(from, key, from[key]);
    }
  };
  const visit = (holder: Record<string, unknown> | unknown[], key: string | number, v: unknown): void => {
    if (!isHandle(v)) { walk(v); return; }
    let view = views.get(v);
    if (!view) {
      const buf = bufferFor(v[' blob']);
      if (v.at + v.length * bytesPer(v.kind) > buf.byteLength) throw new Error(`blob ${v[' blob']}: ${v.length} ${v.kind} at ${v.at} is past its ${buf.byteLength} bytes`);
      view = new KINDS[v.kind](buf, v.at, v.length);
      views.set(v, view);
    }
    (holder as Record<string | number, unknown>)[key] = view;
  };
  walk(payload);
  return { count: views.size, bytes };
}
