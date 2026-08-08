// The reachability check's main-process half: assembling the question.
//
// The walk itself is src/map/reach.ts and knows nothing about Electron, and
// what a tile does to a hero is src/terrain/passability.ts — the same rule the
// viewport washes the ground with. What is decided HERE is what the open map
// says: which slot a person plays, where his hero stands, what every object's
// footprint is once it has been turned to face the way it faces, and which
// portals lead to each other.
//
// Read-only from beginning to end. Nothing is recorded, nothing is dirtied: the
// check is a question about the map, not an edit to it.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ReachPayload, ReachResultIpc } from '#electron/ipc.ts';
import { need, terrainDoc, TERRAIN_FILE } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { reachFrom } from '#src/map/reach.ts';
import type { Offset, ReachObject } from '#src/map/reach.ts';
import { canBeHuman, isActive, slotOf, HERO_TYPE, SLOTS } from '#src/map/players.ts';
import { classifyTiles, PASS_WALK } from '#src/terrain/passability.ts';
import { parseFootprint } from '#src/scene/scene.ts';
import type { Footprint } from '#src/scene/payload.ts';
import { childText } from '#src/format/xml.ts';
import type { MapObject } from '#src/map/map.ts';

/**
 * The types whose green tile a hero walks ON and past, rather than up to.
 *
 * Senya's rule, from playing: a creature, another hero and anything you pick up
 * leave the ground free behind them — the monster is dead, the chest is in your
 * bag — and everything built does not. So a row of mines is a wall with doors
 * in it, and the doors are not gaps.
 */
const WALK_THROUGH = new Set([
  'AdvMapHero', 'AdvMapMonster', 'AdvMapTreasure', 'AdvMapArtifact',
]);

/** A shared's footprint, read once per shared rather than once per object. */
function footprints(s: Session): (href: string | null) => Footprint | null {
  const seen = new Map<string, Footprint | null>();
  return (href) => {
    if (!href) return null;
    const key = href.split('#')[0]!.replace(/^\/+/, '');
    if (seen.has(key)) return seen.get(key)!;
    const xml = s.assets.text(key);
    const fp = xml ? parseFootprint(xml) : null;
    seen.set(key, fp);
    return fp;
  };
}

/**
 * An object's footprint tiles, turned to face the way the object faces.
 *
 * The same arithmetic the footprint overlay draws with: the object stands at a
 * grid corner and its footprint is anchored at the cell's CENTRE, so the half
 * tile goes on before the rotation and comes off after. Without it a rotated
 * building's squares straddle the grid lines — and a check that disagreed with
 * the overlay by half a tile would be worse than no check.
 */
function tilesOf(o: MapObject, list: readonly Offset[]): Offset[] {
  const pos = o.pos!;
  const cos = Math.cos(o.rot), sin = Math.sin(o.rot);
  const ax = Math.floor(pos.x) + 0.5, ay = Math.floor(pos.y) + 0.5;
  return list.map((t) => ({
    x: Math.floor(ax + t.x * cos - t.y * sin),
    y: Math.floor(ay + t.x * sin + t.y * cos),
  }));
}

/** Where the ground itself stops a hero, one byte per tile. */
function terrainWalls(s: Session, floors: number, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let z = 0; z < floors; z++) {
    const wall = new Uint8Array(size * size);
    // A floor whose terrain file is missing is not walkable at all — better a
    // check that says "nothing is reachable" than one that quietly walks over
    // ground it never read.
    let doc;
    try { doc = terrainDoc(s, z); } catch { wall.fill(1); out.push(wall); continue; }
    const heights = doc.heightsCopy();
    const flags = doc.flagsCopy();
    const cls = classifyTiles({
      V: doc.V, heights, flags, passable: doc.passableCopy(),
      river: (v) => doc.isRiver(v),
    });
    // Sea counts as wall here. It is navigable — a boat crosses it — but this
    // walk is a hero's on foot, and saying so is the whole difference between
    // the two questions.
    for (let i = 0; i < wall.length && i < cls.length; i++) wall[i] = cls[i] === PASS_WALK ? 0 : 1;
    out.push(wall);
  }
  return out;
}

