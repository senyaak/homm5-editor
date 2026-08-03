// Electron main process — the editor's backend. Owns the map model and the file
// system; the renderer is a thin 3D/UI client that talks to it over IPC.
//
// This file is the boot: the switches Chromium needs before it comes up, the
// window, the timing wrapper every channel is measured by, and the calls that
// wire the channels on. The channels themselves are one module per domain under
// channels/, and what they share — the open session, recording an edit, the
// text files beside a map, the game's type spec — is state.ts, edits.ts,
// sidecar.ts and spec.ts beside this file.
//
// Everything file-format lives in ../src, shared with the CLI tools. Nothing
// here decodes anything.

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { dirname } from 'node:path';
import { buildScene } from '#src/scene/scene.ts';
import { initProject } from '#src/map/project.ts';
import { isConfigured, mountedAssets, preloadPath, readSettings, rendererFile, reportRoots } from '#electron/paths.ts';
import { closeSetup, runSetup } from '#electron/setup.ts';
import { assetRootFor, state } from '#electron/state.ts';
import { registerApp } from '#electron/channels/app.ts';
import { registerCampaigns } from '#electron/channels/campaigns.ts';
import { registerEntities } from '#electron/channels/entities.ts';
import { registerHistory } from '#electron/channels/history.ts';
import { registerLoc } from '#electron/channels/loc.ts';
import { registerMaps } from '#electron/channels/maps.ts';
import { registerModArtifacts } from '#electron/channels/mods-artifacts.ts';
import { registerModBuildings } from '#electron/channels/mods-buildings.ts';
import { registerModCreatures } from '#electron/channels/mods-creatures.ts';
import { registerModHeroes } from '#electron/channels/mods-heroes.ts';
import { registerModsList } from '#electron/channels/mods-list.ts';
import { registerModTextures } from '#electron/channels/mods-textures.ts';
import { registerObjects } from '#electron/channels/objects.ts';
import { registerQol } from '#electron/channels/qol.ts';
import { registerSave } from '#electron/channels/save.ts';
import { registerScene } from '#electron/channels/scene.ts';
import { registerDialogScenes } from '#electron/channels/dialog-scenes.ts';
import { registerTerrain } from '#electron/channels/terrain.ts';
import { registerText } from '#electron/channels/text.ts';
import { registerTree } from '#electron/channels/tree.ts';

// [perf] Windows-only Chromium bug: the native occlusion calculator intermittently
// decides a fully visible window is covered and throttles its compositor to a
// crawl for the rest of the session — the "sometimes the whole editor goes
// slow-motion, and alt-tab fixes it" symptom (a focus change resets the state).
// Turning the feature off is the standard workaround and costs nothing here: we
// only ever run one visible window. Must be set before app is ready.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Software rendering, if a previous run was told to remember it. Chromium picks
// its GL backend while coming up, so this has to be said here and cannot be a
// setting the running editor applies. It exists because a driver that gives no
// WebGL leaves the editor with nothing to draw on, and someone running a
// packaged build has no command line to pass the switch on — see
// Settings.softwareRendering.
if (readSettings().softwareRendering) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  // Paired on purpose: if the driver was merely blocklisted, ANGLE's software
  // path is a heavy price for a machine that could have run on the GPU, and
  // whoever turned this on has already seen the editor fail to start.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  console.log('[gpu] software rendering, remembered from a previous run');
}

function createWindow(): void {
  // Fit the work area rather than insisting on 1400x900. On a smaller or scaled
  // display that size hangs off the right edge, and what hangs off is the
  // right-hand panel — the palettes — so a chunk of the UI is simply not there.
  const area = screen.getPrimaryDisplay().workAreaSize;
  state.win = new BrowserWindow({
    width: Math.min(1400, area.width), height: Math.min(900, area.height),
    center: true,
    backgroundColor: '#0d1014',
    title: 'homm5-editor',
    webPreferences: {
      // Stays .cjs: Electron's preload loader does not strip types (see preload.cjs).
      preload: preloadPath('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The render loop drives the whole editor; never let Chromium throttle its
      // rAF/timers because it thinks the window is backgrounded. Pairs with the
      // occlusion switch above.
      backgroundThrottling: false,
    },
  });
  // Hoisted so the rest of the function sees a non-null window without
  // re-narrowing the mutable shared `state.win` after every call.
  const w = state.win;
  w.setMenuBarVisibility(false);
  // Renderer failures, in the terminal that launched the app. Until this was
  // here, a renderer that died on its first line left no trace anywhere the
  // person hitting it would look: DevTools is closed, and start-editor.bat keeps
  // its window open for exactly this and had nothing to show.
  w.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error(`[renderer] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  w.webContents.on('preload-error', (_e, path, err) => {
    console.error(`[preload] ${path} failed to load: ${err.message}`);
  });
  w.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[renderer gone] ${d.reason} (exit ${d.exitCode})`);
  });
  w.loadFile(rendererFile('index.html'));
}

