// Big bytes to the window by fetch, not by IPC.
//
// A map's payload crosses to the renderer as one `ipcRenderer.invoke` reply:
// structured-cloned, then pushed through Mojo in one message. Measured on
// A2C1M1 (61 MB): the clone itself is ~150 ms in plain node, the trip is
// 600–700 ms; on the mix stress map (207 MB) 3.4 s of a 7.5 s open. Ten
// to seventeen milliseconds a megabyte, all of it with both JS threads
// waiting, and the bytes are the textures, the skins and the geometry —
// typed arrays that need no cloning at all.
//
// So the big typed arrays go out of band: the main process keeps them here,
// the payload carries where each one sits, and the renderer `fetch`es
// `h5e-blob://b/<id>`, which this scheme's handler answers straight from the
// registry — ONE response per map, the arrays streamed back to back (a fetch
// costs a request and a task on each side, and 651 small ones ran at 80 MB/s
// where one big one runs at ~450). Nothing is copied here: the response body
// is a stream that yields the arrays as they are held.
//
// The scheme has to be declared privileged before the app is ready to be
// fetchable from a page at all, and the handler installed before the window
// loads — the renderer binds its loader for the scheme at navigation.

import { protocol } from 'electron';

export const BLOB_SCHEME = 'h5e-blob';

/**
 * One offered blob: its pieces, each array padded to `ALIGN` so every one
 * starts aligned for its element type. A big array is a piece of its own,
 * by reference; the small ones — a bone's clip samples, a few hundred bytes
 * each, forty thousand of them on a crowded map — are copied into shared
 * megabyte pieces, because the stream hands the renderer one piece per
 * pull and forty thousand pulls were most of the fetch.
 */
interface Blob { parts: Uint8Array[]; bytes: number; staging: Uint8Array | null; staged: number }
const SMALL = 64 * 1024;
const STAGING = 1024 * 1024;
const blobs = new Map<string, Blob>();
let next = 1;

/** Every piece starts on a multiple of this — Float64Array is the widest element the payload holds. */
export const ALIGN = 8;
const PAD = new Uint8Array(ALIGN);

/** Before `app.whenReady`: what the scheme may do. */
export function registerBlobScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: BLOB_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  }]);
}

/** After `app.whenReady`, before the window: answer fetches from the registry. */
export function serveBlobs(): void {
  protocol.handle(BLOB_SCHEME, (req) => {
    const id = new URL(req.url).pathname.replace(/^\/+/, '');
    const b = blobs.get(id);
    if (!b) return new Response(null, { status: 404 });
    flush(b);
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < b.parts.length) controller.enqueue(b.parts[i++]!);
        else controller.close();
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(b.bytes),
        // The window is a file:// page: its origin is null, so the answer has to say anyone may read it.
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

/**
 * A blob to be filled: `add` takes an array's bytes (by reference above
 * SMALL, copied into a shared piece below) and answers the byte offset it
 * will arrive at; `url` is where the
 * whole thing is fetched from. The bytes are kept until `clearBlobs`, so a
 * fetch that is retried, or a window that reloads, still finds them.
 */
export function openBlob(): { url: string; add(bytes: Uint8Array): number } {
  const id = String(next++);
  const b: Blob = { parts: [], bytes: 0, staging: null, staged: 0 };
  blobs.set(id, b);
  return {
    url: `${BLOB_SCHEME}://b/${id}`,
    add(bytes) {
      const at = b.bytes;
      const padded = bytes.byteLength + (ALIGN - (bytes.byteLength % ALIGN)) % ALIGN;
      if (padded <= SMALL) {
        // Into the staging piece, which joins the parts when it fills (or at the end).
        if (!b.staging || b.staged + padded > STAGING) flush(b);
        b.staging ??= new Uint8Array(STAGING);
        b.staging.set(bytes, b.staged);
        b.staged += padded; // the padding is the zeroes already there
      } else {
        flush(b);
        b.parts.push(bytes);
        const pad = padded - bytes.byteLength;
        if (pad) b.parts.push(PAD.subarray(0, pad));
      }
      b.bytes += padded;
      return at;
    },
  };
}

/** The staging piece, as far as it is filled, joins the parts; a blob is served with it flushed. */
function flush(b: Blob): void {
  if (!b.staging) return;
  b.parts.push(b.staging.subarray(0, b.staged));
  b.staging = null;
  b.staged = 0;
}

/** Forget what was offered — when the map that owned it is closed or replaced. */
export function clearBlobs(): void {
  blobs.clear();
}

/** What the registry holds — for a memory reading. */
export function blobStats(): { count: number; bytes: number } {
  let bytes = 0;
  for (const b of blobs.values()) bytes += b.bytes;
  return { count: blobs.size, bytes };
}
