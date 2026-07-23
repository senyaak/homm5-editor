# Localization — one map, many languages

## The constraint

The game reads **one language**. A map's text reference names a plain file —
`name.txt`, `objectives/prim1_name.txt` — and the engine reads whatever bytes are
there. Which language that is comes from the installation (the game mounts one
`…texts_<lang>.h5u`); you cannot switch it in play. So a shipped map is
single-language, full stop.

That would normally force a map author to keep separate copies of the whole map,
one per language, and edit them in parallel by hand. The editor removes that: you
author **every language in one project**, and **export** a single-language map per
language on demand.

## How the project holds it

Localization is the editor's, not the map's — the game never sees any of this.

- **Tagged sources.** Every text is kept once per language, tagged:
  `name.en.txt`, `name.ru.txt`, `description.en.txt`, … The plain `name.txt` the
  map references does **not** exist on disk in a localized project; it is created
  only by export.
- **A base language.** One language is the reference (usually English). New
  strings are authored there, and any language without a translation falls back to
  it on export.
- **A sidecar.** `localization.json` in the map folder records the base language
  and which languages the project carries. Editor-only; never packed.

## The workflow

1. **Enable** — toolbar **Localize** → pick the base language (what the existing
   texts are written in). The editor tags every existing `*.txt` with that
   language (`name.txt` → `name.en.txt`).
2. **Add a language** — in the same dialog. Every base text is copied to the new
   language (`name.ru.txt`), so a translator edits in place rather than from a
   blank. An untouched copy is still the base language until changed.
3. **Translate** — open any text; the editor window grows a **tab per language**.
   Switch tabs to edit each; while translating a non-base language, the base text
   is shown beneath the editor as the source. Save keeps the window open, so the
   languages are saved in turn.
4. **Export** — **Localize** → **export .h5m** beside a language. This packs an
   ordinary single-language map: each `name.txt` holds that language's text
   (falling back to the base where a translation is missing), and the tagged files
   and the sidecar are left out. Export one `.h5m` per language you ship.

Normal **Pack** is refused on a localized map — there is no plain `name.txt` to
pack, so it would ship a map with no text. Use Export.

## Where it lives

- Provisioning (enable/add/remove) and the sidecar: `loc:*` in `electron/main.ts`.
- The single-language pack: `exportLocalized` in `src/project.ts` (a normal pack
  with the tagged files collapsed to plain names for the chosen language).
- Tabs, the Localize dialog and export buttons: `renderer/app.ts`.
- End to end (enable → add → edit tabs → export → read the archive back →
  remove): `e2e/localization.spec.ts`.
