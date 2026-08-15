// The agent: the game's own peer traffic, seen from inside the game.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY IT IS IN HERE AND NOT BESIDE. Over the internet the address a peer is
// told is useless: both players are behind something, and one of them behind
// carrier-grade NAT has no address to be told. So their datagrams have to be
// able to travel through a relay of ours (h5e-lobby, docs/ARCHITECTURE.md), and
// something has to decide, per datagram, whether to send it to the peer or to
// the relay. A process beside the game would have to be DIALLED — the game
// handed a stand-in address for every peer, the server writing those addresses
// into the room description, a mechanism built to be thrown away. In the
// process there is nothing to dial: the calls the game already makes are ours
// to answer.
//
// WHAT IT DOES. It watches every datagram on that socket, and — once there is a
// relay connected — it CARRIES the peer ones: out through the WebSocket instead
// of the wire, and back in by answering the game's own `recvfrom` with what the
// relay delivered. Everything else on the socket, the lobby's own services included,
// goes exactly where the game sent it.
//
// The first version of this file only watched, and that step earned its keep:
// it proved the hook was on the right socket at the right time, and it found a
// mistake of its own (the CD-key service counted as a player) before anything
// depended on the answer.
//
// EVERY PEER DATAGRAM GOES THROUGH THE RELAY, not "when the direct path fails".
// A hole punch is worth having and is not written yet; what is being
// established first is that a match can be played through the relay at all,
// which is a claim a packet capture can check — nothing direct between the two
// clients.
//
// HOW IT ATTACHES. The game imports `sendto` and `recvfrom` from WSOCK32.dll BY
// ORDINAL (20 and 17) rather than by name, which is why `hook_import` in
// qol/borderless.c cannot be used as it stands: it compares names, and an
// ordinal import has none. The slot is found by walking the same import table
// for the library and the number, and it is verified against `GetProcAddress`
// of that ordinal from that library before a pointer is written — so a slot
// somebody else got to first, or a table that does not look like the one this
// was written for, is left alone.
//
// WHAT THE GAME'S PEER SOCKET IS (h5e-lobby/docs/NETWORK_STATE.md, measured):
// one UDP socket per client, bound to `net_game_port` (8888 by default, 8889
// and 8890 in the second and third copies), and it is ALSO the socket that
// pings the NAT service on port 40010. So this file has to tell the two apart, and
// it does it the only way that needs nothing from the engine: by the port at
// the other end.
//
// The peer datagrams themselves are small and few — a nine-byte handshake with
// a four-byte token each way, one 273-byte description, then 18 to 28 bytes
// about every 0.9 s with two counters that behave like a sequence and an
// acknowledgement. A relay can pass all of that through unchanged and
// understand none of it.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_agent

/** WSOCK32's ordinals for the calls the game makes with a datagram. */
#define WSOCK32_SENDTO 20
#define WSOCK32_RECVFROM 17
#define WSOCK32_SELECT 18

/**
 * The u-lobby's services, whose ports are NOT a peer's.
 *
 * The same socket carries the game's own service traffic — the NAT mirror's
 * keep-alives, the CD-key service — and telling that apart from a peer by guessing
 * at port numbers is guessing at OUR server's configuration. The game does not
 * guess: it reads `%TEMP%\ubi_servers.ini`, which is what one HTTP request wrote
 * for it (docs/NETWORK.md), and so does this.
 *
 * The first run of this file had only 40010 written in, and the CD-key service on
 * 40020 duly appeared in the log as a peer of the player's.
 */
#define AGENT_DESKS 8
static WORD g_uServicePorts[AGENT_DESKS];
static int g_uServicePortCount = 0;
static int g_uServicePortsRead = 0;

/** One `[Servers]` entry, if it is there and is a port. */
static void agent_u_service_port(const char *ini, const char *key) {
  char text[32];
  DWORD got = GetPrivateProfileStringA("Servers", key, "", text, sizeof(text), ini);
  if (!got) return;
  int port = 0;
  const char *p = text;
  if (!read_int(&p, text + got, &port)) return;
  if (port <= 0 || port > 0xffff || g_uServicePortCount >= AGENT_DESKS) return;
  for (int i = 0; i < g_uServicePortCount; i++) {
    if (g_uServicePorts[i] == (WORD)port) return;
  }
  g_uServicePorts[g_uServicePortCount++] = (WORD)port;
  log_num("agent: a u-lobby service of the lobby is on port ", port);
}

