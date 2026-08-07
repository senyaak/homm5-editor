# The windows that MAKE things

Creatures, artifacts, artifact sets, heroes, buildings, campaigns, new maps.
They have nothing in common as data — a creature ends in the executable's
ceiling, a campaign in a folder of missions — and everything in common as
FORMS: each one fills a record, hands it to main, and gets back either a
rebuilt archive or a sentence about what was wrong with it.

This is what they agree on. It is one page because the three bugs at the end
were the same bug three times, and each was found by writing the same rule into
one more window.

## 1. Say what is missing BEFORE the press

Every one of these forms ends in a channel that throws:

| the channel says | when |
|---|---|
| `the file stem is required` | a creature or an artifact with no stem |
| `an icon href is required — take the donor's` | an artifact with no icon |
| `cannot resolve the donor (none)` | a creature with no preset |
| `the hero needs an identifier` | …a hero with none |
| `a preset is required — a new hero starts from the shape of a shipped one` | …and with no preset |
| `a set of 1 never combines` | a set with one member |
| `HERO_SPEC_… is not a usable specialization id` / `a specialization needs a name` | a specialization |
| `the identifier is required` / `a building needs a model` | a building |
| `the campaign needs a name` / `the map needs a name` | a campaign, a map |

Every one of those arrives **after** the press — after a full rebuild in most
cases — as a line of red under a form still holding everything that was typed.
The form knows the same rules, so it says so first:

- a star (`<b class="req">*</b>`) on the label,
- what is still missing, named under the form (`still needed: identifier, name, preset`),
- Save disabled until they are in.

One helper does it: **`renderer/core/form-gate.ts`**.

```ts
const gate = requireFilled({
  ok: 'am-ok',              // the button to hold down
  missing: 'am-missing',    // where to name what is still needed
  fields: { files: 'am-file', id: 'am-id', name: 'am-name', icon: 'am-icon' },
  extra: () => (members() < 2 ? ['two members or more'] : []),  // what a box cannot say
  watch: '#as-members input',   // controls the form draws and redraws
});
gate.rewatch();   // after filling the form, or after redrawing part of it
```

It lives in `core/` rather than beside the mod forms because two of its callers
— the campaign list and the New Map dialog — are not mods.

### What gets a star

What the build **refuses**, plus what makes the thing **pointless**: the
identifier that names its files, the preset a copy is made from, the name it is
listed under, the icon a hero screen shows without, a dwelling's creatures.

Not every field the record happens to have. A creature with no description is a
creature; a tent with no colour is a border guard of no colour, which the game
will happily show. Marking those would train people to ignore the star.

| form | marked |
|---|---|
| creature | preset\*, identifier, name |
| artifact | files, id, name, icon |
| artifact set | files, effect, name, two members |
| hero | preset\*, identifier, name |
| specialization | identifier, name |
| building | identifier, model, name, + the class's own (a dwelling's `creatures`) |
| spell | files, id, name, + the tiles an area one covers |
| campaign | name (and Create in the list, which used to answer an empty box by doing nothing) |
| new map | name |

The spell's last one is the star with no label to sit on: a spell that hits an
area and names no tiles builds cleanly and covers NOTHING, because the shape is
a switch on the spell's number and a number of ours falls to a default that
covers none. So it is named under the form the way a set's "two members" is —
and, like that one, the build behind it refuses too.

\* Only for a NEW one. A creature or hero already in the mod keeps the documents
it was built from, so asking for a preset again would be a refusal invented by
the form rather than one the build makes.

Each form has a refusal test beside its authoring one — `mod-001`, `mod-003`
(twice: the artifact and the set), `mod-004` (twice: the hero and his
specialization), `mod-005`, `mod-008` (twice: the fields, and the tiles),
`campaign.spec.ts`.

## 2. A form must carry back everything it writes

This is the rule the bugs were all violations of. **Saving writes the whole
record**, so any field the form does not carry is written back as whatever the
box happened to hold — the last thing's value, or nothing.

Three found in one pass:

- **The creature's preset.** Never restored when a creature was opened for
  editing, and the hidden input keeps its last value — so Save either failed
  with `cannot resolve the donor (none)`, or, if a preset had been picked for
  something else since, quietly rebuilt the creature from THAT one's art. The
  donor is recorded on the creature now (a hero has recorded his `basedOn` all
  along), and `mods:update` keeps the documents a creature already has when the
  payload carries no donor — so creatures built before that was written down
  still save.
- **The artifact set's file stem.** Not in the DTO at all, so the box held the
  last set's stem, or none, and saving wrote the set's texts under it.
- **The campaign's name.** Read from the document into an editable box that was
  never read back: renaming a campaign did nothing and said nothing.

And its twin: **New must clear the form.** Every box kept the last one's
contents, so the fastest way to lose ten minutes was to author one, press New,
author the next, and be refused for an identifier already taken.

The lesson generalises past these windows: a form that shows a record must show
ALL of it or write back only the part it shows. Half of one is how a creature
loses its description by having its price corrected — which is why the DTOs here
carry whole records rather than summaries, and say so in their comments.

## 3. Where the truth lives

Not in the form. The rules above are read off:

- `electron/channels/mods-*.ts` — what the channel refuses outright,
- `src/mods/mod-model.ts` — `addCreature` / `addArtifact` / `addArtifactSet` /
  `addHero`, the id shapes and the uniqueness rules,
- `src/mods/buildings.ts` — `REQUIRED_FIELDS`, per class, which is why the
  building form's stars are drawn from data rather than written in the markup.

A star that is not one of those is a rule invented in the renderer, and the two
will drift.

## 4. Adding another form

1. Find what its channel throws for, and what its core `add*` refuses.
2. Put a `<b class="req">*</b>` on those labels and a `<div id="…-missing"
   class="um-missing">` under the form.
3. `requireFilled({ ok, missing, fields, extra?, watch? })`, built lazily if the
   form's controls are drawn rather than static; `rewatch()` after every fill.
4. A refusal test: blank form, button down, the names listed, then filled one at
   a time until the button comes up.

## See also

- [../README.md#testing](../README.md#testing) — what `npm test` actually runs.
- [mapPlaceables/buildings/BUILDINGS.md](mapPlaceables/buildings/BUILDINGS.md) —
  §7, the buildings window, and §3 for the fields a PLACEMENT needs, which the
  object panel does not mark yet.
- [NEW_CREATURES.md](NEW_CREATURES.md), [ARTIFACTS.md](ARTIFACTS.md),
  [CAMPAIGNS.md](CAMPAIGNS.md) — what each form is making.
