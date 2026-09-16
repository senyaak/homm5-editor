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

/**
 * A handler's refusal, in its own words. Electron wraps a rejection from
 * main as "Error invoking remote method 'rmg:generate': Error: <message>",
 * and that is what a dialog's error line showed. The channel is the code's
 * business, not the reader's; the message is the whole of it.
 */
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    const m = /^Error invoking remote method '[^']*': (?:Error: )?([\s\S]*)$/.exec(e instanceof Error ? e.message : String(e));
    throw m ? new Error(m[1]) : e;
  }
}

/** @type {import('./ipc.ts').EditorApi} */
const api = {
  listMaps: () => invoke('maps:list'),
  openMapDialog: () => invoke('dialog:openMap'),
  newMap: (p) => invoke('map:new', p),
  rmgChoices: () => invoke('rmg:choices'),
  rmgTemplates: (p) => invoke('rmg:templates', p),
  rmgGenerate: (p) => invoke('rmg:generate', p),
  rmgTemplateRead: (file) => invoke('rmg:template-read', file),
  rmgTemplateSave: (p) => invoke('rmg:template-save', p),
  rmgTemplateDelete: (file) => invoke('rmg:template-delete', file),
  openArchive: (path, inner, stock) => invoke('map:open-archive', { path, inner, stock }),
  loadMap: (path) => invoke('map:load', path),
  pickSceneFile: () => invoke('scene:pick-file'),
  scenesInFile: (file) => invoke('scene:in-file', file),
  openScene: (p) => invoke('scene:open', p),
  closeMap: () => invoke('map:close'),
  moveObject: (id, x, y) => invoke('object:move', { id, x, y }),
  rotateObject: (id, r) => invoke('object:rotate', { id, r }),
  removeObject: (id) => invoke('object:remove', { id }),
  reach: (p) => invoke('map:reach', p ?? {}),
  objectProps: (id) => invoke('object:props', { id }),
  specValues: (type) => invoke('spec:values', { type }),
  setObjectProp: (p) => invoke('object:set-prop', p),
  mapProps: () => invoke('map:props'),
  setMapProp: (p) => invoke('map:set-prop', p),
  roster: (name) => invoke('registry:roster', { name }),
  objectsOfClass: (className) => invoke('objects:of-class', { className }),
  newEntity: (p) => invoke('map:new-entity', p),
  readEntity: (href) => invoke('entity:read', { href }),
  setEntityPath: (p) => invoke('entity:set-path', p),
  pickText: () => invoke('map:pick-text'),
  copyEntityToMap: (href) => invoke('entity:copy-to-map', { href }),
  suggestName: (className) => invoke('map:suggest-name', { className }),
  names: (kind) => invoke('map:names', { kind }),
  mapTree: () => invoke('map:tree'),
  // The same tree, rooted at one object — structures a flat property list
  // cannot reach (a hero's army, a capture trigger).
  objectTree: (p) => invoke('object:tree', p),
  setObjectPath: (p) => invoke('object:set-path', p),
  addObjectItem: (p) => invoke('object:add-item', p),
  removeObjectItem: (p) => invoke('object:remove-item', p),
  setMapPath: (p) => invoke('map:set-path', p),
  addMapItem: (p) => invoke('map:add-item', p),
  removeMapItem: (p) => invoke('map:remove-item', p),
  setMapList: (p) => invoke('map:set-list', p),
  readFile: (href) => invoke('map:read-file', { href }),
  scriptContext: () => invoke('script:context'),
  mapFiles: (p) => invoke('map:files', p),
  writeFile: (p) => invoke('map:write-file', p),
  newScript: (p) => invoke('script:new', p),
  newSpecialization: (p) => invoke('spec:new', p),
  resolveScript: (p) => invoke('script:resolve', p),
  locGet: () => invoke('loc:get'),
  locEnable: (p) => invoke('loc:enable', p),
  locAddLanguage: (p) => invoke('loc:add-language', p),
  locRemoveLanguage: (p) => invoke('loc:remove-language', p),
  locExport: (p) => invoke('loc:export', p),
  listObjects: () => invoke('objects:list'),
  objectIcon: (path) => invoke('objects:icon', { path }),
  addObject: (p) => invoke('object:add', p),
  fillPresets: () => invoke('fill:presets'),
  applyFill: (p) => invoke('fill:apply', p),
  previewFill: (p) => invoke('fill:preview', p),
  saveFillPreset: (p) => invoke('fill:save-preset', p),
  deleteFillPreset: (p) => invoke('fill:delete-preset', p),
  save: () => invoke('map:save'),
  pack: () => invoke('map:pack'),
  status: () => invoke('map:status'),
  listTiles: () => invoke('terrain:tiles'),
  paintTile: (p) => invoke('terrain:paint', p),
  paintRiver: (p) => invoke('terrain:paint-river', p),
  setRiverCells: (p) => invoke('terrain:river-cells', p),
  setMask: (p) => invoke('terrain:mask', p),
  sculpt: (p) => invoke('terrain:sculpt', p),
  addLayer: (p) => invoke('terrain:add-layer', p),
  undo: () => invoke('history:undo'),
  redo: () => invoke('history:redo'),
  // Campaigns. A campaign is edited as a whole document (see EditorApi), so
  // these carry one CampaignDoc rather than a field at a time.
  listCampaigns: () => invoke('campaign:list'),
  newCampaign: (name) => invoke('campaign:new', { name }),
  openCampaign: (dir) => invoke('campaign:open', { dir }),
  saveCampaign: (doc) => invoke('campaign:save', { doc }),
  packCampaign: (dir) => invoke('campaign:pack', { dir }),
  mapHeroes: (mapRel) => invoke('campaign:map-heroes', { mapRel }),
  // Units/Artifacts mod — game-global, no map needed.
  listMods: () => invoke('mods:list'),
  modFormData: () => invoke('mods:form-data'),
  modPreset: (donor) => invoke('mods:preset', { donor }),
  modArtifactPreset: (donor) => invoke('mods:artifact-preset', { donor }),
  buildingData: () => invoke('mods:building-data'),
  buildingPreset: (donor) => invoke('mods:building-preset', { donor }),
  installBuilding: (p) => invoke('mods:install-building', p),
  updateBuilding: (p) => invoke('mods:update-building', p),
  removeBuilding: (p) => invoke('mods:remove-building', p),
  installMod: (p) => invoke('mods:install', p),
  updateMod: (p) => invoke('mods:update', p),
  installArtifact: (p) => invoke('mods:install-artifact', p),
  installArtifactSet: (p) => invoke('mods:install-set', p),
  installHero: (p) => invoke('mods:install-hero', p),
  updateHero: (p) => invoke('mods:update-hero', p),
  removeHero: (p) => invoke('mods:remove-hero', p),
  heroUses: (p) => invoke('mods:hero-uses', p),
  installSpecialization: (p) => invoke('mods:install-specialization', p),
  installHeroClass: (p) => invoke('mods:install-class', p),
  updateHeroClass: (p) => invoke('mods:update-class', p),
  removeHeroClass: (p) => invoke('mods:remove-class', p),
  installHeroSkill: (p) => invoke('mods:install-skill', p),
  updateHeroSkill: (p) => invoke('mods:update-skill', p),
  removeHeroSkill: (p) => invoke('mods:remove-skill', p),
  installSpell: (p) => invoke('mods:install-spell', p),
  updateSpell: (p) => invoke('mods:update-spell', p),
  removeSpell: (p) => invoke('mods:remove-spell', p),
  spellUses: (p) => invoke('mods:spell-uses', p),
  spellData: () => invoke('mods:spell-data'),
  classData: () => invoke('mods:class-data'),
  updateSpecialization: (p) => invoke('mods:update-specialization', p),
  removeSpecialization: (p) => invoke('mods:remove-specialization', p),
  heroArtOf: (hero) => invoke('mods:hero-art', { hero }),
  pickHeroFile: (p) => invoke('mods:pick-hero-file', p),
  pickPicture: () => invoke('mods:pick-picture'),
  updateArtifact: (p) => invoke('mods:update-artifact', p),
  updateArtifactSet: (p) => invoke('mods:update-set', p),
  creatureUses: (p) => invoke('mods:creature-uses', p),
  removeCreature: (p) => invoke('mods:remove-creature', p),
  artifactUses: (p) => invoke('mods:artifact-uses', p),
  removeArtifact: (p) => invoke('mods:remove-artifact', p),
  removeArtifactSet: (p) => invoke('mods:remove-set', p),
  extensionStatus: () => invoke('mods:extension-status'),
  installExtension: () => invoke('mods:install-extension'),
  modTextures: (target) => invoke('mods:textures', target),
  recolorMod: (p) => invoke('mods:recolor', p),
  // Diagnostics for the fatal-error screen (renderer/parts/fatal.html). It shows up
  // when the renderer module died, so these two are all it can still call —
  // preload has its own context and survives.
  gpuReport: () => invoke('app:gpu-report'),
  openDevTools: () => invoke('app:open-devtools'),
  launchGame: () => invoke('app:launch-game'),
  pandoraGet: (id) => invoke('pandora:get', { id }),
  pandoraSet: (id, contents) => invoke('pandora:set', { id, contents }),
  qolGet: () => invoke('qol:get'),
  qolApply: (settings, net) => invoke('qol:apply', { settings, net }),
  gpuSoftware: () => invoke('app:gpu-software'),
  setGpuSoftware: (on) => invoke('app:set-gpu-software', { on }),
  idleAnimation: () => invoke('app:idle-animation'),
  setIdleAnimation: (mode) => invoke('app:set-idle-animation', { mode }),
  idleSkins: () => invoke('map:idle-skins'),
  fx: (uids) => invoke('map:fx', { uids }),
  // Push channel, not invoke: the main process decides when the folder moved.
  // The listener is wrapped so the renderer never sees the IpcRendererEvent.
  onExternalChange: (cb) => { ipcRenderer.on('map:external-change', (_e, c) => cb(c)); },
};

contextBridge.exposeInMainWorld('editor', api);
