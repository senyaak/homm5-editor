// The way out: a WebSocket to our relay, from inside the game.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY A WEBSOCKET AND NOT A SOCKET. The relay is reached over the internet
// through a tunnel (cloudflared), and a tunnel carries HTTP and nothing else —
// the game's own six u-lobby services are raw TCP and UDP and cannot be reached through
// one at all. So the datagrams travel inside a WebSocket, which is
// message-oriented: one message is one datagram and nothing has to be framed
// again on top.
//
// WHY WINHTTP. It is in Windows, it speaks WebSocket since Windows 8, and it
// terminates TLS itself — so `wss://` on the internet costs nothing here and no
// library of ours ships with the mod. The functions are taken with
// `GetProcAddress` rather than linked, because the build has no `-l` flags at
// all (src/mods/extension.ts) and because `LoadLibrary` must not be called from
// `DllMain`: this is loaded from the worker thread instead, which starts once
// the game is running.
//
// WHAT IT IS NOT. It knows nothing about the game, about peers, or about which
// datagram should go where — it carries bytes and reports bytes. The deciding
// is next door in net/agent.c.
//
// THE CONFIG IS ITS OWN FILE, `bin/homm5-editor-net.txt`, beside the quality of
// life one:
//
//   relay ws://127.0.0.1:40200/agent
//   secret <what `npm run issue-agent` printed>
//
// A file of its own because these are not flags: `homm5-editor-qol.txt` is a
// list of names and 0/1, its reader knows nothing else, and docs/QOL.md is
// explicit that a setting which is not a switch gets its own home rather than
// being squeezed in. The secret is here and not in the game's settings for the
// same reason it is issued once per installation: the game never sees it.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_relay

/* WinHTTP, declared here rather than included: this unit takes only windows.h,
 * and everything below is reached through GetProcAddress anyway. The handle
 * type belongs to winhttp.h and is an opaque pointer, so it is spelled out here
 * with the rest. */
typedef void *HINTERNET;

#define WINHTTP_ACCESS_TYPE_NO_PROXY 1
#define WINHTTP_FLAG_SECURE 0x00800000
#define WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET 114
#define WS_BINARY_MESSAGE 0
#define WS_BINARY_FRAGMENT 1
#define WS_CLOSE 4

typedef HINTERNET(WINAPI *WinHttpOpenFn)(LPCWSTR, DWORD, LPCWSTR, LPCWSTR, DWORD);
typedef HINTERNET(WINAPI *WinHttpConnectFn)(HINTERNET, LPCWSTR, WORD, DWORD);
typedef HINTERNET(WINAPI *WinHttpOpenRequestFn)(HINTERNET, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR,
                                                LPCWSTR *, DWORD);
typedef BOOL(WINAPI *WinHttpSetOptionFn)(HINTERNET, DWORD, LPVOID, DWORD);
typedef BOOL(WINAPI *WinHttpSendRequestFn)(HINTERNET, LPCWSTR, DWORD, LPVOID, DWORD, DWORD,
                                           DWORD_PTR);
typedef BOOL(WINAPI *WinHttpReceiveResponseFn)(HINTERNET, LPVOID);
typedef HINTERNET(WINAPI *WinHttpWebSocketCompleteUpgradeFn)(HINTERNET, DWORD_PTR);
typedef DWORD(WINAPI *WinHttpWebSocketSendFn)(HINTERNET, DWORD, PVOID, DWORD);
typedef DWORD(WINAPI *WinHttpWebSocketReceiveFn)(HINTERNET, PVOID, DWORD, DWORD *, DWORD *);
typedef BOOL(WINAPI *WinHttpCloseHandleFn)(HINTERNET);

static WinHttpOpenFn g_httpOpen = NULL;
static WinHttpConnectFn g_httpConnect = NULL;
static WinHttpOpenRequestFn g_httpOpenRequest = NULL;
static WinHttpSetOptionFn g_httpSetOption = NULL;
static WinHttpSendRequestFn g_httpSendRequest = NULL;
static WinHttpReceiveResponseFn g_httpReceiveResponse = NULL;
static WinHttpWebSocketCompleteUpgradeFn g_httpCompleteUpgrade = NULL;
static WinHttpWebSocketSendFn g_httpSocketSend = NULL;
static WinHttpWebSocketReceiveFn g_httpSocketReceive = NULL;
static WinHttpCloseHandleFn g_httpClose = NULL;

/** The biggest datagram this will carry. The game's are under 300 bytes. */
#define RELAY_MAX_DATAGRAM 2048

