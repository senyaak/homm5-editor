---
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
  - "**/*.{rs,c,cc,cpp,h,hpp,cs}"
---

# Code

- Modules stay small and single-purpose: split a file before it takes a
  second concern, in a commit of its own.
- No leftovers: a stand-in is deleted the moment the real thing lands, with
  its tests; it is never kept as a fallback.
- One code path: a changed model or default comes with its content migrated,
  never a "field absent → old behaviour" branch. A migration that is more
  than a few files is asked about first — whether to migrate at all — not
  done silently.
- One feature, one folder; a big component's inner parts get subfolders.
- Fix what the task asks; a bug noticed beside it becomes an issue or a
  work-list item, not part of the change. A new entity, field or enum added
  to get round a problem is a design decision: say it, don't slip it in.
- Hotkeys bind the physical key (`event.code` `'KeyF'`, an engine's key code),
  never the typed character (`event.key`): another keyboard layout breaks it.
- Every screen, overlay and control a person uses works with the mouse; one
  the pointer cannot drive reads as broken.
