// The one answer the multiplayer agent needs from this machine: which relay.
//
// A file of its own, `bin/homm5-editor-net.txt`, beside the quality-of-life one
// and read by `native/net/relay.c`. Not lines in `homm5-editor-qol.txt`: that
// file is a list of names and 0/1, its reader in C knows nothing else, and
// docs/QOL.md is explicit that a setting which is not a switch gets its own
// home rather than being squeezed into the flags.
//
// THERE IS NO CREDENTIAL HERE, and there used to be. A `secret` stood for the
// player, was issued once per installation by a command line, and was cut on
// 14.08.2026 because nobody outside this desk could ever have obtained one. The
// agent now says which address and port its game plays on, and the lobby is what
// decides whether anybody is playing there (h5e-lobby docs/ARCHITECTURE.md).
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
}

export function netPath(gameRoot: string): string {
  return join(gameRoot, NET_FILE);
}

/**
 * What the install says, or an empty string.
 *
 * The same shape of reader as the C one next to it: `#` is a comment, a line is
 * a word and the rest of it, and anything unknown is ignored rather than
 * refused — a file somebody added a note to still works, and so does one still
 * carrying the `secret` line nothing reads any more.
 */
export function readNet(gameRoot: string): NetSettings {
  const out: NetSettings = { relay: '' };
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
  }
  return out;
}

/**
 * Write it, whole, with the same explanation the panel gives.
 *
 * Written whether or not it is empty: a file with an empty relay says "this
 * install was set up and nobody filled it in", which is a different thing from
 * no file at all, and the C side treats them the same way — nothing is dialled.
 * A `secret` line an older editor left behind is dropped here, since this
 * rewrites the file rather than editing it.
 */
export function writeNetFile(gameRoot: string, net: NetSettings): string {
  const lines = [
    '# The multiplayer agent, written by homm5-editor.',
    '# Read by homm5-editor.dll when the game first talks to another player.',
    '#',
    '# relay — our lobby relay: ws://host:port/agent, or wss:// behind a tunnel.',
    '#',
    '# Nothing else belongs here. The agent tells the relay which address and port',
    '# this game plays on, and the lobby decides whether that is anybody — so there',
    '# is no secret to keep and nothing to issue.',
    '',
    `relay ${net.relay.trim()}`,
    '',
  ];
  const path = netPath(gameRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

/** Whether this install has been set up — what the panel says out loud. */
export function netReady(gameRoot: string): boolean {
  return !!readNet(gameRoot).relay && existsSync(netPath(gameRoot));
}