/**
 * Every port the server list names, read once.
 *
 * Only the ones a datagram can go to are worth having, but all of them are
 * cheap: what this list is for is answering "is this endpoint a player", and a
 * TCP-only u-lobby service in it costs nothing and cannot be wrong.
 */
static void agent_read_u_service_ports(void) {
  char ini[MAX_PATH];
  DWORD len = GetTempPathA(MAX_PATH, ini);
  if (!len || len + 16 >= MAX_PATH) return;
  const char *name = "ubi_servers.ini";
  int at = (int)len;
  for (int i = 0; name[i]; i++) ini[at++] = name[i];
  ini[at] = 0;

  static const char *const KEYS[] = {
    "RouterPort0", "RouterLauncherPort0", "NATServerPort0",
    "CDKeyServerPort0", "CDKeyServerLauncherPort0", "IRCPort0",
  };
  for (int i = 0; i < (int)(sizeof(KEYS) / sizeof(KEYS[0])); i++) agent_u_service_port(ini, KEYS[i]);
  if (!g_uServicePortCount) log_text("agent: no server list at ", ini);
}

static int agent_is_u_service(WORD port) {
  for (int i = 0; i < g_uServicePortCount; i++) {
    if (g_uServicePorts[i] == port) return 1;
  }
  return 0;
}

/** How many peers one game can have in flight. Eight players, so seven others. */
#define AGENT_PEERS 8

/** How many of a peer's datagrams are written out whole before counting takes over. */
#define AGENT_FIRST_SHOWN 3

/** And how often the counts are said, while anything is moving. */
#define AGENT_REPORT_MS 5000

typedef int(WINAPI *AgentSendToFn)(SOCKET s, const char *buf, int len, int flags,
                                   const struct sockaddr *to, int tolen);
typedef int(WINAPI *AgentRecvFromFn)(SOCKET s, char *buf, int len, int flags,
                                     struct sockaddr *from, int *fromlen);
typedef int(WINAPI *AgentSelectFn)(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds,
                                   const struct timeval *timeout);

static AgentSendToFn g_agentSendTo = NULL;
static AgentRecvFromFn g_agentRecvFrom = NULL;
static AgentSelectFn g_agentSelect = NULL;

/**
 * The socket the game plays on, learned rather than looked for.
 *
 * The first datagram to something that is not one of the lobby's services was sent
 * on it, and there is only one (measured: one socket per client, and it is the
 * same one that pings the NAT mirror). Knowing it is what lets everything below
 * leave every other socket in the process alone.
 */
static SOCKET g_gameSocket = INVALID_SOCKET;
/** The lobby's own address, off the first datagram that went to one of its services. */
static DWORD g_lobbyAddr = 0;
/** Which relay connection we last said our endpoint on; 0 means never. */
static LONG g_announcedOn = 0;

typedef struct {
  DWORD addr; /* as it lies in the sockaddr: network order */
  WORD port;  /* host order, because it is only ever printed */
  int shown;
  int sent;
  int sentBytes;
  int got;
  int gotBytes;
} AgentPeer;

/** Named before it is written, because the watcher below hands it to the relay. */
static void agent_inbound(const BYTE *data, int len);

static AgentPeer g_peers[AGENT_PEERS];
static int g_peerCount = 0;
static int g_uServicePings = 0;
static DWORD g_lastReport = 0;
static int g_reportPending = 0;
static int g_relayed = 0;
static int g_delivered = 0;
static int g_relayTried = 0;

// ---------------------------------------------------------------------------
// What comes back from the relay.
//
// The game reads its socket; a datagram that arrived over a WebSocket is not on
// that socket and never will be. So it is put in a queue here and handed over
// the next time the game asks — `recvfrom` is ours, and the address it reports
// is the peer's own, the one the game was told about and already believes in.
//
// THAT IS WHAT BEING INSIDE THE PROCESS BUYS. A relay outside would have had to
// be dialled: a loopback stand-in address per peer, patched into the room
// description by the server, per recipient because three of them on one machine
// cannot share one address. None of that exists here. The open question in
// docs/ARCHITECTURE.md — whether the address must be rewritten per recipient —
// is answered by not needing an address at all.
// ---------------------------------------------------------------------------

