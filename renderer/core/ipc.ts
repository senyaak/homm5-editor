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
