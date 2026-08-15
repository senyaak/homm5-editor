// The u-lobby half: Ubisoft's lobby, carried out of the game over one WebSocket.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// TWO FEATURES, NOT ONE. net/agent.c carries the game's PEER traffic; this
// carries its LOBBY traffic. They are separate on purpose and share no state:
// different sockets, different connection, different config line, different
// switch. Either can be off while the other works, and a fault in one is not a
// fault in the other. What they do share is plumbing that belongs to neither —
// `relay_split_url` and the WinHTTP entry points — which is why this file is
// spliced in after net/relay.c and not before.
//
// WHY IT EXISTS. The game speaks HTTP to us exactly once, for its server list,
// and raw TCP and UDP for every service of it after that. A tunnel of the cloudflared
// family carries HTTP and WebSocket and nothing else, so no configuration of
// one can put the u-lobby behind it (h5e-lobby, SLICE_over_the_internet.md §1).
// The peer half already solved this shape of problem inside the game; this is
// the same answer for the other half.
//
// AND WHY IT HOOKS NOTHING. The u-lobby can be moved without touching a single
// call of the game's: the game asks for its server list through `http_proxy`,
// and every u-lobby address it then dials comes out of the answer we give. Point
// both at `127.0.0.1` and the game opens ordinary sockets to a listener of
// ours, in its own process, of its own accord. That is a whole class of hook —
// `connect`, `send`, `recv`, and the non-blocking semantics under them — that
// this file does not have to get right.
//
// THE SHAPE. One listener on the loopback takes the game's u-lobby connections and
// its u-lobby datagrams; each of them becomes a numbered stream or channel inside
// one WebSocket to `services/u-lobby` at the other end, which opens the real
// connection to the real u-lobby. The frames are three bytes and then the rest:
//
//   0x01 [id:u16] payload   bytes on a stream, either direction
//   0x02 [id:u16]           open a stream                      (we say it)
//   0x03 [id:u16]           the stream ended, either direction
//   0x04 [id:u16] payload   one datagram, on a channel, either direction
//
// A CHANNEL IS ONE OF OUR SOURCE ADDRESSES. Two of its services are UDP — the NAT
// mirror and the CD-key window — and the game may ask them from two sockets of
// its own. An answer has to go back to the socket that asked, so each source
// address the listener hears from gets a number, and the far end keeps a socket
// of its own per number. Without that the answer would be a guess.
//
// A THREAD PER CONNECTION, and no `select`. The count is small — a handful of
// services — and the alternative costs more than it saves here: `FD_ISSET` is a
// call into winsock's import library, and this DLL links nothing at all.
//
// AND THE GAME IS POINTED HERE BY US, not by a bat file. The one URL it fetches
// its server list from is a string the executable builds at startup, and it is
// rewritten in place once this listener is up — so there is no `http_proxy` to
// set, no launcher script to keep in step, and no way for the port in a bat file
// to disagree with the port we are listening on. See `lobby_point_the_game_here`.
//
// THE CONFIG, in `bin/homm5-editor-net.txt` beside the relay's own line:
//
//   u-lobby wss://host/u-lobby
//   u-lobby-port 8080
//
// The port is what the listener binds on the loopback and what the game is then
// told to ask; its default is the u-lobby's own `8080`.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_lobby

#define LOBBY_FRAME_DATA 0x01
#define LOBBY_FRAME_OPEN 0x02
#define LOBBY_FRAME_CLOSE 0x03
#define LOBBY_FRAME_DATAGRAM 0x04
/** Type and id, in front of every frame there is. */
#define LOBBY_HEADER 3

/**
 * How many u-lobby connections at once, and how many datagram sources.
 *
 * The measured lobby session opened eighteen connections over its whole life and
 * never many at a time; sixteen is room to spare, and a table that cannot grow is
 * a table that cannot leak.
 */
#define LOBBY_STREAMS 16
#define LOBBY_CHANNELS 8

/** The biggest thing that crosses. Its messages are hundreds of bytes, not thousands. */
#define LOBBY_BUFFER 4096

typedef SOCKET(WINAPI *LobbySocketFn)(int af, int type, int protocol);
typedef int(WINAPI *LobbyBindFn)(SOCKET s, const struct sockaddr *name, int namelen);
typedef int(WINAPI *LobbyListenFn)(SOCKET s, int backlog);
typedef SOCKET(WINAPI *LobbyAcceptFn)(SOCKET s, struct sockaddr *addr, int *addrlen);
typedef int(WINAPI *LobbyRecvFn)(SOCKET s, char *buf, int len, int flags);
typedef int(WINAPI *LobbySendFn)(SOCKET s, const char *buf, int len, int flags);
typedef int(WINAPI *LobbyRecvFromFn)(SOCKET s, char *buf, int len, int flags,
                                     struct sockaddr *from, int *fromlen);
typedef int(WINAPI *LobbySendToFn)(SOCKET s, const char *buf, int len, int flags,
                                   const struct sockaddr *to, int tolen);
typedef int(WINAPI *LobbyCloseFn)(SOCKET s);
/** `WSADATA` is 400 bytes at most and nothing here reads it — a buffer will do. */
typedef int(WINAPI *LobbyStartupFn)(WORD version, void *data);

