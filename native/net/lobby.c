// The lobby half: the game's DESK sockets, carried out over one WebSocket.
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
// and raw TCP and UDP for every desk after that. A tunnel of the cloudflared
// family carries HTTP and WebSocket and nothing else, so no configuration of
// one can put the desks behind it (h5e-lobby, SLICE_over_the_internet.md §1).
// The peer half already solved this shape of problem inside the game; this is
// the same answer for the other half.
//
// AND WHY IT HOOKS NOTHING. The desks can be moved without touching a single
// call of the game's: the game asks for its server list through `http_proxy`,
// and every desk address it then dials comes out of the answer we give. Point
// both at `127.0.0.1` and the game opens ordinary sockets to a listener of
// ours, in its own process, of its own accord. That is a whole class of hook —
// `connect`, `send`, `recv`, and the non-blocking semantics under them — that
// this file does not have to get right.
//
// THE SHAPE. One listener on the loopback takes the game's desk connections and
// its desk datagrams; each of them becomes a numbered stream or channel inside
// one WebSocket to `services/desks` at the other end, which opens the real
// connection to the real gateway. The frames are three bytes and then the rest:
//
//   0x01 [id:u16] payload   bytes on a stream, either direction
//   0x02 [id:u16]           open a stream                      (we say it)
//   0x03 [id:u16]           the stream ended, either direction
//   0x04 [id:u16] payload   one datagram, on a channel, either direction
//
// A CHANNEL IS ONE OF OUR SOURCE ADDRESSES. Two of the desks are UDP — the NAT
// mirror and the CD-key window — and the game may ask them from two sockets of
// its own. An answer has to go back to the socket that asked, so each source
// address the listener hears from gets a number, and the far end keeps a socket
// of its own per number. Without that the answer would be a guess.
//
// A THREAD PER CONNECTION, and no `select`. The count is small — a handful of
// desks — and the alternative costs more than it saves here: `FD_ISSET` is a
// call into winsock's import library, and this DLL links nothing at all.
//
// THE CONFIG, in `bin/homm5-editor-net.txt` beside the relay's own line:
//
//   desks wss://host/desks
//   desks-port 8080
//
// The port is what the listener binds on the loopback, and it has to be the one
// the game is told to use — `http_proxy=http://127.0.0.1:8080` in the copy's bat
// file, and the desk addresses in the ini we are served. Its default is the
// gateway's own `8080`, so all three agree while nobody changes anything.

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
 * How many desk connections at once, and how many datagram sources.
 *
 * The measured lobby session opened eighteen connections over its whole life and
 * never many at a time; sixteen is room to spare, and a table that cannot grow is
 * a table that cannot leak.
 */
#define LOBBY_STREAMS 16
#define LOBBY_CHANNELS 8

/** The biggest thing that crosses. Desk messages are hundreds of bytes, not thousands. */
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

static LobbySocketFn g_lobbySocket = NULL;
static LobbyBindFn g_lobbyBind = NULL;
static LobbyListenFn g_lobbyListen = NULL;
static LobbyAcceptFn g_lobbyAccept = NULL;
static LobbyRecvFn g_lobbyRecv = NULL;
static LobbySendFn g_lobbySend = NULL;
static LobbyRecvFromFn g_lobbyRecvFrom = NULL;
static LobbySendToFn g_lobbySendTo = NULL;
static LobbyCloseFn g_lobbyCloseSocket = NULL;

static char g_desksUrl[256];
static int g_desksPort = 8080;

static SOCKET g_desksListener = INVALID_SOCKET;
static SOCKET g_desksUdp = INVALID_SOCKET;

/** Its own WebSocket, its own state — nothing here is the relay's. */
static HINTERNET g_desksSession = NULL;
static HINTERNET g_desksConnect = NULL;
static HINTERNET g_desksSocket = NULL;
static volatile LONG g_desksReady = 0;
static volatile LONG g_desksStop = 0;
static CRITICAL_SECTION g_desksSendLock;
static CRITICAL_SECTION g_desksTableLock;
static int g_desksLocksMade = 0;

/** What crossed, for the log line that says whether this did anything at all. */
static volatile LONG g_desksOut = 0;
static volatile LONG g_desksBack = 0;

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
 * Read `desks` and `desks-port` out of the file the relay line lives in.
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
    // The longer key first: `desks-port` also begins with `desks`, and taking the
    // short one would leave `-port 8080` as the address to dial.
    if (take_word(&q, stop, "desks-port")) {
      int value = 0;
      if (read_int(&q, stop, &value) && value > 0 && value <= 0xffff) g_desksPort = value;
      continue;
    }
    q = line;
    if (take_word(&q, stop, "desks")) {
      relay_read_token(&q, stop, g_desksUrl, sizeof(g_desksUrl));
    }
  }
  VirtualFree(buf, 0, MEM_RELEASE);

  if (!g_desksUrl[0]) {
    log_line("lobby: the config names no desk tunnel");
    return 0;
  }
  log_text("lobby: ", g_desksUrl);
  log_num("lobby: listening for the game on 127.0.0.1:", g_desksPort);
  return 1;
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------

