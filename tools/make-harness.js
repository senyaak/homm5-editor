// Generates renderer/harness.html: the real index.html with a stub bridge
// injected ahead of the app module.
//
// The renderer talks to Electron through `window.editor`, and it does so at
// module scope, so the page cannot be opened in a plain browser — which meant
// the UI only ever got exercised by hand, and a control that was unreachable
// (hidden behind a toggle that could not be turned on) shipped unnoticed.
//
// Generated rather than checked in, from index.html rather than a copy of it:
// a duplicate would drift, and a harness that tests different markup than the
// app ships is worse than none.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer');

// A small synthetic map: flat ground with a dug basin, no textures. Enough to
// build a world, raise a sea, and drive every brush control.
const STUB = `<script>
(() => {
  const V = 25, N = V * V;
  const heights = new Array(N).fill(2);
  const flags = new Array(N).fill(16);
  // A dug basin near the middle, so it lands in the default camera view and a
  // brush can actually be aimed at it: flagged water and pinned to 0.0, which is
  // the invariant the sea holds in every shipped map.
  for (let y = 9; y < 16; y++) for (let x = 9; x < 16; x++) {
    heights[y * V + x] = 0; flags[y * V + x] = 0;
  }
  // A PNG data URI of one flat colour, for stand-in tile textures.
  const solid = (w, h, r, g, b) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    cx.fillRect(0, 0, w, h);
    return c.toDataURL();
  };
  // Two layers packed into one mask group: red channel (layer 0) fully painted,
  // green (layer 1) empty. Without a splat the tile brush has nothing to write
  // into and silently does nothing, so the harness needs a real one.
  // Realistic tile paths: the renderer decides what is a river brush by the
  // path's folder, so a stub with made-up paths would never exercise that.
  const T = '/MapObjects/_(AdvMapTile)/';
  const splat = {
    V, size: 8, layerCount: 2,
    layerTex: [solid(8, 8, 110, 140, 80), solid(8, 8, 70, 90, 130)],
    maskGroups: [solid(V, V, 255, 0, 0)],
    // Required, or uCliff stays 0 and cliff shading is skipped entirely. Kept
    // near the real Rock.dds's 26% grey: a light stand-in gets multiplied to
    // white by the shader and hides everything drawn on the face.
    rockTex: solid(8, 8, 66, 66, 70),
    paths: [T + 'Grass/Grass.xdb', T + 'Water/Bog.xdb'],
  };
  const floor = {
    name: 'surface', V, heights, colors: null, flags, riverVerts: [],
    // Everything walkable to start, so masking has a visible before and after.
    passable: new Array(N).fill(1),
    water: { V, level: 1.5, cells: [], wet: 36, tex: null },
    splat, instances: [],
  };
  // Cells touching water, the same rule the renderer uses.
  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    const a = y * V + x;
    if (!flags[a] || !flags[a + 1] || !flags[a + V] || !flags[a + V + 1]) floor.water.cells.push(a);
  }
  const status = { dirty: [], lastPack: null, editorVersion: '0.0.1', drift: false };
  window.__calls = [];
  const log = (name, arg) => { window.__calls.push({ name, arg }); };
  window.editor = {
    listMaps: async () => ({ root: '(harness)', maps: [
      { name: 'harness', rel: 'Single/harness', path: '/harness/map.xdb' },
    ] }),
    openMapDialog: async () => null,
    loadMap: async (path) => {
      log('loadMap', path);
      return {
        scene: { geoms: [], floors: [floor] },
        info: {
          name: 'harness', mapPath: path, tileX: V - 1, tileY: V - 1,
          counts: {}, floors: [{ name: 'surface', objects: 0 }], placed: 0, skipped: 0,
        },
        status,
      };
    },
    moveObject: async (...a) => { log('moveObject', a); return { ok: true }; },
    save: async () => { log('save'); return { ok: true, status }; },
    pack: async () => ({ canceled: true }),
    status: async () => status,
    // Two tiles, one of them present in the map so it is paintable.
    listTiles: async () => ({
      tiles: [
        { name: 'Grass', category: 'Grass', path: T + 'Grass/Grass.xdb', priority: 10, type: 'Grass', thumb: '' },
        { name: 'Bog', category: 'Water', path: T + 'Water/Bog.xdb', priority: 277, type: 'Water', thumb: '' },
        { name: 'Sand', category: 'Sand', path: T + 'Sand/Sand.xdb', priority: 20, type: 'Sand', thumb: '' },
      ],
      inMap: [T + 'Grass/Grass.xdb', T + 'Water/Bog.xdb'],
    }),
    paintTile: async (p) => { log('paintTile', p); return { ok: true }; },
    paintRiver: async (p) => { log('paintRiver', p); return { ok: true }; },
    // Adding a layer grows the shader by one: hand back a splat with an extra
    // mask group and layer, the way the real one does.
    addLayer: async (p) => {
      log('addLayer', p);
      splat.layerCount += 1;
      splat.paths.push(p.tile);
      splat.layerTex.push(solid(8, 8, 180, 90, 90));
      splat.maskGroups.push(solid(V, V, 0, 0, 0));
      return { ok: true, splat, inMap: splat.paths.slice() };
    },
    sculpt: async (p) => { log('sculpt', p); return { ok: true }; },
    setMask: async (p) => { log('setMask', p); return { ok: true }; },
    onExternalChange: (cb) => { window.__fireExternalChange = cb; },
  };
})();
<\/script>
`;

const html = readFileSync(join(RENDERER, 'index.html'), 'utf8');
const anchor = '<script type="module" src="./app.js"></script>';
if (!html.includes(anchor)) throw new Error('index.html no longer loads ./app.js the expected way');
writeFileSync(join(RENDERER, 'harness.html'), html.replace(anchor, STUB + anchor));
console.log('wrote renderer/harness.html');
