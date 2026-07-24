// Validates the campaign document and packCampaign() — the .h5c file set.
//
//   1. Self-contained (always runs): a built campaign carries the fields the
//      game's own editor writes, IN THE SAME ORDER (these documents are
//      serialized structs, so order is not cosmetic), and packing one produces
//      UserCampaigns/<name>/campaign.xdb plus flat texts and NO map.
//   2. Against the real thing (optional): if a campaign made by the game's own
//      editor is around, check the expected order below really is its order.
//      Point at one with HOMM5_CAMPAIGN, else ../UserCampaigns/terst.h5c.
//
// Why the order list is spelled out here rather than derived: it is the thing
// under test. A schema reshuffle that silently changes what we emit is exactly
// the regression this catches.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCampaignBody, newMission, saveCampaign, loadCampaign } from '../src/campaign.ts';
import { packCampaign, missionMapDir, campaignMaps } from '../src/campaign-pack.ts';
import {
  addMission, buildNewCampaignProject, hasEntryPoint, loadCampaignProject, missions,
  moveMission, readHeroesPool, readProjectText, removeMission, saveCampaignProject,
  transportableHeroes, writeHeroesPool,
} from '../src/campaign-project.ts';
import { readEntries } from '../src/pak.ts';
import { find, setAttr } from '../src/xml.ts';
import type { XmlElement } from '../src/xml.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** What a campaign made by the game's own editor holds, in order. */
const CAMPAIGN_ORDER = [
  'InternalName', 'NameFileRef', 'FullNameFileRef', 'NameCommentFileRef',
  'DependentCampaigns', 'Missions', 'AdventureMusic', 'WinMissionMusic',
  'LoseMissionMusic', 'DescriptionFileRef', 'Icon', 'UserCampaign',
  'UseCustomHallOfFameResults', 'CustomHallOfFameResults',
];

/** And what one of its missions holds, in order. */
const MISSION_ORDER = [
  'NameFileRef', 'NameCommentFileRef', 'MissionTag', 'Bonuses', 'HeroesPool',
  'startMusics', 'additionalAdventureMusics', 'additionalWaitMusics',
  'additionalCombatMusics',
];

/** A HoMM5 text file: UTF-16LE with a BOM. */
const text = (s: string): Buffer => Buffer.from('﻿' + s, 'utf16le');

/** Direct element children, by name, in document order. */
const names = (el: XmlElement): string[] =>
  el.children.filter((c): c is XmlElement => c.type === 'element').map((c) => c.name);

/** A one-mission campaign, as the editor would build it. */
function buildCampaign(missionTag: string): XmlElement {
  const camp = newCampaignBody('TestCampaign');
  setAttr(find(camp, 'NameFileRef')!, 'href', 'CampaignName.txt');
  setAttr(find(camp, 'DescriptionFileRef')!, 'href', 'CampaignDescription.txt');
  const missions = find(camp, 'Missions')!;
  const m = newMission();
  setAttr(find(m, 'NameFileRef')!, 'href', 'MissionName.txt');
  setAttr(find(m, 'MissionTag')!, 'href', missionTag);
  missions.selfClose = false;
  missions.children = [{ type: 'text', text: '\n\t\t' }, m, { type: 'text', text: '\n\t' }] as never;
  return camp;
}

/** Write that campaign out as a project folder, returning its path. */
function writeProject(dir: string, camp: XmlElement): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'campaign.xdb'), saveCampaign(camp), 'latin1');
  writeFileSync(join(dir, 'CampaignName.txt'), text('Test Campaign'));
  writeFileSync(join(dir, 'CampaignDescription.txt'), text('A one-mission test campaign.'));
  writeFileSync(join(dir, 'MissionName.txt'), text('The Queen'));
  return dir;
}

const TAG = '/Maps/SingleMissions/e2e Reconstruct C1M1/map-tag.xdb#xpointer(/AdvMapDescTag)';