/** Room for a burst; the game's own rate is about one datagram a second. */
#define AGENT_QUEUE 64

/**
 * The frame the relay and this agent share, seven bytes in both directions:
 *
 *   [0x01][address: 4 bytes][port: 2 bytes big-endian][the datagram]
 *
 * Going out, the address is the one the game dialled; coming back, it is the
 * one the datagram is FROM, which is what `recvfrom` is then answered with. The
 * agent never names a player and never learns who is who: it knows addresses,
 * the relay knows players, and the relay is the side that has the room's own
 * description to map between them. Which is also why this is the whole of the
 * three-player problem — with two, "the other one" was always right.
 */
#define FRAME_DATAGRAM 0x01
/**
 * And the frame that opens a connection: `[0x02][address: 4][port: 2]`, where this
 * game plays.
 *
 * It is not a credential and there is nothing to keep: the relay hands the endpoint to the
 * lobby, and the lobby either has somebody playing there or does not. A `secret` lived in
 * the config beside the relay's address until 14.08.2026 and was cut for the reason that
 * settles it — nobody outside this desk could ever have been given one.
 */
#define FRAME_IDENTIFY 0x02
#define FRAME_HEADER 7

typedef struct {
  int len;
  /** Who it came from, as the frame said. Zero when nothing said. */
  DWORD addr;
  WORD port;
  BYTE data[RELAY_MAX_DATAGRAM];
} AgentDatagram;

static AgentDatagram *g_queue = NULL;
static int g_queueHead = 0; /* next to hand over */
static int g_queueCount = 0;
static CRITICAL_SECTION g_queueLock;
static int g_queueLockMade = 0;
static int g_queueDropped = 0;

/** `1.2.3.4:5678` into `out`, which needs 24 bytes. */
static void agent_endpoint(DWORD addr, WORD port, char *out) {
  const BYTE *b = (const BYTE *)&addr;
  int at = 0, len = 0;
  for (int i = 0; i < 4; i++) {
    num_to_dec(b[i], out + at, &len);
    at += len;
    out[at++] = i == 3 ? ':' : '.';
  }
  num_to_dec((int)port, out + at, &len);
  at += len;
  out[at] = 0;
}

/** The first `n` bytes as hex, space separated. `out` needs 3n bytes. */
static void agent_hex(const BYTE *data, int n, char *out) {
  static const char DIGITS[] = "0123456789abcdef";
  int at = 0;
  for (int i = 0; i < n; i++) {
    out[at++] = DIGITS[(data[i] >> 4) & 0x0f];
    out[at++] = DIGITS[data[i] & 0x0f];
    if (i + 1 < n) out[at++] = ' ';
  }
  out[at] = 0;
}

/**
 * The row for this endpoint, made if it is new.
 *
 * A peer is an address AND a port: two copies of the game on one machine share
 * an address and differ only in the port, which is exactly the case every local
 * test is made of.
 */
static AgentPeer *agent_peer(DWORD addr, WORD port) {
  for (int i = 0; i < g_peerCount; i++) {
    if (g_peers[i].addr == addr && g_peers[i].port == port) return &g_peers[i];
  }
  if (g_peerCount >= AGENT_PEERS) return NULL;
  AgentPeer *peer = &g_peers[g_peerCount++];
  peer->addr = addr;
  peer->port = port;
  peer->shown = 0;
  peer->sent = peer->sentBytes = peer->got = peer->gotBytes = 0;
  return peer;
}

/** Every five seconds, what has moved since the last time — and nothing when nothing has. */
static void agent_report(void) {
  if (!g_reportPending) return;
  DWORD now = GetTickCount();
  if (now - g_lastReport < AGENT_REPORT_MS) return;
  g_lastReport = now;
  g_reportPending = 0;

  char where[24];
  for (int i = 0; i < g_peerCount; i++) {
    AgentPeer *peer = &g_peers[i];
    agent_endpoint(peer->addr, peer->port, where);
    log_text("agent: peer ", where);
    log_num("agent:   sent packets ", peer->sent);
    log_num("agent:   sent bytes ", peer->sentBytes);
    log_num("agent:   received packets ", peer->got);
    log_num("agent:   received bytes ", peer->gotBytes);
  }
  if (g_uServicePings) log_num("agent: datagrams to the lobby's own services ", g_uServicePings);
  // The two numbers that say whether the relay is doing the work: what went out
  // through it instead of the wire, and what came back in through `recvfrom`.
  if (g_relayed) log_num("agent: carried out by the relay ", g_relayed);
  if (g_delivered) log_num("agent: handed to the game from the relay ", g_delivered);
  if (g_queueDropped) log_num("agent: relayed datagrams dropped, the game was not reading ", g_queueDropped);
}