static char g_relayUrl[256];
static char g_relaySecret[192];
static int g_relayConfigured = 0;

static HINTERNET g_wsSession = NULL;
static HINTERNET g_wsConnect = NULL;
static HINTERNET g_wsSocket = NULL;
static volatile LONG g_wsReady = 0;
/** Bumped on every successful dial, so the agent can tell a new connection from the old. */
static volatile LONG g_wsGeneration = 0;
static volatile LONG g_relayStop = 0;
static CRITICAL_SECTION g_wsSendLock;
static int g_wsSendLockMade = 0;

/** What to do with a datagram that arrived from the other side. Set by agent.c. */
static void (*g_relayInbound)(const BYTE *data, int len) = NULL;

/** How long to wait before dialling again, and the ceiling it climbs to. */
#define RELAY_RETRY_MIN_MS 1000
#define RELAY_RETRY_MAX_MS 15000

/** One token: everything up to whitespace, copied out. Returns how many. */
static int relay_read_token(const char **p, const char *end, char *out, int room) {
  while (*p < end && (**p == ' ' || **p == '\t')) (*p)++;
  int at = 0;
  while (*p < end && **p != ' ' && **p != '\t' && **p != '\r' && **p != '\n') {
    if (at + 1 < room) out[at++] = **p;
    (*p)++;
  }
  out[at] = 0;
  return at;
}

/**
 * Read `bin/homm5-editor-net.txt`, which is where this machine's own two
 * answers live: which relay, and who this installation is.
 *
 * Neither has a default worth having. A relay nobody named is not a relay to
 * guess at, and an agent with no secret is one the core will refuse — so a
 * missing file means the agent watches and carries nothing, which is exactly
 * what it did before this file existed.
 */
static int relay_read_config(void) {
  DWORD size = 0;
  char *buf = read_beside_us(L"homm5-editor-net.txt", &size);
  if (!buf) {
    log_line("relay: no bin/homm5-editor-net.txt — nothing to dial");
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
    if (take_word(&q, stop, "relay")) {
      relay_read_token(&q, stop, g_relayUrl, sizeof(g_relayUrl));
    }
    // There was a `secret` here once. It is gone: the relay asks the lobby who is
    // playing at the endpoint this agent names, and a copy of the game has nothing
    // to hold. See docs/NETWORK.md and the lobby's docs/ARCHITECTURE.md, Identity.
  }
  VirtualFree(buf, 0, MEM_RELEASE);

  if (!g_relayUrl[0]) {
    log_line("relay: the config names no relay");
    return 0;
  }
  log_text("relay: ", g_relayUrl);
  g_relayConfigured = 1;
  return 1;
}

/** ASCII into UTF-16, which is the only string WinHTTP takes. */
static void relay_widen(const char *from, WCHAR *to, int room) {
  int at = 0;
  while (from[at] && at + 1 < room) {
    to[at] = (WCHAR)(BYTE)from[at];
    at++;
  }
  to[at] = 0;
}

/**
 * `ws://host:port/path` in pieces.
 *
 * Hand-written because there is no CRT here and because the shape is fixed: our
 * own launcher writes this line. Anything it cannot read it refuses rather than
 * half-understands — a relay dialled at the wrong port is a game that does not
 * connect and a log that does not say why.
 */
static int relay_split_url(const char *url, char *host, int hostRoom, WORD *port, char *path,
                           int pathRoom, int *secure) {
  const char *p = url;
  *secure = 0;
  if (p[0] == 'w' && p[1] == 's' && p[2] == 's' && p[3] == ':' && p[4] == '/' && p[5] == '/') {
    *secure = 1;
    p += 6;
  } else if (p[0] == 'w' && p[1] == 's' && p[2] == ':' && p[3] == '/' && p[4] == '/') {
    p += 5;
  } else {
    return 0;
  }

  int at = 0;
  while (*p && *p != ':' && *p != '/') {
    if (at + 1 < hostRoom) host[at++] = *p;
    p++;
  }
  host[at] = 0;
  if (!at) return 0;

  *port = (WORD)(*secure ? 443 : 80);
  if (*p == ':') {
    p++;
    int value = 0;
    const char *stop = p;
    while (*stop) stop++;
    if (!read_int(&p, stop, &value) || value <= 0 || value > 0xffff) return 0;
    *port = (WORD)value;
  }

  at = 0;
  if (*p != '/') path[at++] = '/';
  while (*p && at + 1 < pathRoom) path[at++] = *p++;
  path[at] = 0;
  return 1;
}

