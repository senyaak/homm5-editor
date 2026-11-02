# Lua in multiplayer 2 — revive the world machine

**What.** Call the engine's own world-side door (`0xA4B6A0`) where a network or
hotseat game starts, so the map's script and its triggers run there; never
patch the predicate `0x7223E0` open (a screen-side script is unsynchronised
by construction). Then the battle and town scripts the same way, if the
reading shows a world-side path for them.

**Source.** [mp-lua-1-read-the-world-script-system.md](mp-lua-1-read-the-world-script-system.md).

**Acceptance.** The hook's site checked by `test-native-anchors`; a test map
whose script and one trigger write a visible result; the extension's flag for
it in the QoL panel, off by default.

**Depends on.** mp-lua-1-read-the-world-script-system.

**Needs.** The owner plays the test map in hotseat (one machine is enough: the
same gate) and sees the script's result. A network game needs a second
machine.
