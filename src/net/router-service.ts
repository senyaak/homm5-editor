// The router — the TCP door every online session comes through.
//
// It is the GS front desk: key exchange, then a login, then a hand-off to the
// next service. Nothing about a game happens here; what happens is that the
// client stops being anonymous and gets told where to go. The order, as the
// client drives it:
//
//   KEY_EXCHANGE "1"   here is my RSA public key   -> here is ours
//   KEY_EXCHANGE "2"   here is a Blowfish key      -> and here is ours
//   LOGIN              here is a username          -> GSSUCCESS
//   JOINWAITMODULE     where do I go now           -> an address and a port
//   STILLALIVE         keep-alive                     (no answer)
//
// Accounts are ours to define: the client shows a name and a password, and what
// they mean is a decision on this side. For now every name is accepted, which is
// the smallest thing that lets the session continue — `docs/NETWORK.md` says
// what registration will look like when there is somewhere to keep it.
//
// Messages arrive over a TCP stream and can be bundled, so a session buffers and
// walks whole messages by their size field.
//
// Exports:
//   RouterService     new(waitModule) -> session(); session.receive(buf) -> Buffer[]

import { hostU32String } from './address.ts';
import { DEFAULT_LOBBIES, GroupType, LobbyMsg, Lsm, Rooms, lobbyEntry, roomEntry } from './lobby.ts';
import { HEADER_SIZE as GS_HEADER_SIZE, MessageType, build, parse, reply, type GSMessage } from './gs-message.ts';
import { decodeBody, type GSValue } from './gs-data.ts';
import { Blowfish } from './blowfish.ts';
import { decryptWith, generateKeyPair, parsePublicKey, publicKeyBlob, encryptTo, type RsaKeyPair, type RsaPublicKey } from './pkc.ts';
import { randomBytes } from 'node:crypto';

/** Where the client is sent after it logs in. */
export interface Endpoint {
  address: string;
  port: number;
}

/**
 * Which desk this connection is.
 *
 * The same protocol serves four of them — the router, its wait module, the proxy
 * a module lives behind, and the proxy's own wait module — and the client opens a
 * fresh connection, with a fresh key exchange, for each. Only a few answers
 * differ, and every difference below is one the client insisted on.
 */
export type Role = 'router' | 'proxy' | 'lobby';

export interface RouterEvent {
  note: string;
  replies: Buffer[];
}

/** The id we hand out for a proxy module; the client echoes it back to release it. */
const PROXY_ID = '1';

/** A one-byte body value, which is how GS names the message being answered. */
function messageId(type: number): GSValue {
  return new Uint8Array([type & 0xff]);
}

/** A little-endian u32 body value — how a port travels. */
function u32(value: number): GSValue {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return new Uint8Array(out);
}

export class RouterSession {
  private buffer = Buffer.alloc(0);
  private keys: RsaKeyPair | null = null;
  private clientKey: RsaPublicKey | null = null;
  /** The session key the client sent us, and its cipher. */
  clientBlowfishKey: Buffer | null = null;
  private clientCipher: Blowfish | null = null;
  /** The one we generated and sent back. */
  serverBlowfishKey: Buffer | null = null;
  private serverCipher: Blowfish | null = null;
  /** Which of the two turned out to open the client's bodies. */
  encryptedWith: string | null = null;
  username = '';
  /** The game the client logged into the lobby with, e.g. `HEROES_…`. */
  gameId = '';
  /**
   * The address the client says it has, from its lobby-server login: its own LAN
   * address and netmask. This is the raw material for introducing two peers —
   * the lobby is what tells one player where the other is.
   */
  localAddress = '';
  localNetmask = '';

  private readonly role: Role;
  private readonly waitModule: Endpoint;
  private readonly proxy: Endpoint;
  private readonly lobbyServer: Endpoint;
  /** Shared with every other connection: a room one player hosts, others join. */
  private readonly rooms: Rooms;

