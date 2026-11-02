# How the editor is designed

The owner's standing decisions about what the editor does and how its windows
behave. They came out of corrections, and they are as binding as the code
conventions in [CONTRIBUTING.md](../../CONTRIBUTING.md#conventions-that-matter).
What every window that MAKES something agrees on is
[CONTENT_FORMS.md](../CONTENT_FORMS.md).

## Data

- **Show the data as it is saved.** When the display disagrees with the file,
  fix the display. Model geometry was once divided by 2 so it fitted a world
  where a tile was one unit; the data was consistent, the renderer was mixing
  two coordinate systems, and a conversion on load forces one back on save —
  into the path that writes the user's map, the one place a mistake destroys
  work. Conversions live where the view lays out its world, as one named
  constant. A fix that has to touch the save path is on the wrong side.
- **Take the value, don't derive it.** When data is missing a piece, first ask
  who already holds it whole. A bare `shared` lacked `#xpointer(/<type>Shared)`;
  the rule "the class is always `<type>Shared`" held on 21 of 21 shipped maps,
  and the palette holds the whole href anyway (`<Link href="…">`) — the type is
  derived FROM that fragment. The palette knows hrefs, `Types.xml` knows the
  enumerations (our colour list had seven of eight), the shipped maps know the
  shape of any field. A measurement is good for CHECKING a derivation, bad as
  its source.
- **Properties are described by JSON schema**, with `$ref` for what types
  share, never a per-type table of fields in UI code (`src/schema/`,
  [TYPE_SPEC.md](../TYPE_SPEC.md), [MAP_PROPERTIES.md](../MAP_PROPERTIES.md)).

## Windows

- **A preset fills every field it covers, visibly.** Picking a preset, a donor
  or a "take from" writes its values INTO the form's fields, where they can be
  seen; what the author changes afterwards is the difference. A field that only
  says "as the preset" hides what will be built: 018's town once took one
  exterior stage of its own and kept the donor's nine with nothing showing it,
  and its walls stood in black cut-outs. A faction's building tree starts
  EMPTY; a preset puts a town's whole tree, and every building field shows the
  record's value, not a grey hint. Serialization stays compact: rows equal to
  the preset are stored as the preset.
- **The newest web platform, always**: `<dialog>` + `showModal()`, `popover`,
  `:has()`, container queries, `inert`, native form elements, `structuredClone`
  — before writing bespoke JS or CSS. It is Chromium; there is no support
  matrix. Never `confirm()` / `alert()` / `prompt()` (CONTRIBUTING says why).
- **The gesture named is the gesture built.** "On click" means a click, not a
  drop. Find the source of the event the owner named and branch THERE — "if
  the modifier, our path; otherwise everything as it was" — leaving the
  existing path untouched by default. Rewriting the path that already worked
  (the split dialog, 02.08.2026) broke the dialog for everyone and still did
  not give the gesture asked for. Check every gesture on the list.
- **Deleting**:
  - something MAPS refer to is never refused: the question names those maps
    exactly and deletes on yes. Maps are someone else's; their author fixes
    them;
  - something OUR MOD refers to is refused, naming who holds it, and those go
    first (`removeFaction`, `removeSpecialization`, `removeHeroSkill`,
    `removeSpell` with `src/mods/spell-holders.ts`): otherwise the mod names a
    type the game no longer knows, and the game fails at start-up. Never
    "repair" the mod's other records silently.
- **A new refusal rule is narrow and tested through the window.** Word it by
  what it is about ("does it deal damage at all", then the reach), not by a
  handy neighbouring trait — the wide wording refused the Sharpshooter
  training, an adventure spell that only shares "aims at nobody". Unit-test
  BOTH sides, including content the rule must not touch. Then check it through
  the window: a form's gate re-evaluates only on the fields it was told to
  watch, and an `extra` that reads other fields must add them to `watch`
  (08.08.2026 — the unit test could not catch it, e2e did).

## Art

- **Our things get our own art**, however crude. Reusing a picture that does
  not fit confuses more than a bad drawing: on the hero screen the picture IS
  the item's identity, and the bug report comes in about the wrong item. Icons
  are drawn by code (`tools/draw-artifact-icons.ts`: shapes, drawn at 4× and
  averaged down) and the script is committed beside the pictures.
- **No perfectionism once it renders.** An object that renders recognisably and
  places without error is done; a faint shadow plate is a one-line note for
  the owner to decide on, not an investigation.

## The game's own quirks

A flaw the game shows WITHOUT our mod is found, proven to be the game's, and
written down — and not fixed unless asked. The tooltip that glues the last
green line to the first red one is the game's template
(`spell_affections.txt` has no `<br>` between the lists); a fix was built,
merged and reverted on "if that's how it is, let it be". Our own bugs are
fixed at once.
