# Our own Ubi.com: where this stands, and what is known

A companion to [NETWORK.md](NETWORK.md), which explains how the game finds its
servers. This one is the state of play: what runs, what the client accepted, what
it refused, and where the next wall is. Written 12.08.2026 so that none of it has
to be recovered from memory.

## How to run it

```bash
node tools/net-server.ts          # all our services, one process, logs to _tmp/net/
```

Then start the game from the copy: `C:\Projects\homm5-game-net\run-net.bat`. That
bat sets `http_proxy=http://127.0.0.1:8080`, which is the whole redirect — the
game's libcurl asks us for its server list instead of `gsconnect.ubisoft.com`.
Nothing in the exe is patched for this.

Two logs matter, and they answer different questions:

| log | says |
|---|---|
| `_tmp/net/session-*.log` | every byte in and out of our services, decoded |
| `<game copy>/bin/homm5-editor-*.log` | **the game's own narration**, mirrored by our DLL |

The second one is the important one and it exists because of
[native/net/ubi-log.c](../native/net/ubi-log.c): one detour on the engine's log
append (0xDFB270), lines stamped with a tick count. Build it with
`node tools/build-native.ts --log net/ubi-log` and install with
`node tools/install-native.ts --game C:\Projects\homm5-game-net`. Without it we are
blind — five walls in a row were found by reading it, and the two before it cost a
launch each to guess at.

`node tools/net-decode.ts --file <dump>` turns a hex dump from either log back
into a message; `--srp` for a datagram, `--irc` for chat.
`node tools/net-probe.ts <exe> …` is the disassembly side: strings, references,
imports, callers, `--func`, `--dword`, `--bytes`.

## The ports, and who answers

```
8080   HTTP        the server list (this is the whole redirect)
40000  Router      key exchange, LOGIN, JOINWAITMODULE
40001  RouterWM    the wait module: LOGINWAITMODULE, PLAYERINFO, PROXY_HANDLER, LOBBY_MSG
40010  NAT   UDP   the address mirror
40020  CDKey UDP   challenge / activation / authorisation / validation — all yes
40030  Proxy       where "persistantdata" and "ladderquery" live
40031  ProxyWM     the proxy's own wait module
40040  Lobby       LOBBYSERVERLOGIN, channels, rooms
6667   IRC         chat, and a precondition for entering a channel
```

The four GS desks (router, its wait module, proxy, proxy's wait module) speak one
protocol with three differences, all in `src/net/router-service.ts`; the lobby is
a fourth role on the same code.

## How far the client gets

Everything below is from the game's own log, not inference:

```
server list        -> ours
NAT init           -> "connected to NAT Service server 127.0.0.1:40010"
CD-key             -> challenge, authorisation, validation: all answered yes
router             -> keys, LOGIN, "iam sent to 40001"
wait module        -> LOGINWAITMODULE, PLAYERINFO, PROXY_HANDLER
proxy chain        -> LOGIN, hand-off, LOGINWAITMODULE on 40031, LOGINFRIENDS
lobby login        -> accepted, three channels pushed
IRC                -> "IRC welcome", "IRC join channel succeeded"
join channel       -> "join lobby succeeded(GroupID=1,LobbySrvID=1)"
NAT address        -> "address request succeeded,address=1.0.0.127:40010"
create game        -> CREATE_ROOM answered, room 100 in the channel
join own room      -> "join room sent, waiting reply" -> JOIN_ROOM answered
```

So a player can log in, enter a channel, host a game and be in his own room. What
he cannot do yet is start it, and a second player has never been tried.

## Facts worth not re-learning

- **An address in a message body is a decimal u32**, and which order depends on
  the field. The wait-module hand-off wants HOST order (`2130706433`); the NAT
  answer wants `inet_addr` order (`16777343`). Both were measured by watching the
  game's sockets — a dotted string sent it to `0.0.0.127`, the wrong number to
  `1.0.0.127`.
- **The client's log prints a network-order address octet-reversed.** Its
  "address=1.0.0.127:40010" is how it renders 127.0.0.1. Reading that as an error
  and turning the bytes round broke a step that already worked, twice. See the
  table in `src/net/nat-service.ts`.
- **The NAT answer that works is subtypes 1, 2 and 3 together**, `inet_addr`
  order, the mirror's own port, request id echoed. Two subtypes failed; one
  subtype failed; one subtype twice failed. Why three is not understood.
- **A step that is not answered costs 30 seconds** — the `0x1E` handed to the NAT
  connect — and then the client moves on or starts over. That is the lag Сеня
  noticed, and it is why a wrong answer looks like a hang rather than an error.
- **The login arrives GS_ENCRYPT, keyed with the key WE generated**, not the one
  the client sent us.
- **Chat is real IRC in a wrapper** (u16 big-endian length, Blowfish on a key in
  the exe) and entering a channel depends on it: the client joins
  `#LobbyGrp<lobby>.<server>` and only then asks for its address.
- **The client reads our game list and enforces unique names.** Its default game
  name comes from the player's own, so a stale room of his own makes "a game with
  this name already exists". Rooms now die with their host's connection, on
  GROUP_LEAVE, and a host recreating his own game replaces it.
- **Both engine log thresholds are already 0.** Lowering them opens branches the
  engine means to skip and it dies in its own string append. Read, do not write.
- The 555-byte blob in CREATE_ROOM is the host's own description of the game — map
  path, rules, goal. It passes through us untouched.

## Where the next wall is

Two messages are unanswered, and both are now the whole of the gap:

- **`LOBBY_MSG` subtype 15, START_GAME.** Nothing has asked for it yet because
  starting needs two players in a room; it is the last lobby message before the
  game itself, and after it the peers connect directly.
- **`PROXY_HANDLER` subtype 1281 on the proxy wait module.** Sent right after the
  proxy chain comes up, ignored so far with no visible harm. 1281 = 0x501, which
  looks like a composite rather than a subtype — decode it before answering.

After those: two clients at once (nothing about a second player has been
exercised), then the peer introduction — the lobby knows each player's address
because the client tells us in `LOBBYSERVERLOGIN` and asks the NAT mirror what it
looks like from outside — and then the ladder, which is ours to invent and lives
behind the proxy on 40030.

Accounts are still "any name, any password". The client has no registration
screen (`UI/MPRegister` is the progress window), but the wire has
`NEWUSERREQUEST` and the client knows how to say "name taken" and "wrong
password", so creating an account on first login needs no client change —
Сеня chose that over a website or a new screen.
