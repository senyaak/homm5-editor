// Our own online services for the game, at the stage where they only listen.
//
// The game decides where to play by fetching one URL (docs/NETWORK.md), and its
// libcurl 7.14 honours the `http_proxy` environment variable — so a game started
// with `http_proxy=http://127.0.0.1:8080` asks US for its server list, with no
// patch to the exe and no hosts file. We answer with an ini that points every
// service at this machine, then accept those connections and write down every
// byte the client sends.
//
// The NAT service answers for real (src/net/nat-service.ts) — it is the step the
// game refuses to start without. The router, CD-key and IRC ports still only
// record: there is no live Ubisoft service left to copy, so what the client says
// first is how each of them gets written. Run it, let the game reach the online
// menu, read the log.
//
//   node tools/net-server.ts [--host 127.0.0.1] [--http 8080]
//
// The log goes to _tmp/net/ as well as the console, in full — a truncated dump
// of an unknown protocol is worth nothing.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NatService } from '../src/net/nat-service.ts';
import { RouterService } from '../src/net/router-service.ts';
import { CdKeyService } from '../src/net/cdkey-service.ts';
import { IrcConnection, IrcService } from '../src/net/irc.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

/** The address the game will be told to connect to — itself, by default. */
const host = arg('host', '127.0.0.1');
const httpPort = Number(arg('http', '8080'));

/**
 * What the ini advertises. `launcher` is only read for Router and CDKeyServer
 * (`%sLauncherPort%i`); what it is for is not known yet.
 */
interface Service {
  prefix: string;
  port: number;
  launcher: number | null;
  kind: 'tcp' | 'tcp+udp';
}

const SERVICES: Service[] = [
  { prefix: 'Router', port: 40000, launcher: 40001, kind: 'tcp+udp' },
  { prefix: 'NATServer', port: 40010, launcher: null, kind: 'tcp+udp' },
  { prefix: 'CDKeyServer', port: 40020, launcher: 40021, kind: 'tcp+udp' },
  { prefix: 'IRC', port: 6667, launcher: null, kind: 'tcp' },
];

// Not in the ini: the client is told where this one lives when it asks for a
// module (PROXY_HANDLER). It is where persistent data and, later, the ladder sit.
const PROXY: Service = { prefix: 'Proxy', port: 40030, launcher: 40031, kind: 'tcp' };

// Also not in the ini: where the lobby itself lives, handed over when the client
// asks to join a lobby server.
const LOBBY: Service = { prefix: 'Lobby', port: 40040, launcher: null, kind: 'tcp' };

function serversIni(): string {
  const lines = ['[Servers]'];
  for (const s of SERVICES) {
    lines.push(`${s.prefix}IP0=${host}`, `${s.prefix}Port0=${s.port}`);
    if (s.launcher !== null) lines.push(`${s.prefix}LauncherPort0=${s.launcher}`);
  }
  // Windows' profile-string reader wants CRLF and a trailing newline.
  return `${lines.join('\r\n')}\r\n`;
}

const logDir = join(repo, '_tmp', 'net');
mkdirSync(logDir, { recursive: true });
const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, '-');
const logFile = createWriteStream(join(logDir, `session-${stamp}.log`));

function log(line: string): void {
  const at = new Date().toISOString().slice(11, 23);
  const text = `${at}  ${line}`;
  console.log(text);
  logFile.write(`${text}\n`);
}

/** Hex and text, 16 bytes to a line, however long the buffer is. */
function hexDump(buf: Buffer, indent = '    '): string {
  const out: string[] = [];
  for (let i = 0; i < buf.length; i += 16) {
    const slice = buf.subarray(i, i + 16);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const text = [...slice].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
    out.push(`${indent}${i.toString(16).padStart(4, '0')}  ${hex}  ${text}`);
  }
  return out.join('\n');
}

