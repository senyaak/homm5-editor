// Heroes III campaign container (.h3c) — reader.
//
// A .h3c is a single gzip stream. Inside: a campaign header, then every mission
// map stored back to back. The header describes each scenario — which map file,
// its region on the campaign screen, its prologue/epilogue, and the rules for
// what the player's hero carries into it.
//
// Two things here are not guessable and cost real debugging:
//
//   1. `packedMapSize` LIES in the files we have. The field is documented as the
//      byte length of the scenario's map chunk, and a reader is supposed to split
//      the tail by walking those lengths. In our set it holds the size the .h3m
//      had while gzipped, while the chunk stored is the RAW map — off by ~4x, and
//      there is not a single gzip member (1f 8b 08) anywhere in the tail. So we
//      split by scanning for .h3m signatures instead and only *report* the
//      declared size. See findMapOffsets().
//
//   2. The header must be parsed to its last byte to find where map data starts,
//      and the variable-length part is the travel options (bitmasks whose width
//      depends on the campaign version, plus a start-bonus list whose payload
//      differs per bonus type). That makes the header parse self-checking: it has
//      to land exactly on the first map offset found by scanning. tools/test-h3c.ts
//      asserts that over every campaign, which is what keeps this file honest.
//
// Strings are cp1252 in the originals; we read them as latin1 (byte-transparent)
// and leave any transcoding to whoever renders them.

import { gunzipSync } from 'node:zlib';

/** Campaign format versions we have seen. RoE = 4, AB/SoD = 5, WoG/repacks = 6. */
export type H3cVersion = 4 | 5 | 6;

/** A prologue or epilogue: a video, a track, and the narration text. */
export interface H3cCutscene {
  video: number;
  music: number;
  text: string;
}

/** One start bonus offered on a scenario's start-options screen. */
export interface H3cBonus {
  type: number;
  info1: number;
  info2: number;
  info3: number;
}

/** What a hero carries in, and how the player starts the scenario. */
export interface H3cTravel {
  /** Bitmask: 1 experience, 2 primary skills, 4 secondary skills, 8 spells, 16 artifacts. */
  whatHeroKeeps: number;
  /** Creature-by-id bitmask (19 bytes) of stacks the hero keeps. */
  monstersKept: Uint8Array;
  /** Artifact-by-id bitmask of items the hero keeps. */
  artifactsKept: Uint8Array;
  /** 0 none, 1 pick a start bonus, 2 hero crossover, 3 hero from a past scenario. */
  startOptions: number;
  /** Player the options apply to — only meaningful when startOptions is 1. */
  playerColor: number;
  bonuses: H3cBonus[];
  /** startOptions 2: which past scenarios a hero may be taken from, per player. */
  crossover: { player: number; scenario: number }[];
  /** startOptions 3: the hero handed to each player. */
  startingHeroes: { player: number; hero: number }[];
}

export interface H3cScenario {
  /**
   * The map's file name as the campaign refers to it, e.g. "gelu1.h3m". Empty
   * for an unused region slot — a campaign always writes every slot its region
   * layout has, and the spare ones are 55-byte records with no map.
   */
  mapName: string;
  /** The header's own size claim. Unreliable — see the note at the top. */
  declaredPackedSize: number;
  /**
   * Bitmask of scenarios that must be beaten before this one unlocks — one bit
   * per region, so a campaign with more than 8 of them widens the field to two
   * bytes. See readCampaign() on how that is detected.
   */
  prerequisites: number;
  /** Region colour on the campaign map. */
  regionColor: number;
  difficulty: number;
  /** The blurb shown when the region is highlighted. */
  regionText: string;
  prologue: H3cCutscene | null;
  epilogue: H3cCutscene | null;
  travel: H3cTravel;
  /** Where the map's bytes actually start, in the decompressed container. */
  mapOffset: number;
  /** How many bytes they actually occupy. */
  mapSize: number;
}

export interface H3cCampaign {
  version: H3cVersion;
  /** Index into the game's campaign table — picks the campaign-screen artwork. */
  campaignId: number;
  name: string;
  description: string;
  /** Whether the player may choose the difficulty. Absent in RoE campaigns. */
  difficultyChosenByPlayer: boolean;
  musicId: number;
  scenarios: H3cScenario[];
  /** The decompressed container, so map chunks can be sliced out of it. */
  data: Buffer;
}