/**
 * One datagram, going out or coming in.
 *
 * `sending` is which; `data` is the payload, only read for the first few of a
 * peer's datagrams. Anything that is not IPv4 is left alone without a word: the
 * game's own transport is UDP over IPv4 and something else here would be a
 * surprise worth not guessing about.
 */
static int agent_watch(const struct sockaddr *other, int len, int bytes, int sending,
                       const BYTE *data) {
  // Those ports are read HERE and not at install time, and the difference matters:
  // this DLL's entry point runs before the executable's, and the server list is
  // something the game downloads once it is running. Read too early, the file is
  // last session's or is not there at all. By the time a datagram exists it has
  // been written — the address the datagram is going to came out of it.
  if (!g_uServicePortsRead) {
    g_uServicePortsRead = 1;
    agent_read_u_service_ports();
  }
  if (!other || len < (int)sizeof(struct sockaddr_in)) return 0;
  if (!readable(other, sizeof(struct sockaddr_in))) return 0;
  const struct sockaddr_in *in = (const struct sockaddr_in *)other;
  if (in->sin_family != AF_INET) return 0;

  const BYTE *rawPort = (const BYTE *)&in->sin_port;
  WORD port = (WORD)((rawPort[0] << 8) | rawPort[1]); /* the wire is big endian */
  DWORD addr = *(const DWORD *)&in->sin_addr;

  if (agent_is_u_service(port)) {
    // Kept for `agent_announce`: routing a socket at the lobby is how this process finds
    // out which of its own addresses the lobby sees, and the lobby's is the only address
    // here that is certain to be the right one to ask about.
    if (!g_lobbyAddr) g_lobbyAddr = addr;
    g_uServicePings++;
    g_reportPending = 1;
    agent_report();
    return 0;
  }

  AgentPeer *peer = agent_peer(addr, port);
  if (!peer) return 1;
  if (sending) {
    peer->sent++;
    peer->sentBytes += bytes;
  } else {
    peer->got++;
    peer->gotBytes += bytes;
  }

  // The opening of a conversation, written out whole-ish: the handshake and the
  // description are what say whether this hook is on the right socket at all,
  // and they happen once.
  if (peer->shown < AGENT_FIRST_SHOWN && data && bytes > 0) {
    peer->shown++;
    char where[24];
    char head[3 * 16 + 1];
    int n = bytes < 16 ? bytes : 16;
    agent_endpoint(peer->addr, peer->port, where);
    if (readable(data, (SIZE_T)n)) {
      agent_hex(data, n, head);
      log_text(sending ? "agent: -> " : "agent: <- ", where);
      log_num("agent:   bytes ", bytes);
      log_text("agent:   head ", head);
    }
  }

  // A peer, so there is a game on: this is the moment to have a way out. The
  // relay is dialled here and not at load, because WinHTTP arrives through
  // LoadLibrary and that must not happen under the loader lock — and because
  // until two players are talking there is no room for the core to put this
  // agent in, and it would be refused.
  if (!g_relayTried) {
    g_relayTried = 1;
    g_relayInbound = &agent_inbound;
    if (relay_start()) log_line("agent: dialling the relay");
  }

  g_reportPending = 1;
  agent_report();
  return 1;
}

