# Online play: how the game finds its servers

> **The server itself is not in this repo.** It lives in `h5e-lobby`
> (`C:\Projects\h5e-lobby`), where `docs/STATE.md` says how far the client gets and
> `docs/PROTOCOL.md` is the wire. This file stays on the game's side of that line:
> how the exe looks for its services, and what it was observed to do with what it
> is told. What the editor still owns here is the log-mirror DLL
> ([native/net/ubi-log.c](../native/net/ubi-log.c)) and the disassembly probe
> (`tools/net-probe.ts`) — both are things done *to* the game.

Everything here is read out of `bin/H5_Game_H5E.exe` (our unwrapped retail exe,
image base 0x400000 — the Steam-wrapped `H5_Game.exe` has an encrypted `.text`
and cannot be disassembled). Reproduce any of it with:

```bash
node tools/net-probe.ts <exe> "http://gsconnect.ubisoft.com/gsinit.php?dp="
node tools/net-probe.ts <exe> --func 0xE07A50
node tools/net-probe.ts <exe> --imports libcurl
```

**A string argument matches a whole literal, not a substring.** The engine's log
names live inside longer literals — the sender is `LobbySend_Login(`, with the
bracket, and the receiver is `NUbi::CClient2::LadderQueryRcv_RequestReply: ` with
the colon and space — so asking for `LobbySend_Login` or `LadderQuery` answers
"(no such string)" about strings that are plainly there. That false negative
nearly got this document "corrected" into being wrong. When a name is not found,
dump the neighbourhood instead: `--strings <from> <to>`.

## The one address the whole online stack hangs from

`NUbi::CStateUninitialized::GetServersConfig` (**0xE07A50**) does this, in order:

1. `GetTempPathA` → builds `%TEMP%\ubi_servers.ini`
   (both literals are globals: URL at **0x121A81C**, filename at **0x121A828**,
   initialized by the static ctors at 0x4D0080 / 0x4D0000).
2. `curl_easy_init`, then `curl_easy_setopt` with
   `CURLOPT_WRITEFUNCTION` (20011) = 0xE09770, `CURLOPT_WRITEDATA` (10001) =
   the open temp file, `CURLOPT_URL` (10002) =
   **`http://gsconnect.ubisoft.com/gsinit.php?dp=` + a product id** (a global
   string read from 0x1092E30; the two `HEROES_29988429c481f219` /
   `HEROES_a3e9d5c9b79a1a57` literals in .rdata are the candidates for it).
3. `curl_easy_perform`. On failure it logs
   `failed to get servers config from <url>` and returns false — **no local
   fallback**: the temp file is only ever read after a successful download.
4. On success (`downloaded servers.ini`) it parses the downloaded file with
   plain **`GetPrivateProfileStringA` / `GetPrivateProfileIntA`** (0xE07EA0 reads
   one entry, 0xE08260 loops a group into a vector, 0xE08040 reads the router):

   ```ini
   [Servers]
   RouterIP0=…            RouterPort0=…      RouterLauncherPort0=…
   NATServerIP0=…         NATServerPort0=…
   CDKeyServerIP0=…       CDKeyServerPort0=…
   IRCIP0=…               IRCPort0=…
   ```

   The key names are built with `%sIP%i`, `%sPort%i`, `%sLauncherPort%i` from the
   prefixes `Router`, `NATServer`, `CDKeyServer`, `IRC`, and the index counts up
   until a key is missing — i.e. each service is a *list* of servers to try.

So: **one HTTP GET decides every address the game will talk to.**

The cheapest way to take that request over needs neither a patch nor admin
rights: `bin/libcurl.dll` is **libcurl 7.14.0**, which reads `http_proxy` /
`ALL_PROXY` from the environment, and the game never sets `CURLOPT_PROXY`
(10004) — `net-probe --push 10004` finds no such push anywhere in `.text`, while
the three options it does set are all there. So a game started with
`http_proxy=http://127.0.0.1:8080` asks us for its server list, and only that
process is affected. `h5e-lobby` is what answers.

**That route is no longer the one taken, and the bat files that took it were
deleted on 15.08.2026.** The extension rewrites the URL in memory instead (below),
and a leftover `http_proxy` beats that rewrite silently — it decides where the
request is SENT, whatever the URL says, so off the lobby's own LAN it is
twenty-one seconds of waiting and then a failure. The variable is still the
cheapest way in for a copy with no extension, and that is all it is kept here for.

