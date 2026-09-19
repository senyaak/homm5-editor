// The town screen's centre button for a building of ours.
//
// The left jog-dial of the town screen has one big button in the middle,
// `EnterSpecial` (`UI/TownScreen/Special.(WindowMSButton).xdb`), and every
// shipped town uses it for its own special building. Its skin is
// `ButtonStates[town ordinal]` — eight items, one per town, each with its OWN
// click commands — over eight `VisualStates` of the shared document; the
// engine sets the state from the town's type and enables the button by
// whether the town's building stands (docs/engineInternals/FACTIONS.md, "The
// centre button"). A type past the eight gets nothing: no skin, no building,
// the handler's switch falls through.
//
// So a faction's button is three things, and this file is the data two:
//
// - a NINTH item in both lists (one per faction with a button): the skin
//   drawn from the faction's theme (faction-icons.ts), and a click that sends
//   OUR message — `enter_own`, a `ARSendGameMessage` of our own beside the
//   engine's — since the item's commands are the item's;
// - a row in `bin/homm5-editor-buildings.txt` naming the type, the building
//   the button stands for, the item's index and the map function the click
//   calls: `native/faction/town-button.c` registers the message on the town
//   screen, enables the button the engine's own way and says
//   `<function>("<town's script name>")` to the map's Lua.
//
// Both documents are the game's, shared by every town, so the faction mod
// carries a copy of each with the items appended — the same standing as the
// build grid's `UIGameRoot` ([[homm5-editor-mod-is-global]]). The shipped
// eight are never touched: the state the DLL sets is the index the data
// appended at, and the two are written together here so they cannot drift.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Image } from '../format/dds.ts';
import { SCRIPT_DIR } from './artifact-scripts.ts';
import { textureFiles } from './faction-icons.ts';
import type { ModFile } from './mod-files.ts';
import { EOL, insertBeforeLine, once } from './xml-edit.ts';

/** The button and its shared look, as the game ships them. */
export const SPECIAL_BUTTON = 'UI/TownScreen/Special.(WindowMSButton).xdb';
export const SPECIAL_BUTTON_SHARED = 'UI/TownScreen/Special.(WindowMSButtonShared).xdb';
/** How many `ButtonStates`/`VisualStates` the shipped documents hold: one per town. */
export const SHIPPED_BUTTON_STATES = 8;
/** The message a click of ours sends — what the DLL registers a handler for. */
export const OWN_MESSAGE = 'enter_own';
/** Our two reaction documents beside the engine's, in the same folder. */
export const OWN_MESSAGE_FILE = 'UI/TownScreen/Own.(ARSendGameMessage).xdb';
export const OWN_REACTION_FILE = 'UI/TownScreen/Own.(UISDirectRunReaction).xdb';
/** Beside `H5_Game_H5E.exe` and the extension, relative to the game root. */
export const BUILDINGS_FILE = join('bin', 'homm5-editor-buildings.txt');

/**
 * `ETownBuilding` as the executable has it — the number the DLL asks the
 * town about (`GetBuildingLevel(n)`). Fixed in the engine, so fixed here;
 * tools/test-town-buildings.ts checks it against types.xml.
 */
export const TOWN_BUILDINGS: readonly string[] = [
  'TB_TOWN_HALL', 'TB_FORT', 'TB_MARKETPLACE', 'TB_SHIPYARD', 'TB_TAVERN', 'TB_BLACKSMITH', 'TB_MAGIC_GUILD',
  'TB_DWELLING_1', 'TB_DWELLING_2', 'TB_DWELLING_3', 'TB_DWELLING_4', 'TB_DWELLING_5', 'TB_DWELLING_6', 'TB_DWELLING_7',
  'TB_GRAIL', 'TB_WONDER',
  'TB_SPECIAL_0', 'TB_SPECIAL_1', 'TB_SPECIAL_2', 'TB_SPECIAL_3', 'TB_SPECIAL_4',
  'TB_SPECIAL_5', 'TB_SPECIAL_6', 'TB_SPECIAL_7', 'TB_SPECIAL_8', 'TB_SPECIAL_9',
];