/** Sequential little-endian reader over a decompressed container. */
class Reader {
  at = 0;
  buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  u8(): number {
    return this.buf[this.at++]!;
  }
  u16(): number {
    const v = this.buf.readUInt16LE(this.at);
    this.at += 2;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.at);
    this.at += 4;
    return v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  bytes(n: number): Uint8Array {
    const v = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return new Uint8Array(v);
  }
  /** A length-prefixed string. cp1252 on disk; kept byte-transparent as latin1. */
  str(): string {
    const len = this.u32();
    if (len > this.buf.length - this.at) throw new Error(`string length ${len} runs past the end at ${this.at}`);
    const s = this.buf.toString('latin1', this.at, this.at + len);
    this.at += len;
    return s;
  }
}

/** Map-format versions a .h3m header may declare, by name. */
const H3M_VERSIONS: Record<number, string> = {
  14: 'RoE', 21: 'AB', 28: 'SoD', 29: 'CHR', 32: 'HotA', 51: 'WoG',
};

/** The only square map sizes Heroes III has. */
const H3M_SIZES = [36, 72, 108, 144];

/**
 * Every offset in `buf` that begins a .h3m. A map header opens with the format
 * version, a 0/1 "any players" flag, the square size and a 0/1 two-level flag —
 * ten bytes that no other data in a container happens to imitate, which is why
 * this is a sound way to split a tail whose declared lengths cannot be trusted.
 */
export function findMapOffsets(buf: Buffer, from = 0): number[] {
  const found: number[] = [];
  for (let i = from; i <= buf.length - 10; i++) {
    if (!H3M_VERSIONS[buf.readUInt32LE(i)]) continue;
    if (buf[i + 4]! > 1 || buf[i + 9]! > 1) continue;
    if (!H3M_SIZES.includes(buf.readUInt32LE(i + 5))) continue;
    found.push(i);
  }
  return found;
}

/**
 * Width of the "artifacts the hero keeps" bitmask, which grew with each release
 * as artifacts were added: RoE 16 bytes, AB 17, SoD 18. This is the field that
 * makes a v5 campaign unreadable by a v6 parser and vice versa.
 */
function artifactBytes(version: number): number {
  if (version <= 4) return 16;
  return version === 5 ? 17 : 18;
}

function readCutscene(r: Reader): H3cCutscene | null {
  if (!r.bool()) return null;
  const video = r.u8();
  const music = r.u8();
  return { video, music, text: r.str() };
}

/**
 * The start-bonus payload. Every field width differs per type and getting one
 * wrong desynchronizes the whole header — which the offset check catches.
 *
 * The trap: the hero a bonus is attached to is a **word**, not a byte (0xFFFF
 * meaning "whoever the player starts with"). Reading it as a byte parses the
 * first bonus of Elixir of Life as garbage instead of Gelu's Grand Elves.
 */
function readBonus(r: Reader): H3cBonus {
  const type = r.u8();
  switch (type) {
    case 0: // spell: hero, spell
      return { type, info1: r.u16(), info2: r.u8(), info3: 0 };
    case 1: // creature: hero, creature, amount
      return { type, info1: r.u16(), info2: r.u16(), info3: r.u16() };
    case 2: // building
      return { type, info1: r.u8(), info2: 0, info3: 0 };
    case 3: // artifact: hero, artifact
      return { type, info1: r.u16(), info2: r.u16(), info3: 0 };
    case 4: // spell scroll: hero, then the SPELL as one byte — not an artifact id
      return { type, info1: r.u16(), info2: r.u8(), info3: 0 };
    case 5: // primary skills: hero, then attack/defence/power/knowledge
      return { type, info1: r.u16(), info2: r.u32(), info3: 0 };
    case 6: // secondary skill: hero, skill, level
      return { type, info1: r.u16(), info2: r.u8(), info3: r.u8() };
    case 7: // resource: type, amount
      return { type, info1: r.u8(), info2: r.u32(), info3: 0 };
    default:
      throw new Error(`unknown start-bonus type ${type} at ${r.at - 1}`);
  }
}

function readTravel(r: Reader, version: number): H3cTravel {
  const whatHeroKeeps = r.u8();
  const monstersKept = r.bytes(19);
  const artifactsKept = r.bytes(artifactBytes(version));
  const startOptions = r.u8();

  const travel: H3cTravel = {
    whatHeroKeeps, monstersKept, artifactsKept, startOptions,
    playerColor: 0xff, bonuses: [], crossover: [], startingHeroes: [],
  };

  // 0 and 0xFF both mean "nothing to choose"; the originals use either.
  if (startOptions === 0 || startOptions === 0xff) return travel;
  if (startOptions === 1) {
    travel.playerColor = r.u8();
    const count = r.u8();
    for (let i = 0; i < count; i++) travel.bonuses.push(readBonus(r));
    return travel;
  }
  if (startOptions === 2) {
    const count = r.u8();
    for (let i = 0; i < count; i++) travel.crossover.push({ player: r.u8(), scenario: r.u8() });
    return travel;
  }
  if (startOptions === 3) {
    const count = r.u8();
    for (let i = 0; i < count; i++) travel.startingHeroes.push({ player: r.u8(), hero: r.u16() });
    return travel;
  }
  throw new Error(`unknown startOptions ${startOptions} at ${r.at - 1}`);
}

