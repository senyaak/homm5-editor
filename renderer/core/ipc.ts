// The bridge to the main process.
//
// contextIsolation is on, so `window.editor` (set up in electron/preload.cjs)
// is the entire surface the renderer has; the contract lives in electron/ipc.ts
// and both sides bind to it. Everything in the renderer goes through `api`
// rather than reaching for the global, so a panel's dependency on main is an
// import like any other.

import type { EditorApi } from '#electron/ipc.ts';

declare global {
  interface Window {
    editor: EditorApi;
  }
}

/** The main process, as this window sees it. */
export const api: EditorApi = window.editor;

/**
 * One blob the main process offers over its scheme (electron/blobs.ts) — a
 * map's or a scene's typed arrays, fetched in one response; the payload
 * that named it is put back together with `unpackBlobs`.
 */
export async function fetchBlob(url: string): Promise<ArrayBuffer> {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} — the main process no longer holds these bytes (another map or scene opened over them?)`);
  const t1 = performance.now();
  const buf = await res.arrayBuffer();
  console.log(`[perf] blob fetch: headers ${(t1 - t0) | 0}ms · body ${(performance.now() - t1) | 0}ms · ${(buf.byteLength / 1048576).toFixed(1)} MB`);
  return buf;
}