static LobbySocketFn g_lobbySocket = NULL;
static LobbyBindFn g_lobbyBind = NULL;
static LobbyListenFn g_lobbyListen = NULL;
static LobbyAcceptFn g_lobbyAccept = NULL;
static LobbyRecvFn g_lobbyRecv = NULL;
static LobbySendFn g_lobbySend = NULL;
static LobbyRecvFromFn g_lobbyRecvFrom = NULL;
static LobbySendToFn g_lobbySendTo = NULL;
static LobbyCloseFn g_lobbyCloseSocket = NULL;

static char g_uLobbyUrl[256];
static int g_uLobbyPort = 8080;

static SOCKET g_uLobbyListener = INVALID_SOCKET;
static SOCKET g_uLobbyUdp = INVALID_SOCKET;

/** Its own WebSocket, its own state — nothing here is the relay's. */
static HINTERNET g_uLobbySession = NULL;
static HINTERNET g_uLobbyConnect = NULL;
static HINTERNET g_uLobbySocket = NULL;
static volatile LONG g_uLobbyReady = 0;
static volatile LONG g_uLobbyStop = 0;
static CRITICAL_SECTION g_uLobbySendLock;
static CRITICAL_SECTION g_uLobbyTableLock;
static int g_uLobbyLocksMade = 0;

/** What crossed, for the log line that says whether this did anything at all. */
static volatile LONG g_uLobbyOut = 0;
static volatile LONG g_uLobbyBack = 0;

typedef struct {
  SOCKET socket;
  int used;
} LobbyStream;

typedef struct {
  struct sockaddr_in from;
  int used;
} LobbyChannel;

static LobbyStream g_streams[LOBBY_STREAMS];
static LobbyChannel g_channels[LOBBY_CHANNELS];

// ---------------------------------------------------------------------------
// The config line of its own.
// ---------------------------------------------------------------------------

/**
 * Read `u-lobby` and `u-lobby-port` out of the file the relay line lives in.
 *
 * Its own reader rather than a share of the relay's: the two features are meant
 * to be separable, and a reader that knows both keys is a place where turning
 * one of them off can break the other. The file is a few hundred bytes and is
 * read once.
 */
static int lobby_read_config(void) {
  DWORD size = 0;
  char *buf = read_beside_us(L"homm5-editor-net.txt", &size);
  if (!buf) {
    log_line("lobby: no bin/homm5-editor-net.txt — nothing to dial");
    return 0;
  }
  const char *p = buf, *end = buf + size;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    const char *q = line;
    // The longer key first: `u-lobby-port` also begins with `u-lobby`, and taking the
    // short one would leave `-port 8080` as the address to dial.
    if (take_word(&q, stop, "u-lobby-port")) {
      int value = 0;
      if (read_int(&q, stop, &value) && value > 0 && value <= 0xffff) g_uLobbyPort = value;
      continue;
    }
    q = line;
    if (take_word(&q, stop, "u-lobby")) {
      relay_read_token(&q, stop, g_uLobbyUrl, sizeof(g_uLobbyUrl));
    }
  }
  VirtualFree(buf, 0, MEM_RELEASE);

  if (!g_uLobbyUrl[0]) {
    log_line("lobby: the config names no u-lobby tunnel");
    return 0;
  }
  log_text("lobby: ", g_uLobbyUrl);
  log_num("lobby: listening for the game on 127.0.0.1:", g_uLobbyPort);
  return 1;
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------

static void lobby_wire_drop(void) {
  InterlockedExchange(&g_uLobbyReady, 0);
  if (g_uLobbySocket) g_httpClose(g_uLobbySocket);
  if (g_uLobbyConnect) g_httpClose(g_uLobbyConnect);
  if (g_uLobbySession) g_httpClose(g_uLobbySession);
  g_uLobbySocket = g_uLobbyConnect = g_uLobbySession = NULL;
}

/**
 * Dial the u-lobby tunnel.
 *
 * `WINHTTP_ACCESS_TYPE_NO_PROXY` for the same reason the relay uses it, and here
 * the reason is sharper: the `http_proxy` that redirects the game points at OUR
 * OWN listener, so a session that honoured it would dial itself.
 */