export function buildingOrdinal(type: string): number {
  const i = TOWN_BUILDINGS.indexOf(type);
  if (i < 0) throw new Error(`${type} is not an ETownBuilding`);
  return i;
}

/** What a faction hands over: its type, the building, the map function, and the three skins. */
export interface TownButton {
  /** The `TownType` ordinal, out of types.xml. */
  town: number;
  /** `TB_*` — the building the button stands for. */
  building: string;
  /** The map function the click calls with the town's script name. */
  lua: string;
  /** The three pictures, 82×82. */
  skins: { normal: Image; pushed: Image; disabled: Image };
  /** Where the pictures go inside the mod: `<dir>/special_normal.xdb` and so on. */
  dir: string;
}

/** The two reaction documents: a click of the appended state sends `enter_own`. */
export function ownMessageFiles(): ModFile[] {
  const message = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ARSendGameMessage ObjectRecordID="1000201">',
    '\t<ClassTypeID>352859136</ClassTypeID>',
    `\t<EventName>${OWN_MESSAGE}</EventName>`,
    '\t<IntParam>0</IntParam>',
    '</ARSendGameMessage>',
    '',
  ];
  const reaction = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<UISDirectRunReaction ObjectRecordID="1000203">',
    '\t<ClassTypeID>554457792</ClassTypeID>',
    '\t<SUIStateBaseFakeField>0</SUIStateBaseFakeField>',
    '\t<ReactionForward href="Own.(ARSendGameMessage).xdb#xpointer(/ARSendGameMessage)"/>',
    '\t<ReactionBackward/>',
    '</UISDirectRunReaction>',
    '',
  ];
  return [
    { path: OWN_MESSAGE_FILE, data: Buffer.from(message.join(EOL), 'latin1') },
    { path: OWN_REACTION_FILE, data: Buffer.from(reaction.join(EOL), 'latin1') },
  ];
}

/** A `BackgroundSimpleTexture` naming a texture of ours, as the shipped skins are. */
function backgroundDoc(textureHref: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<BackgroundSimpleTexture ObjectRecordID="1001728">',
    '\t<ClassTypeID>285694785</ClassTypeID>',
    `\t<Texture href="${textureHref}"/>`,
    '\t<Color>-1</Color>',
    '\t<TextureX>EPA_LOW_END</TextureX>',
    '\t<TextureY>EPA_LOW_END</TextureY>',
    '</BackgroundSimpleTexture>',
    '',
  ].join(EOL);
}

/** The skin's three pictures and their documents; returns the hrefs a VisualState names. */
function skinFiles(b: TownButton): { files: ModFile[]; hrefs: Record<'normal' | 'pushed' | 'disabled', string> } {
  const files: ModFile[] = [];
  const hrefs = {} as Record<'normal' | 'pushed' | 'disabled', string>;
  for (const state of ['normal', 'pushed', 'disabled'] as const) {
    const texture = `${b.dir}/special_${state}.xdb`;
    files.push(...textureFiles(texture, b.skins[state]));
    const background = `${b.dir}/special_${state}.(BackgroundSimpleTexture).xdb`;
    files.push({ path: background, data: Buffer.from(backgroundDoc(`/${texture}#xpointer(/Texture)`), 'latin1') });
    hrefs[state] = `/${background}#xpointer(/BackgroundSimpleTexture)`;
  }
  return { files, hrefs };
}

const commands = (href: string): string[] => [
  '<Commands>',
  `\t<Item href="${href}"/>`,
  '</Commands>',
  '<Reversable>false</Reversable>',
];
const noCommands = ['<Commands/>', '<Reversable>false</Reversable>'];
const indent = (lines: string[], by: string): string[] => lines.map((l) => by + l);