  constructor(role: Role, waitModule: Endpoint, proxy: Endpoint, lobbyServer: Endpoint, rooms: Rooms) {
    this.role = role;
    this.waitModule = waitModule;
    this.proxy = proxy;
    this.lobbyServer = lobbyServer;
    this.rooms = rooms;
  }

  /** Feed bytes from the socket; get back what to send, and a line for the log. */
  receive(chunk: Buffer): RouterEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const events: RouterEvent[] = [];
    for (;;) {
      // The size field is read first and the bytes are taken off the buffer
      // BEFORE anything can go wrong with them. A message we cannot understand
      // must not be left at the front of the stream: that stalls the connection
      // for good, which is exactly what happened on 12.08.2026 to the first
      // encrypted login we saw.
      if (this.buffer.length < GS_HEADER_SIZE) break;
      const size = (this.buffer[0]! << 16) | (this.buffer[1]! << 8) | this.buffer[2]!;
      if (size < GS_HEADER_SIZE) {
        this.buffer = Buffer.alloc(0);
        events.push({ note: `a message claiming ${size} bytes cannot be one — stream dropped`, replies: [] });
        break;
      }
      if (this.buffer.length < size) break;
      const bytes = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      try {
        const message = parse(bytes, this.decryptBody);
        events.push(message ? this.handle(message) : { note: `${size} bytes did not parse`, replies: [] });
      } catch (err) {
        events.push({ note: `${size} bytes could not be read: ${(err as Error).message}`, replies: [] });
      }
    }
    return events;
  }

  /**
   * Open an encrypted body.
   *
   * Which of the two session keys the client encrypts with is a thing to be
   * measured, not assumed, so both are tried and the one that yields a body we
   * can decode is remembered and reported. A wrong key gives noise, and noise
   * does not decode as a list — that is what makes the trial safe.
   */
  private readonly decryptBody = (body: Buffer): Buffer => {
    const candidates: Array<[string, Blowfish | null]> = [
      ['the key we sent', this.serverCipher],
      ['the key the client sent', this.clientCipher],
    ];
    for (const [name, cipher] of candidates) {
      if (!cipher) continue;
      try {
        const plain = cipher.decrypt(body);
        decodeBody(plain);
        this.encryptedWith = name;
        return plain;
      } catch {
        // Wrong key, or not this one. Try the other.
      }
    }
    throw new Error('neither session key opens this body');
  };

  /**
   * The channels, as child groups of the one group the client is in.
   *
   * The flag asks the client to come back for their children — the rooms —
   * which is how a channel with games in it gets a game list.
   */
  private lobbyList(message: GSMessage): Buffer {
    const lobbies = DEFAULT_LOBBIES.map((lobby) => lobbyEntry(lobby, this.gameId));
    return build(reply(message, [String(LobbyMsg.GROUP_INFO), ['1', String(Lsm.CHILDGROUPINFO), ['0'], lobbies]]));
  }

  private handle(message: GSMessage): RouterEvent {
    switch (message.type) {
      case MessageType.KEY_EXCHANGE:
        return this.keyExchange(message);
      case MessageType.LOGIN: {
        const name = message.body?.[0];
        this.username = typeof name === 'string' ? name : '';
        const body: GSValue[] = this.role === 'proxy' ? [messageId(MessageType.LOGIN), []] : [messageId(MessageType.LOGIN)];
        return {
          note: `LOGIN as "${this.username}" on the ${this.role}${this.encryptedWith ? `, body opened with ${this.encryptedWith}` : ''}`,
          replies: [build(reply(message, body, MessageType.GSSUCCESS))],
        };
      }
      case MessageType.JOINWAITMODULE: {
        // A decimal u32 in HOST order. Both other forms were tried and watched:
        // dotted sent the client to 0.0.0.127, and inet_addr's number sent it to
        // 1.0.0.127. See src/net/address.ts.
        const where = hostU32String(this.waitModule.address);
        // The proxy's own hand-off carries the user and spells the port out;
        // the router's carries four raw bytes. Both come from the client.
        const inner: GSValue[] =
          this.role === 'proxy'
            ? [this.username, where, String(this.waitModule.port)]
            : [where, u32(this.waitModule.port)];
        return {
          note: `JOINWAITMODULE on the ${this.role} — sent to ${this.waitModule.address}:${this.waitModule.port} (as ${where})`,
          replies: [build(reply(message, [messageId(MessageType.JOINWAITMODULE), inner], MessageType.GSSUCCESS))],
        };
      }
      // Once the client is told where to go it opens a SECOND connection — the
      // "wait module" — and speaks the same protocol on it, key exchange and all.
      // The same desk answers both; only the address it was given differs.
      case MessageType.LOGINWAITMODULE: {
        const name = message.body?.[0];
        if (typeof name === 'string' && name) this.username = name;
        const body: GSValue[] =
          this.role === 'proxy' ? [messageId(MessageType.LOGINWAITMODULE), []] : [messageId(MessageType.LOGINWAITMODULE)];
        return {
          note: `LOGINWAITMODULE as "${this.username}" on the ${this.role} — accepted`,
          replies: [build(reply(message, body, MessageType.GSSUCCESS))],
        };
      }
      case MessageType.LOGINFRIENDS:
        return {
          note: 'LOGINFRIENDS — accepted',
          replies: [build(reply(message, [messageId(MessageType.LOGINFRIENDS)], MessageType.GSSUCCESS))],
        };
      case MessageType.PLAYERINFO: {
        // Seven fields; only the first two are known to be the nickname and the
        // real name, and nothing so far has needed the rest.
        const player: GSValue[] = [this.username, this.username, '', '', '', '', ''];
        return {
          note: `PLAYERINFO for "${this.username}"`,
          replies: [build(reply(message, [messageId(MessageType.PLAYERINFO), player], MessageType.GSSUCCESS))],
        };
      }
      // "Where does module X live?" The client asks for `persistantdata` first
      // (its own spelling) and `ladderquery` when it wants a rating — both are
      // served by one proxy, which is where our stats and ladder will go.
      case MessageType.PROXY_HANDLER: {
        const subtype = message.body?.[0];
        if (Array.isArray(subtype)) return { note: 'PROXY_HANDLER notification — nothing to answer', replies: [] };
        const inner = message.body?.[1];
        const module = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '';
        if (subtype === '1') {
          if (module !== 'persistantdata' && module !== 'ladderquery') {
            return { note: `PROXY_HANDLER for unknown module "${module}" — nothing sent`, replies: [] };
          }
          const where = [[PROXY_ID, hostU32String(this.proxy.address), String(this.proxy.port)]];
          return {
            note: `PROXY_HANDLER — "${module}" is at ${this.proxy.address}:${this.proxy.port}`,
            replies: [
              build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [module, '0', '0', where]]])),
            ],
          };
        }
        if (subtype === '2') {
          const moduleId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '0';
          return {
            note: `PROXY_HANDLER — module ${moduleId} released`,
            replies: [build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [moduleId]]]))],
          };
        }
        return { note: `PROXY_HANDLER subtype ${String(subtype)} is not implemented`, replies: [] };
      }
      // The lobby server's own hello. The client introduces itself by name and
      // tells us where it lives on its network — which is the material a lobby
      // needs later, when it has to point one player at another.
      case MessageType.LOBBYSERVERLOGIN: {
        const name = message.body?.[0];
        const serverId = message.body?.[1];
        if (typeof name === 'string' && name) this.username = name;
        if (typeof message.body?.[2] === 'string') this.localAddress = message.body[2];
        if (typeof message.body?.[3] === 'string') this.localNetmask = message.body[3];
        return {
          note: `LOBBYSERVERLOGIN "${this.username}" on server ${String(serverId)}, from ${this.localAddress}/${this.localNetmask}`,
          replies: [
            build(
              reply(
                message,
                [String(MessageType.LOBBYSERVERLOGIN), [typeof serverId === 'string' ? serverId : '1']],
                MessageType.GSSUCCESS,
              ),
            ),
          ],
        };
      }
      // The lobby, as far as the wait module is concerned: log in, hand over the
      // list of lobbies, and say where the lobby server itself lives.
      case MessageType.LOBBY_MSG: {
        const subtype = message.body?.[0];
        const inner = message.body?.[1];
        if (subtype === String(LobbyMsg.LOGIN)) {
          this.gameId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '';
          // The channel list is PUSHED, not asked for. Measured: after this login
          // was answered the client said nothing more and drew an empty channel
          // screen — and its receive side is full of handlers for arriving groups
          // (`ProcessNewLobby`, "new lobby \"…\"", `ProcessLobbyInfo`). So the
          // success goes out with the lobbies right behind it.
          return {
            note: `lobby LOGIN for game "${this.gameId}" — accepted, ${DEFAULT_LOBBIES.length} channels pushed`,
            replies: [build(reply(message, [String(MessageType.GSSUCCESS), [subtype]])), this.lobbyList(message)],
          };
        }
        if (subtype === String(LobbyMsg.CHANGE_REQUESTED_LOBBIES)) {
          return {
            note: `lobby list — ${DEFAULT_LOBBIES.map((l) => l.name).join(', ')}`,
            replies: [this.lobbyList(message)],
          };
        }
        // Entering a channel. The client wants to know it is in, and then what is
        // inside — the rooms. There are none yet, so what follows is an honest
        // empty channel rather than nothing at all.
        if (subtype === String(LobbyMsg.JOIN_LOBBY)) {
          const groupId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '1';
          const lobby = DEFAULT_LOBBIES.find((l) => String(l.id) === groupId) ?? DEFAULT_LOBBIES[0]!;
          const rooms = this.rooms.inLobby(lobby.id).map(roomEntry);
          return {
            note: `JOIN_LOBBY ${groupId} ("${lobby.name}") — in, ${rooms.length} game(s) listed`,
            replies: [
              build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [groupId]]])),
              build(
                reply(message, [
                  String(LobbyMsg.GROUP_INFO),
                  [groupId, String(Lsm.CHILDGROUPINFO), lobbyEntry(lobby, this.gameId), rooms, []],
                ]),
              ),
            ],
          };
        }
        // Hosting a game. Everything about it comes from the client: the name it
        // composed, the map and rules in one blob, how many may join. We give it
        // an id and put it in the channel it was created in.
        if (subtype === String(LobbyMsg.CREATE_ROOM)) {
          const fields = Array.isArray(inner) ? inner : [];
          const text = (at: number): string => (typeof fields[at] === 'string' ? (fields[at] as string) : '');
          const room = this.rooms.create({
            parentId: Number(text(0)) || 1,
            name: text(1),
            gameTitle: text(2),
            type: Number(text(3)) || GroupType.ROOM_UBI_P2P,
            maxPlayers: Number(text(4)) || 2,
            maxVisitors: Number(text(5)) || 0,
            password: text(7),
            info: fields[6] instanceof Uint8Array ? fields[6] : new Uint8Array(0),
            master: this.username,
            members: [this.username],
          });
          return {
            note: `CREATE_ROOM "${room.name}" in channel ${room.parentId} — id ${room.id}, up to ${room.maxPlayers} players`,
            replies: [
              build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [String(room.id), room.name, '1']]])),
              // And the room itself, so the channel it lives in shows it.
              build(reply(message, [String(LobbyMsg.NEW_GROUP), [roomEntry(room)]])),
            ],
          };
        }
        if (subtype === String(LobbyMsg.JOIN_ROOM)) {
          const roomId = Number(Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '0');
          const room = this.rooms.get(roomId);
          if (!room) return { note: `JOIN_ROOM ${roomId} — no such room`, replies: [] };
          if (!room.members.includes(this.username)) room.members.push(this.username);
          return {
            note: `JOIN_ROOM ${roomId} ("${room.name}") — in, ${room.members.length} of ${room.maxPlayers}`,
            replies: [
              build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [String(roomId)]]])),
              build(
                reply(message, [
                  String(LobbyMsg.GROUP_INFO),
                  [String(roomId), String(Lsm.GROUPMEMBERS), roomEntry(room), [], room.members.map((name) => [name])],
                ]),
              ),
            ],
          };
        }
        if (subtype === String(LobbyMsg.GROUP_INFO_GET)) {
          const groupId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '1';
          return {
            note: `GROUP_INFO_GET for ${groupId}`,
            replies: [build(reply(message, [String(MessageType.GSSUCCESS), [subtype, [groupId, '0']]]))],
          };
        }
        if (subtype === String(LobbyMsg.JOIN_SERVER)) {
          const serverId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '1';
          const where = hostU32String(this.lobbyServer.address);
          return {
            note: `lobby server ${serverId} — sent to ${this.lobbyServer.address}:${this.lobbyServer.port}`,
            replies: [
              build(
                reply(message, [
                  String(MessageType.GSSUCCESS),
                  [subtype, [serverId, where, String(this.lobbyServer.port)]],
                ]),
              ),
            ],
          };
        }
        return { note: `lobby message subtype ${String(subtype)} is not implemented`, replies: [] };
      }
      case MessageType.STILLALIVE:
        return { note: 'STILLALIVE', replies: [] };
      default:
        return { note: `no handler for message type ${message.type} — nothing sent`, replies: [] };
    }
  }

  private keyExchange(message: GSMessage): RouterEvent {
    const step = message.body?.[0];
    const payload = message.body?.[1];
    const blob = Array.isArray(payload) ? payload[2] : undefined;

    if (step === '1') {
      if (!(blob instanceof Uint8Array)) return { note: 'KEY_EXCHANGE 1 without a key blob — ignored', replies: [] };
      this.clientKey = parsePublicKey(blob);
      this.keys = generateKeyPair();
      const ours = publicKeyBlob(this.keys.publicKey);
      return {
        note: `KEY_EXCHANGE 1 — client key ${this.clientKey.bits} bits, exponent ${this.clientKey.exponent}; ours sent`,
        replies: [build(reply(message, ['1', ['1', String(ours.length), new Uint8Array(ours)]]))],
      };
    }

    if (step === '2') {
      if (!(blob instanceof Uint8Array) || !this.keys || !this.clientKey) {
        return { note: 'KEY_EXCHANGE 2 out of order — ignored', replies: [] };
      }
      this.clientBlowfishKey = decryptWith(this.keys.privateKey, blob);
      this.clientCipher = new Blowfish(this.clientBlowfishKey);
      this.serverBlowfishKey = randomBytes(16);
      this.serverCipher = new Blowfish(this.serverBlowfishKey);
      const encrypted = encryptTo(this.clientKey, this.serverBlowfishKey);
      return {
        note: `KEY_EXCHANGE 2 — client session key ${this.clientBlowfishKey.length} bytes; ours sent`,
        replies: [build(reply(message, ['2', ['1', String(encrypted.length), new Uint8Array(encrypted)]]))],
      };
    }

    return { note: `KEY_EXCHANGE step ${String(step)} is not implemented`, replies: [] };
  }
}

export class RouterService {
  private readonly waitModule: Endpoint;
  private readonly proxy: Endpoint;
  private readonly proxyWaitModule: Endpoint;
  private readonly lobbyServer: Endpoint;
  private readonly rooms = new Rooms();

  constructor(waitModule: Endpoint, proxy: Endpoint, proxyWaitModule: Endpoint, lobbyServer: Endpoint) {
    this.waitModule = waitModule;
    this.proxy = proxy;
    this.proxyWaitModule = proxyWaitModule;
    this.lobbyServer = lobbyServer;
  }

  /** A connection on one of the four desks. */
  session(role: Role = 'router'): RouterSession {
    const waitModule = role === 'proxy' ? this.proxyWaitModule : this.waitModule;
    return new RouterSession(role, waitModule, this.proxy, this.lobbyServer, this.rooms);
  }
}
