// A campaign PROJECT on disk — the editable form of what packCampaign ships.
//
// It is the campaign's counterpart of a map project: a folder holding the
// descriptor (campaign.xdb) and the text files its refs name, flat beside it,
// exactly as they will sit inside UserCampaigns/<name>/ in the .h5c. Editing a
// campaign is therefore editing this folder; packing is a copy, not a build.
//
// The list operations here (add/remove/move a mission) exist because a campaign
// is an ORDERED document: a mission's position is its identity — the heroes it
// hands on name their destination by index (see handOnTo). Reordering missions
// without fixing those indices silently sends heroes to the wrong chapter, so
// that repair lives here rather than in the UI.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { newCampaignBody, newMission, newPoolHero, newBonus, loadCampaign, saveCampaign } from './campaign.ts';
import { loadMap } from './map.ts';
import { find, children, parse, setAttr, setText, childText, clearElement } from './xml.ts';
import type { XmlElement } from './xml.ts';
import type { ProjectFile } from './new-map.ts';

/** The descriptor's file name, in the project and in the archive alike. */
export const DESCRIPTOR = 'campaign.xdb';

/** The campaign-wide texts, and the field whose href names each. */
export const CAMPAIGN_TEXTS: Record<string, string> = {
  NameFileRef: 'CampaignName.txt',
  FullNameFileRef: 'FullCampaignName.txt',
  NameCommentFileRef: 'CampaignSummary.txt',
  DescriptionFileRef: 'CampaignDescription.txt',
};

/** A shipped campaign-select texture, so a fresh campaign has an icon at all. */
export const DEFAULT_ICON = '/UI/MainMenu2/SelectCampaign/GriffonBack.(Texture).xdb#xpointer(/Texture)';

/** The utility object that marks where transported heroes ARRIVE on a map. */
export const ENTRY_POINT = '/MapObjects/Utility/EntryPoint.xdb';

