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
  /**
   * Where the game's own services are carried — `ws://host:port/u-lobby`, or `wss://…`.
   *
   * A second answer and not a second use of the first: the relay carries the
   * peers and this carries the lobby, they are two services and two features,
   * and either may be set while the other is not.
   */
  uLobby: string;
  /**
   * Which loopback port the lobby half listens on for the game — or 0, which
   * means the system picks a free one at bind and `getsockname` says which
   * (`native/net/lobby.c`). Zero is the ordinary answer: it is what lets any
   * number of copies run on one machine without a hand dealing the numbers
   * out. Naming one is for a capture filter that wants a stable number.
   *
   * Nothing else has to be told either way: the extension rewrites the one URL
   * the game fetches its server list from AFTER the bind, using the number the
   * bind settled on, so the two cannot disagree and there is no launcher
   * script to keep in step.
   */
  uLobbyPort: number;
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
  const out: NetSettings = { relay: '', uLobby: '', uLobbyPort: 0 };
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
    if (word === 'u-lobby') out.uLobby = value;
    if (word === 'u-lobby-port') {
      const port = Number(value);
      // A port that is not one is left at the default rather than carried: the C side
      // would refuse it too, and a listener on port 0 is a listener nobody can find.
      if (Number.isInteger(port) && port > 0 && port <= 0xffff) out.uLobbyPort = port;
    }
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
    '# Multiplayer, written by homm5-editor. Read by homm5-editor.dll.',
    '#',
    '# TWO FEATURES, TWO ANSWERS. They share this file and nothing else — either can',
    '# be set while the other is empty, and each has its own switch on the Network tab.',
    '#',
    '# relay      — where the PEERS are carried: ws://host:port/agent, or wss:// behind',
    '#              a tunnel. Read by native/net/agent.c.',
    '# u-lobby      — where UBISOFT\'S LOBBY is carried: ws://host:port/u-lobby, or wss://',
    '#              behind a tunnel. Read by native/net/lobby.c, which needs it because a',
    '#              tunnel carries HTTP and WebSocket while the u-lobby\'s own services are',
    '#              raw TCP and UDP.',
    '# u-lobby-port — OPTIONAL: the loopback port the lobby half listens on for the',
    '#              game. Left out, the system picks a free one at bind — any number',
    '#              of copies on one machine, no hand dealing the numbers. Name one',
    '#              only for a stable number to filter a capture by. Either way the',
    '#              extension points the game at it by rewriting the game\'s own',
    '#              server-list URL after the bind, so nothing can disagree.',
    '#',
    '# There is no secret here. The agent tells the relay which address and port this',
    '# game plays on, and the lobby decides whether that is anybody.',
    '',
    `relay ${net.relay.trim()}`,
    `u-lobby ${net.uLobby.trim()}`,
    ...(net.uLobbyPort ? [`u-lobby-port ${String(net.uLobbyPort)}`] : []),
    '',
  ];
  const path = netPath(gameRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

/**
 * Whether this install has been set up — what the panel says out loud.
 *
 * EITHER answer counts. The two halves are separate features and a copy that
 * carries only the u-lobby, or only its peers, is set up for what it was asked to
 * do; requiring both would call a working install unfinished.
 */
export function netReady(gameRoot: string): boolean {
  const net = readNet(gameRoot);
  return (!!net.relay || !!net.uLobby) && existsSync(netPath(gameRoot));
}
