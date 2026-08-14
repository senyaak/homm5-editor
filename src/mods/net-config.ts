// The two answers the multiplayer agent needs from this machine: which relay,
// and who this installation is.
//
// A file of its own, `bin/homm5-editor-net.txt`, beside the quality-of-life one
// and read by `native/net/relay.c`. Not lines in `homm5-editor-qol.txt`: that
// file is a list of names and 0/1, its reader in C knows nothing else, and
// docs/QOL.md is explicit that a setting which is not a switch gets its own
// home rather than being squeezed into the flags.
//
// THE SECRET IS A CREDENTIAL. It is issued once per installation by the lobby
// (`npm run issue-agent -- <name>` in the h5e-lobby repo) and it stands for the
// player, so it belongs in the install and nowhere else: not in the game's own
// settings, which the game and every mod can read, and not in this repository.
// Nothing in the editor logs it and the panel shows it as a password field.
//
// Exports:
//   NET_FILE, netPath(gameRoot)
//   readNet(gameRoot)              what the install currently says
//   writeNetFile(gameRoot, net)    write it, comments and all

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const NET_FILE = 'bin/homm5-editor-net.txt';

export interface NetSettings {
  /** `ws://host:port/agent`, or `wss://…` behind a tunnel. Empty means "not set up". */
  relay: string;
  /** What `issue-agent` printed for this player. Empty means the agent stays home. */
  secret: string;
}

export function netPath(gameRoot: string): string {
  return join(gameRoot, NET_FILE);
}

/**
 * What the install says, or empty strings.
 *
 * The same shape of reader as the C one next to it: `#` is a comment, a line is
 * a word and the rest of it, and anything unknown is ignored rather than
 * refused — a file somebody added a note to still works.
 */
export function readNet(gameRoot: string): NetSettings {
  const out: NetSettings = { relay: '', secret: '' };
  let text = '';
  try {
    text = readFileSync(netPath(gameRoot), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.search(/\s/);
    if (at < 0) continue;
    const word = trimmed.slice(0, at);
    const value = trimmed.slice(at + 1).trim();
    if (word === 'relay') out.relay = value;
    else if (word === 'secret') out.secret = value;
  }
  return out;
}

/**
 * Write both, whole, with the same explanation the panel gives.
 *
 * Written whether or not they are empty: a file with an empty relay says "this
 * install was set up and nobody filled it in", which is a different thing from
 * no file at all, and the C side treats them the same way — nothing is dialled.
 */
export function writeNetFile(gameRoot: string, net: NetSettings): string {
  const lines = [
    '# The multiplayer agent, written by homm5-editor.',
    '# Read by homm5-editor.dll when the game first talks to another player.',
    '#',
    '# relay  — our lobby relay: ws://host:port/agent, or wss:// behind a tunnel.',
    '# secret — issued once for this installation by the lobby; it stands for the',
    '#          player, and the game itself never sees it.',
    '',
    `relay ${net.relay.trim()}`,
    `secret ${net.secret.trim()}`,
    '',
  ];
  const path = netPath(gameRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

/** Whether this install has both halves — what the panel says out loud. */
export function netReady(gameRoot: string): boolean {
  const net = readNet(gameRoot);
  return !!net.relay && !!net.secret && existsSync(netPath(gameRoot));
}