/** A HoMM5 text file: UTF-16 LE with a byte-order mark, no trailing newline. */
const utf16 = (s: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

/** Read one back. Returns '' when the file is absent — a blank text, not an error. */
export function readProjectText(projectDir: string, rel: string): string {
  const p = join(projectDir, rel);
  if (!existsSync(p)) return '';
  const buf = readFileSync(p);
  const from = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? 2 : 0;
  return buf.toString('utf16le', from);
}

/** Write one, in the game's encoding. */
export function writeProjectText(projectDir: string, rel: string, value: string): void {
  writeFileSync(join(projectDir, rel), utf16(value));
}

/** The text files a mission's own refs name, by field. */
export function missionTexts(index: number): Record<string, string> {
  return {
    NameFileRef: `Mission${index + 1}Name.txt`,
    NameCommentFileRef: `Mission${index + 1}Description.txt`,
  };
}

/**
 * The file set for a fresh campaign: a descriptor with no missions yet, and the
 * campaign-wide texts its refs point at. Mirrors buildNewMapProject.
 */
export function buildNewCampaignProject(name: string): ProjectFile[] {
  const root = newCampaignBody(name);
  for (const [field, file] of Object.entries(CAMPAIGN_TEXTS)) {
    const el = find(root, field);
    if (el) setAttr(el, 'href', file);
  }
  const icon = find(root, 'Icon');
  if (icon) setAttr(icon, 'href', DEFAULT_ICON);

  return [
    { path: DESCRIPTOR, data: Buffer.from(saveCampaign(root), 'latin1') },
    { path: CAMPAIGN_TEXTS.NameFileRef!, data: utf16(name) },
    { path: CAMPAIGN_TEXTS.FullNameFileRef!, data: utf16(name) },
    { path: CAMPAIGN_TEXTS.NameCommentFileRef!, data: utf16('') },
    { path: CAMPAIGN_TEXTS.DescriptionFileRef!, data: utf16('') },
  ];
}

/** Read a campaign project's descriptor. */
export function loadCampaignProject(projectDir: string): XmlElement {
  return loadCampaign(readFileSync(join(projectDir, DESCRIPTOR), 'latin1'));
}

/** Write it back. */
export function saveCampaignProject(projectDir: string, root: XmlElement): void {
  writeFileSync(join(projectDir, DESCRIPTOR), saveCampaign(root), 'latin1');
}

/** The mission items, in play order. */
export function missions(root: XmlElement): XmlElement[] {
  const list = find(root, 'Missions');
  return list ? children(list).filter((c) => c.name === 'Item') : [];
}

/**
 * Append a mission for `mapTag` (an absolute map-tag href) and return it, with
 * its text refs already naming the files that belong to its position.
 */
export function addMission(root: XmlElement, mapTag = ''): XmlElement {
  const list = find(root, 'Missions');
  if (!list) throw new Error('the campaign has no <Missions>');
  const item = newMission();
  const at = missions(root).length;
  for (const [field, file] of Object.entries(missionTexts(at))) {
    const el = find(item, field);
    if (el) setAttr(el, 'href', file);
  }
  const tag = find(item, 'MissionTag');
  if (tag) setAttr(tag, 'href', mapTag);
  appendItem(list, item);
  // A campaign's earlier missions hand their heroes to the one after them; the
  // new last mission is now that destination for the one before it.
  renumberHandovers(root);
  return item;
}

/** Drop mission `index`, keeping the remaining ones' texts and handovers right. */
export function removeMission(root: XmlElement, index: number): void {
  const list = find(root, 'Missions');
  const items = missions(root);
  const gone = items[index];
  if (!list || !gone) throw new Error(`no mission at ${index}`);
  list.children = list.children.filter((c) => c !== gone);
  retextMissions(root);
  renumberHandovers(root);
}

/** Move mission `index` by `delta` (-1 up, +1 down). A no-op at the ends. */
export function moveMission(root: XmlElement, index: number, delta: number): void {
  const items = missions(root);
  const to = index + delta;
  if (!items[index] || to < 0 || to >= items.length) return;
  const list = find(root, 'Missions')!;
  const order = items.slice();
  const [moved] = order.splice(index, 1);
  order.splice(to, 0, moved!);
  reorderItems(list, order);
  retextMissions(root);
  renumberHandovers(root);
}

/**
 * Which mission a hero handed on by mission `index` travels to: the next one,
 * as a 0-based index — what every shipped campaign writes.
 */
export function handOnTo(index: number): number {
  return index + 1;
}

/** A hero standing on a map: which character it is, and its script name. */
export interface PlacedHero {
  /** The AdvMapHeroShared this hero is an instance of. */
  shared: string;
  /** The object's own <Name> — the handle the map's Lua uses. May be empty. */
  name: string;
  /** Which player owns it. */
  player: string;
}

/**
 * The heroes standing on a map.
 *
 * The map's EntryPoint is skipped — it is an AdvMapHero by shape, but it marks
 * where ARRIVING heroes land rather than being a hero itself.
 */
export function placedHeroes(mapXdbText: string): PlacedHero[] {
  const out: PlacedHero[] = [];
  for (const o of loadMap(mapXdbText).objects) {
    if (o.type !== 'AdvMapHero') continue;
    const shared = find(o.el, 'Shared')?.attrs.href ?? '';
    if (shared.startsWith(ENTRY_POINT)) continue;
    out.push({ shared, name: childText(o.el, 'Name').trim(), player: childText(o.el, 'PlayerID') });
  }
  return out;
}

/**
 * The name a hero travels under — the CHARACTER's, read from its shared
 * document's <InternalName> (Isabell, Godric, Agrael …).
 *
 * This is not the placed object's <Name>, which is the handle the map's Lua
 * uses and is often empty. The distinction is the whole mechanism: C1M2
 * receives Isabell from C1M1 while the Isabell it holds has no <Name> at all,
 * so the game matches the campaign's HeroScriptName against the character, not
 * against whatever the object on the map was called. A made-up name matches no
 * character, and the hero is silently never handed on.
 */
export function heroScriptName(sharedXdbText: string): string {
  const doc = parse(sharedXdbText);
  const root = doc.name === 'AdvMapHeroShared' ? doc : find(doc, 'AdvMapHeroShared');
  return root ? childText(root, 'InternalName').trim() : '';
}

/** Whether a map carries an EntryPoint — where transported heroes arrive. */
export function hasEntryPoint(mapXdbText: string): boolean {
  return loadMap(mapXdbText).objects.some(
    (o) => o.type === 'AdvMapHero' && (find(o.el, 'Shared')?.attrs.href ?? '').startsWith(ENTRY_POINT),
  );
}

/** One hero handed on by a mission. */
export interface PoolHero {
  scriptName: string;
  targetCampaign?: string;
  targetMission: number;
}

/** Read a mission's handed-on heroes. */
export function readHeroesPool(mission: XmlElement): PoolHero[] {
  const pool = find(mission, 'HeroesPool');
  const list = pool ? find(pool, 'Heroes') : null;
  if (!list) return [];
  return children(list).filter((c) => c.name === 'Item').map((h) => ({
    scriptName: childText(h, 'HeroScriptName'),
    targetCampaign: find(h, 'TargetCampaign')?.attrs.href ?? '',
    targetMission: Number(childText(h, 'TargetMission') || 0),
  }));
}

/** Replace them. Count always tracks the list, as the shipped campaigns keep it. */
export function writeHeroesPool(mission: XmlElement, heroes: PoolHero[]): void {
  const pool = find(mission, 'HeroesPool');
  if (!pool) throw new Error('the mission has no <HeroesPool>');
  const count = find(pool, 'Count');
  if (count) setText(count, heroes.length);
  const list = find(pool, 'Heroes');
  if (!list) throw new Error('the mission has no <Heroes>');
  clearElement(list);
  for (const h of heroes) {
    // Built from the schema so the item carries every field the format wants,
    // in order — hand-rolled elements miss rawAttrs and serialize wrong.
    const item = newPoolHero();
    const name = find(item, 'HeroScriptName');
    if (name) setText(name, h.scriptName);
    const target = find(item, 'TargetCampaign');
    if (target && h.targetCampaign) setAttr(target, 'href', h.targetCampaign);
    const to = find(item, 'TargetMission');
    if (to) setText(to, h.targetMission);
    appendItem(list, item);
  }
}

/** One of a mission's three start-bonus slots. */
export interface Bonus {
  /** E_BONUS_NONE, or what the slot grants. */
  type: string;
  /** The artifact/creature/spell/building id — or, for a resource, its name. */
  value: string;
  /** How many: creatures and resources use it. */
  count: number;
}

/** The seven resources, in the order the format lists them. */
export const RESOURCES = ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold'];

/** Read a mission's bonus slots. */
export function readBonuses(mission: XmlElement): Bonus[] {
  const list = find(mission, 'Bonuses');
  if (!list) return [];
  return children(list).filter((c) => c.name === 'Item').map((b) => {
    const type = childText(b, 'Type');
    const army = find(b, 'BonusArmy');
    const res = find(b, 'BonusResources');
    if (type === 'E_BONUS_CREATURE') {
      return { type, value: army ? childText(army, 'Creature') : '', count: Number(army ? childText(army, 'Count') : 0) };
    }
    if (type === 'E_BONUS_RESOURCE') {
      // Exactly one resource carries the amount; which one IS the choice.
      const kind = res ? RESOURCES.find((r) => Number(childText(res, r)) > 0) : undefined;
      return { type, value: kind ?? RESOURCES[0]!, count: Number(res && kind ? childText(res, kind) : 0) };
    }
    if (type === 'E_BONUS_ARTIFACT') return { type, value: childText(b, 'BonusArtifactID'), count: 1 };
    if (type === 'E_BONUS_SPELL') return { type, value: childText(b, 'BonusSpellID'), count: 1 };
    if (type === 'E_BONUS_BUILDING') return { type, value: childText(b, 'Building'), count: 1 };
    return { type: type || 'E_BONUS_NONE', value: '', count: 0 };
  });
}

/**
 * Replace them. A mission offers three slots or none at all — that is what the
 * shipped campaigns hold — so an all-empty set is written as no list.
 */
export function writeBonuses(mission: XmlElement, bonuses: Bonus[]): void {
  const list = find(mission, 'Bonuses');
  if (!list) throw new Error('the mission has no <Bonuses>');
  clearElement(list);
  const used = bonuses.filter((b) => b.type && b.type !== 'E_BONUS_NONE');
  if (!used.length) return;

  const slots = bonuses.slice(0, 3);
  while (slots.length < 3) slots.push({ type: 'E_BONUS_NONE', value: '', count: 0 });
  for (const b of slots) {
    const item = newBonus();
    const set = (name: string, v: string | number): void => {
      const el = find(item, name);
      if (el) setText(el, v);
    };
    set('Type', b.type || 'E_BONUS_NONE');
    if (b.type === 'E_BONUS_CREATURE') {
      const army = find(item, 'BonusArmy');
      if (army) { setText(find(army, 'Creature')!, b.value); setText(find(army, 'Count')!, b.count); }
    } else if (b.type === 'E_BONUS_RESOURCE') {
      const res = find(item, 'BonusResources');
      const kind = RESOURCES.includes(b.value) ? b.value : RESOURCES[0]!;
      if (res) setText(find(res, kind)!, b.count);
    } else if (b.type === 'E_BONUS_ARTIFACT') set('BonusArtifactID', b.value);
    else if (b.type === 'E_BONUS_SPELL') set('BonusSpellID', b.value);
    else if (b.type === 'E_BONUS_BUILDING') set('Building', b.value);
    appendItem(list, item);
  }
}

// --- keeping the document consistent -----------------------------------------

/** Point every mission's text refs at the files for its current position. */
function retextMissions(root: XmlElement): void {
  missions(root).forEach((m, i) => {
    for (const [field, file] of Object.entries(missionTexts(i))) {
      const el = find(m, field);
      if (el) setAttr(el, 'href', file);
    }
  });
}

/**
 * Send every handed-on hero to the mission that now follows its own, and drop
 * the handover from the last mission — there is nowhere left to hand on to.
 * Heroes aimed at another campaign are left alone: that destination is explicit.
 */
function renumberHandovers(root: XmlElement): void {
  const all = missions(root);
  all.forEach((m, i) => {
    const heroes = readHeroesPool(m);
    if (!heroes.length) return;
    const last = i === all.length - 1;
    const kept = heroes
      .filter((h) => h.targetCampaign || !last)
      .map((h) => (h.targetCampaign ? h : { ...h, targetMission: handOnTo(i) }));
    if (kept.length !== heroes.length || kept.some((h, k) => h.targetMission !== heroes[k]!.targetMission)) {
      writeHeroesPool(m, kept);
    }
  });
}

// --- small XML helpers --------------------------------------------------------

/** Append an `<Item>` to a list element, keeping it non-self-closing. */
function appendItem(list: XmlElement, item: XmlElement): void {
  list.selfClose = false;
  list.children.push(item);
}

/** Re-lay a list's items in `order`, dropping the old whitespace between them. */
function reorderItems(list: XmlElement, order: XmlElement[]): void {
  list.children = order.slice();
  list.selfClose = false;
}
