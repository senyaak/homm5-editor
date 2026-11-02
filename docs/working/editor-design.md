# How the editor is designed

The owner's standing decisions. Code conventions:
[CONTRIBUTING.md](../../CONTRIBUTING.md#conventions-that-matter); windows that
make content: [CONTENT_FORMS.md](../CONTENT_FORMS.md).

## Data

- Show data as it is saved. When the display disagrees with the file, fix the
  display; conversions live in the view as one named constant. A fix that
  touches the save path is on the wrong side.
- Take a value from where it already lies whole (the palette's href,
  `Types.xml`'s enumerations, the shipped maps' fields) instead of deriving it
  by a rule. Measurements check a derivation; they are not its source.
- Editable properties are described by JSON schema with `$ref` for shared
  parts — no per-type field tables in UI code ([TYPE_SPEC.md](../TYPE_SPEC.md),
  [MAP_PROPERTIES.md](../MAP_PROPERTIES.md)).

## Windows

- A preset, donor or "take from" FILLS every field it covers, visibly; the
  author edits the difference. Never a field that only says "as the preset".
  Rows equal to the preset are stored as the preset. A faction's building tree
  starts empty; a preset puts a whole town's tree.
- Use the newest web platform first (`<dialog>`, `popover`, `:has()`,
  container queries, `inert`, native controls). Never `confirm()` / `alert()` /
  `prompt()`.
- Build the gesture named: "on click" is a click. Branch at the source of that
  event and leave the existing path as it was. Check every gesture listed.
- Deleting something MAPS refer to: never refuse — name the maps, delete on
  yes. Deleting something OUR MOD refers to: refuse, name the holders; they go
  first. Never silently repair other mod records.
- A new refusal rule: word it by what it is about, not a neighbouring trait;
  unit-test both sides including content it must not touch; then test it
  through the window, adding every field its check reads to the form's `watch`.

## Art

- Our things get our own art, however crude, drawn by code
  (`tools/draw-artifact-icons.ts`) with the script committed. Never reuse a
  picture that does not fit.
- An object that renders recognisably and places without error is done; a
  cosmetic quirk is one line to the owner, not an investigation.

## The game's own quirks

A flaw the game shows without our mod: prove it is the game's, write it down,
and do not fix it unless asked. Our own bugs are fixed at once.