/** A datagram off the relay, put where the game will find it. Relay thread. */
static void agent_inbound(const BYTE *data, int len) {
  if (!g_queue || len <= 0 || len > RELAY_MAX_DATAGRAM) return;

  // The sender, out of the frame. Anything not framed is taken as the payload
  // itself and left without one — a relay of an older build, and with two
  // players the peer we know is the right answer anyway.
  DWORD from = 0;
  WORD fromPort = 0;
  if (data[0] == FRAME_DATAGRAM && len > FRAME_HEADER) {
    BYTE *octets = (BYTE *)&from;
    for (int i = 0; i < 4; i++) octets[i] = data[1 + i];
    fromPort = (WORD)((data[5] << 8) | data[6]);
    data += FRAME_HEADER;
    len -= FRAME_HEADER;
  }

  EnterCriticalSection(&g_queueLock);
  if (g_queueCount >= AGENT_QUEUE) {
    // The game is not reading. Dropping the OLDEST is the right end to drop
    // from: this is a transport that already expects loss, and the newest
    // datagram is the one its sequencing can still use.
    g_queueHead = (g_queueHead + 1) % AGENT_QUEUE;
    g_queueCount--;
    g_queueDropped++;
  }
  int at = (g_queueHead + g_queueCount) % AGENT_QUEUE;
  g_queue[at].len = len;
  g_queue[at].addr = from;
  g_queue[at].port = fromPort;
  for (int i = 0; i < len; i++) g_queue[at].data[i] = data[i];
  g_queueCount++;
  LeaveCriticalSection(&g_queueLock);
}

static int agent_queue_waiting(void) {
  if (!g_queue) return 0;
  EnterCriticalSection(&g_queueLock);
  int waiting = g_queueCount;
  LeaveCriticalSection(&g_queueLock);
  return waiting;
}

/**
 * Hand the oldest queued datagram to the game, as though it had just arrived.
 *
 * `from` is the peer we are relaying with. A relayed datagram carries no
 * address of its own — the relay is told "to the others in my room", never an
 * address — so with two players there is exactly one answer and it is right.
 * With three there is not, and this says so rather than picking: what a
 * three-player game needs is a peer named in the relay's own framing, which is
 * a change on both sides and is not this one.
 */
static int agent_deliver(char *buf, int len, struct sockaddr *from, int *fromlen) {
  EnterCriticalSection(&g_queueLock);
  if (!g_queueCount) {
    LeaveCriticalSection(&g_queueLock);
    return 0;
  }
  AgentDatagram *one = &g_queue[g_queueHead];
  int copy = one->len < len ? one->len : len;
  for (int i = 0; i < copy; i++) buf[i] = (char)one->data[i];
  int whole = one->len;
  DWORD queuedAddr = one->addr;
  WORD queuedPort = one->port;
  g_queueHead = (g_queueHead + 1) % AGENT_QUEUE;
  g_queueCount--;
  LeaveCriticalSection(&g_queueLock);

  // Who it is from: the frame says, and only when it does not — an older relay,
  // or a datagram that reached us before the room description was read — does
  // this fall back to the peer we know, which is right whenever there is one.
  DWORD fromAddr = queuedAddr ? queuedAddr : (g_peerCount ? g_peers[0].addr : 0);
  WORD fromPort = queuedPort ? queuedPort : (g_peerCount ? g_peers[0].port : 0);
  if (from && fromlen && *fromlen >= (int)sizeof(struct sockaddr_in) && fromAddr) {
    struct sockaddr_in *in = (struct sockaddr_in *)from;
    BYTE *port = (BYTE *)&in->sin_port;
    in->sin_family = AF_INET;
    port[0] = (BYTE)(fromPort >> 8);
    port[1] = (BYTE)(fromPort & 0xff);
    *(DWORD *)&in->sin_addr = fromAddr;
    *fromlen = (int)sizeof(struct sockaddr_in);
  }
  g_delivered++;
  if (whole > copy) log_num("agent: a relayed datagram did not fit and was cut to ", copy);
  return copy;
}

#ifndef SOCK_DGRAM
#define SOCK_DGRAM 2
#endif

typedef SOCKET(WINAPI *AgentSocketFn)(int af, int type, int protocol);
typedef int(WINAPI *AgentConnectFn)(SOCKET s, const struct sockaddr *name, int namelen);
typedef int(WINAPI *AgentGetSockNameFn)(SOCKET s, struct sockaddr *name, int *namelen);
typedef int(WINAPI *AgentCloseSocketFn)(SOCKET s);

/**
 * Say where this game plays, which is the whole of how the relay learns who we are.
 *
 * Two halves, and neither of them is a secret. THE PORT comes off the game's own socket
 * with `getsockname` — it is bound by then, or no datagram would have gone out of it. THE
 * ADDRESS cannot come from there, because a socket bound to every interface reports
 * exactly that; so a throwaway UDP socket is routed at the lobby and asked which of our
 * addresses it picked. That is the same choice the game made when it told the lobby where
 * it plays, and the lobby's copy of that answer is what the endpoint is checked against.
 *
 * Nothing is sent by the throwaway socket: `connect` on UDP only fixes a route.
 */