/** The WinHTTP entry points, taken once. */
static int relay_load_winhttp(void) {
  if (g_httpOpen) return 1;
  HMODULE lib = LoadLibraryW(L"winhttp.dll");
  if (!lib) {
    log_line("relay: winhttp.dll would not load");
    return 0;
  }
  g_httpOpen = (WinHttpOpenFn)GetProcAddress(lib, "WinHttpOpen");
  g_httpConnect = (WinHttpConnectFn)GetProcAddress(lib, "WinHttpConnect");
  g_httpOpenRequest = (WinHttpOpenRequestFn)GetProcAddress(lib, "WinHttpOpenRequest");
  g_httpSetOption = (WinHttpSetOptionFn)GetProcAddress(lib, "WinHttpSetOption");
  g_httpSendRequest = (WinHttpSendRequestFn)GetProcAddress(lib, "WinHttpSendRequest");
  g_httpReceiveResponse = (WinHttpReceiveResponseFn)GetProcAddress(lib, "WinHttpReceiveResponse");
  g_httpCompleteUpgrade =
      (WinHttpWebSocketCompleteUpgradeFn)GetProcAddress(lib, "WinHttpWebSocketCompleteUpgrade");
  g_httpSocketSend = (WinHttpWebSocketSendFn)GetProcAddress(lib, "WinHttpWebSocketSend");
  g_httpSocketReceive = (WinHttpWebSocketReceiveFn)GetProcAddress(lib, "WinHttpWebSocketReceive");
  g_httpClose = (WinHttpCloseHandleFn)GetProcAddress(lib, "WinHttpCloseHandle");

  if (!g_httpOpen || !g_httpConnect || !g_httpOpenRequest || !g_httpSetOption ||
      !g_httpSendRequest || !g_httpReceiveResponse || !g_httpCompleteUpgrade || !g_httpSocketSend ||
      !g_httpSocketReceive || !g_httpClose) {
    // Every one of these has been in Windows since 8; missing means something
    // stranger than an old machine, and carrying on would crash rather than fail.
    log_line("relay: winhttp.dll has no WebSocket in it");
    g_httpOpen = NULL;
    return 0;
  }
  return 1;
}

static void relay_drop(void) {
  InterlockedExchange(&g_wsReady, 0);
  if (g_wsSocket) g_httpClose(g_wsSocket);
  if (g_wsConnect) g_httpClose(g_wsConnect);
  if (g_wsSession) g_httpClose(g_wsSession);
  g_wsSocket = g_wsConnect = g_wsSession = NULL;
}

/**
 * Dial, and hand back whether there is a socket at the end of it.
 *
 * The secret goes in the URL's query, which is how the relay asks the core
 * "who is this agent, and which room is he in" — one question, at the moment
 * the connection opens, and nothing carried in the datagrams afterwards.
 */