/** One `ButtonStates` item whose click runs our reaction. */
function buttonStateItem(): string[] {
  const reaction = 'Own.(UISDirectRunReaction).xdb#xpointer(/UISDirectRunReaction)';
  return [
    '<Item>',
    '\t<MessageOnEnterState/>',
    '\t<CommandsOnEnterState>', ...indent(commands(reaction), '\t\t'), '\t</CommandsOnEnterState>',
    '\t<CommandsOnRightClick>', ...indent(noCommands, '\t\t'), '\t</CommandsOnRightClick>',
    '\t<commandsOnLDblKlick>', ...indent(noCommands, '\t\t'), '\t</commandsOnLDblKlick>',
    '\t<WaitVisual>false</WaitVisual>',
    '\t<ReverseCommands>false</ReverseCommands>',
    '\t<Name/>',
    '</Item>',
  ];
}

/** One `VisualStates` item: the three skins, the dial's big highlight on hover. */
function visualStateItem(hrefs: Record<'normal' | 'pushed' | 'disabled', string>): string[] {
  const sub = (name: string, background: string, foreground = ''): string[] => [
    `<${name}>`,
    `\t<Background href="${background}"/>`,
    foreground ? `\t<Foreground href="${foreground}"/>` : '\t<Foreground/>',
    '\t<TextString/>',
    '\t<OnEnterSubState>', ...indent(noCommands, '\t\t'), '\t</OnEnterSubState>',
    '\t<TextFormat/>',
    `</${name}>`,
  ];
  const highlight = '/UI/Common/JogDial/HilightBig.(BackgroundSimpleTexture).xdb#xpointer(/BackgroundSimpleTexture)';
  return [
    '<Item>',
    ...indent(sub('Normal', hrefs.normal), '\t'),
    ...indent(sub('MouseOver', hrefs.normal, highlight), '\t'),
    ...indent(sub('Pushed', hrefs.pushed), '\t'),
    ...indent(sub('Disabled', hrefs.disabled), '\t'),
    '\t<RightButtonDown>',
    '\t\t<Background/>', '\t\t<Foreground/>', '\t\t<TextString/>',
    '\t\t<OnEnterSubState>', ...indent(noCommands, '\t\t\t'), '\t\t</OnEnterSubState>',
    '\t\t<TextFormat/>',
    '\t</RightButtonDown>',
    '\t<DefaultSubState>BST_NORMAL</DefaultSubState>',
    '\t<VisualOnEnterState>', ...indent(noCommands, '\t\t'), '\t</VisualOnEnterState>',
    '</Item>',
  ];
}

/** How many items a list holds — by the tag every item of it carries once. */
function stateCount(text: string, tag: string): number {
  return text.split(tag).length - 1;
}

/** A row of the buildings file. */
export interface TownButtonRow {
  town: number;
  building: number;
  state: number;
  lua: string;
}

/**
 * The shipped button and its shared look with one item per faction appended
 * to each, the skins' files, and the rows the DLL reads — the state of each
 * row being the index its items were appended at.
 */
export function addTownButtons(button: string, shared: string, buttons: readonly TownButton[]): {
  button: string; shared: string; files: ModFile[]; rows: TownButtonRow[];
} {
  const have = stateCount(button, '<MessageOnEnterState/>');
  if (have !== SHIPPED_BUTTON_STATES) throw new Error(`${SPECIAL_BUTTON} holds ${have} button states, not the shipped ${SHIPPED_BUTTON_STATES}`);
  const haveShared = stateCount(shared, '<DefaultSubState>');
  if (haveShared !== SHIPPED_BUTTON_STATES) throw new Error(`${SPECIAL_BUTTON_SHARED} holds ${haveShared} visual states, not the shipped ${SHIPPED_BUTTON_STATES}`);
  const files: ModFile[] = ownMessageFiles();
  const rows: TownButtonRow[] = [];
  let b = button, s = shared;
  buttons.forEach((tb, i) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tb.lua)) throw new Error(`${tb.lua} is not a Lua function name`);
    const skin = skinFiles(tb);
    files.push(...skin.files);
    b = insertBeforeLine(b, once(b, '</ButtonStates>', 'button states'), buttonStateItem());
    s = insertBeforeLine(s, once(s, '</VisualStates>', 'visual states'), visualStateItem(skin.hrefs));
    rows.push({ town: tb.town, building: buildingOrdinal(tb.building), state: SHIPPED_BUTTON_STATES + i, lua: tb.lua });
  });
  return { button: b, shared: s, files, rows };
}

