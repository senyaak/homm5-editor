// Persisted UI preferences.
//
// The toolbar toggles and sliders are view state, not map data, so they live in
// localStorage and a restart reopens the editor the way it was left. showObjects
// defaults ON — the first thing a session usually wants is to see the map's
// objects, and terrain-only work can still flip the toggle off (and it sticks).

export interface UiPrefs {
  showObjects: boolean;
  explorerOpen: boolean;
  cliffs: boolean;
  grid: boolean;
  showHidden: boolean;
  texScale: number;
  /** How thick the fill tool lays a preset on; 1 is the preset as written. */
  fillDensity: number;
  /** Plan (top-down orthographic) view instead of the 3D orbit view. */
  topView: boolean;
  /** Height the Bulk/Dig brush moves per stroke, and how far it tapers. */
  brushForce: number;
  brushTension: number;
  /** The terrain strip (brushes + tiles) — open by default, since the bar no
   *  longer holds the tools. */
  terrainPanel: boolean;
  /** Particle effects playing, and the map's own light vs flat editing light. */
  showFx: boolean;
  mapLight: boolean;
}

const UI_PREFS_DEFAULT: UiPrefs = {
  showObjects: true, explorerOpen: true, cliffs: true, grid: false, showHidden: false, texScale: 0.5,
  topView: false, brushForce: 0.35, brushTension: 1, terrainPanel: true,
  showFx: true, mapLight: true, fillDensity: 1,
};
const UI_PREFS_KEY = 'homm5-editor.ui';

function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    // Spread over the defaults so a prefs blob written by an older build (missing
    // a key added since) still yields a complete object.
    return raw ? { ...UI_PREFS_DEFAULT, ...JSON.parse(raw) } : { ...UI_PREFS_DEFAULT };
  } catch { return { ...UI_PREFS_DEFAULT }; }
}

/** The live preferences. An ESM live binding, so importers see every save. */
export let uiPrefs = loadUiPrefs();

/**
 * Merge one change in and write the whole blob back. Every toggle's setter calls
 * this, so the store always mirrors the live UI with no separate save step.
 */
export function saveUiPrefs(patch: Partial<UiPrefs>): void {
  uiPrefs = { ...uiPrefs, ...patch };
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs)); }
  catch { /* private mode or quota: the editor still runs, just without persistence */ }
}