static int lobby_dial(void) {
  char host[128], path[192];
  WORD port = 0;
  int secure = 0;
  if (!relay_split_url(g_uLobbyUrl, host, sizeof(host), &port, path, sizeof(path), &secure)) {
    log_text("lobby: this is not an address I can read: ", g_uLobbyUrl);
    return 0;
  }

  WCHAR hostW[128], pathW[192];
  relay_widen(host, hostW, 128);
  relay_widen(path, pathW, 192);

  // EVERY FAILURE SAYS SO. A first run spent fifteen seconds with no tunnel and
  // an empty log, because these three returned nothing and said nothing — and a
  // dial that fails in silence is indistinguishable from one that never ran.
  g_uLobbySession = g_httpOpen(L"h5e-u-lobby", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
  if (!g_uLobbySession) {
    log_num("lobby: could not open a WinHTTP session, last error ", (int)GetLastError());
    return 0;
  }
  g_uLobbyConnect = g_httpConnect(g_uLobbySession, hostW, port, 0);
  if (!g_uLobbyConnect) {
    log_num("lobby: could not reach that host, last error ", (int)GetLastError());
    lobby_wire_drop();
    return 0;
  }
  HINTERNET request = g_httpOpenRequest(g_uLobbyConnect, L"GET", pathW, NULL, NULL, NULL,
                                        secure ? WINHTTP_FLAG_SECURE : 0);
  if (!request) {
    log_num("lobby: could not open the request, last error ", (int)GetLastError());
    lobby_wire_drop();
    return 0;
  }
  /**
   * THE ERROR IS TAKEN WHERE IT HAPPENS, and the step is named.
   *
   * Reading `GetLastError` after the handle is closed reports nothing: a call
   * that SUCCEEDS is free to reset it, and `WinHttpCloseHandle` does — which is
   * why a refused upgrade logged "last error 0" and a run was spent on it. Four
   * calls can fail here and they fail for entirely different reasons; which one
   * it was is most of the answer.
   */
  const char *step = NULL;
  DWORD why = 0;
  if (!g_httpSetOption(request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0)) {
    step = "asking for a WebSocket";
    why = GetLastError();
  } else if (!g_httpSendRequest(request, NULL, 0, NULL, 0, 0, 0)) {
    step = "sending the request";
    why = GetLastError();
  } else if (!g_httpReceiveResponse(request, NULL)) {
    step = "reading the answer";
    why = GetLastError();
  } else {
    g_uLobbySocket = g_httpCompleteUpgrade(request, 0);
    if (!g_uLobbySocket) {
      step = "completing the upgrade";
      why = GetLastError();
      /**
       * AND WHAT THE FAR END ACTUALLY SAID.
       *
       * This call answers `ERROR_INVALID_OPERATION` for every response that is
       * not a `101`, so the error number is the same whether the tunnel is down,
       * the path is wrong or something in front of it is asking a question. The
       * status code tells those apart at a glance — a run was spent on a `4317`
       * that turned out to be Cloudflare's `530`, its way of saying the tunnel
       * on the other side is not connected.
       */
      DWORD status = 0, size = (DWORD)sizeof(status);
      if (g_httpQueryHeaders &&
          g_httpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL,
                             &status, &size, NULL)) {
        log_num("lobby: the far end answered with status ", (int)status);
      }
    }
  }
  g_httpClose(request);
  if (!g_uLobbySocket) {
    log_text("lobby: the upgrade was refused while ", step);
    log_num("lobby: and the error was ", (int)why);
    lobby_wire_drop();
    return 0;
  }
  InterlockedExchange(&g_uLobbyReady, 1);
  log_line("lobby: connected");
  return 1;
}

/** One frame out. Called from whichever thread had something to say. */
/** Said once per outage, not once per message: the game repeats, the log must not. */
static volatile LONG g_uLobbySaidNotReady = 0;

static int lobby_wire_send(BYTE type, WORD id, const BYTE *payload, int len) {
  if (!InterlockedCompareExchange(&g_uLobbyReady, 1, 1)) {
    // THE SILENT DROP IS WHAT COST A RUN. The game sent its NAT datagrams at a
    // listener whose tunnel was not up, they went nowhere, and nothing said so —
    // fifteen seconds of the game's own timeout, and a log with no answer in it.
    if (!InterlockedExchange(&g_uLobbySaidNotReady, 1))
      log_line("lobby: the game is talking to us and the tunnel is not up — dropping until it is");
    return 0;
  }
  InterlockedExchange(&g_uLobbySaidNotReady, 0);
  if (len < 0 || len > LOBBY_BUFFER) return 0;
  BYTE frame[LOBBY_HEADER + LOBBY_BUFFER];
  frame[0] = type;
  frame[1] = (BYTE)(id >> 8);
  frame[2] = (BYTE)(id & 0xff);
  for (int i = 0; i < len; i++) frame[LOBBY_HEADER + i] = payload[i];

  EnterCriticalSection(&g_uLobbySendLock);
  DWORD failed = g_uLobbySocket ? g_httpSocketSend(g_uLobbySocket, WS_BINARY_MESSAGE, (PVOID)frame,
                                                  (DWORD)(LOBBY_HEADER + len))
                               : 1;
  LeaveCriticalSection(&g_uLobbySendLock);
  if (failed) {
    // The receive loop finds the same break and dials again; saying it in both
    // places would fill the log with one dead connection.
    InterlockedExchange(&g_uLobbyReady, 0);
    return 0;
  }
  if (len) InterlockedIncrement(&g_uLobbyOut);
  return 1;
}

// ---------------------------------------------------------------------------
// The tables. Both threads reach them, so both take the lock.
// ---------------------------------------------------------------------------

static int lobby_take_stream(SOCKET s) {
  EnterCriticalSection(&g_uLobbyTableLock);
  int id = -1;
  for (int i = 0; i < LOBBY_STREAMS; i++) {
    if (g_streams[i].used) continue;
    g_streams[i].used = 1;
    g_streams[i].socket = s;
    id = i;
    break;
  }
  LeaveCriticalSection(&g_uLobbyTableLock);
  return id;
}

static SOCKET lobby_stream_socket(int id) {
  if (id < 0 || id >= LOBBY_STREAMS) return INVALID_SOCKET;
  EnterCriticalSection(&g_uLobbyTableLock);
  SOCKET s = g_streams[id].used ? g_streams[id].socket : INVALID_SOCKET;
  LeaveCriticalSection(&g_uLobbyTableLock);
  return s;
}

/** Give the slot back, and hand out the socket to close exactly once. */
static SOCKET lobby_free_stream(int id) {
  if (id < 0 || id >= LOBBY_STREAMS) return INVALID_SOCKET;
  EnterCriticalSection(&g_uLobbyTableLock);
  SOCKET s = INVALID_SOCKET;
  if (g_streams[id].used) {
    s = g_streams[id].socket;
    g_streams[id].used = 0;
    g_streams[id].socket = INVALID_SOCKET;
  }
  LeaveCriticalSection(&g_uLobbyTableLock);
  return s;
}

