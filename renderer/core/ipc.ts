// The bridge to the main process.
//
// contextIsolation is on, so `window.editor` (set up in electron/preload.cjs)
// is the entire surface the renderer has; the contract lives in electron/ipc.ts
// and both sides bind to it. Everything in the renderer goes through `api`
// rather than reaching for the global, so a panel's dependency on main is an
// import like any other.

import type { EditorApi } from '#electron/ipc.ts';
import { Refusal } from '#src/failure.ts';

declare global {
  interface Window {
    editor: EditorApi;
  }
}

/** A refusal arrives as an Error whose message starts with its name; it is a Refusal again here. */
const REFUSED = /^Refusal: ([\s\S]*)$/;
const backFromMain = (e: unknown): unknown => {
  const m = e instanceof Error ? REFUSED.exec(e.message) : null;
  return m ? new Refusal(m[1]!) : e;
};

/**
 * The main process, as this window sees it: every call as the preload gives
 * it, with a refusal made a Refusal again, so a form tells it from a failure.
 *
 * A copy with each function wrapped, not a Proxy: the bridge's object is
 * frozen, and a Proxy may not hand back anything but a frozen property's own
 * value.
 */
export const api: EditorApi = Object.fromEntries(
  Object.entries(window.editor).map(([key, v]: [string, unknown]) => [key, typeof v !== 'function' ? v
    : (...args: unknown[]) => {
      const out = (v as (...a: unknown[]) => unknown)(...args);
      return out instanceof Promise ? out.catch((e: unknown) => { throw backFromMain(e); }) : out;
    }]),
) as unknown as EditorApi;

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
