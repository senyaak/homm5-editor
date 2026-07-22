// Preload bridge — exposes a minimal, typed IPC surface to the renderer.
// contextIsolation is on, so the renderer sees only `window.editor` with these
// methods, never Node or the raw ipcRenderer.
//
// This file stays plain CommonJS JavaScript on purpose. Electron's preload
// loader does not run Node's type-stripping hook — a `.cts` preload is read
// verbatim, so even a bare `const n: number = 1` fails with "Missing
// initializer in const declaration" and the bridge silently never installs.
// The contract it implements is EditorApi in ./ipc.ts; keep the two in step.
const { contextBridge, ipcRenderer } = require('electron');

/** @type {import('./ipc.ts').EditorApi} */
const api = {
  listMaps: () => ipcRenderer.invoke('maps:list'),
  openMapDialog: () => ipcRenderer.invoke('dialog:openMap'),
  newMap: (p) => ipcRenderer.invoke('map:new', p),
  openArchive: (path) => ipcRenderer.invoke('map:open-archive', { path }),
  loadMap: (path) => ipcRenderer.invoke('map:load', path),
  moveObject: (id, x, y) => ipcRenderer.invoke('object:move', { id, x, y }),
  rotateObject: (id, r) => ipcRenderer.invoke('object:rotate', { id, r }),
  removeObject: (id) => ipcRenderer.invoke('object:remove', { id }),
  objectProps: (id) => ipcRenderer.invoke('object:props', { id }),
  specValues: (type) => ipcRenderer.invoke('spec:values', { type }),
  setObjectProp: (p) => ipcRenderer.invoke('object:set-prop', p),
  mapProps: () => ipcRenderer.invoke('map:props'),
  setMapProp: (p) => ipcRenderer.invoke('map:set-prop', p),
  roster: (name) => ipcRenderer.invoke('registry:roster', { name }),
  objectsOfClass: (className) => ipcRenderer.invoke('objects:of-class', { className }),
  newEntity: (p) => ipcRenderer.invoke('map:new-entity', p),
  readEntity: (href) => ipcRenderer.invoke('entity:read', { href }),
  setEntityPath: (p) => ipcRenderer.invoke('entity:set-path', p),
  pickText: () => ipcRenderer.invoke('map:pick-text'),
  copyEntityToMap: (href) => ipcRenderer.invoke('entity:copy-to-map', { href }),
  suggestName: (className) => ipcRenderer.invoke('map:suggest-name', { className }),
  names: (kind) => ipcRenderer.invoke('map:names', { kind }),
  mapTree: () => ipcRenderer.invoke('map:tree'),
  setMapPath: (p) => ipcRenderer.invoke('map:set-path', p),
  addMapItem: (p) => ipcRenderer.invoke('map:add-item', p),
  removeMapItem: (p) => ipcRenderer.invoke('map:remove-item', p),
  setMapList: (p) => ipcRenderer.invoke('map:set-list', p),
  readFile: (href) => ipcRenderer.invoke('map:read-file', { href }),
  writeFile: (p) => ipcRenderer.invoke('map:write-file', p),
  listObjects: () => ipcRenderer.invoke('objects:list'),
  objectIcon: (path) => ipcRenderer.invoke('objects:icon', { path }),
  addObject: (p) => ipcRenderer.invoke('object:add', p),
  save: () => ipcRenderer.invoke('map:save'),
  pack: () => ipcRenderer.invoke('map:pack'),
  status: () => ipcRenderer.invoke('map:status'),
  listTiles: () => ipcRenderer.invoke('terrain:tiles'),
  paintTile: (p) => ipcRenderer.invoke('terrain:paint', p),
  paintRiver: (p) => ipcRenderer.invoke('terrain:paint-river', p),
  setMask: (p) => ipcRenderer.invoke('terrain:mask', p),
  sculpt: (p) => ipcRenderer.invoke('terrain:sculpt', p),
  addLayer: (p) => ipcRenderer.invoke('terrain:add-layer', p),
  undo: () => ipcRenderer.invoke('history:undo'),
  redo: () => ipcRenderer.invoke('history:redo'),
  // Push channel, not invoke: the main process decides when the folder moved.
  // The listener is wrapped so the renderer never sees the IpcRendererEvent.
  onExternalChange: (cb) => { ipcRenderer.on('map:external-change', (_e, c) => cb(c)); },
};

contextBridge.exposeInMainWorld('editor', api);