static void lobby_wire_drop(void) {
  InterlockedExchange(&g_desksReady, 0);
  if (g_desksSocket) g_httpClose(g_desksSocket);
  if (g_desksConnect) g_httpClose(g_desksConnect);
  if (g_desksSession) g_httpClose(g_desksSession);
  g_desksSocket = g_desksConnect = g_desksSession = NULL;
}

/**
 * Dial the desk tunnel.
 *
 * `WINHTTP_ACCESS_TYPE_NO_PROXY` for the same reason the relay uses it, and here
 * the reason is sharper: the `http_proxy` that redirects the game points at OUR
 * OWN listener, so a session that honoured it would dial itself.
 */
static int lobby_dial(void) {
  char host[128], path[192];
  WORD port = 0;
  int secure = 0;
  if (!relay_split_url(g_desksUrl, host, sizeof(host), &port, path, sizeof(path), &secure)) {
    log_text("lobby: this is not an address I can read: ", g_desksUrl);
    return 0;
  }

  WCHAR hostW[128], pathW[192];
  relay_widen(host, hostW, 128);
  relay_widen(path, pathW, 192);

  g_desksSession = g_httpOpen(L"h5e-desks", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
  if (!g_desksSession) return 0;
  g_desksConnect = g_httpConnect(g_desksSession, hostW, port, 0);
  if (!g_desksConnect) {
    lobby_wire_drop();
    return 0;
  }
  HINTERNET request = g_httpOpenRequest(g_desksConnect, L"GET", pathW, NULL, NULL, NULL,
                                        secure ? WINHTTP_FLAG_SECURE : 0);
  if (!request) {
    lobby_wire_drop();
    return 0;
  }
  int ok = g_httpSetOption(request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0) &&
           g_httpSendRequest(request, NULL, 0, NULL, 0, 0, 0) &&
           g_httpReceiveResponse(request, NULL);
  if (ok) g_desksSocket = g_httpCompleteUpgrade(request, 0);
  g_httpClose(request);
  if (!g_desksSocket) {
    log_num("lobby: the upgrade was refused, last error ", (int)GetLastError());
    lobby_wire_drop();
    return 0;
  }
  InterlockedExchange(&g_desksReady, 1);
  log_line("lobby: connected");
  return 1;
}

/** One frame out. Called from whichever thread had something to say. */
static int lobby_wire_send(BYTE type, WORD id, const BYTE *payload, int len) {
  if (!InterlockedCompareExchange(&g_desksReady, 1, 1)) return 0;
  if (len < 0 || len > LOBBY_BUFFER) return 0;
  BYTE frame[LOBBY_HEADER + LOBBY_BUFFER];
  frame[0] = type;
  frame[1] = (BYTE)(id >> 8);
  frame[2] = (BYTE)(id & 0xff);
  for (int i = 0; i < len; i++) frame[LOBBY_HEADER + i] = payload[i];

  EnterCriticalSection(&g_desksSendLock);
  DWORD failed = g_desksSocket ? g_httpSocketSend(g_desksSocket, WS_BINARY_MESSAGE, (PVOID)frame,
                                                  (DWORD)(LOBBY_HEADER + len))
                               : 1;
  LeaveCriticalSection(&g_desksSendLock);
  if (failed) {
    // The receive loop finds the same break and dials again; saying it in both
    // places would fill the log with one dead connection.
    InterlockedExchange(&g_desksReady, 0);
    return 0;
  }
  if (len) InterlockedIncrement(&g_desksOut);
  return 1;
}

// ---------------------------------------------------------------------------
// The tables. Both threads reach them, so both take the lock.
// ---------------------------------------------------------------------------

static int lobby_take_stream(SOCKET s) {
  EnterCriticalSection(&g_desksTableLock);
  int id = -1;
  for (int i = 0; i < LOBBY_STREAMS; i++) {
    if (g_streams[i].used) continue;
    g_streams[i].used = 1;
    g_streams[i].socket = s;
    id = i;
    break;
  }
  LeaveCriticalSection(&g_desksTableLock);
  return id;
}

static SOCKET lobby_stream_socket(int id) {
  if (id < 0 || id >= LOBBY_STREAMS) return INVALID_SOCKET;
  EnterCriticalSection(&g_desksTableLock);
  SOCKET s = g_streams[id].used ? g_streams[id].socket : INVALID_SOCKET;
  LeaveCriticalSection(&g_desksTableLock);
  return s;
}

/** Give the slot back, and hand out the socket to close exactly once. */
static SOCKET lobby_free_stream(int id) {
  if (id < 0 || id >= LOBBY_STREAMS) return INVALID_SOCKET;
  EnterCriticalSection(&g_desksTableLock);
  SOCKET s = INVALID_SOCKET;
  if (g_streams[id].used) {
    s = g_streams[id].socket;
    g_streams[id].used = 0;
    g_streams[id].socket = INVALID_SOCKET;
  }
  LeaveCriticalSection(&g_desksTableLock);
  return s;
}

/** Which channel this source address is, making one if it is new. */
static int lobby_channel_for(const struct sockaddr_in *from) {
  EnterCriticalSection(&g_desksTableLock);
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
  LeaveCriticalSection(&g_desksTableLock);
  return id;
}

static int lobby_channel_address(int id, struct sockaddr_in *out) {
  if (id < 0 || id >= LOBBY_CHANNELS) return 0;
  EnterCriticalSection(&g_desksTableLock);
  int ok = g_channels[id].used;
  if (ok) *out = g_channels[id].from;
  LeaveCriticalSection(&g_desksTableLock);
  return ok;
}

// ---------------------------------------------------------------------------
// The threads.
// ---------------------------------------------------------------------------

/** One accepted desk connection, read until it ends. */
static DWORD WINAPI lobby_stream_thread(LPVOID which) {
  int id = (int)(INT_PTR)which;
  SOCKET s = lobby_stream_socket(id);
  if (s == INVALID_SOCKET) return 0;

  BYTE *buf = (BYTE *)VirtualAlloc(NULL, LOBBY_BUFFER, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  for (;;) {
    int got = g_lobbyRecv(s, (char *)buf, LOBBY_BUFFER, 0);
    if (got <= 0) break;
    if (!lobby_wire_send(LOBBY_FRAME_DATA, (WORD)id, buf, got)) break;
  }
  VirtualFree(buf, 0, MEM_RELEASE);

  SOCKET mine = lobby_free_stream(id);
  if (mine != INVALID_SOCKET) {
    lobby_wire_send(LOBBY_FRAME_CLOSE, (WORD)id, NULL, 0);
    g_lobbyCloseSocket(mine);
    log_num("lobby: the game closed desk stream ", id);
  }
  return 0;
}

/** The listener: every desk connection the game opens to us. */
static DWORD WINAPI lobby_accept_thread(LPVOID unused) {
  (void)unused;
  for (;;) {
    struct sockaddr_in from;
    int size = (int)sizeof(from);
    SOCKET s = g_lobbyAccept(g_desksListener, (struct sockaddr *)&from, &size);
    if (s == INVALID_SOCKET) {
      if (InterlockedCompareExchange(&g_desksStop, 0, 0)) break;
      Sleep(50);
      continue;
    }
    int id = lobby_take_stream(s);
    if (id < 0) {
      // Refusing is the honest answer: carrying it as somebody else's stream would
      // interleave two desks, and the classifier at the far end would see nonsense.
      log_line("lobby: more desk connections at once than there is room for — refused");
      g_lobbyCloseSocket(s);
      continue;
    }
    lobby_wire_send(LOBBY_FRAME_OPEN, (WORD)id, NULL, 0);
    log_num("lobby: the game opened desk stream ", id);
    HANDLE thread = CreateThread(NULL, 0, lobby_stream_thread, (LPVOID)(INT_PTR)id, 0, NULL);
    if (!thread) {
      SOCKET mine = lobby_free_stream(id);
      if (mine != INVALID_SOCKET) g_lobbyCloseSocket(mine);
      lobby_wire_send(LOBBY_FRAME_CLOSE, (WORD)id, NULL, 0);
      continue;
    }
    CloseHandle(thread);
  }
  return 0;
}

/** The desks that answer datagrams: the NAT mirror and the CD-key window. */
static DWORD WINAPI lobby_datagram_thread(LPVOID unused) {
  (void)unused;
  BYTE *buf = (BYTE *)VirtualAlloc(NULL, LOBBY_BUFFER, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  for (;;) {
    struct sockaddr_in from;
    int size = (int)sizeof(from);
    int got = g_lobbyRecvFrom(g_desksUdp, (char *)buf, LOBBY_BUFFER, 0, (struct sockaddr *)&from,
                              &size);
    if (got <= 0) {
      if (InterlockedCompareExchange(&g_desksStop, 0, 0)) break;
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
    InterlockedIncrement(&g_desksBack);
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
    g_lobbySendTo(g_desksUdp, (const char *)payload, size, 0, (const struct sockaddr *)&to,
                  (int)sizeof(to));
    InterlockedIncrement(&g_desksBack);
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

  while (!InterlockedCompareExchange(&g_desksStop, 0, 0)) {
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
          g_httpSocketReceive(g_desksSocket, buf, LOBBY_HEADER + LOBBY_BUFFER, &got, &type);
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

    // Every desk stream belonged to that connection. Keeping them across a redial
    // would hand the far end stream numbers it has never heard of, and the game a
    // desk that answers nothing.
    for (int i = 0; i < LOBBY_STREAMS; i++) {
      SOCKET s = lobby_free_stream(i);
      if (s != INVALID_SOCKET) g_lobbyCloseSocket(s);
    }
    if (!InterlockedCompareExchange(&g_desksStop, 0, 0)) Sleep(RELAY_RETRY_MIN_MS);
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

  if (!g_lobbySocket || !g_lobbyBind || !g_lobbyListen || !g_lobbyAccept || !g_lobbyRecv ||
      !g_lobbySend || !g_lobbyRecvFrom || !g_lobbySendTo || !g_lobbyCloseSocket) {
    log_line("lobby: this winsock is missing something we need");
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
  port[0] = (BYTE)(g_desksPort >> 8);
  port[1] = (BYTE)(g_desksPort & 0xff);
  BYTE *octets = (BYTE *)&at.sin_addr;
  octets[0] = 127;
  octets[1] = 0;
  octets[2] = 0;
  octets[3] = 1;

  g_desksListener = g_lobbySocket(AF_INET, SOCK_STREAM, 0);
  if (g_desksListener == INVALID_SOCKET) return 0;
  if (g_lobbyBind(g_desksListener, (const struct sockaddr *)&at, (int)sizeof(at)) != 0 ||
      g_lobbyListen(g_desksListener, 8) != 0) {
    // Almost always somebody else on the number — a gateway of our own running on
    // this machine, most likely. Saying which port it was is the whole diagnosis.
    log_num("lobby: could not listen on 127.0.0.1:", g_desksPort);
    g_lobbyCloseSocket(g_desksListener);
    g_desksListener = INVALID_SOCKET;
    return 0;
  }

  g_desksUdp = g_lobbySocket(AF_INET, SOCK_DGRAM, 0);
  if (g_desksUdp == INVALID_SOCKET ||
      g_lobbyBind(g_desksUdp, (const struct sockaddr *)&at, (int)sizeof(at)) != 0) {
    log_num("lobby: could not take the datagram side of 127.0.0.1:", g_desksPort);
    if (g_desksUdp != INVALID_SOCKET) g_lobbyCloseSocket(g_desksUdp);
    g_lobbyCloseSocket(g_desksListener);
    g_desksUdp = g_desksListener = INVALID_SOCKET;
    return 0;
  }
  return 1;
}

/**
 * Stand up the lobby half, if this installation was told where to carry it.
 *
 * From the worker thread and not `DllMain`: WinHTTP is reached with
 * `LoadLibrary`, and calling that under the loader lock hangs the game before it
 * has drawn anything. Winsock is already mapped by then — the executable imports
 * it — so nothing here loads a library of its own.
 */
static int install_lobby(void) {
  if (!lobby_read_config()) return 0;
  if (!relay_load_winhttp()) return 0;
  if (!lobby_load_winsock()) return 0;

  if (!g_desksLocksMade) {
    InitializeCriticalSection(&g_desksSendLock);
    InitializeCriticalSection(&g_desksTableLock);
    g_desksLocksMade = 1;
  }
  for (int i = 0; i < LOBBY_STREAMS; i++) g_streams[i].socket = INVALID_SOCKET;

  if (!lobby_open_sockets()) return 0;

  HANDLE wire = CreateThread(NULL, 0, lobby_wire_thread, NULL, 0, NULL);
  HANDLE listener = CreateThread(NULL, 0, lobby_accept_thread, NULL, 0, NULL);
  HANDLE datagrams = CreateThread(NULL, 0, lobby_datagram_thread, NULL, 0, NULL);
  if (!wire || !listener || !datagrams) {
    log_line("lobby: could not start its threads");
    InterlockedExchange(&g_desksStop, 1);
    return 0;
  }
  CloseHandle(wire);
  CloseHandle(listener);
  CloseHandle(datagrams);
  return 1;
}