The other two ways to redirect it: a `hosts` entry for
`gsconnect.ubisoft.com`, or patching the URL literal — possible, but it is
length-bound at 43 bytes on 0xFE5FAC with `ubi_servers.ini` immediately after it
at 0xFE5FD8, so the copy loop's end address 0xFE5FD7 and the `push 2Ch`
allocation size would both have to change too. Rewriting the global string from
`homm5-editor.dll` at runtime has no such limit.

A second, unrelated place in the exe also uses libcurl (0xEF42A0, same three
options) — the stats/tracking path, not multiplayer.

## What the services are

From the log strings (`NUbi::…`) the client's online session is:

- **Router** (`RouterConnect: connecting to router...`) — the GS entry point;
  everything lobby-side is tunnelled through it.
- **Lobby** — a statically linked Ubisoft GS client library
  (`GSClientLibrary_Initialize`). ~20 requests (`LobbySend_Login`, `JoinLobby`,
  `CreateRoom`, `JoinRoom`, `SetPlayerInfo`, `GameReady`, `GameStart`,
  `StartMatch`, `SubmitMatchResult`, …) against a matching set of
  `NUbi::CClient2::LobbyRcv_*` handlers, and an error enum
  (`GSLE_ERRORLOBBYSRV_*`) that spells out the server-side rules — wrong game
  version, password, member banned, not master, min players not reached.
- **IRC** (`ChatInit: initializing IRC service...`, `IRCRcv_Welcome`,
  `Excess Flood`) — chat, apparently over real IRC.
- **CDKeyServer** — activation / authorization / validation of the key;
  `CDKeyInit` logs `failure: no cdkey server in downloaded ini`, so the ini must
  name one.
- **NATServer** — traversal; `no more NAT Service servers to try, connection
  failed`.
- **Ladder** (`LadderQuery_*`) — stats, and the per-race
  `W_HEAVEN`/`L_HEAVEN`/… counters listed next to `RATING`.

**Gameplay itself is peer to peer** (`NetDriver`, `connecting NetDriver at …`).
The lobby only hands out peer addresses — the group logs print `ExtIP=`,
`LocIP(s)=`, `szIPAddress=`, `szAltIPAddress=` — so a replacement lobby does not
have to carry game traffic.

The LAN path (`NUbi::NLAN::CLANMatchMaker`, `CLANState*`) is a second, much
smaller implementation of the same idea with no server at all: UDP broadcast
(`ProcessDriverIPNetworkBroadcast`) plus `GameInfoPacket`,
`EnterGameRequest/Allowed/Denied`, `LeaveGame`, `GameChat`. Its port comes from
the config var `net_lan_match_maker_port` (siblings: `net_game_port`,
`net_ubi_cdkey_port`, `net_timeout`, `net_ubicom_init_timeout`,
`net_multiplayer_init_timeout`, `ubi_cdkey`, `ubi_com`).

`profiles/p2pdir.cfg` ("generated by the game, please do not modify", empty on a
fresh install) is a third thing again — a global string at 0x4880E0's ctor; who
writes it is not traced yet.

## Can we run our own?

Yes — and it does run: a player logs in, enters a channel and hosts a game. The
server is `h5e-lobby`, and how far the client gets is that repo's `docs/STATE.md`.
What is written down below is the part that belongs to the game rather than to the
server: what the exe was observed to do, and the addresses to go back to.

### The first thing it does with our list

The game fetches the list (`GET /gsinit.php?dp=HEROES_29988429c481f219`,
`user-agent: curl/7.14.0`) and then goes straight for the **NAT service over
UDP** — not the router. These were the first two packet kinds it ever sent us, on
the advertised NAT port from its own port 1024, before we could answer anything:

```
+0ms    20 bytes  93 88 00 00  08 00  42 30  00 00 00 00  0a 00 01 00  ff 44 18 02
+15.7s  12 bytes  b6 cf 00 00  00 00  49 30  ff ff 00 00        (nine identical copies)
```

Unanswered, it refetches the list, repeats the whole attempt, and after the second
failure shows error `0.7.0`. Those bytes are the ground truth the transport was
built on, and they are still the fixtures the server's suite runs against.

