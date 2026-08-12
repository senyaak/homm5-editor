# Online play: how the game finds its servers

Everything here is read out of `bin/H5_Game_H5E.exe` (our unwrapped retail exe,
image base 0x400000 — the Steam-wrapped `H5_Game.exe` has an encrypted `.text`
and cannot be disassembled). Reproduce any of it with:

```bash
node tools/net-probe.ts <exe> "http://gsconnect.ubisoft.com/gsinit.php?dp="
node tools/net-probe.ts <exe> --func 0xE07A50
node tools/net-probe.ts <exe> --imports libcurl
```

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
process is affected. `tools/net-server.ts` is that server, and
`run-net.bat` in the game copy sets the variable.

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

Yes, in stages, and each stage is testable on one machine.

1. **Redirect** — done, `tools/net-server.ts`: it answers the gsinit request with
   an ini pointing every service at this machine. The ini it serves was read back
   through `GetPrivateProfileStringA`/`IntA` the way the game reads it, so the
   format is checked and not merely assumed: index 0 comes back, index 1 comes
   back empty, which is how the client knows the list ended.

   ```bash
   node tools/net-server.ts          # then run run-net.bat in the game copy
   ```
2. **Listen and record** — accept the router/CDKey/NAT/IRC connections and dump
   the bytes. There is no live Ubi service left to capture, so the protocol has
   to come from the client: every `LobbyRcv_*` parser is in the exe, and the log
   strings name the fields.
3. **Implement enough lobby** for login → room → start game, answer the CD-key
   check, and point IRC at a stock ircd.
4. **Peer addresses** — the lobby hands out ExtIP/LocIP; with port forwarding
   the NAT service can probably be stubbed out (unverified — the "no more NAT
   Service servers" path may be fatal).

The cheap alternative, if the GS protocol turns out to be a slog: tunnel the LAN
matchmaker's broadcasts instead (5 packet types, no auth) — a game-specific
Hamachi. It does not replace the lobby, but it does put two players in a game
over the internet.
