// The lobby: the lists a player picks from before there is a game at all.
//
// GS calls everything a GROUP. A lobby is a top-level group (Casual, Ranked,
// 1v1 — ours to define), a room is a group inside it, and one player in a room is
// its master. The client asks about them with LOBBY_MSG messages, each carrying a
// subtype: log in, give me the lobby list, take me to the lobby server.
//
// A lobby is described by fourteen fields in a fixed order, and the client reads
// them positionally, so the order below is the format. Two of them carry meaning
// worth knowing: `config` is a mask of LSM_* flags that tells the client what to
// ask for on joining, and `eventId` is the game mode — 0 plain, 1 rated, 2 duel —
// which is how a "Ranked" lobby is rated rather than merely named so.
//
// Exports:
//   LobbyMsg              the subtypes we answer
//   GroupType, Lsm        what a group is, and what it asks for
//   DEFAULT_LOBBIES       the three we offer
//   lobbyEntry(lobby)     one lobby as the client reads it

import { type GSValue } from './gs-data.ts';

/** LOBBY_MSG subtypes. The protocol has ~60; these are the ones we speak. */
export const LobbyMsg = {
  JOIN_SERVER: 3,
  GROUP_LEAVE: 8,
  GROUP_INFO_GET: 9,
  CREATE_ROOM: 12,
  START_GAME: 15,
  LOGIN: 21,
  JOIN_LOBBY: 23,
  JOIN_ROOM: 24,
  SET_PLAYER_INFO: 42,
  GROUP_INFO: 53,
  NEW_GROUP: 54,
  CHANGE_REQUESTED_LOBBIES: 109,
} as const;

export const GroupType = { LOBBY: 0, ROOM_UBI_P2P: 7 } as const;

/** Lobby Service Mask — what the client should ask for once it is in. */
export const Lsm = {
  PRIVATE: 0x1,
  NEEDMASTER: 0x2,
  ETERNAL: 0x4,
  ACTIVE: 0x8,
  OPEN: 0x10,
  STARTABLE: 0x20,
  GROUPINFO: 0x40,
  GROUPMEMBERS: 0x80,
  CHILDGROUPINFO: 0x100,
} as const;

/** Game modes, as the client counts them. */
export const GameMode = { STANDARD: 0, RATED: 1, DUEL: 2 } as const;

export interface Lobby {
  id: number;
  name: string;
  mode: number;
  maxMembers: number;
  members: number;
}

/** What we offer on the lobby screen. Ours to choose; the client only lists them. */
export const DEFAULT_LOBBIES: Lobby[] = [
  { id: 1, name: 'Casual', mode: GameMode.STANDARD, maxMembers: 8, members: 0 },
  { id: 2, name: 'Ranked', mode: GameMode.RATED, maxMembers: 8, members: 0 },
  { id: 3, name: '1v1', mode: GameMode.DUEL, maxMembers: 8, members: 0 },
];

/**
 * A game somebody is hosting.
 *
 * Almost all of it comes straight from the client's CREATE_ROOM: the name it
 * composed ("Сервер — Senyaak", in the player's own language), the game title,
 * the room type (7, peer-to-peer), how many may play and watch, and `info` — a
 * blob of the game's own settings with the map path inside it
 * (`/Maps/Multiplayer/…/map.xdb`, `autosave_enabled`, the goal). We do not need to
 * understand that blob to run a lobby: it is the host's description of the game,
 * and it goes back out to everyone who lists the room.
 */
export interface Room {
  id: number;
  parentId: number;
  name: string;
  gameTitle: string;
  type: number;
  maxPlayers: number;
  maxVisitors: number;
  password: string;
  info: Uint8Array;
  master: string;
  members: string[];
}

/** The rooms that exist, per lobby. Ours to keep; nothing else knows them. */
export class Rooms {
  private readonly rooms = new Map<number, Room>();
  private nextId = 100;

  create(room: Omit<Room, 'id'>): Room {
    const created: Room = { ...room, id: this.nextId++ };
    this.rooms.set(created.id, created);
    return created;
  }

  get(id: number): Room | undefined {
    return this.rooms.get(id);
  }

  inLobby(lobbyId: number): Room[] {
    return [...this.rooms.values()].filter((room) => room.parentId === lobbyId);
  }

  named(parentId: number, name: string): Room | undefined {
    return [...this.rooms.values()].find((room) => room.parentId === parentId && room.name === name);
  }

  hostedBy(master: string): Room[] {
    return master ? [...this.rooms.values()].filter((room) => room.master === master) : [];
  }

  remove(id: number): void {
    this.rooms.delete(id);
  }
}

/** A room in the same fourteen fields a lobby uses — see `lobbyEntry`. */
export function roomEntry(room: Room): GSValue[] {
  return [
    String(room.type),
    room.name,
    String(room.id),
    '1',
    String(room.parentId),
    String(Lsm.OPEN | Lsm.STARTABLE | Lsm.NEEDMASTER),
    '1',
    room.master,
    room.gameTitle,
    room.gameTitle,
    room.info,
    String(room.type),
    String(room.maxPlayers),
    String(room.members.length),
  ];
}

/**
 * One lobby, in the fourteen fields the client reads by position:
 * type, name, id, lobby server id, parent, config, level, master, allowed games,
 * games, info blob, event id, max members, members.
 *
 * `game` fills the two game fields with the id the client logged in with
 * (`HEROES_…`). Whether it has to be there is not settled: the reference
 * implementation leaves both empty, and the first channel screen we reached was
 * empty too — a client that filters the list by "is this lobby for my game" would
 * explain that, so this is the cheaper thing to try before reading the filter out
 * of the exe.
 */
export function lobbyEntry(lobby: Lobby, game = ''): GSValue[] {
  return [
    String(GroupType.LOBBY),
    lobby.name,
    String(lobby.id),
    '1',
    '0',
    '0',
    '1',
    '',
    game,
    game,
    new Uint8Array(0),
    String(lobby.mode),
    String(lobby.maxMembers),
    String(lobby.members),
  ];
}
