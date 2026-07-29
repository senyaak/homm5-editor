// Making a dwelling through the window — the feature that does not exist yet.
//
// A dwelling for a creature the game does not ship is ours to make: `addDwelling`
// builds one (document, footprint measured off the model, palette entry, texts,
// and `bake` to bring a town-screen building down to map scale), and the map spec
// stands the Sharpshooter's palace on a map. What is missing is the DIALOG — every
// dwelling that exists was authored by writing a spec in a file, which is why the
// port's tier 4-7 buildings and the mummies' pyramid are still data in the maps
// repo with nothing to install them.
//
// So this spec is written and marked `fixme`: it is reported every run as work
// planned and not done, and it costs nothing while the buttons it names are not
// there. When they are, delete one word and it runs.
//
// The shape it should take is the Artifacts dialog's, which already covers this
// ground: a LIST of what the mod carries with edit and remove, a form on top of
// it, members picked from a list rather than typed, and Build & install writing
// the one global archive. The fixture in e2e/mods.ts (PALACE) is exactly what the
// form has to be able to express, field for field.

import { test } from '@playwright/test';

test.fixme('authors a dwelling for a creature the mod adds', async () => {
  // Dwellings…  →  New dwelling
  //   file stem            SharpshooterPalace
  //   hires                the mod's own creature, TICKED from a list — a
  //                        misspelt id builds cleanly and hires nothing
  //   model                /Arenas/Town/Rampart/HighCabins_u2r0.xdb
  //   bake                 6 tiles wide, ground at 41.2
  //   icon                 /UI/TownHall/preserve/128/d3u.xdb
  //   name, description    ours; a value starting with `/` is an href to a text
  //                        the game already has, in the install's own language
  //   the four visit messages
  //
  // Then: Build & install, and the archive carries
  // Dwellings/SharpshooterPalace/… with a footprint of more than one tile —
  // one tile means the model was not found and the building would be placed
  // inside its neighbour instead of failing.
});
