// Dump what a Heroes III campaign contains, for reading and for planning a port.
//
//   node tools/h3-dump.ts "герои 3/IV - RoE - 1. Foolhardy Waywardness.h3c"
//   node tools/h3-dump.ts <file.h3c> --json
//   node tools/h3-dump.ts <file.h3c> --extract out/    # write the .h3m files out
//
// With no file it lists every campaign in the folder test-h3c.ts uses.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCampaign, mapData, mapFormat, playedScenarios } from '../src/h3c.ts';
import type { H3cBonus, H3cCampaign } from '../src/h3c.ts';

const BONUS_NAMES = ['spell', 'creature', 'building', 'artifact', 'spell scroll', 'primary skills', 'secondary skill', 'resource'];
const KEEPS = ['experience', 'primary skills', 'secondary skills', 'spells', 'artifacts'];
const DIFFICULTY = ['easy', 'normal', 'hard', 'expert', 'impossible'];

/** 0xFFFD..0xFFFF mark "the hero the player brings", not a hero by id. */
function heroRef(id: number): string {
  return id >= 0xfffd ? 'the carried hero' : `hero #${id}`;
}

function bonusText(b: H3cBonus): string {
  const kind = BONUS_NAMES[b.type] ?? `type ${b.type}`;
  switch (b.type) {
    case 0: return `${kind} #${b.info2} to ${heroRef(b.info1)}`;
    case 1: return `${kind} #${b.info2} ×${b.info3} to ${heroRef(b.info1)}`;
    case 2: return `${kind} #${b.info1}`;
    case 3: return `${kind} #${b.info2} to ${heroRef(b.info1)}`;
    case 4: return `${kind} of spell #${b.info2} to ${heroRef(b.info1)}`;
    case 5: return `${kind} 0x${b.info2.toString(16).padStart(8, '0')} to ${heroRef(b.info1)}`;
    case 6: return `${kind} #${b.info2} at level ${b.info3} to ${heroRef(b.info1)}`;
    // 0xFD and 0xFE are not resources but the two bundles the bonus screen offers.
    case 7: {
      const what = b.info1 === 0xfd ? 'wood & ore' : b.info1 === 0xfe ? 'mercury, sulfur, crystal & gems' : `resource #${b.info1}`;
      return `${what} ×${b.info2}`;
    }
    default: return kind;
  }
}

function keepsText(mask: number): string {
  const kept = KEEPS.filter((_, i) => mask & (1 << i));
  return kept.length ? kept.join(', ') : 'nothing';
}

function bits(mask: Uint8Array): number {
  let n = 0;
  for (const byte of mask) for (let i = 0; i < 8; i++) if (byte & (1 << i)) n++;
  return n;
}

function report(c: H3cCampaign, file: string): void {
  const played = playedScenarios(c);
  const empty = c.scenarios.length - played.length;
  console.log(`${c.name}`);
  console.log(`  file        ${file}`);
  console.log(`  format      v${c.version}  campaign id ${c.campaignId}  music ${c.musicId}`);
  console.log(`  difficulty  ${c.difficultyChosenByPlayer ? 'chosen by the player' : 'fixed'}`);
  console.log(`  regions     ${played.length} played${empty ? ` + ${empty} empty` : ''}`);
  console.log(`  ${c.description.replace(/\s+/g, ' ').slice(0, 300)}`);

  for (const [i, s] of c.scenarios.entries()) {
    if (s.mapName === '') continue;
    const map = mapData(c, i);
    const size = map.readUInt32LE(5);
    const twoLevel = map[9] === 1;
    console.log(`\n  ${played.indexOf(s) + 1}. ${s.mapName}`);
    console.log(`     map        ${mapFormat(c, i)} ${size}×${size}${twoLevel ? ' + underground' : ''}, ${s.mapSize} bytes`);
    console.log(`     region     colour ${s.regionColor}, ${DIFFICULTY[s.difficulty] ?? s.difficulty}, unlocked by mask 0x${s.prerequisites.toString(16)}`);
    if (s.declaredPackedSize !== s.mapSize) {
      console.log(`     (header claims ${s.declaredPackedSize} bytes — the gzipped size; the chunk here is raw)`);
    }
    if (s.regionText) console.log(`     brief      ${s.regionText.replace(/\s+/g, ' ').slice(0, 160)}`);
    if (s.prologue) console.log(`     prologue   video ${s.prologue.video}, music ${s.prologue.music}, ${s.prologue.text.length} chars`);
    if (s.epilogue) console.log(`     epilogue   video ${s.epilogue.video}, music ${s.epilogue.music}, ${s.epilogue.text.length} chars`);
    const t = s.travel;
    console.log(`     hero keeps ${keepsText(t.whatHeroKeeps)}` +
      ` · ${bits(t.monstersKept)} creature types · ${bits(t.artifactsKept)} artifacts`);
    if (t.startOptions === 1) {
      console.log(`     start      player ${t.playerColor} picks one of:`);
      for (const b of t.bonuses) console.log(`                  ${bonusText(b)}`);
    } else if (t.startOptions === 2) {
      console.log(`     start      hero carried from scenario(s) ${t.crossover.map((x) => x.scenario + 1).join(', ')}`);
    } else if (t.startOptions === 3) {
      console.log(`     start      given ${t.startingHeroes.map((x) => heroRef(x.hero)).join(', ')}`);
    }
  }
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const extractTo = args[args.indexOf('--extract') + 1];

if (!file) {
  const dir = process.env.H3_CAMPAIGNS ?? join(import.meta.dirname, '..', 'герои 3');
  if (!existsSync(dir)) { console.log(`no campaign folder at ${dir}`); process.exit(1); }
  for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.h3c')).sort()) {
    const c = readCampaign(readFileSync(join(dir, f)));
    console.log(`${String(playedScenarios(c).length).padStart(2)} maps  ${f}  —  ${c.name}`);
  }
  process.exit(0);
}

const campaign = readCampaign(readFileSync(file));

if (asJson) {
  console.log(JSON.stringify(campaign, (k, v) => {
    if (k === 'data') return undefined;
    if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
    return v;
  }, 2));
} else {
  report(campaign, file);
}

if (args.includes('--extract')) {
  const out = extractTo && !extractTo.startsWith('--') ? extractTo : '.';
  mkdirSync(out, { recursive: true });
  for (const [i, s] of campaign.scenarios.entries()) {
    if (s.mapName === '') continue;
    const to = join(out, s.mapName);
    writeFileSync(to, mapData(campaign, i));
    console.log(`\nwrote ${to} (${s.mapSize} bytes)`);
  }
}
