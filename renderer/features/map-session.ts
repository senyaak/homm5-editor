// Opening, closing and reloading a map — the window's whole state.
//
// A map is a scene on the GPU here and a session in the main process; both are
// built from one path and torn down together, so both live behind these calls.

import { FLOOR_LABEL, explorerOpen, hideExternalChange, setCliffs, setExplorer, setMapOpen, setShowObjects, updateIdleButton, updateFloorUI } from '#features/shell.ts';
import { buildWorld } from '#viewport/world.ts';
import { markDirty } from '#core/dirty.ts';
import { $, $button, $input } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { uiPrefs } from '#core/prefs.ts';
import { state } from '#core/state.ts';
import { unpackTextures } from '#src/scene/tex-table.ts';
import { updateHistoryUI } from '#features/history.ts';
import { loadLocState, loc } from '#features/localization.ts';
import { allTiles, initObjectPalette, renderPalette, setPalette, tiles } from '#features/palettes.ts';
import { loadRegions } from '#features/regions.ts';
import { setBrush, syncBrushPanel } from '#features/terrain-brush/sculpt.ts';
import { forgetScriptContext } from '#features/text-editor/context.ts';
import { refreshScriptContext } from '#features/text-editor/document.ts';
import { setIdleMode } from '#viewport/idle.ts';
import { setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { cliffsOn } from '#viewport/splat.ts';
import { setTopView } from '#viewport/stage.ts';
import { sea } from '#viewport/terrain-mesh.ts';
import { brush } from '#features/terrain-brush/brush.ts';

export /** What is open, as paths — see `opened()`. */
interface OpenedMap {
  /** The `map.xdb` being edited. */
  mapPath: string;
  /** The folder holding it — a workspace, or wherever HOMM5_UNPACK_TO put it. */
  mapDir: string;
  /** The archive it belongs to, when the app knows which: `<game>/H5E/<name>.h5m`. */
  archive: string | null;
}
/**
 * What is open, as paths, for anything that has to know where the map went —
 * see `ViewApi.opened`. Written here, where a map actually becomes the open one.
 */
/** What is open, as paths, for anything that has to know where the map went. */
export const session = { openedMap: null as OpenedMap | null };

export async function loadMapPath(path: string | null, archive: string | null = null): Promise<void> {
  if (!path) return;
  session.openedMap = { mapPath: path, mapDir: path.replace(/[\\/][^\\/]*$/, ''), archive };
  // Whatever the banner was offering is about to be on screen for real.
  hideExternalChange();
  const say = (m: string): Promise<void> => {
    $('loadmsg').textContent = m;
    // Two frames: one to run the style change, one to paint it — a single rAF
    // fires before paint, so the message would not show before the blocking
    // work that follows it.
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  };
  $('loading').classList.add('on');
  await say('decoding map…');
  try {
    // The heavy lifting is in the main process (mesh/texture decode), so the
    // renderer's own thread is free to keep the spinner turning while it runs.
    const tReq = performance.now();
    const { scene: S, info, history, idleAnimation, textures } = await api.loadMap(path);
    // The pictures came once each and the scene holds handles into that table
    // — see src/scene/tex-table.ts. Put them back before anything draws.
    unpackTextures(S, textures);
    const tLoad = performance.now();
    // The scene says which mode it was BUILT for, and that is what the view
    // follows: a map built without bones cannot be animated by asking nicely.
    setIdleMode(idleAnimation);
    updateIdleButton();
    // buildWorld DOES block this thread, so let the new message paint first —
    // the GPU-composited spinner keeps moving through the freeze regardless.
    await say('building scene…');
    buildWorld(S);
    // [perf] The two halves of opening a map: the main-process decode (IPC) and
    // the renderer-blocking scene build. Grep "[perf]" while chasing a stall.
    console.log(`[perf] loadMap ${(tLoad - tReq) | 0}ms · buildWorld ${(performance.now() - tLoad) | 0}ms · ${S.geoms.length} geoms`);
    // A history kept from a previous run is adopted when the files still hash
    // the same, so opening a map is not always a blank slate.
    updateHistoryUI(history.canUndo, history.canRedo, history.undoLabel, history.redoLabel);
    $('empty').style.display = 'none';
    $('title').textContent = `homm5-editor — ${info.name} (${info.tileX}×${info.tileY})`;
    // One switch for the whole bar: the map tools come out, the launcher's
    // editors go away. What used to be a dozen `style.display` lines here — and
    // the same dozen again, inverted, on the way out — is a class the stylesheet
    // reads.
    setMapOpen(true);
    $button('pack').disabled = false;
    // Reflect the persisted ground-scale on the slider itself, or its thumb would
    // sit at the HTML default while the terrain uses the restored value.
    $input('texscale').value = String(uiPrefs.texScale);
    $('texscaleval').textContent = uiPrefs.texScale.toFixed(2);
    // Sea controls only matter on maps that actually have water-flagged ground.
    const hasSea = S.floors.some((f) => f.water && f.water.cells.length);
    $('seawrap').style.display = hasSea ? 'flex' : 'none';
    sea.base = S.floors.find((f) => f.water)?.water?.level ?? 1.5;
    // The map changed, so the names a script completes from did too.
    forgetScriptContext();
    void refreshScriptContext();
    // …and its localization state (which languages this map is authored in).
    loc.active = '';
    void loadLocState();
    // A map just opened has whatever regions it shipped with; the panel may
    // still be open from the last one, and it must not show those.
    void loadRegions();
    // Same reason as the ground-scale slider: show the restored force and
    // tension, not the HTML defaults the brush is not using.
    $input('brushforce').value = String(brush.force);
    $input('brushtension').value = String(brush.tension);
    $('brushtensionval').textContent = brush.tension.toFixed(2);
    syncBrushPanel();
    setBrush(false); // a fresh map starts in camera mode
    setCliffs(cliffsOn());
    setShowBlocked(showBlocked);
    $('help').style.display = '';
    // A newly loaded map has its own layer set; refresh the "used" markers.
    tiles.inMap = new Set((await api.listTiles()).inMap);
    if (allTiles.length) renderPalette();
    // Restore the panels the way they were left rather than forcing them open —
    // that is the whole point of persisting the toggles.
    setExplorer(explorerOpen);
    setPalette(uiPrefs.terrainPanel);
    setShowObjects(state.showObjects);
    setTopView(uiPrefs.topView); // restore the plan/3D view choice
    markDirty(false);
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    const floorsTxt = info.floors.length > 1
      ? ' · floors: ' + info.floors.map((f) => `${FLOOR_LABEL[f.name] || f.name} ${f.objects}`).join(', ')
      : '';
    $('hud').textContent = `${total} objects · placed ${info.placed}, no model ${info.skipped} · ${S.geoms.length} meshes${floorsTxt}`;
    // The map's tile set is derived from the terrain's layers, and opening a map
    // whose list had fallen behind repairs it. That is a real change to the
    // document, so it counts as unsaved work rather than vanishing quietly.
    if (info.tilesNamed) {
      markDirty(true);
      $('hud').textContent += ` · named ${info.tilesNamed} ground tile(s) this map paints with but did not list`;
    }
    // Warm the object catalogue in the background, so opening the palette is
    // instant rather than a disk scan on the first click. Kicked off only once
    // the map itself is on screen and the loading overlay is down, so it never
    // competes with the work the user is actually waiting for. Not awaited.
    void initObjectPalette();
  } catch (e) {
    $('hud').textContent = 'error: ' + (e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}