/** Which slot a person plays, and the hero he begins as. */
function humanSlot(s: Session): number {
  for (let slot = 0; slot < SLOTS; slot++) {
    if (isActive(s.map.desc, slot) && canBeHuman(s.map.desc, slot)) return slot;
  }
  return -1;
}

export function registerReach(): void {
  ipcMain.handle('map:reach', async (_e: IpcMainInvokeEvent, p: ReachPayload = {}): Promise<ReachResultIpc> => {
    const s = need();
    const size = s.map.tileX;
    const floors = s.map.hasUnderground ? Math.min(2, TERRAIN_FILE.length) : 1;
    const footprintOf = footprints(s);

    const objects: ReachObject[] = [];
    const heroes: { id: string; label: string; player: string | null; obj: ReachObject }[] = [];
    for (const o of s.map.objects) {
      const pos = o.pos;
      if (!pos) continue;
      const floor = Math.min(Math.max(o.floor, 0), floors - 1);
      const fp = footprintOf(o.shared);
      // No footprint at all is a one-tile object, which is what the game does
      // with it too. `passable` and `hole` are ground the object merely draws
      // over, so they are neither body nor doorway here.
      const at = { x: Math.floor(pos.x), y: Math.floor(pos.y) };
      // Back to offsets from the object's own tile: tilesOf resolved the
      // rotation into map coordinates, and the walk wants the object's tile and
      // its shape apart so it can report WHERE something unreachable is.
      const off = (list: readonly Offset[]): Offset[] =>
        tilesOf(o, list).map((t) => ({ x: t.x - at.x, y: t.y - at.y }));
      const blocked = fp ? off(fp.blocked) : [{ x: 0, y: 0 }];
      const active = fp ? off(fp.active) : [];
      // Named for a person to find on the map. The map's own script name is
      // first, since that is what everything else in the editor calls it, but
      // `BUILDING_001` says nothing about WHICH building — so the shared's own
      // file stem rides along, and that is where "Fountain_Of_Fortune" comes
      // from.
      const stem = o.shared?.split('#')[0]?.split(/[\\/]/).pop()?.replace(/\.\(.*/, '') ?? '';
      const item: ReachObject = {
        id: o.id ?? `${o.type}@${at.x},${at.y},${floor}`,
        label: [o.name || o.type, stem].filter(Boolean).join(' · '),
        floor, x: at.x, y: at.y, blocked, active,
        crossable: WALK_THROUGH.has(o.type),
      };
      const group = childText(o.el, 'GroupID');
      if (group) item.group = `${o.type}:${group}`;
      objects.push(item);
      if (o.type === HERO_TYPE) heroes.push({ id: item.id, label: item.label, player: o.player, obj: item });
    }

    // Where the walk begins. A hero the caller names (the selected one) wins,
    // because "can THIS hero get about" is a question worth asking directly;
    // otherwise the person's own slot, and his heroes on it.
    const slot = humanSlot(s);
    const chosen = p.fromId ? heroes.filter((h) => h.id === p.fromId) : [];
    const mine = chosen.length ? chosen
      : slot >= 0 ? heroes.filter((h) => slotOf(h.player) === slot) : [];
    if (!mine.length) {
      return {
        ok: false,
        error: slot < 0
          ? 'no slot on this map is active and offered to a person'
          : `PLAYER_${slot + 1} is the person’s slot and has no hero on the map to start from`,
        from: [], objects: 0, reached: 0, unreached: [], seen: [], walkable: [],
      };
    }

    const starts = mine.flatMap((h) => (h.obj.active.length ? h.obj.active : [{ x: 0, y: 0 }])
      .map((t) => ({ x: h.obj.x + t.x, y: h.obj.y + t.y, floor: h.obj.floor })));
    const walls = terrainWalls(s, floors, size);
    const out = reachFrom({ size, terrain: walls, objects, starts });
    const withDoors = objects.filter((o) => o.active.length).length;
    return {
      ok: true,
      from: mine.map((h) => ({ id: h.id, label: h.label, floor: h.obj.floor })),
      objects: withDoors,
      reached: out.reached.length,
      unreached: out.unreached,
      seen: out.seen,
      walkable: out.walkable,
    };
  });
}