static int agent_announce(void) {
  if (g_gameSocket == INVALID_SOCKET || !g_lobbyAddr || !g_uServicePortCount) return 0;
  HMODULE ws = GetModuleHandleA("wsock32.dll");
  if (!ws) ws = GetModuleHandleA("ws2_32.dll");
  if (!ws) return 0;
  AgentGetSockNameFn ourName = (AgentGetSockNameFn)GetProcAddress(ws, "getsockname");
  AgentSocketFn makeSocket = (AgentSocketFn)GetProcAddress(ws, "socket");
  AgentConnectFn route = (AgentConnectFn)GetProcAddress(ws, "connect");
  AgentCloseSocketFn shut = (AgentCloseSocketFn)GetProcAddress(ws, "closesocket");
  if (!ourName || !makeSocket || !route || !shut) {
    log_line("agent: this winsock has no getsockname — cannot say where we play");
    return 0;
  }

  struct sockaddr_in bound;
  int size = (int)sizeof(bound);
  if (ourName(g_gameSocket, (struct sockaddr *)&bound, &size) != 0) return 0;
  const BYTE *portBytes = (const BYTE *)&bound.sin_port; /* already big endian */
  if (!portBytes[0] && !portBytes[1]) return 0;

  DWORD ours = 0;
  SOCKET probe = makeSocket(AF_INET, SOCK_DGRAM, 0);
  if (probe != INVALID_SOCKET) {
    struct sockaddr_in at;
    for (int i = 0; i < (int)sizeof(at); i++) ((BYTE *)&at)[i] = 0;
    at.sin_family = AF_INET;
    *(DWORD *)&at.sin_addr = g_lobbyAddr;
    BYTE *servicePort = (BYTE *)&at.sin_port;
    servicePort[0] = (BYTE)(g_uServicePorts[0] >> 8);
    servicePort[1] = (BYTE)(g_uServicePorts[0] & 0xff);
    if (route(probe, (const struct sockaddr *)&at, (int)sizeof(at)) == 0) {
      struct sockaddr_in local;
      int localSize = (int)sizeof(local);
      if (ourName(probe, (struct sockaddr *)&local, &localSize) == 0) ours = *(DWORD *)&local.sin_addr;
    }
    shut(probe);
  }
  if (!ours) {
    log_line("agent: could not work out which address the lobby sees us at");
    return 0;
  }

  BYTE frame[FRAME_HEADER];
  frame[0] = FRAME_IDENTIFY;
  const BYTE *octets = (const BYTE *)&ours;
  for (int i = 0; i < 4; i++) frame[1 + i] = octets[i];
  frame[5] = portBytes[0];
  frame[6] = portBytes[1];
  if (!relay_send(frame, FRAME_HEADER)) return 0;
  log_num("agent: we play on port ", (int)((portBytes[0] << 8) | portBytes[1]));
  log_num("agent: and the lobby knows this address ", (int)octets[3]);
  return 1;
}

/** The datagram, with the address the game dialled in front of it, to the relay. */
static int agent_carry(const struct sockaddr *to, const BYTE *data, int len) {
  if (len <= 0 || len > RELAY_MAX_DATAGRAM - FRAME_HEADER) return 0;
  const struct sockaddr_in *in = (const struct sockaddr_in *)to;
  BYTE frame[RELAY_MAX_DATAGRAM];
  frame[0] = FRAME_DATAGRAM;
  const BYTE *addr = (const BYTE *)&in->sin_addr;
  for (int i = 0; i < 4; i++) frame[1 + i] = addr[i];
  // The port is already big-endian in the sockaddr, which is the order the frame
  // wants — so it is copied rather than swapped twice.
  const BYTE *port = (const BYTE *)&in->sin_port;
  frame[5] = port[0];
  frame[6] = port[1];
  for (int i = 0; i < len; i++) frame[FRAME_HEADER + i] = data[i];
  return relay_send(frame, len + FRAME_HEADER);
}