/**
 * The buildings file's text: the centre button's rows, and the rows that say
 * what a building of ours does (town-features.ts, `featureLines`).
 */
export function buildingsFileText(rows: readonly TownButtonRow[], features: readonly string[] = []): string {
  const lines = [
    '# A faction\'s buildings. Written by the editor; read by homm5-editor.dll.',
    '#   button <townType> <buildingType> <state> <luaFunction>   the town screen\'s centre button',
    '#   feature <townType> <buildingType> <minLevel> <feature>   the effect a building grants',
  ];
  for (const r of rows) lines.push(`button ${r.town} ${r.building} ${r.state} ${r.lua}`);
  for (const f of features) {
    if (!/^feature \d+ \d+ \d+ \d+$/.test(f)) throw new Error(`not a feature row: ${f}`);
    lines.push(f);
  }
  return lines.join('\n') + '\n';
}

/** Write it beside the executable and say where. Always whole: a stale row would keep a button after its faction is gone. */
export function writeBuildingsFile(gameRoot: string, rows: readonly TownButtonRow[], features: readonly string[] = []): string {
  const path = join(gameRoot, BUILDINGS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildingsFileText(rows, features), 'latin1');
  return path;
}

// --- the faction's Lua, on every map -----------------------------------------
//
// The button names a function; the function has to EXIST on every map the
// faction can be played on, not on one map's script — a map with a town of
// ours and no `BonePit` prints "Value was NIL" at every click. So the
// faction's map-side Lua is a file of the mod's, loaded by the one global
// script the game runs at every map's start (`scripts/advmap-common.lua`,
// see artifact-scripts.ts — a `doFile` line per file of ours), and it begins
// with the call that lets the extension reach the map from a click.

/** Where a faction's map-side script goes inside the mod. */
export const factionScriptPath = (file: string): string => `${SCRIPT_DIR}/faction-${file}.lua`;

/**
 * The faction's script file: the extension's prelude, then the author's Lua
 * verbatim — where the button's function is defined.
 */
export function factionScriptFile(file: string, lua: string, type?: { name: string; number: number }): ModFile {
  const text = [
    `-- ${file}: the faction's adventure-map Lua, loaded on every map by advmap-common.lua.`,
    '-- The map introduces itself to the extension, so a click on the town',
    "-- screen's centre button can reach the map's Lua (native/faction/town-button.c).",
    'H5ETownButtons();',
    // The game's Lua numbers towns from zero — advmap-startup.lua's
    // TOWN_HEAVEN = 0 … TOWN_STRONGHOLD = 7 — and GetTownRace (0x5FE540)
    // answers the type less three (0xB4E720). Ours by the same rule, under
    // the same name, so a script compares `GetTownRace(town) == TOWN_TEST`
    // the way it does for a shipped one.
    ...(type ? [`${type.name} = ${type.number - 3};`] : []),
    '',
    ...lua.split(/\r?\n/),
    '',
  ];
  return { path: factionScriptPath(file), data: Buffer.from(text.join('\n'), 'latin1') };
}

/** The line the global script loads it with — what `patchCommonScript`'s `extra` takes is the path. */
export const factionScriptLoadLine = (file: string): string => `doFile("/${factionScriptPath(file)}");`;
