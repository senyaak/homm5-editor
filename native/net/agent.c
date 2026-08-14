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
// WHAT IT DOES TODAY: it watches, and nothing else. Every datagram goes exactly
// where the game sent it, and what this writes down is what the hook SAW — the
// endpoint, the size, the first bytes of the first few, and a count every five
// seconds. That is deliberate: nothing in this repository has ever hooked a
// socket before, the whole of the relay rests on this hook seeing the right
// traffic at the right time, and a build that carries datagrams before that is
// established would be a build whose failures have two possible causes.
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
// pings the NAT desk on port 40010. So this file has to tell the two apart, and
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

/** WSOCK32's ordinals for the two calls the game makes with a datagram. */
#define WSOCK32_SENDTO 20
#define WSOCK32_RECVFROM 17

/** The NAT desk's port. Traffic to it is the game's own keep-alive, not a peer. */
#define NAT_DESK_PORT 40010

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

static AgentSendToFn g_agentSendTo = NULL;
static AgentRecvFromFn g_agentRecvFrom = NULL;

typedef struct {
  DWORD addr; /* as it lies in the sockaddr: network order */
  WORD port;  /* host order, because it is only ever printed */
  int shown;
  int sent;
  int sentBytes;
  int got;
  int gotBytes;
} AgentPeer;

static AgentPeer g_peers[AGENT_PEERS];
static int g_peerCount = 0;
static int g_deskPings = 0;
static DWORD g_lastReport = 0;
static int g_reportPending = 0;

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
  if (g_deskPings) log_num("agent: keep-alives to the NAT desk ", g_deskPings);
}

/**
 * One datagram, going out or coming in.
 *
 * `sending` is which; `data` is the payload, only read for the first few of a
 * peer's datagrams. Anything that is not IPv4 is left alone without a word: the
 * game's own transport is UDP over IPv4 and something else here would be a
 * surprise worth not guessing about.
 */
static void agent_watch(const struct sockaddr *other, int len, int bytes, int sending,
                        const BYTE *data) {
  if (!other || len < (int)sizeof(struct sockaddr_in)) return;
  if (!readable(other, sizeof(struct sockaddr_in))) return;
  const struct sockaddr_in *in = (const struct sockaddr_in *)other;
  if (in->sin_family != AF_INET) return;

  const BYTE *rawPort = (const BYTE *)&in->sin_port;
  WORD port = (WORD)((rawPort[0] << 8) | rawPort[1]); /* the wire is big endian */
  DWORD addr = *(const DWORD *)&in->sin_addr;

  if (port == NAT_DESK_PORT) {
    g_deskPings++;
    g_reportPending = 1;
    agent_report();
    return;
  }

  AgentPeer *peer = agent_peer(addr, port);
  if (!peer) return;
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

  g_reportPending = 1;
  agent_report();
}

static int WINAPI agent_sendto_hook(SOCKET s, const char *buf, int len, int flags,
                                    const struct sockaddr *to, int tolen) {
  agent_watch(to, tolen, len, 1, (const BYTE *)buf);
  return g_agentSendTo(s, buf, len, flags, to, tolen);
}

static int WINAPI agent_recvfrom_hook(SOCKET s, char *buf, int len, int flags,
                                      struct sockaddr *from, int *fromlen) {
  // AFTER the call, because until it returns there is nothing to look at — and
  // only when it brought something: a non-blocking socket with nothing waiting
  // returns -1 all day, and counting those would drown the log in silence.
  int got = g_agentRecvFrom(s, buf, len, flags, from, fromlen);
  if (got > 0) agent_watch(from, fromlen ? *fromlen : 0, got, 0, (const BYTE *)buf);
  return got;
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
  g_lastReport = GetTickCount();
  return 1;
}