**The NAT step cannot be skipped.** With no `NATServer*` keys the list is empty and
`NUbi::CStateUninitialized::NATInit` (0xE087B0) falls straight into `no more NAT
Service servers to try, connection failed` and returns false, which fails the whole
init. The connect itself is 0x447640 → 0x447910 → 0x448220, and from there it is a
virtual call into a transport object: the protocol lives behind a vtable, so
reading it statically means walking that library — which is why it was learned from
packets instead.

### Error codes name nothing

`0.7.0` says nothing about which step failed: the failure path in `ProcessInit`
(0xE075B1) builds the triple {7,0,0} for every one of them, and the formatter
(0x7DC5F0) prints its fields in the order f1.f0.f2 — which is how {7,0,0} reaches
the screen as `0.7.0`, next to the text `MatchMakerErrors/ErrorTextWithCode`.

So the only way to know where a session died is the client's own log, which is what
[native/net/ubi-log.c](../native/net/ubi-log.c) is for: one detour on the engine's
log append (RVA 0x9FB270), every line stamped with a tick count.

```bash
node tools/build-native.ts --log net/ubi-log
node tools/install-native.ts --game C:\Projects\homm5-game-net
```

**Both of the engine's own log thresholds (RVA 0xE1A8F0, 0xE1A908) are already 0,
and must be left alone.** Lowering them opens branches the engine means to skip,
and it died in its own string append (0x4E75F9, `mov [esi+2],ax` with esi = 0)
the one time they were touched. The detour reads them and reports; it does not
write.

## The agent: the peer socket, from inside the game

Gameplay is peer to peer, and over the internet the address a peer is told is
often useless — behind carrier-grade NAT there is none to tell. So the datagrams
have to be able to travel through a relay of ours instead
(`h5e-lobby/docs/ARCHITECTURE.md`), and the choice between the peer and the relay
belongs inside the game: a process beside it would have to be *dialled*, which
means handing the game a stand-in address for every peer and writing those
addresses into the room description — a mechanism built to be thrown away.

[native/net/agent.c](../native/net/agent.c) is that piece, and **today it only
watches**. It is switched on by `net-agent` in `bin/homm5-editor-qol.txt`, which
is the Network tab of the editor's Game settings panel.

**How it attaches.** The game imports `sendto` and `recvfrom` from `WSOCK32.dll`
**by ordinal** — 20 and 17, slots `0xf413c8` and `0xf413c4` — not by name, so
`hook_import` in `qol/borderless.c` cannot take them: it compares names, and an
ordinal import has none. The agent walks the same import table for the *library*
and the *number*, and verifies the slot against `GetProcAddress` of that ordinal
before writing, exactly as `hook_import` does with a name. Nothing of the game's
code is touched; one pointer in a table changes.

There are three `sendto` call sites and one `recvfrom` in the whole image, all in
the wrapper region at `0x440e70`, `0x440f10`, `0x441300` — the same socket carries
the peer traffic and the NAT service's keep-alives (port 40010), which is how the
agent tells them apart.

```bash
npm run build-native            # net_agent is in the default logging set for now
node tools/install-native.ts --game C:\Projects\homm5-game-net
```

What lands in the log: one line when the hook goes in, the first three datagrams
of each peer with their first sixteen bytes, and a count every five seconds.

### Carrying, and how the datagram gets back in

[native/net/relay.c](../native/net/relay.c) is the way out: a WebSocket to the
relay through **WinHTTP**, which is in Windows, speaks WebSocket since 8, and
terminates TLS itself — so `wss://` costs nothing later and no library of ours
ships with the mod. Its entry points are taken with `GetProcAddress` because the
build links nothing (`src/mods/extension.ts`) and because `LoadLibrary` must not
be called under the loader lock; the dial happens on a thread, started at the
first datagram to a peer — which is also the moment the player is in a room, and
so the moment the core can say which room to put this agent in.

Its one setting is its own file, `bin/homm5-editor-net.txt`, beside the
quality-of-life one:

```
relay ws://127.0.0.1:40200/agent
```

**And nothing else, because there is no credential.** A `secret` sat under that
line until 14.08.2026 — issued once per installation by a command line in the
lobby repository, and cut because nobody outside this desk could ever have been
given one. What the agent presents instead is where its game plays: seven bytes,
`[0x02][address][port]`, sent on every relay connection before the first
datagram. The port comes off the game's own socket with `getsockname`; the
address cannot, since a socket bound to every interface says so, and instead a
throwaway UDP socket is routed at the lobby and asked which of our addresses it
picked — the same choice the game made when it told the lobby where it plays.
The lobby looks that endpoint up in the room it is holding, and either somebody
is playing there or nobody is.

