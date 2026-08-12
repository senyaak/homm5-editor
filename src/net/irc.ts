// Chat: real IRC, in a wrapper.
//
// The game opens a TCP connection to the IRC service at startup and speaks
// ordinary IRC on it — NICK, USER, JOIN, PRIVMSG — except that every line is
// wrapped: a big-endian u16 length, then the line Blowfish-encrypted with a key
// that is the same in every copy of the game (below). Several wrapped lines can
// arrive in one read.
//
// Why this matters beyond chat: entering a lobby channel DEPENDS on it. After the
// lobby says "you are in", the client joins an IRC channel and only then asks for
// its NAT address (`NUbi::CStateWaitJoinLobbyReply::ProcessJoinLobbyReply`, which
// logs "IRC join channel succeeded" / "failed" right there). A silent chat server
// stops the channel screen, which is exactly what it did.
//
// What we implement is the minimum an ircd must say for a client to believe it is
// connected: the welcome numerics, an echo of its own JOIN with a member list, and
// PING/PONG. Everything a player types goes to whoever else is in the channel.
//
// Exports:
//   IRC_KEY, frame(line), unframe(buf)     the wrapper
//   IrcService                             new(); connection() -> handle(buf)

import { Blowfish } from './blowfish.ts';

/** Not a secret: it is compiled into the game. */
export const IRC_KEY = new Uint8Array([
  0x06, 0xe2, 0xc8, 0x46, 0x01, 0x90, 0x55, 0x7c, 0x3c, 0xa1, 0xcd, 0xa3, 0xe3, 0xa1, 0x10, 0x6c,
]);

const cipher = new Blowfish(IRC_KEY);

/** One IRC line, wrapped the way the client expects to read it. */
export function frame(line: string): Buffer {
  const body = cipher.encrypt(Buffer.from(`${line}\r\n`, 'latin1'));
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  body.copy(out, 2);
  return out;
}

/**
 * Every whole wrapped line in `buf`, and whatever is left over.
 *
 * A read can carry a bundle, and it can also cut the last line in half — the
 * remainder goes back on the buffer rather than being guessed at.
 */
export function unframe(buf: Buffer): { lines: string[]; rest: Buffer } {
  const lines: string[] = [];
  let at = 0;
  while (at + 2 <= buf.length) {
    const size = buf.readUInt16BE(at);
    if (size === 0 || at + 2 + size > buf.length) break;
    const text = cipher.decrypt(buf.subarray(at + 2, at + 2 + size)).toString('latin1');
    for (const line of text.split(/\r?\n/)) if (line) lines.push(line);
    at += 2 + size;
  }
  return { lines, rest: buf.subarray(at) };
}

const SERVER = 'homm5.local';

export interface IrcEvent {
  note: string;
  /** Lines for this client. */
  replies: Buffer[];
  /** Lines for everyone else in a channel: [channel, line]. */
  broadcast: Array<{ channel: string; line: Buffer }>;
}

export class IrcConnection {
  nick = '';
  readonly channels = new Set<string>();
  private buffer = Buffer.alloc(0);

  receive(chunk: Buffer): IrcEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { lines, rest } = unframe(this.buffer);
    this.buffer = Buffer.from(rest);
    return lines.map((line) => this.handle(line));
  }

  private handle(line: string): IrcEvent {
    const [word, ...rest] = line.split(' ');
    const command = (word ?? '').toUpperCase();
    const event: IrcEvent = { note: `IRC <- ${line}`, replies: [], broadcast: [] };

    switch (command) {
      case 'NICK': {
        this.nick = (rest[0] ?? '').replace(/^:/, '');
        // The welcome numerics. A client that does not get 001 waits forever.
        event.replies.push(
          frame(`:${SERVER} 001 ${this.nick} :Welcome to the Heroes lobby, ${this.nick}`),
          frame(`:${SERVER} 002 ${this.nick} :Your host is ${SERVER}`),
          frame(`:${SERVER} 003 ${this.nick} :This server is ours`),
          frame(`:${SERVER} 004 ${this.nick} ${SERVER} homm5-editor o o`),
        );
        event.note = `IRC nick "${this.nick}" — welcomed`;
        break;
      }
      case 'USER':
        // The client sends it right after NICK; the welcome has already gone out.
        event.note = `IRC user ${rest.join(' ')}`;
        break;
      case 'JOIN': {
        const channel = rest[0] ?? '';
        if (channel) {
          this.channels.add(channel);
          event.replies.push(
            frame(`:${this.nick} JOIN ${channel}`),
            frame(`:${SERVER} 353 ${this.nick} = ${channel} :${this.nick}`),
            frame(`:${SERVER} 366 ${this.nick} ${channel} :End of /NAMES list`),
          );
          event.broadcast.push({ channel, line: frame(`:${this.nick} JOIN ${channel}`) });
          event.note = `IRC ${this.nick} joined ${channel}`;
        }
        break;
      }
      case 'PART': {
        const channel = rest[0] ?? '';
        this.channels.delete(channel);
        event.replies.push(frame(`:${this.nick} PART ${channel}`));
        event.broadcast.push({ channel, line: frame(`:${this.nick} PART ${channel}`) });
        event.note = `IRC ${this.nick} left ${channel}`;
        break;
      }
      case 'PING':
        event.replies.push(frame(`:${SERVER} PONG ${SERVER} :${rest.join(' ').replace(/^:/, '')}`));
        event.note = 'IRC ping';
        break;
      case 'PRIVMSG': {
        const target = rest[0] ?? '';
        const text = rest.slice(1).join(' ');
        const said = frame(`:${this.nick} PRIVMSG ${target} ${text}`);
        if (target.startsWith('#')) event.broadcast.push({ channel: target, line: said });
        event.note = `IRC ${this.nick} -> ${target}: ${text.replace(/^:/, '')}`;
        break;
      }
      case 'QUIT':
        event.note = `IRC ${this.nick} quit`;
        break;
      default:
        event.note = `IRC unhandled: ${line}`;
        break;
    }
    return event;
  }
}

export class IrcService {
  private readonly connections = new Set<IrcConnection>();

  connection(): IrcConnection {
    const connection = new IrcConnection();
    this.connections.add(connection);
    return connection;
  }

  drop(connection: IrcConnection): void {
    this.connections.delete(connection);
  }

  /** Everyone else who is in this channel. */
  others(channel: string, except: IrcConnection): IrcConnection[] {
    return [...this.connections].filter((c) => c !== except && c.channels.has(channel));
  }
}
