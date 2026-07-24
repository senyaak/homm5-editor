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

testDocument();
testPack();
testAgainstTheRealThing();

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