function testDocument(): void {
  console.log('\nTHE DOCUMENT');
  const camp = buildCampaign(TAG);
  check('campaign fields, in the editor\'s order', names(camp).join() === CAMPAIGN_ORDER.join(), names(camp).join(' '));
  const mission = find(find(camp, 'Missions')!, 'Item')!;
  check('mission fields, in the editor\'s order', names(mission).join() === MISSION_ORDER.join(), names(mission).join(' '));
  check('UserCampaign is forced true', find(camp, 'UserCampaign')?.children[0]?.type === 'text');
  check('round-trips through the XML layer', names(loadCampaign(saveCampaign(camp))).join() === CAMPAIGN_ORDER.join());
  // No campaign the game ships or its own editor writes holds a single href="";
  // one on a hero's TargetCampaign stopped the hero being handed on at all.
  check('an empty reference is a bare element, never href=""', !saveCampaign(camp).includes('href=""'));
}

function testPack(): void {
  console.log('\nTHE ARCHIVE');
  const tmp = mkdtempSync(join(tmpdir(), 'homm5-campaign-'));
  try {
    const dir = writeProject(join(tmp, 'project'), buildCampaign(TAG));
    check('campaignMaps names the mission\'s map', campaignMaps(dir).join() === 'Maps/SingleMissions/e2e Reconstruct C1M1');

    const out = join(tmp, 'My Campaign.h5c');
    const res = packCampaign(dir, out);
    const entries = readEntries(readFileSync(out));
    const paths = entries.map((e) => e.name).sort();

    check('every entry sits under UserCampaigns/<name>/', paths.every((p) => p.startsWith('UserCampaigns/My Campaign/')), paths[0]);
    check('the descriptor is named campaign.xdb', paths.includes('UserCampaigns/My Campaign/campaign.xdb'));
    check('the texts stay flat beside it', paths.includes('UserCampaigns/My Campaign/CampaignName.txt'));
    check('NO map is bundled', !paths.some((p) => /\/Maps\/|map\.xdb|GroundTerrain/i.test(p)), paths.join(' '));
    check('entry count matches what was packed', res.entries === paths.length, `${res.entries}`);

    // A campaign that names no map lists in the menu but cannot start, so the
    // packer refuses it rather than shipping something broken.
    const bad = writeProject(join(tmp, 'blank-tag'), buildCampaign(''));
    let threw = '';
    try { packCampaign(bad, join(tmp, 'bad.h5c')); } catch (e) { threw = (e as Error).message; }
    check('refuses a mission with no map', /has no map/.test(threw), threw);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The expected orders above are claims about the game's format; if a campaign
// built by the game's own editor is around, hold them to it.
function testAgainstTheRealThing(): void {
  const ref = process.env.HOMM5_CAMPAIGN || join('..', 'UserCampaigns', 'terst.h5c');
  if (!existsSync(ref)) {
    console.log('\n(no editor-made campaign — pass one as HOMM5_CAMPAIGN for the format check)');
    return;
  }
  console.log(`\nAGAINST ${ref}`);
  const entry = readEntries(readFileSync(ref)).find((e) => e.name.endsWith('campaign.xdb'));
  if (!entry) { check('the reference holds a campaign.xdb', false); return; }
  const root = loadCampaign(entry.data.toString('latin1'));
  check('campaign order matches the reference', names(root).join() === CAMPAIGN_ORDER.join(), names(root).join(' '));
  const mission = find(find(root, 'Missions')!, 'Item');
  if (mission) check('mission order matches the reference', names(mission).join() === MISSION_ORDER.join(), names(mission).join(' '));
  const tag = mission ? find(mission, 'MissionTag')?.attrs.href ?? '' : '';
  check('its MissionTag resolves to a map folder', missionMapDir(tag).startsWith('Maps/'), missionMapDir(tag));
}

function testProject(): void {
  console.log('\nTHE PROJECT');
  const tmp = mkdtempSync(join(tmpdir(), 'homm5-campproj-'));
  try {
    const dir = join(tmp, 'My Campaign');
    mkdirSync(dir, { recursive: true });
    const files = buildNewCampaignProject('My Campaign');
    for (const f of files) writeFileSync(join(dir, f.path), f.data);
    check('a fresh project is the descriptor plus its texts', files.length === 5, `${files.length}`);
    const name = files.find((f) => f.path === 'CampaignName.txt')!.data;
    check('texts are UTF-16 LE with a BOM', name[0] === 0xff && name[1] === 0xfe && name.toString('utf16le', 2) === 'My Campaign');
    check('reads its own texts back', readProjectText(dir, 'CampaignName.txt') === 'My Campaign');

    // Three missions, each handing a hero to the next.
    const root = loadCampaignProject(dir);
    for (const map of ['A', 'B', 'C']) {
      const m = addMission(root, `/Maps/SingleMissions/${map}/map-tag.xdb#xpointer(/AdvMapDescTag)`);
      writeHeroesPool(m, [{ scriptName: `Hero${map}`, targetMission: 0 }]);
    }
    check('three missions', missions(root).length === 3);
    const tagOf = (i: number): string => find(missions(root)[i]!, 'MissionTag')?.attrs.href ?? '';
    const nameRefOf = (i: number): string => find(missions(root)[i]!, 'NameFileRef')?.attrs.href ?? '';
    check('a mission\'s texts follow its position', nameRefOf(1) === 'Mission2Name.txt', nameRefOf(1));

    // Handovers point at the NEXT mission, and the last one hands on to nobody.
    const handovers = (): string => missions(root).map((m) => readHeroesPool(m).map((h) => h.targetMission).join('|') || '-').join(' ');
    writeHeroesPool(missions(root)[0]!, [{ scriptName: 'HeroA', targetMission: 0 }]);
    addMission(root, '/Maps/SingleMissions/D/map-tag.xdb#xpointer(/AdvMapDescTag)');
    check('heroes travel to the next mission', handovers().startsWith('1 '), handovers());
    check('the last mission hands on to nobody', handovers().endsWith('-'), handovers());

    // Reordering rewrites those indices — a hero must not follow a stale one.
    moveMission(root, 0, 1);
    check('a move keeps handovers pointing at the next mission', /^(-|\d) /.test(handovers()) && !handovers().includes('0'), handovers());
    check('a move re-points the texts too', nameRefOf(0) === 'Mission1Name.txt' && tagOf(0).includes('/B/'), `${nameRefOf(0)} ${tagOf(0)}`);

    removeMission(root, 3);
    check('a mission can be removed', missions(root).length === 3);

    saveCampaignProject(dir, root);
    check('the saved descriptor reloads', missions(loadCampaignProject(dir)).length === 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Which heroes a mission can hand on is read off its map, so check that against
// real maps when they are around: map 12 carries an EntryPoint (it receives
// heroes), the reconstructed C1M1 does not (it is a first mission).
function testHeroesAgainstMaps(): void {
  const c1m1 = join('data-unpacked', 'Maps', 'SingleMissions', 'e2e Reconstruct C1M1', 'map.xdb');
  // Only meaningful once the reconstruction has built the map: a run stopped
  // part-way leaves a blank one behind, with no heroes to offer yet.
  if (existsSync(c1m1)) {
    const xml = readFileSync(c1m1, 'latin1');
    const heroes = transportableHeroes(xml);
    if (heroes.length) {
      console.log('\nAGAINST A REAL MAP');
      check('C1M1 offers its named hero', heroes.includes('Isabell'), heroes.join());
      check('C1M1 has no EntryPoint (nothing arrives there)', !hasEntryPoint(xml));
    }
  }
  const twelve = join('..', 'Maps', '12.h5m');
  if (existsSync(twelve)) {
    const entry = readEntries(readFileSync(twelve)).find((e) => e.name === 'Maps/SingleMissions/12/map.xdb');
    if (entry) {
      const xml = entry.data.toString('latin1');
      check('map 12 has an EntryPoint (heroes arrive there)', hasEntryPoint(xml));
      // Its heroes are unnamed, so none of them can travel — the EntryPoint is
      // never offered as one either.
      check('an EntryPoint is never offered as a hero', !transportableHeroes(xml).some((h) => /entry/i.test(h)), transportableHeroes(xml).join());
    }
  }
}

testDocument();
testPack();
testProject();
testHeroesAgainstMaps();

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