// Every channel says how long it took, and says so again while it is still
// going. The main process is single-threaded: one slow handler stops the
// window, and from outside that is indistinguishable from a crash — which cost
// an afternoon of guessing at which call it was. Now it names itself.
//
// Installed BEFORE anything registers, which is why the register() calls below
// come after it: it works by wrapping ipcMain.handle, so a channel wired first
// would be the one channel with no clock on it.
{
  const raw = ipcMain.handle.bind(ipcMain);
  type Listener = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
  ipcMain.handle = ((channel: string, listener: Listener) => raw(channel, async (e, ...args) => {
    const started = Date.now();
    const stuck = setInterval(
      () => console.error(`[ipc] ${channel} still running after ${Math.round((Date.now() - started) / 1000)}s`),
      2000,
    );
    try {
      return await listener(e, ...args);
    } finally {
      clearInterval(stuck);
      const ms = Date.now() - started;
      // Only the slow ones: a line per call would bury them.
      if (ms > 200) console.error(`[ipc] ${channel} ${ms}ms`);
    }
  })) as typeof ipcMain.handle;
}

// The whole contract, wired explicitly. A domain module that registered itself
// as a side effect of being imported would work right up until something tidied
// an import it looked unused from — and the channel it owned would answer
// "no handler registered" with nothing anywhere saying why.
registerApp();
registerMaps();
registerScene();
registerDialogScenes();
registerObjects();
registerEntities();
registerTree();
registerText();
registerLoc();
registerTerrain();
registerHistory();
registerSave();
registerCampaigns();
registerModsList();
registerModCreatures();
registerModHeroes();
registerModArtifacts();
registerModBuildings();
registerModTextures();
registerQol();

app.whenReady().then(async () => {
  // Nothing to read means nothing to edit, so setup comes first: it asks where
  // the game is and then prepares that install — the archives unpacked, a
  // readable copy of the executable, our extension in it, our own mod folder
  // (src/first-run.ts). `--setup` forces it, which is the way back in once the
  // answers are wrong (the game moved, the data root was deleted, the install
  // was never prepared) and the editor would otherwise open onto an empty map
  // list or a game that cannot load what it makes.
  // Before the gate, not after it: the run that most needs to know which folder
  // it settled on is the one that is about to refuse to open because of it.
  reportRoots();
  if (!isConfigured() || process.argv.includes('--setup')) {
    const ok = await runSetup();
    if (!ok) { app.quit(); return; }
  }
  createWindow();
  // Only now is setup's window redundant. It stays open (hidden) until here so
  // that the app is never windowless, which Electron takes as its cue to quit.
  closeSetup();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Dev smoke test: HOMM5_SMOKE=<map.xdb> loads a map through the real pipeline
  // and exits, so CI/headless can verify the backend without clicking.
  if (process.env.HOMM5_SMOKE) runSmoke(process.env.HOMM5_SMOKE);
});

async function runSmoke(mapPath: string): Promise<void> {
  try {
    const { map, scene, skipped } = buildScene(mountedAssets(assetRootFor(mapPath)), mapPath);
    initProject(dirname(mapPath));
    const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
    console.log(`SMOKE ok: ${map.tileX}x${map.tileY}, geoms ${scene.geoms.length}, floors ${scene.floors.length}, placed ${placed}, skipped ${skipped.length}`);
    app.exit(0);
  } catch (e) { console.error('SMOKE fail:', e instanceof Error ? e.message : String(e)); app.exit(1); }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { state.session?.watch.stop(); });