/** Reads the scenario table, given a guess about the prerequisite field width. */
function readScenarios(r: Reader, version: number, until: number, widePrerequisites: boolean): H3cScenario[] {
  const scenarios: H3cScenario[] = [];
  while (r.at < until) {
    const mapName = r.str();
    const declaredPackedSize = r.u32();
    const prerequisites = widePrerequisites ? r.u16() : r.u8();
    const regionColor = r.u8();
    const difficulty = r.u8();
    if (difficulty > 4) throw new Error(`difficulty ${difficulty} at ${r.at - 1}`);
    const regionText = r.str();
    const prologue = readCutscene(r);
    const epilogue = readCutscene(r);
    const travel = readTravel(r, version);
    scenarios.push({
      mapName, declaredPackedSize, prerequisites, regionColor, difficulty, regionText,
      prologue, epilogue, travel, mapOffset: -1, mapSize: -1,
    });
  }
  if (r.at !== until) throw new Error(`scenario table ended at ${r.at}, map data starts at ${until}`);
  return scenarios;
}

/**
 * Read a .h3c. `raw` is the file as it sits on disk (still gzipped).
 *
 * The scenario count is not stored — the game derives it from a table keyed by
 * campaignId, and that table also tells it how wide the prerequisite bitmask is.
 * We have neither, and do not need them: map data begins at the first .h3m
 * signature, so we read scenarios until the cursor reaches it. Landing exactly
 * there validates every field width on the way, and a campaign with more than
 * eight regions (Unholy Alliance is the one) only fails on the 1-byte guess, so
 * trying the 2-byte one after it converges without any campaign table at all.
 */
export function readCampaign(raw: Buffer): H3cCampaign {
  const data = gunzipSync(raw);
  const r = new Reader(data);

  const version = r.u32() as H3cVersion;
  if (version < 4 || version > 6) throw new Error(`unsupported campaign version ${version}`);
  const campaignId = r.u8();
  const name = r.str();
  const description = r.str();
  const difficultyChosenByPlayer = version > 4 ? r.bool() : false;
  const musicId = r.u8();

  const offsets = findMapOffsets(data, r.at);
  if (!offsets.length) throw new Error('no .h3m found in the container');
  const firstMap = offsets[0]!;
  const tableAt = r.at;

  let scenarios: H3cScenario[];
  try {
    scenarios = readScenarios(r, version, firstMap, false);
  } catch (narrow) {
    r.at = tableAt;
    try {
      scenarios = readScenarios(r, version, firstMap, true);
    } catch {
      // Report the plain case; the wide retry only exists for >8-region campaigns.
      throw narrow;
    }
  }

  // Only regions that name a map own one, and those are stored back to back in
  // region order — so each map runs up to the start of the next.
  const played = scenarios.filter((s) => s.mapName !== '');
  if (offsets.length !== played.length) {
    throw new Error(`${played.length} scenarios with a map but ${offsets.length} maps in the container`);
  }
  played.forEach((s, i) => {
    s.mapOffset = offsets[i]!;
    s.mapSize = (i + 1 < offsets.length ? offsets[i + 1]! : data.length) - offsets[i]!;
  });

  return { version, campaignId, name, description, difficultyChosenByPlayer, musicId, scenarios, data };
}

/** The regions that actually play a map, in campaign order. */
export function playedScenarios(campaign: H3cCampaign): H3cScenario[] {
  return campaign.scenarios.filter((s) => s.mapName !== '');
}

/** The raw .h3m bytes of one scenario, sliced out of the container. */
export function mapData(campaign: H3cCampaign, index: number): Buffer {
  const s = campaign.scenarios[index];
  if (!s) throw new Error(`no scenario ${index}`);
  if (s.mapOffset < 0) throw new Error(`scenario ${index} is an empty region slot`);
  return campaign.data.subarray(s.mapOffset, s.mapOffset + s.mapSize);
}

/** The map-format name a scenario's chunk declares, e.g. "SoD". */
export function mapFormat(campaign: H3cCampaign, index: number): string {
  const version = mapData(campaign, index).readUInt32LE(0);
  return H3M_VERSIONS[version] ?? `unknown(${version})`;
}