static int relay_dial(void) {
  char host[128], path[192];
  WORD port = 0;
  int secure = 0;
  if (!relay_split_url(g_relayUrl, host, sizeof(host), &port, path, sizeof(path), &secure)) {
    log_text("relay: this is not an address I can read: ", g_relayUrl);
    return 0;
  }

  // The path is dialled as configured. Nothing is appended to it any more — a
  // `?token=` used to carry the secret here, and the connection now says who it is
  // by naming the endpoint its game plays on, once it knows it.
  char full[448];
  int at = 0;
  for (const char *p = path; *p && at + 1 < (int)sizeof(full); p++) full[at++] = *p;
  full[at] = 0;

  WCHAR hostW[128], pathW[448];
  relay_widen(host, hostW, 128);
  relay_widen(full, pathW, 448);

  g_wsSession = g_httpOpen(L"h5e-agent", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
  if (!g_wsSession) return 0;
  g_wsConnect = g_httpConnect(g_wsSession, hostW, port, 0);
  if (!g_wsConnect) {
    relay_drop();
    return 0;
  }
  HINTERNET request = g_httpOpenRequest(g_wsConnect, L"GET", pathW, NULL, NULL, NULL,
                                        secure ? WINHTTP_FLAG_SECURE : 0);
  if (!request) {
    relay_drop();
    return 0;
  }
  int ok = g_httpSetOption(request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0) &&
           g_httpSendRequest(request, NULL, 0, NULL, 0, 0, 0) &&
           g_httpReceiveResponse(request, NULL);
  if (ok) g_wsSocket = g_httpCompleteUpgrade(request, 0);
  g_httpClose(request);
  if (!g_wsSocket) {
    log_num("relay: the upgrade was refused, last error ", (int)GetLastError());
    relay_drop();
    return 0;
  }
  InterlockedIncrement(&g_wsGeneration);
  InterlockedExchange(&g_wsReady, 1);
  log_line("relay: connected");
  return 1;
}

/**
 * Which connection this is, counting from one.
 *
 * The agent has to say where its game plays on every connection, not once ever: a relay
 * that went away and came back knows nothing about the socket it just accepted. Comparing
 * this against what it last announced on is how it notices.
 */
static LONG relay_generation(void) {
  return InterlockedCompareExchange(&g_wsGeneration, 0, 0);
}

/** One datagram out. Called from whichever thread the game is sending on. */
static int relay_send(const BYTE *data, int len) {
  if (!InterlockedCompareExchange(&g_wsReady, 1, 1)) return 0;
  if (len <= 0 || len > RELAY_MAX_DATAGRAM) return 0;
  EnterCriticalSection(&g_wsSendLock);
  DWORD failed = g_wsSocket ? g_httpSocketSend(g_wsSocket, WS_BINARY_MESSAGE, (PVOID)data,
                                               (DWORD)len)
                            : 1;
  LeaveCriticalSection(&g_wsSendLock);
  if (failed) {
    // The receive loop will find the same thing and dial again; saying it twice
    // would fill the log with one broken connection.
    InterlockedExchange(&g_wsReady, 0);
    return 0;
  }
  return 1;
}

/**
 * The worker: dial, then read until it breaks, then dial again.
 *
 * A thread of its own because `WinHttpWebSocketReceive` blocks, and the thread
 * that must never block is the game's. Sends go the other way, from the game's
 * own thread — WinHTTP allows one send and one receive at a time, which is
 * exactly this arrangement, and the send is behind a lock because the game has
 * more than one thread on that socket.
 */
static DWORD WINAPI relay_thread(LPVOID unused) {
  (void)unused;
  BYTE *buf = (BYTE *)VirtualAlloc(NULL, RELAY_MAX_DATAGRAM, MEM_COMMIT, PAGE_READWRITE);
  if (!buf) return 0;
  DWORD wait = RELAY_RETRY_MIN_MS;

  while (!InterlockedCompareExchange(&g_relayStop, 0, 0)) {
    if (!relay_dial()) {
      relay_drop();
      Sleep(wait);
      wait = wait * 2 > RELAY_RETRY_MAX_MS ? RELAY_RETRY_MAX_MS : wait * 2;
      continue;
    }
    wait = RELAY_RETRY_MIN_MS;

    for (;;) {
      DWORD got = 0, type = 0;
      DWORD failed = g_httpSocketReceive(g_wsSocket, buf, RELAY_MAX_DATAGRAM, &got, &type);
      if (failed) {
        log_num("relay: the connection ended, last error ", (int)failed);
        break;
      }
      if (type == WS_CLOSE) {
        log_line("relay: the other end closed it");
        break;
      }
      // A fragment means a message longer than the buffer, which no datagram of
      // this game is. Dropping it is better than gluing half of one to the next.
      if (type == WS_BINARY_FRAGMENT) {
        log_line("relay: a message too long to be a datagram — dropped");
        continue;
      }
      if (got && g_relayInbound) g_relayInbound(buf, (int)got);
    }
    relay_drop();
    if (!InterlockedCompareExchange(&g_relayStop, 0, 0)) Sleep(RELAY_RETRY_MIN_MS);
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  return 0;
}

/**
 * Start dialling, if this installation was told where and who it is.
 *
 * Called from the first datagram rather than from `DllMain`: `LoadLibrary` is
 * how WinHTTP is reached, and calling it under the loader lock is a way to hang
 * the game before it has drawn anything.
 */
static int relay_start(void) {
  if (!relay_read_config()) return 0;
  if (!relay_load_winhttp()) return 0;
  if (!g_wsSendLockMade) {
    InitializeCriticalSection(&g_wsSendLock);
    g_wsSendLockMade = 1;
  }
  HANDLE thread = CreateThread(NULL, 0, relay_thread, NULL, 0, NULL);
  if (!thread) {
    log_line("relay: could not start its thread");
    return 0;
  }
  CloseHandle(thread);
  return 1;
}

static int relay_connected(void) {
  return InterlockedCompareExchange(&g_wsReady, 1, 1) != 0;
}