static int WINAPI agent_sendto_hook(SOCKET s, const char *buf, int len, int flags,
                                    const struct sockaddr *to, int tolen) {
  int peer = agent_watch(to, tolen, len, 1, (const BYTE *)buf);
  if (peer) {
    if (g_gameSocket == INVALID_SOCKET) g_gameSocket = s;
    // Everything, once there is a relay to take it. Not "when the direct path
    // fails" — that choice needs a hole punch to have been tried and measured,
    // and what is being established first is that a game can be played through
    // the relay at all. Nothing direct between the clients is the claim, and it
    // is one a packet capture can check.
    if (relay_connected()) {
      // Who we are goes first, and again on every new connection: a relay that went away
      // and came back has never heard of this socket.
      LONG connection = relay_generation();
      if (g_announcedOn != connection && agent_announce()) g_announcedOn = connection;
      if (g_announcedOn == connection && agent_carry(to, (const BYTE *)buf, len)) {
        g_relayed++;
        return len; /* the game asked for it to be sent, and it was */
      }
    }
  }
  return g_agentSendTo(s, buf, len, flags, to, tolen);
}

static int WINAPI agent_recvfrom_hook(SOCKET s, char *buf, int len, int flags,
                                      struct sockaddr *from, int *fromlen) {
  // The relay's datagrams first, and only on the socket the game plays on:
  // whatever else this process reads is none of our business.
  if (s == g_gameSocket && agent_queue_waiting()) {
    int gave = agent_deliver(buf, len, from, fromlen);
    if (gave > 0) return gave;
  }
  // AFTER the call, because until it returns there is nothing to look at — and
  // only when it brought something: a non-blocking socket with nothing waiting
  // returns -1 all day, and counting those would drown the log in silence.
  int got = g_agentRecvFrom(s, buf, len, flags, from, fromlen);
  if (got > 0) agent_watch(from, fromlen ? *fromlen : 0, got, 0, (const BYTE *)buf);
  return got;
}

/**
 * `select` has to know about the queue too.
 *
 * A datagram of ours is not on the socket, so a game that asks the OS whether
 * there is anything to read would be told no and would never call `recvfrom` —
 * and the queue would fill up behind a game that is waiting for it. Whether
 * this game asks was never established; hooking it costs nothing if it does
 * not, and is the difference between working and hanging if it does.
 *
 * The wait is dropped to nothing when we have something, because we already
 * know the answer and blocking for the caller's timeout would delay it.
 */
/**
 * `FD_ISSET` and `FD_SET`, by hand.
 *
 * The macro version of the first calls `__WSAFDIsSet`, which is a function in
 * the socket library — and this DLL links no libraries at all (see the build
 * line in src/mods/extension.ts). A `fd_set` is a count and an array of
 * sockets, documented and unchanged since Winsock 1.1, so reading it directly
 * costs a loop and owes nobody anything.
 */
static int agent_fd_has(SOCKET s, const fd_set *set) {
  if (!set) return 0;
  for (u_int i = 0; i < set->fd_count; i++) {
    if (set->fd_array[i] == s) return 1;
  }
  return 0;
}

static void agent_fd_add(SOCKET s, fd_set *set) {
  if (!set || set->fd_count >= FD_SETSIZE) return;
  set->fd_array[set->fd_count++] = s;
}

static int WINAPI agent_select_hook(int nfds, fd_set *readfds, fd_set *writefds,
                                    fd_set *exceptfds, const struct timeval *timeout) {
  int wanted = readfds && g_gameSocket != INVALID_SOCKET && agent_fd_has(g_gameSocket, readfds);
  if (!wanted || !agent_queue_waiting()) {
    return g_agentSelect(nfds, readfds, writefds, exceptfds, timeout);
  }
  struct timeval now;
  now.tv_sec = 0;
  now.tv_usec = 0;
  int ready = g_agentSelect(nfds, readfds, writefds, exceptfds, &now);
  if (ready < 0) ready = 0;
  if (readfds && !agent_fd_has(g_gameSocket, readfds)) {
    agent_fd_add(g_gameSocket, readfds);
    ready++;
  }
  return ready;
}

/**
 * The import slot holding `library`'s function number `ordinal`.
 *
 * `find_import_slot` in qol/borderless.c does this by NAME and skips ordinals
 * outright, which is the whole reason this exists: WSOCK32 is imported by
 * number here, so the library has to be matched instead — the descriptor's own
 * name, compared without case, since an import table may spell it either way.
 */
