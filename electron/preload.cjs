// Preload bridge — exposes a minimal, typed IPC surface to the renderer.
// contextIsolation is on, so the renderer sees only `window.editor` with these
// methods, never Node or the raw ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editor', {
  listMaps: () => ipcRenderer.invoke('maps:list'),
  openMapDialog: () => ipcRenderer.invoke('dialog:openMap'),
  loadMap: (path) => ipcRenderer.invoke('map:load', path),
  moveObject: (id, x, y) => ipcRenderer.invoke('object:move', { id, x, y }),
  save: () => ipcRenderer.invoke('map:save'),
  pack: () => ipcRenderer.invoke('map:pack'),
  status: () => ipcRenderer.invoke('map:status'),
  listTiles: () => ipcRenderer.invoke('terrain:tiles'),
});