**Getting a relayed datagram back INTO the game is the part that being in the
process pays for.** It never arrives on the game's socket, so it is queued and
handed over the next time the game asks: `recvfrom` is ours, and the address it
reports is the peer's own — the one the game was told about and already believes
in. No loopback stand-in per peer, no rewriting the room description per
recipient, and the open question in `h5e-lobby/docs/ARCHITECTURE.md` about that
rewriting is answered by not needing an address at all.

`select` is hooked for the same reason: a game that asks the OS whether there is
anything to read would be told no, and would never call `recvfrom`. Whether this
game asks was never established — the hook costs nothing if it does not, and is
the difference between playing and hanging if it does.

Known limit, deliberate: **every peer datagram goes through the relay**, not
"when the direct path fails" — a hole punch is worth having and is not written.
And a relayed datagram carries no peer of its own (the relay is told "to the
others in my room"), so with three players the agent cannot say which peer a
datagram came from. Two is what this step is for; three needs a peer named in
the relay's own framing, on both sides.

### What the first live run said (14.08.2026)

Two copies, a duel played end to end, the log of copy 1:

```
agent: watching sendto
agent: watching recvfrom
agent: the game's peer socket is watched
agent: <- 192.168.178.27:8889   bytes 9   head 07 01 00 00 00 ef e7 2a a5
agent: -> 192.168.178.27:8889   bytes 9   head 07 00 00 00 00 ef e7 2a a5
…
agent: peer 192.168.178.27:8889
agent:   sent packets 522     sent bytes 17430
agent:   received packets 512 received bytes 15610
```

So the hook is on the right socket, at the right time, and the nine-byte
handshake with its four-byte token is exactly the one the packet captures in
`h5e-lobby/docs/NETWORK_STATE.md` describe. The peer is at the **LAN** address,
not loopback, with both clients on one machine — as measured there.

It also found a mistake of its own: the first version knew only the NAT service's
port, so the CD-key service on 40020 was written down as a peer of the player's.
Harmless while the agent only counts, and exactly the kind of thing that would
have sent service traffic into the relay later. The ports now come from
`%TEMP%\ubi_servers.ini` — the same list the game itself read — and they are read
at the first datagram rather than at load, because this DLL's entry point runs
before the executable's and the file is downloaded after that.

## The lobby half: the u-lobby, from inside the game

`native/net/lobby.c`, and a separate feature from the agent above — its own
switch (`net-u-lobby`), its own config line, its own connection, no shared state.
The agent carries the PEERS; this carries the LOBBY.

**Why it has to exist.** A tunnel of the cloudflared family carries HTTP and
WebSocket. The game speaks HTTP to us exactly once, for the list above, and raw
TCP and UDP for every service of it after it — so no configuration of a tunnel can put
the u-lobby services behind one (h5e-lobby, `SLICE_over_the_internet.md` §1). The way out is
the one the peer half already took: hold the traffic inside the game and carry it
out over a WebSocket of our own.

**Why it hooks nothing.** Unlike the agent it needs no import slot and replaces
no call. The game learns every u-lobby address from the ini we serve, and it asks
for that ini at one address — so pointing both at `127.0.0.1` makes the game open
ordinary sockets to a listener of ours, in its own process, of its own accord.
That is a whole class of hook — `connect`, `send`, `recv`, and the non-blocking
semantics under them — that never has to be written.

**And there is no bat file.** The `http_proxy` route above still works, but the
extension does not need it: it rewrites the URL where the game keeps it, so a
copy with this switched on is started by running the executable and nothing else.

### Rewriting that URL, exactly

The documentation above described `0x121A81C` as the URL. It is not a buffer —
it is a three-pointer string object, `{begin, end, capacity_end}` at
`0x121A81C / 0x121A820 / 0x121A824`, whose text lives on the game's own pool
heap. `GetServersConfig` passes the ADDRESS of that object to the concatenation
that appends the product id (`0x4DC770`, which allocates exactly what the result
needs), and curl is handed the fresh buffer — never the global.

So:

- **write to `*(char**)0x121A81C`**, not to `0x121A81C` (12 bytes there are the
  three fields, and `0x121A828` is the `ubi_servers.ini` object with no gap);
- **43 characters is the ceiling** — the constructor allocated `0x2C` and the
  destructor gives that same pointer back to the game's pool allocator on exit,
  so the pointer has to stay the game's and only the bytes inside it are ours.
  `http://127.0.0.1:65535/gsinit.php?dp=` is 37;
- **move `end` too**: the length is `end - begin` and not a `strlen`, so a
  shorter URL that left `end` alone would carry the tail of the old one;
- **not from `DllMain`.** The constructor is a `.CRT$XCU` initialiser — it runs
  inside the executable's entry point, after every imported DLL's `DllMain` and
  before `WinMain`, and would overwrite anything written earlier. `lobby.c` waits
  for the string it expects and only then replaces it, which doubles as the check:
  bytes that are not the ones we know are left alone.

`tools/test-native-anchors.ts` checks the `.rdata` literal the constructor copies
from (`0xFE5FAC`), which is what says the string being waited for is still the
string the game carries. The two `.data` addresses cannot be checked on disk —
nothing has written them yet — and the test lists them as such.

**The shape.** One loopback listener takes the u-lobby connections and the u-lobby service
datagrams; each becomes a numbered stream or channel inside one WebSocket to the u-lobby
at the far end — its `/u-lobby` door, on the same port as everything it serves —
which lands each one on that port as a loopback connection of its own. Three bytes in front of everything:

```
0x01 [id:u16] payload   bytes on a stream, either direction
0x02 [id:u16]           open a stream                      (the game's side says it)
0x03 [id:u16]           the stream ended, either direction
0x04 [id:u16] payload   one datagram, on a channel, either direction
```

A **channel is one of our source addresses**, because two of its services answer datagrams
— the NAT mirror and the CD-key window — and the game may ask them from two
sockets of its own. Without a number on the frame an answer coming back would
have nothing to say which socket it belonged to.

**What it is configured with**, in `bin/homm5-editor-net.txt` beside the relay:

```
u-lobby wss://host/u-lobby
u-lobby-port 8080
```

The port is what the listener binds on the loopback and what the rewritten URL
names, so those two cannot disagree.

**The server list is answered here, not carried.** It is a local question — the
ini says where THIS copy's u-lobby is, and for a copy that carries them through us
the answer is always the same: all of them at our own loopback port. The lobby at
the far end could not answer it if it wanted to, since that number belongs to this
machine. So a stream whose first message begins `GET ` never becomes a stream at
all: it is answered and closed, by the same read-the-first-message rule the
u-lobby uses to tell one u-lobby service from another.

The price is stated where it is paid: the u-lobby service prefixes in `lobby_servers_ini` are
a copy of the u-lobby's own `SERVICES` table, and a u-lobby service added there has to be
added here. Since the merge to one number what could go stale is the LIST and not
the address, and a missing prefix shows up as the game failing to reach a service
by name.

**What is not settled.** Two addresses are still the server's to give and still
come from `H5E_HOST`: the proxy handed over at `PROXY_HANDLER`, and the lobby
server handed over when a room is joined. For a tunnelled client both have to be
its own `127.0.0.1`. The cheapest answer while every client is tunnelled is to set
`H5E_HOST=127.0.0.1` and be done; the answer for a lobby with both kinds of client
in it is for those endpoints to come from the door a connection arrived on, which
is a small change — a session already carries its own copy of them.

### What is still the game's side to find

- **Registration has no screen.** `UI/MPRegister` is the progress window
  (connecting, validating the key, logging in) — Ubisoft did accounts on a website.
  The wire has `NEWUSERREQUEST` and the client already knows how to say "name
  taken" and "wrong password" (`GSLGE_ERRORSECURE_*`), so accounts can be created
  on first login with no client change at all. That is the chosen route; a page of
  our own comes later.
- **The CD-key prompt.** The key lives in the client's `ubi_cdkey` setting, used by
  the screens at 0x87B790, 0x87C840, 0x87CF50, 0x87D2B0. Pre-setting it — or
  cutting the check — is how the question goes away for good.
- **The ladder** the client asks for by name (`LadderQuery_*`,
  `SubmitMatchResult`, and the stat keys `RATING`, `GAMES_PLAYED`,
  `W_HEAVEN`…`G_ORCS`). Nobody has written that end for Heroes V; it belongs to the
  server, but the field names are read out of here.
