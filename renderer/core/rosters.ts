// Game-data lookups the panels share, cached for the session.
//
// Rosters are discovered dynamically in the main process (src/registry.ts), so
// mod- and Lua-added content shows up on its own; what is cached here is only
// the fetch, per name, so a dozen dropdowns built in one render pass ask once.

import { api } from '#core/ipc.ts';
import { schemaForClass } from '#src/schema/schema.ts';
import type { RosterEntryDTO } from '#electron/ipc.ts';

/** Roster entries per name, fetched once from the main process and cached. */
const rosterCache = new Map<string, Promise<RosterEntryDTO[]>>();
export function roster(name: string): Promise<RosterEntryDTO[]> {
  let p = rosterCache.get(name);
  if (!p) { p = api.roster(name).then((r) => r.entries).catch(() => []); rosterCache.set(name, p); }
  return p;
}

/** Every object of an engine class (the "…" browse picker's universe), cached
 *  per class for the session. A New entity invalidates its class's cache. */
const classCache = new Map<string, Promise<RosterEntryDTO[]>>();
export function objectsOfClass(className: string): Promise<RosterEntryDTO[]> {
  let p = classCache.get(className);
  if (!p) { p = api.objectsOfClass(className).then((r) => r.entries).catch(() => []); classCache.set(className, p); }
  return p;
}

/** Forget a class's cache — a New entity has just joined it. */
export function forgetClass(className: string): void {
  classCache.delete(className);
}

/** Whether "New" can author a class — the schema has a template for it (a map
 *  entity $def, or an object type). Shared identity classes have none. */
export function canCreateClass(className: string): boolean {
  return schemaForClass(className) !== null;
}

/** In-map names per kind (objective, object), for x-nameRef autocomplete. Not
 *  cached across edits — names change as the map is edited — but per render pass
 *  the same promise is reused. */
export function mapNames(kind: string): Promise<string[]> {
  return api.names(kind).then((r) => r.names).catch(() => []);
}