/** Which channel this source address is, making one if it is new. */
static int lobby_channel_for(const struct sockaddr_in *from) {
  EnterCriticalSection(&g_uLobbyTableLock);
  int id = -1;
  for (int i = 0; i < LOBBY_CHANNELS; i++) {
    if (!g_channels[i].used) continue;
    if (g_channels[i].from.sin_port == from->sin_port &&
        *(const DWORD *)&g_channels[i].from.sin_addr == *(const DWORD *)&from->sin_addr) {
      id = i;
      break;
    }
  }
  if (id < 0) {
    for (int i = 0; i < LOBBY_CHANNELS; i++) {
      if (g_channels[i].used) continue;
      g_channels[i].used = 1;
      g_channels[i].from = *from;
      id = i;
      break;
    }
  }
  LeaveCriticalSection(&g_uLobbyTableLock);
  return id;
}

static int lobby_channel_address(int id, struct sockaddr_in *out) {
  if (id < 0 || id >= LOBBY_CHANNELS) return 0;
  EnterCriticalSection(&g_uLobbyTableLock);
  int ok = g_channels[id].used;
  if (ok) *out = g_channels[id].from;
  LeaveCriticalSection(&g_uLobbyTableLock);
  return ok;
}

// ---------------------------------------------------------------------------
// The threads.
// ---------------------------------------------------------------------------

/**
 * The server list, answered here and not carried anywhere.
 *
 * IT IS A LOCAL QUESTION. The ini says where this copy's u-lobby is, and for a
 * copy that carries them through us the answer is always the same: all of them,
 * at our own loopback port. The lobby at the far end has no way to know that
 * number — it is this machine's — and asking it would only get back an address
 * meant for somebody dialling the u-lobby directly, which is exactly what a
 * tunnelled game cannot do.
 *
 * THE PRICE, said out loud: the prefixes below are a copy of the u-lobby's own
 * table (`SERVICES` in services/u-lobby/main.ts). A u-lobby service added there has to be
 * added here. They have been one number since they were merged, so what
 * would go stale is the LIST, not the address — and a missing prefix is a game
 * that says it cannot reach the service by name, which is legible.
 *
 * Windows' profile-string reader wants CRLF and a trailing newline.
 */
static int lobby_servers_ini(char *out, int room) {
  static const char *const PREFIX[] = { "Router", "NATServer", "CDKeyServer", "IRC" };
  /** Which of them are handed a `%sLauncherPort%i` as well — the u-lobby's own answer. */
  static const int LAUNCHER[] = { 1, 0, 1, 0 };

  char port[12];
  int portLen = 0;
  num_to_dec(g_uLobbyPort, port, &portLen);

  int at = 0;
  const char *head = "[Servers]\r\n";
  for (const char *p = head; *p; p++) {
    if (at + 1 >= room) return 0;
    out[at++] = *p;
  }
  for (int i = 0; i < 4; i++) {
    /** `IP0`, then `Port0`, then the launcher if this service has one. */
    for (int field = 0; field < 3; field++) {
      if (field == 2 && !LAUNCHER[i]) continue;
      const char *tail = field == 0 ? "IP0=" : field == 1 ? "Port0=" : "LauncherPort0=";
      const char *value = field == 0 ? "127.0.0.1" : port;
      int valueLen = field == 0 ? 9 : portLen;
      int need = 0;
      for (const char *p = PREFIX[i]; *p; p++) need++;
      for (const char *p = tail; *p; p++) need++;
      if (at + need + valueLen + 3 >= room) return 0;
      for (const char *p = PREFIX[i]; *p; p++) out[at++] = *p;
      for (const char *p = tail; *p; p++) out[at++] = *p;
      for (int j = 0; j < valueLen; j++) out[at++] = value[j];
      out[at++] = '\r';
      out[at++] = '\n';
    }
  }
  out[at] = 0;
  return at;
}

