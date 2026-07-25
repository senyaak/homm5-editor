// Preload for the setup window — deliberately tiny and separate from the
// editor's bridge, so the first-run screen cannot reach the editor's IPC.
//
// Plain CommonJS JavaScript for the same reason preload.cjs is: Electron's
// preload loader does not strip types, so a .cts file is read verbatim and the
// bridge silently never installs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  state: () => ipcRenderer.invoke('setup:state'),
  check: (dataRoot) => ipcRenderer.invoke('setup:check', { dataRoot }),
  pickGame: () => ipcRenderer.invoke('setup:pick-game'),
  pickData: () => ipcRenderer.invoke('setup:pick-data'),
  unpack: (gameRoot, dataRoot) => ipcRenderer.invoke('setup:unpack', { gameRoot, dataRoot }),
  finish: (gameRoot, dataRoot) => ipcRenderer.invoke('setup:finish', { gameRoot, dataRoot }),
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, p) => cb(p)),
});
