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
    rockTex: null,
    paths: [T + 'Grass/Grass.xdb', T + 'Water/Bog.xdb'],
  };
  const floor = {
    name: 'surface', V, heights, colors: null, flags, riverVerts: [],
    // Everything walkable to start, so masking has a visible before and after.
    passable: new Array(N).fill(1),
    water: { V, level: 1.5, cells: [], wet: 36, tex: null },
    splat, instances: [],
  };
  // A few objects, so selection, rotation and deletion have something to act on.
  // One tall box mesh shared by every instance — the object tools care about
  // transforms and identity, not about what the model looks like.
  const box = (() => {
    const p = [], i = [];
    const c = [[-.4,-.4,0],[.4,-.4,0],[.4,.4,0],[-.4,.4,0],[-.4,-.4,2],[.4,-.4,2],[.4,.4,2],[-.4,.4,2]];
    for (const v of c) p.push(v[0], v[1], v[2]);
    const f = [0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0];
    for (const k of f) i.push(k);
    // Two parts, the second terrain-projected, so the projected material's
    // shader is compiled here rather than failing for the first time in the app.
    const half = Math.floor(i.length / 6) * 3;
    return { pos: p, uv: new Array((p.length / 3) * 2).fill(0), nrm: null, idx: i, parts: [
      { start: 0, count: half, tex: null, alphaMode: 'AM_OPAQUE', projectOnTerrain: false, flat: false, opaque: true, terrainProjected: false },
      // Flat, projected and sheer, so the no-depth-write overlay path is exercised.
      { start: half, count: i.length - half, tex: null, alphaMode: 'AM_OVERLAY', projectOnTerrain: true, flat: true, opaque: false, terrainProjected: true },
    ],
    // A building footprint with every role, so the grid's coloured tile squares
    // (blocked/active/hole/passable) are exercised, not just a bare model.
    footprint: {
      blocked: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      active: [{ x: 1, y: 1 }],
      hole: [{ x: -1, y: 0 }],
      passable: [{ x: -1, y: 1 }],
    } };
  })();
  const SH = '/MapObjects/Grass/Tree/Tree.(AdvMapStaticShared).xdb';
  floor.instances = [
    { id: 'item_a1', type: 'AdvMapStatic', g: 0, shared: SH, x: 5, y: 5, z: 2, r: 0 },
    { id: 'item_b2', type: 'AdvMapStatic', g: 0, shared: SH, x: 7, y: 5, z: 2, r: 1 },
    { id: 'item_c3', type: 'AdvMapMonster', g: 0, shared: SH, x: 5, y: 7, z: 2, r: 0 },
  ];
  // Cells touching water, the same rule the renderer uses.
  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    const a = y * V + x;
    if (!flags[a] || !flags[a + 1] || !flags[a + V] || !flags[a + V + 1]) floor.water.cells.push(a);
  }
  const status = { dirty: [], lastPack: null, editorVersion: '0.0.1', drift: false };
  window.__calls = [];
  const log = (name, arg) => { window.__calls.push({ name, arg }); };

  // A pretend undo stack. The real patching lives in the main process and is
  // covered by tools/test-history.ts; what the harness needs is a backend that
  // reports plausible state, so the buttons, the keys and the renderer's
  // rebuild path all get exercised.
  const hist = {
    done: 0, total: 0,
    state() {
      return {
        canUndo: this.done > 0, canRedo: this.done < this.total,
        undoLabel: this.done > 0 ? 'stub edit' : null,
        redoLabel: this.done < this.total ? 'stub edit' : null,
      };
    },
    note() { this.done++; this.total = this.done; },
    step(dir) {
      const applied = dir === 'undo' ? this.done > 0 : this.done < this.total;
      if (applied) this.done += dir === 'undo' ? -1 : 1;
      return {
        ok: true, applied, label: applied ? 'stub edit' : null,
        instances: applied ? [floor.instances, []] : null,
        terrain: [], ...this.state(),
      };
    },
  };
  // A small in-memory <AdvMapDesc> so the tree panel and map-properties dialog
  // are exercisable in the harness (add/remove keeps the tree honest). Paths are
  // (name|index) steps, matching src/tree.ts.
  const mapTreeData = {
    HeroMaxLevel: '0', CustomTeams: 'false',
    NameFileRef: 'name.txt', DescriptionFileRef: 'desc.txt',
    Birds: 'Pigeons.(AdvMapBirds).xdb#xpointer(/AdvMapBirds)',
    MapRumours: [{ Text: 'r1.txt' }, { Text: 'r2.txt' }],
    players: [{ Colour: 'PCOLOR_RED', Team: '0', MainTown: 'main_town_test.(AdvMapTown).xdb#xpointer(/AdvMapTown)' }, { Colour: 'PCOLOR_BLUE', Team: '1' }],
  };
  const tget = (root, path) => path.reduce((n, s) => (n == null ? n : n[s]), root);
  const tset = (root, path, v) => { const p = tget(root, path.slice(0, -1)); if (p) p[path[path.length - 1]] = v; };
  window.editor = {
    listMaps: async () => ({ root: '(harness)', maps: [
      { name: 'harness', rel: 'Single/harness', path: '/harness/map.xdb' },
    ] }),
    mapTree: async () => ({ tree: JSON.parse(JSON.stringify(mapTreeData)) }),
    mapProps: async () => ({ props: [], name: 'Harness Map', description: 'A test description.' }),
    names: async () => ({ names: [] }),
    roster: async () => ({ entries: [] }),
    objectsOfClass: async () => ({ entries: [] }),
    newEntity: async ({ className, name }) => ({ href: name + '.(' + className + ').xdb#xpointer(/' + className + ')' }),
    readEntity: async (href) => /AdvMapTown/.test(href)
      ? { className: 'AdvMapTown', editable: true, tree: { Pos: { x: '11', y: '11', z: '0' }, PlayerID: 'PLAYER_NONE', Shared: '', AllowQuickCombat: 'true' } }
      : { className: 'Wind', editable: true, tree: { Angle: '225', Speed: '10' } },
    setEntityPath: async (p) => { log('setEntityPath', p); return { ok: true }; },
    pickText: async () => ({ href: '' }),
    copyEntityToMap: async (href) => ({ href }),
    readFile: async () => ({ text: '' }),
    writeFile: async (p) => { log('writeFile', p); return { ok: true }; },
    setMapPath: async (p) => { log('setMapPath', p); tset(mapTreeData, p.path, p.value); return { ok: true }; },
    setMapList: async (p) => { tset(mapTreeData, p.path, p.values.slice()); return { ok: true }; },
    setMapProp: async (p) => { log('setMapProp', p); return { ok: true }; },
    addMapItem: async (p) => { const a = tget(mapTreeData, p.path); if (Array.isArray(a)) a.push(p.value !== undefined ? p.value : {}); return { ok: true }; },
    removeMapItem: async (p) => { const a = tget(mapTreeData, p.path.slice(0, -1)); if (Array.isArray(a)) a.splice(p.path[p.path.length - 1], 1); return { ok: true }; },
    openMapDialog: async () => null,
    loadMap: async (path) => {
      log('loadMap', path);
      return {
        scene: { geoms: [box], floors: [floor] },
        info: {
          name: 'harness', mapPath: path, tileX: V - 1, tileY: V - 1,
          counts: { AdvMapStatic: 2, AdvMapMonster: 1 }, floors: [{ name: 'surface', objects: 3 }], placed: 3, skipped: 0,
        },
        status,
        history: hist.state(),
      };
    },
    moveObject: async (...a) => { log('moveObject', a); hist.note(); return { ok: true }; },
    rotateObject: async (...a) => { log('rotateObject', a); hist.note(); return { ok: true }; },
    removeObject: async (...a) => { log('removeObject', a); hist.note(); return { ok: true }; },
    // One field of every kind, so the panel's four editors are all exercised.
    objectProps: async (id) => {
      log('objectProps', id);
      return { type: 'AdvMapStatic', props: [
        { name: 'Name', value: '', kind: 'text' },
        { name: 'Amount', value: '40', kind: 'number' },
        { name: 'IsRemovable', value: 'false', kind: 'bool' },
        { name: 'Mood', value: 'MONSTER_MOOD_AGGRESSIVE', kind: 'enum' },
        { name: 'Shared', value: SH, kind: 'href' },
      ] };
    },
    setObjectProp: async (p) => { log('setObjectProp', p); return { ok: true }; },
    // A catalogue with the shapes that matter: a normal entry, a hidden one, a
    // random-group one, and one with no type (which must refuse to place).
    listObjects: async () => {
      log('listObjects');
      const mk = (name, group, type, extra) => Object.assign({
        path: 'MapObjects/_(AdvMapObjectLink)/' + group + '/' + name + '.xdb',
        name, label: name, description: null, group, type,
        shared: '/MapObjects/' + name + '.(' + type + 'Shared).xdb#xpointer(/' + type + 'Shared)',
        hidden: false, random: false,
      }, extra || {});
      return {
        objects: [
          mk('Spruce', 'Objects-Grass', 'AdvMapStatic'),
          mk('Anthill', 'Objects-Grass', 'AdvMapStatic'),
          mk('Peasant', 'Monsters', 'AdvMapMonster'),
          mk('TestProp', 'Objects-Grass', 'AdvMapStatic', { hidden: true }),
          mk('RandomHero', 'GenericHeroes', 'AdvMapHero', { random: true }),
          mk('Broken', 'Objects-Grass', '', {}),
        ],
        groups: [
          { name: '==== Environment ====', separator: true },
          { name: 'Objects-Grass', separator: false },
          { name: 'Monsters', separator: false },
          { name: 'GenericHeroes', separator: false },
        ],
        hasEditor: true,
      };
    },
    objectIcon: async (path) => {
      log('objectIcon', path);
      return solid(16, 16, 120, 100, 160);
    },
    addObject: async (p) => {
      log('addObject', p);
      return {
        instance: { id: 'item_new' + (window.__calls.length), type: p.type, g: 0,
          shared: p.shared.split('#')[0], x: p.x, y: p.y, z: 0, r: p.r || 0 },
        geom: null,
        complete: p.type === 'AdvMapStatic',
      };
    },
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
    sculpt: async (p) => { log('sculpt', p); hist.note(); return { ok: true }; },
    // Undo/redo far enough to drive the UI: the stub keeps a counter rather
    // than real patches, and hands back the instance list so the renderer's
    // rebuild path is exercised.
    undo: async () => { log('undo'); return hist.step('undo'); },
    redo: async () => { log('redo'); return hist.step('redo'); },
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