/** The ini, wrapped in the smallest answer curl will read. */
static int lobby_answer_the_list(SOCKET s) {
  char ini[512];
  int iniLen = lobby_servers_ini(ini, (int)sizeof(ini));
  if (!iniLen) {
    log_line("lobby: no room to write the server list — the game is left without one");
    return 0;
  }

  char reply[768];
  int at = 0, digits = 0;
  for (const char *p = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: "; *p; p++)
    reply[at++] = *p;
  num_to_dec(iniLen, reply + at, &digits);
  at += digits;
  // `close`, because the game asks this once and curl is happier being told than
  // waiting to find out.
  for (const char *p = "\r\nConnection: close\r\n\r\n"; *p; p++) reply[at++] = *p;
  for (int i = 0; i < iniLen; i++) reply[at++] = ini[i];

  int wrote = 0;
  while (wrote < at) {
    int n = g_lobbySend(s, reply + wrote, at - wrote, 0);
    if (n <= 0) return 0;
    wrote += n;
  }
  log_num("lobby: answered the game's server list, every u-lobby service at 127.0.0.1:", g_uLobbyPort);
  return 1;
}

/**
 * One accepted u-lobby connection, read until it ends.
 *
 * The first message decides what this is, the same way the u-lobby decides which
 * u-lobby service a connection wants (`services/u-lobby/classify.ts`): a `GET ` is the server
 * list and is answered here; anything else is a u-lobby service and is carried. Which is
 * why the stream is not announced on accept — until something has been said
 * there is nothing to announce, and the list must not become a stream at all.
 */
static DWORD WINAPI lobby_stream_thread(LPVOID which) {
  int id = (int)(INT_PTR)which;
  SOCKET s = lobby_stream_socket(id);
  if (s == INVALID_SOCKET) return 0;

  BYTE *buf = (BYTE *)VirtualAlloc(NULL, LOBBY_BUFFER, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  int announced = 0;
  for (;;) {
    int got = g_lobbyRecv(s, (char *)buf, LOBBY_BUFFER, 0);
    if (got <= 0) break;
    if (!announced) {
      if (got >= 4 && buf[0] == 'G' && buf[1] == 'E' && buf[2] == 'T' && buf[3] == ' ') {
        lobby_answer_the_list(s);
        break;
      }
      lobby_wire_send(LOBBY_FRAME_OPEN, (WORD)id, NULL, 0);
      log_num("lobby: the game opened u-lobby stream ", id);
      announced = 1;
    }
    if (!lobby_wire_send(LOBBY_FRAME_DATA, (WORD)id, buf, got)) break;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  if (!announced) {
    SOCKET mine = lobby_free_stream(id);
    if (mine != INVALID_SOCKET) g_lobbyCloseSocket(mine);
    return 0;
  }

  SOCKET mine = lobby_free_stream(id);
  if (mine != INVALID_SOCKET) {
    lobby_wire_send(LOBBY_FRAME_CLOSE, (WORD)id, NULL, 0);
    g_lobbyCloseSocket(mine);
    log_num("lobby: the game closed u-lobby stream ", id);
  }
  return 0;
}

/** The listener: every u-lobby connection the game opens to us. */
static DWORD WINAPI lobby_accept_thread(LPVOID unused) {
  (void)unused;
  for (;;) {
    struct sockaddr_in from;
    int size = (int)sizeof(from);
    SOCKET s = g_lobbyAccept(g_uLobbyListener, (struct sockaddr *)&from, &size);
    if (s == INVALID_SOCKET) {
      if (InterlockedCompareExchange(&g_uLobbyStop, 0, 0)) break;
      Sleep(50);
      continue;
    }
    int id = lobby_take_stream(s);
    if (id < 0) {
      // Refusing is the honest answer: carrying it as somebody else's stream would
      // interleave two services, and the classifier at the far end would see nonsense.
      log_line("lobby: more u-lobby connections at once than there is room for — refused");
      g_lobbyCloseSocket(s);
      continue;
    }
    // Nothing is said to the far end yet: what this connection turns out to be is
    // in the first message, and one of the things it can be is a question we
    // answer ourselves.
    HANDLE thread = CreateThread(NULL, 0, lobby_stream_thread, (LPVOID)(INT_PTR)id, 0, NULL);
    if (!thread) {
      SOCKET mine = lobby_free_stream(id);
      if (mine != INVALID_SOCKET) g_lobbyCloseSocket(mine);
      continue;
    }
    CloseHandle(thread);
  }
  return 0;
}

/** The services that answer datagrams: the NAT mirror and the CD-key window. */
static DWORD WINAPI lobby_datagram_thread(LPVOID unused) {
  (void)unused;
  BYTE *buf = (BYTE *)VirtualAlloc(NULL, LOBBY_BUFFER, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  for (;;) {
    struct sockaddr_in from;
    int size = (int)sizeof(from);
    int got = g_lobbyRecvFrom(g_uLobbyUdp, (char *)buf, LOBBY_BUFFER, 0, (struct sockaddr *)&from,
                              &size);
    if (got <= 0) {
      if (InterlockedCompareExchange(&g_uLobbyStop, 0, 0)) break;
      Sleep(20);
      continue;
    }
    int id = lobby_channel_for(&from);
    if (id < 0) {
      log_line("lobby: more datagram sources than there is room for — dropped");
      continue;
    }
    lobby_wire_send(LOBBY_FRAME_DATAGRAM, (WORD)id, buf, got);
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  return 0;
}

/** What came back from the tunnel, put where the game will find it. */
static void lobby_inbound(const BYTE *bytes, int len) {
  if (len < LOBBY_HEADER) return;
  BYTE type = bytes[0];
  int id = (bytes[1] << 8) | bytes[2];
  const BYTE *payload = bytes + LOBBY_HEADER;
  int size = len - LOBBY_HEADER;

  if (type == LOBBY_FRAME_DATA) {
    SOCKET s = lobby_stream_socket(id);
    if (s == INVALID_SOCKET) return;
    int at = 0;
    while (at < size) {
      int wrote = g_lobbySend(s, (const char *)payload + at, size - at, 0);
      if (wrote <= 0) return;
      at += wrote;
    }
    InterlockedIncrement(&g_uLobbyBack);
    return;
  }
  if (type == LOBBY_FRAME_CLOSE) {
    SOCKET s = lobby_free_stream(id);
    // Closing it is also how its own thread is woken: a blocking `recv` on a closed
    // socket returns rather than waiting for bytes that will never come.
    if (s != INVALID_SOCKET) g_lobbyCloseSocket(s);
    return;
  }
  if (type == LOBBY_FRAME_DATAGRAM) {
    struct sockaddr_in to;
    if (!lobby_channel_address(id, &to)) return;
    g_lobbySendTo(g_uLobbyUdp, (const char *)payload, size, 0, (const struct sockaddr *)&to,
                  (int)sizeof(to));
    InterlockedIncrement(&g_uLobbyBack);
    return;
  }
}

/**
 * The wire's own thread: dial, read until it breaks, dial again.
 *
 * `WinHttpWebSocketReceive` blocks, and the threads that must not block are the
 * game's — so the reading is here and the sending is done by whoever had
 * something to send, behind a lock. WinHTTP allows exactly one of each at a
 * time, which is this arrangement.
 */
static DWORD WINAPI lobby_wire_thread(LPVOID unused) {
  (void)unused;
  BYTE *buf = (BYTE *)VirtualAlloc(NULL, LOBBY_HEADER + LOBBY_BUFFER, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  DWORD wait = RELAY_RETRY_MIN_MS;

  while (!InterlockedCompareExchange(&g_uLobbyStop, 0, 0)) {
    if (!lobby_dial()) {
      lobby_wire_drop();
      Sleep(wait);
      wait = wait * 2 > RELAY_RETRY_MAX_MS ? RELAY_RETRY_MAX_MS : wait * 2;
      continue;
    }
    wait = RELAY_RETRY_MIN_MS;

    for (;;) {
      DWORD got = 0, type = 0;
      DWORD failed =
          g_httpSocketReceive(g_uLobbySocket, buf, LOBBY_HEADER + LOBBY_BUFFER, &got, &type);
      if (failed) {
        log_num("lobby: the connection ended, last error ", (int)failed);
        break;
      }
      if (type == WS_CLOSE) {
        log_line("lobby: the other end closed it");
        break;
      }
      if (type == WS_BINARY_FRAGMENT) {
        log_line("lobby: a frame too long to be one of ours — dropped");
        continue;
      }
      if (got) lobby_inbound(buf, (int)got);
    }
    lobby_wire_drop();

    // Every u-lobby stream belonged to that connection. Keeping them across a redial
    // would hand the far end stream numbers it has never heard of, and the game a
    // u-lobby service that answers nothing.
    for (int i = 0; i < LOBBY_STREAMS; i++) {
      SOCKET s = lobby_free_stream(i);
      if (s != INVALID_SOCKET) g_lobbyCloseSocket(s);
    }
    if (!InterlockedCompareExchange(&g_uLobbyStop, 0, 0)) Sleep(RELAY_RETRY_MIN_MS);
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  return 0;
}

// ---------------------------------------------------------------------------
// Starting it.
// ---------------------------------------------------------------------------

static int lobby_load_winsock(void) {
  HMODULE ws = GetModuleHandleA("wsock32.dll");
  if (!ws) ws = GetModuleHandleA("ws2_32.dll");
  if (!ws) {
    log_line("lobby: no winsock in this process yet");
    return 0;
  }
  g_lobbySocket = (LobbySocketFn)GetProcAddress(ws, "socket");
  g_lobbyBind = (LobbyBindFn)GetProcAddress(ws, "bind");
  g_lobbyListen = (LobbyListenFn)GetProcAddress(ws, "listen");
  g_lobbyAccept = (LobbyAcceptFn)GetProcAddress(ws, "accept");
  g_lobbyRecv = (LobbyRecvFn)GetProcAddress(ws, "recv");
  g_lobbySend = (LobbySendFn)GetProcAddress(ws, "send");
  g_lobbyRecvFrom = (LobbyRecvFromFn)GetProcAddress(ws, "recvfrom");
  g_lobbySendTo = (LobbySendToFn)GetProcAddress(ws, "sendto");
  g_lobbyCloseSocket = (LobbyCloseFn)GetProcAddress(ws, "closesocket");
  LobbyStartupFn startup = (LobbyStartupFn)GetProcAddress(ws, "WSAStartup");

  if (!g_lobbySocket || !g_lobbyBind || !g_lobbyListen || !g_lobbyAccept || !g_lobbyRecv ||
      !g_lobbySend || !g_lobbyRecvFrom || !g_lobbySendTo || !g_lobbyCloseSocket || !startup) {
    log_line("lobby: this winsock is missing something we need");
    return 0;
  }

  /**
   * OUR OWN `WSAStartup`, and this is not politeness.
   *
   * This thread runs from `DllMain`, which is long before the game's own
   * `SocketsInit` — and until somebody in the process has called this, every
   * `socket()` fails with WSANOTINITIALISED. That is exactly what a first run
   * did: winsock was ours, the sockets were not opened, and the whole feature
   * stopped there. The call is reference-counted per caller, so ours and the
   * game's do not touch: neither can shut the other's down.
   */
  BYTE data[512];
  int failed = startup(0x0202, data);
  if (failed) {
    log_num("lobby: winsock would not start for us, error ", failed);
    return 0;
  }
  // Taken from the library, never from the game's import table — so the peer half's
  // hooks are not in this path and cannot be, whichever of the two is installed.
  return 1;
}

/** Both sockets on the loopback, or neither: half of them is a lobby that half works. */
static int lobby_open_sockets(void) {
  struct sockaddr_in at;
  for (int i = 0; i < (int)sizeof(at); i++) ((BYTE *)&at)[i] = 0;
  at.sin_family = AF_INET;
  BYTE *port = (BYTE *)&at.sin_port;
  port[0] = (BYTE)(g_uLobbyPort >> 8);
  port[1] = (BYTE)(g_uLobbyPort & 0xff);
  BYTE *octets = (BYTE *)&at.sin_addr;
  octets[0] = 127;
  octets[1] = 0;
  octets[2] = 0;
  octets[3] = 1;

  g_uLobbyListener = g_lobbySocket(AF_INET, SOCK_STREAM, 0);
  if (g_uLobbyListener == INVALID_SOCKET) {
    // The one path out of here that used to say nothing, and the one a first run
    // took: WSANOTINITIALISED, because this ran before anybody had started winsock.
    log_num("lobby: winsock would not give us a socket, error ", (int)GetLastError());
    return 0;
  }
  if (g_lobbyBind(g_uLobbyListener, (const struct sockaddr *)&at, (int)sizeof(at)) != 0 ||
      g_lobbyListen(g_uLobbyListener, 8) != 0) {
    // Almost always somebody else on the number — a u-lobby of our own running on
    // this machine, most likely. Saying which port it was is the whole diagnosis.
    log_num("lobby: could not listen on 127.0.0.1:", g_uLobbyPort);
    g_lobbyCloseSocket(g_uLobbyListener);
    g_uLobbyListener = INVALID_SOCKET;
    return 0;
  }

  g_uLobbyUdp = g_lobbySocket(AF_INET, SOCK_DGRAM, 0);
  if (g_uLobbyUdp == INVALID_SOCKET ||
      g_lobbyBind(g_uLobbyUdp, (const struct sockaddr *)&at, (int)sizeof(at)) != 0) {
    log_num("lobby: could not take the datagram side of 127.0.0.1:", g_uLobbyPort);
    if (g_uLobbyUdp != INVALID_SOCKET) g_lobbyCloseSocket(g_uLobbyUdp);
    g_lobbyCloseSocket(g_uLobbyListener);
    g_uLobbyUdp = g_uLobbyListener = INVALID_SOCKET;
    return 0;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Pointing the game at us.
// ---------------------------------------------------------------------------

/**
 * Where the executable keeps the one URL its whole online stack hangs from.
 *
 * NOT a character buffer, whatever an earlier note said: it is three pointers —
 * `begin`, `end`, `capacity_end` — and the text is on the game's own pool heap.
 * `GetServersConfig` (0xE07A50) hands the ADDRESS of this object to the string
 * concatenation that appends the product id, and curl is given the fresh buffer
 * that comes out of it. So the thing to rewrite is what `begin` points AT.
 */
#define URL_OBJECT_RVA 0xe1a81cu
#define URL_END_RVA 0xe1a820u

/**
 * The literal the constructor copies from, and the only part of this that can be
 * checked without running the game.
 *
 * The two addresses above are `.data` that nothing has written yet on disk — a
 * pointer to the heap, made at startup — so `tools/test-native-anchors.ts` can
 * only list them, and it does. This one is `.rdata` and is checked there, which
 * is what says the string below is still the string the game carries.
 */
#define URL_LITERAL_RVA 0xbe5facu
static const BYTE URL_LITERAL_HEAD[] = {
  /* the first twelve characters of the address below, spelled out: the anchor
     collector strips line comments before it reads the bytes, so a comment with
     a slash pair in it takes the last byte with it. */
  0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x67, 0x73, 0x63, 0x6f, 0x6e
};

/**
 * What has to be there before we write, and what goes in its place.
 *
 * The buffer was allocated with room for 44 (`push 2Ch` in the constructor) and
 * is freed on exit through the game's own pool allocator — so the pointer must
 * stay the game's and only the bytes inside it are ours. 43 characters is the
 * ceiling, and `http://127.0.0.1:65535/gsinit.php?dp=` is 37 of them.
 */
static const char URL_EXPECTED[] = "http://gsconnect.ubisoft.com/gsinit.php?dp=";
#define URL_ROOM 43

/**
 * Rewrite that URL to name our own listener.
 *
 * WHEN. The string is built by a static constructor (0x4D0080, an entry in
 * `.CRT$XCU`), which runs inside the executable's entry point — after every
 * imported DLL has had its `DllMain` and before `WinMain`. Writing from
 * `DllMain` would therefore be undone a moment later, so this waits for the
 * text it expects to appear and only then replaces it. What it waits for IS the
 * check: bytes that are not the ones we know are left alone, exactly as
 * `detour` refuses a function whose head it does not recognise.
 *
 * THE LENGTH IS A FIELD, not a `strlen`. The concatenation reads `end - begin`,
 * so a shorter URL that forgot to move `end` would carry the tail of the old
 * one into the request.
 */
static int lobby_point_the_game_here(void) {
  BYTE *image = (BYTE *)GetModuleHandleW(NULL);
  char **begin = (char **)(image + URL_OBJECT_RVA);
  char **end = (char **)(image + URL_END_RVA);

  // Room for the longest this can be — five digits of port — checked below all
  // the same, because a buffer that is exactly big enough is one edit from not.
  char ours[64];
  int at = 0, digits = 0;
  for (const char *p = "http://127.0.0.1:"; *p; p++) ours[at++] = *p;
  num_to_dec(g_uLobbyPort, ours + at, &digits);
  at += digits;
  for (const char *p = "/gsinit.php?dp="; *p; p++) ours[at++] = *p;
  ours[at] = 0;
  if (at > URL_ROOM) {
    log_line("lobby: our own address does not fit where the game keeps its URL");
    return 0;
  }

  // AND SAY IF SOMETHING ELSE IS ALREADY DECIDING. `http_proxy` in the
  // environment beats everything below it: the game's curl sends its request to
  // that proxy whatever the URL says, so a copy still started by the old bat file
  // reaches whatever the bat named and none of this shows up anywhere. One run
  // went that way and looked, in the log, exactly like a redirection that worked.
  char proxy[128];
  DWORD proxyLen = GetEnvironmentVariableA("http_proxy", proxy, sizeof(proxy));
  if (proxyLen > 0 && proxyLen < sizeof(proxy)) {
    log_text("lobby: http_proxy is set and OVERRIDES us — the game will ask ", proxy);
    log_line("lobby: start bin/H5_Game_H5E.exe directly; the bat file is not needed any more");
  }

  // Half a minute of looking, in case a machine is slow to get through its
  // initialisers. Nothing is drawn yet while this runs, and it is one thread.
  // WHAT IT SEES, ON THE FIRST LOOK. Waiting silently for thirty seconds and only
  // then saying "never built it" costs a launch to learn nothing: the game gives
  // up in four. This says the pointer it read straight away, so a run answers
  // whether the address is right, whether the constructor has run yet, or whether
  // this thread reached here at all — three questions that looked identical.
  log_hex("lobby: the game's server-list URL object holds ", (DWORD)(ULONG_PTR)*begin);

  for (int tries = 0; tries < 600; tries++) {
    char *text = *begin;
    if (text && readable(text, sizeof(URL_EXPECTED))) {
      int same = 1;
      for (int i = 0; URL_EXPECTED[i]; i++) {
        if (text[i] != URL_EXPECTED[i]) {
          same = 0;
          break;
        }
      }
      if (same) {
        for (int i = 0; i <= at; i++) text[i] = ours[i];
        *end = text + at;
        log_text("lobby: the game now asks for its server list at ", ours);
        return 1;
      }
      // Something is there and it is not what this was written against. Saying so
      // and leaving it is the only safe answer — the game keeps its own URL and
      // the u-lobby services are simply not reached, which is visible rather than silent.
      log_text("lobby: the game's server-list URL is not the one we know: ", text);
      return 0;
    }
    Sleep(50);
  }
  log_line("lobby: the game never built its server-list URL — not redirected");
  return 0;
}

// ---------------------------------------------------------------------------
// Starting it.
// ---------------------------------------------------------------------------

/**
 * Everything that must not happen under the loader lock, on a thread of its own.
 *
 * `DllMain` is where the mod's switches are read, and it is the one place none of
 * this can be done: WinHTTP is reached with `LoadLibrary`, which under the loader
 * lock is a way to hang the game before it has drawn anything, and the URL this
 * rewrites does not exist yet — a static constructor builds it a moment later.
 * So `install_lobby` starts this and returns, and this thread becomes the wire.
 */
static DWORD WINAPI lobby_start_thread(LPVOID unused) {
  (void)unused;
  // A LINE PER STEP, because two runs were spent asking where this stopped. Each
  // of these can fail and say so; none of them said anything about SUCCEEDING,
  // so a thread that died at the first one and a thread that never started read
  // the same in the log. They are three lines and they end that question.
  if (!relay_load_winhttp()) return 0;
  log_line("lobby: winhttp is loaded");
  if (!lobby_load_winsock()) return 0;
  log_line("lobby: winsock is ours");
  if (!lobby_open_sockets()) return 0;
  log_line("lobby: both sockets are open");

  // EVERYTHING THAT CARRIES, BEFORE ANYTHING THAT WAITS. The redirection below
  // waits for the game to build a string, which can be seconds, and a first run
  // showed what putting it first costs: the game reached its NAT step, sent its
  // datagrams at a listener whose tunnel had not been dialled yet, and sat there
  // for the fifteen seconds of its own timeout before giving up. The tunnel is
  // what takes longest to come up, so it starts first and the rest catches up.
  HANDLE listener = CreateThread(NULL, 0, lobby_accept_thread, NULL, 0, NULL);
  HANDLE datagrams = CreateThread(NULL, 0, lobby_datagram_thread, NULL, 0, NULL);
  HANDLE wire = CreateThread(NULL, 0, lobby_wire_thread, NULL, 0, NULL);
  if (!listener || !datagrams || !wire) {
    log_line("lobby: could not start its threads");
    InterlockedExchange(&g_uLobbyStop, 1);
    return 0;
  }
  CloseHandle(listener);
  CloseHandle(datagrams);
  CloseHandle(wire);

  if (!lobby_point_the_game_here()) {
    // The u-lobby stays the game's own, and so this carries nothing — but the
    // sockets and the tunnel stay up, because a game told where to go by some
    // other means (a proxy in its environment, a `hosts` line) still arrives
    // here, and refusing to carry what does arrive would be a second failure on
    // top of the first.
    log_line("lobby: not redirected — carrying only what reaches us anyway");
    return 0;
  }
  log_line("lobby: the u-lobby is carried out");
  return 0;
}

/**
 * Stand up the lobby half, if this installation was told where to carry it.
 *
 * All this does is read the config and start a thread — see above for why it
 * cannot do more from where it is called.
 */
static int install_lobby(void) {
  if (!lobby_read_config()) return 0;

  if (!g_uLobbyLocksMade) {
    InitializeCriticalSection(&g_uLobbySendLock);
    InitializeCriticalSection(&g_uLobbyTableLock);
    g_uLobbyLocksMade = 1;
  }
  for (int i = 0; i < LOBBY_STREAMS; i++) g_streams[i].socket = INVALID_SOCKET;

  HANDLE start = CreateThread(NULL, 0, lobby_start_thread, NULL, 0, NULL);
  if (!start) {
    log_line("lobby: could not start its thread");
    return 0;
  }
  CloseHandle(start);
  return 1;
}