static void **agent_import_slot(const char *library, WORD ordinal) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_DATA_DIRECTORY *dir = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (!dir->VirtualAddress) return NULL;

  IMAGE_IMPORT_DESCRIPTOR *imp = (IMAGE_IMPORT_DESCRIPTOR *)(base + dir->VirtualAddress);
  for (; imp->Name; imp++) {
    const char *name = (const char *)(base + imp->Name);
    int i = 0;
    for (;; i++) {
      char a = name[i], b = library[i];
      if (a >= 'A' && a <= 'Z') a = (char)(a + 32);
      if (b >= 'A' && b <= 'Z') b = (char)(b + 32);
      if (a != b) break;
      if (!a) break;
    }
    if (name[i] || library[i]) continue;

    DWORD nameRva = imp->OriginalFirstThunk ? imp->OriginalFirstThunk : imp->FirstThunk;
    DWORD *names = (DWORD *)(base + nameRva);
    DWORD *slots = (DWORD *)(base + imp->FirstThunk);
    for (int j = 0; names[j]; j++) {
      if (!(names[j] & IMAGE_ORDINAL_FLAG32)) continue;
      if ((WORD)(names[j] & 0xffff) != ordinal) continue;
      return (void **)&slots[j];
    }
  }
  return NULL;
}

/**
 * Meet one imported-by-ordinal function with one of ours.
 *
 * The same discipline as `hook_import`: what is written is checked first
 * against what the loader would have put there, so this refuses rather than
 * guesses. The library is taken by handle, never loaded — `LoadLibrary` from
 * `DllMain` is a way to deadlock the loader — and WSOCK32 is a static import of
 * the executable, so it is already mapped.
 */
static void *agent_hook_ordinal(const char *library, const WCHAR *libraryW, WORD ordinal,
                                void *ours, const char *what) {
  void **slot = agent_import_slot(library, ordinal);
  if (!slot) {
    log_text("agent: not imported by ordinal - skipping ", what);
    return NULL;
  }
  HMODULE lib = GetModuleHandleW(libraryW);
  void *real = lib ? (void *)GetProcAddress(lib, (LPCSTR)(ULONG_PTR)ordinal) : NULL;
  if (!real || *slot != real) {
    log_text("agent: the import slot is not the library's own - skipping ", what);
    return NULL;
  }
  DWORD old = 0;
  if (!VirtualProtect(slot, sizeof(void *), PAGE_READWRITE, &old)) {
    log_text("agent: could not make the import table writable for ", what);
    return NULL;
  }
  *slot = ours;
  VirtualProtect(slot, sizeof(void *), old, &old);
  log_text("agent: watching ", what);
  return real;
}

/**
 * Watch the socket the game plays on.
 *
 * Both or neither: with only one of the two the log would show half a
 * conversation, which is worse than none — it reads like a peer that never
 * answers. Nothing is installed in a build that cannot say what it saw, the
 * way qol/pandora-notify.c does it, because watching in silence is all cost.
 */
static int install_agent(void) {
  if (!LOG_ON) return 0;
  g_agentSendTo = (AgentSendToFn)agent_hook_ordinal("wsock32.dll", L"wsock32.dll", WSOCK32_SENDTO,
                                                    &agent_sendto_hook, "sendto");
  if (!g_agentSendTo) return 0;
  g_agentRecvFrom = (AgentRecvFromFn)agent_hook_ordinal("wsock32.dll", L"wsock32.dll",
                                                        WSOCK32_RECVFROM, &agent_recvfrom_hook,
                                                        "recvfrom");
  if (!g_agentRecvFrom) return 0;
  // `select` is not fatal to miss: a game that never asks it loses nothing by
  // this being absent, and one that does would otherwise never be told that a
  // relayed datagram is waiting. So it is installed if it can be and reported
  // if it cannot, rather than taking the other two down with it.
  g_agentSelect = (AgentSelectFn)agent_hook_ordinal("wsock32.dll", L"wsock32.dll", WSOCK32_SELECT,
                                                    &agent_select_hook, "select");

  if (!g_queueLockMade) {
    InitializeCriticalSection(&g_queueLock);
    g_queueLockMade = 1;
  }
  g_queue = (AgentDatagram *)VirtualAlloc(NULL, sizeof(AgentDatagram) * AGENT_QUEUE, MEM_COMMIT,
                                          PAGE_READWRITE);
  if (!g_queue) {
    log_line("agent: no room for the queue — nothing can be carried back in");
    return 0;
  }
  g_lastReport = GetTickCount();
  return 1;
}