function serve(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

createHttpServer((req: IncomingMessage, res: ServerResponse) => {
  // As a proxy the game's curl sends an absolute URI; asked directly it sends a
  // path. Either way there is only one answer we have to give.
  log(`HTTP ${req.method} ${req.url}`);
  for (const [name, value] of Object.entries(req.headers)) log(`     ${name}: ${value}`);
  const ini = serversIni();
  log(`HTTP -> ${ini.length} bytes of servers ini\n${hexDump(Buffer.from(ini))}`);
  serve(res, ini);
}).listen(httpPort, () => log(`http on ${httpPort} — start the game with http_proxy=http://127.0.0.1:${httpPort}`));

let connections = 0;

// After the login the client asks where to go next. The launcher port we already
// advertise is the obvious place to send it, and it is ours either way.
const router = new RouterService(
  { address: host, port: SERVICES[0]!.launcher ?? SERVICES[0]!.port },
  { address: host, port: PROXY.port },
  { address: host, port: PROXY.launcher ?? PROXY.port },
  { address: host, port: LOBBY.port },
);

// Every key the player types is accepted; see src/net/cdkey-service.ts for why
// that is the honest answer rather than a shortcut.
const cdkey = new CdKeyService();

// Chat — and the reason a lobby channel can be entered at all: joining a lobby
// makes the client join an IRC channel. See src/net/irc.ts.
const irc = new IrcService();

/** Which socket carries which chat connection, so a line can be relayed on. */
const chatSockets = new Map<IrcConnection, Socket>();

for (const service of [...SERVICES, PROXY, LOBBY]) {
  for (const port of [service.port, service.launcher].filter((p): p is number => p !== null)) {
    const label = port === service.port ? service.prefix : `${service.prefix}Launcher`;

    createTcpServer((socket: Socket) => {
      const id = ++connections;
      const peer = `${socket.remoteAddress}:${socket.remotePort}`;
      log(`TCP  #${id} ${label}:${port} <- ${peer} connected`);
      // Four desks speak the GS protocol; the chat port speaks IRC in a wrapper.
      const session =
        label === 'Router' || label === 'RouterLauncher'
          ? router.session('router')
          : label === 'Proxy' || label === 'ProxyLauncher'
            ? router.session('proxy')
            : label === 'Lobby'
              ? router.session('lobby')
              : null;
      const chat = label === 'IRC' ? irc.connection() : null;
      if (chat) {
        chatSockets.set(chat, socket);
        socket.on('close', () => {
          chatSockets.delete(chat);
          irc.drop(chat);
        });
      }
      socket.on('data', (data: Buffer) => {
        log(`TCP  #${id} ${label}:${port} <- ${data.length} bytes\n${hexDump(data)}`);
        if (chat) {
          for (const event of chat.receive(data)) {
            log(`IRC  #${id} ${event.note}`);
            for (const answer of event.replies) socket.write(answer);
            // What one player says reaches whoever else is in that channel.
            for (const out of event.broadcast) {
              for (const other of irc.others(out.channel, chat)) chatSockets.get(other)?.write(out.line);
            }
          }
          return;
        }
        if (!session) return;
        let events;
        try {
          events = session.receive(data);
        } catch (err) {
          log(`TCP  #${id} ${label}:${port} !! ${(err as Error).message}`);
          return;
        }
        for (const event of events) {
          log(`RTR  #${id} ${event.note}`);
          for (const answer of event.replies) {
            socket.write(answer);
            log(`TCP  #${id} ${label}:${port} -> ${answer.length} bytes\n${hexDump(answer)}`);
          }
        }
      });
      socket.on('close', () => {
        const gone = session?.close();
        if (gone) log(`RTR  #${id} ${gone}`);
        log(`TCP  #${id} ${label}:${port} closed`);
      });
      socket.on('error', (err: Error) => log(`TCP  #${id} ${label}:${port} error: ${err.message}`));
    })
      .on('error', (err: Error) => log(`TCP  ${label}:${port} listen failed: ${err.message}`))
      .listen(port, () => log(`tcp  ${label} on ${port}`));

    if (service.kind === 'tcp+udp') {
      // Two of the UDP services answer: the NAT mirror and the CD-key desk. Each
      // keeps its own state, so the instance is made once per port, not per
      // datagram.
      const nat = label === 'NATServer' ? new NatService(port) : null;
      const service = nat
        ? { tag: 'NAT', handle: (data: Buffer, from: { address: string; port: number }) => nat.handle(data, from) }
        : label === 'CDKeyServer'
          ? { tag: 'KEY', handle: (data: Buffer, from: { address: string; port: number }) => cdkey.handle(data, from) }
          : null;
      const udp = createSocket('udp4');
      udp.on('message', (data: Buffer, from) => {
        log(`UDP  ${label}:${port} <- ${from.address}:${from.port}, ${data.length} bytes\n${hexDump(data)}`);
        if (!service) return;
        let result;
        try {
          result = service.handle(data, from);
        } catch (err) {
          log(`UDP  ${label}:${port} !! ${(err as Error).message}`);
          return;
        }
        log(`${service.tag}  ${result.note}`);
        for (const reply of result.replies) {
          udp.send(reply, from.port, from.address);
          log(`UDP  ${label}:${port} -> ${from.address}:${from.port}, ${reply.length} bytes\n${hexDump(reply)}`);
        }
        // Some answers go out a second time a moment later — see `againAfterMs`
        // in src/net/nat-service.ts for the race that makes that necessary.
        const again = (result as { againAfterMs?: number }).againAfterMs;
        if (again) {
          setTimeout(() => {
            for (const reply of result.replies) udp.send(reply, from.port, from.address);
            log(`UDP  ${label}:${port} -> ${from.address}:${from.port}, the same ${result.replies.length} answer(s) again`);
          }, again);
        }
      });
      udp.on('error', (err: Error) => log(`UDP  ${label}:${port} bind failed: ${err.message}`));
      udp.bind(port, () => log(`udp  ${label} on ${port}`));
    }
  }
}

log(`logging to ${join(logDir, `session-${stamp}.log`)}`);
log(`serving this list:\n${serversIni().replace(/\r\n/g, '\n')}`);
