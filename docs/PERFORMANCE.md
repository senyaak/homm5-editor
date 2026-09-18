# Performance log

What got faster, when, and by how much — the performance work kept apart
from [CHANGELOG.md](../CHANGELOG.md) so a release's notes say what changed
for the person using the editor and this says what changed under them.
Entries are written as they land, newest last within a section, in the
changelog's voice: what was wrong, what it cost, what it costs now.

Numbers are measured, not estimated, and always on one of two maps: the
shipped campaign map A2C1M1 (the honest workload) and the mix stress map
`tools/perf-stress.ts` builds (2000 objects, 600 creatures, 528 effect
batches — a map no designer would make). How each was measured, what was
tried and dropped, and what is left is in [SLICE_fx_performance.md](../SLICE_fx_performance.md).

## Unreleased

- The frame can be measured: `view.perf()` reports frame-time percentiles,
  the loop's sections, draw calls and the particle side (systems, atlases,
  bytes), plus Chromium's long-frame attribution and memory per process, and
  `e2e/fx-perf.spec.ts` reads it all off a shipped map. Nothing is faster yet;
  this is the baseline the effects work is held against.
- Copies of one particle effect play in step. The per-placement phase that
  kept thirty campfires from flickering together was the editor's own
  invention, not the game's, and is gone — it is what lets copies share one
  simulation next.
- Every copy of an effect on a floor is one batch: one simulation and one
  draw for all 55 chests' sparkle, with each copy's placement in a small
  matrix texture. On A2C1M1 that is 313 effect draws → 112, 311 MB of
  atlases → 146 MB, and the frame 19 → 15 ms.
- A recording is sampled once, into a table on the GPU, instead of being
  interpolated for every alive particle every frame; the frame only decides
  which copies of the trigger train are playing. Effects now cost about a
  millisecond a frame on A2C1M1 (was 7), and the whole frame holds 60 fps
  with every effect on.
- Creatures' idle animation is posed once per creature kind, from a table the
  clip is baked to, instead of once per creature per frame with a skeleton
  each. The bodies breathe in step (the spread was ours, like the effects');
  on A2C1M1 that is 9 ms a frame back — the frame's JavaScript is 4 ms now,
  down from 19 before this series. `Idle stance: visible` now leaves
  off-screen creatures undrawn rather than merely unposed.
- Closing a map releases its creatures' bone tables (they were kept through
  every reopen), and the object explorer rebuilds once per frame instead of
  once per placed object. `tools/perf-stress.ts` builds a map crammed with
  effects or creatures and reads the frame under it.
- Every creature of one kind on a floor is one draw call, as the static
  objects already were: 1200 monsters of 182 kinds went from 2990 calls and
  18 ms of JavaScript a frame to 790 and 10.
- The shadow map is redrawn when something in it changed — an object placed,
  moved or removed, the sun, the view — or every half second, not every
  frame. A creature's breathing does not count; its shadow stands.
- A particle frame travels as its texels and lands in one RGBA atlas per
  frame table, shared by every effect that wears the same frames — instead of
  two PNGs per frame decoded through a canvas into two textures per batch.
  On A2C1M1 the atlases are 38 MB where they were 146 (224 textures → 58),
  and the frame's texels are in the main process once per file, not once
  per effect that names it.
- Placing an object on a big map no longer stalls: the object explorer is a
  virtual list — every object is in it now (the 2000-row cap is gone), only
  the rows on screen are in the DOM — where it rebuilt all its rows and laid
  them out again on every placement (~95 ms of the ~110 a placement cost on
  a 2700-object map; 14 ms now). The undo recorder's document diff skips
  unchanged blocks natively (3 ms → 0.2 on a megabyte map).
- The tables a map opens with — every creature kind's idle, every effect's
  recording — are baked in worker threads instead of freezing the window
  for the batch: creatures stand at rest and effects wait until their table
  lands, a few hundred milliseconds in. A2C1M1's scene build went from 520
  to 310 ms and its effects' from 560 to 200; on the creature stress map
  the scene build was 2.4 s and is 0.8. `view.perf()` reports the bakes
  (count, milliseconds, still pending).
- A model's textures reach the renderer as texels, not as PNGs encoded in
  the main process and decoded again in the window, and a texture over the
  cap is read from the file's own mip level instead of decoded whole and
  reduced. The asset chain remembers where a file was found and what a
  document said, and the DXT block decoders run without allocating (the
  same bytes out, checked over every shipped texture; 3.4× faster). Opening
  A2C1M1: the main process's part 6.2 → 2.2 s, the scene on screen at
  ~6 s where it was 11.5. The ground-tile palette reads its thumbnails off
  the tiles' own mip levels (0.85 → 0.13 s), and the object catalogue's
  scan no longer stats every entry it lists (0.8 → 0.5 s).
- A model's textures go to the GPU as the game ships them: the file's own
  DXT blocks and mip chain, whole, on a card that takes S3TC (every desktop
  one does; the window says so once at start). No decode in the main
  process, no upload of texels, a quarter to a sixth of the bytes across
  the IPC and on the card — and the texels and mips the game itself draws
  with. A file with no mip chain, and the ground tiles, still travel
  decoded.
- The scene payload's numbers are rounded by arithmetic instead of through
  `toFixed` strings (a quarter of a second per map), and `view.perf()`
  reports the scene's draws by what issues them.
- A model's meshes that wear the same material are one draw call instead
  of one each — a building's walls, a tree's branches. A2C1M1: 604 → 427
  draw calls a frame, the picture unchanged.
- three.js 0.160 → 0.186 (run `npm install`). Our shaders pass the new
  shadow intensity to three's `getShadow`; a non-square texture's padded
  mip tail has the block count its levels take (the new upload path
  checks, the old one did not).
- Every part of every still object on a floor that wears one material is
  one draw call: one `BatchedMesh` per material, the models' parts as its
  geometries, the placements as its instances. A map crammed with 2000
  objects of 470 kinds went from 1496 draw calls and a 12.9 ms render to
  994 and 9.3; the picture is pixel-identical.
- The creatures' idle animation uploads one bone texture a frame for every
  kind on the map instead of one per kind, and an effect glued to a bone
  is re-hung only when the bone moves. On that same map: the frame's
  JavaScript 10.8 → 8.5 ms.
- Every particle effect on a floor that draws with one frame atlas is one
  draw call, however many different effects that is: the baked recordings
  are stacked in one GPU texture, and a small per-draw list says which
  entries, which copies and which tint each instance takes. That same map
  drew its 528 effect batches as 528 calls and wears 203 atlases: 994 →
  683 calls, JavaScript 8.5 → 6.3 ms, render 8.1 → 5.8; A2C1M1's 112
  effect draws are 58. The picture is unchanged.
- A blended two-sided part is drawn once, as the game draws it. three drew
  such a material twice a frame (back faces, then front) and re-resolved
  its shader program before each pass — 30 re-resolves and 15 extra draw
  calls a frame on the stress map, all of it in `getParameters`.
- A particle whose rotation runs to millions of radians (the Storm Lord's
  Flow_Initial) no longer prints 4900 `toHalfFloat(): Value out of range`
  warnings per map open: the angle is stored wrapped to (−π, π], which its
  cos and sin cannot tell apart. Opening the stress map: 12.4 → 11.4 s.
  `npm run test-fx-table` covers the bake.
- A map's bytes no longer cross to the window through the IPC. The
  textures, geometry and animation clips — typed arrays now, as the files
  hold them — stay in the main process and the window fetches them in one
  stream over the editor's own `h5e-blob:` scheme at 400+ MB/s, where the
  IPC reply moved them at 60–95 with both sides waiting. Opening A2C1M1:
  ~2.1 → ~1.7 s; a stress map of 2000 objects and 600 creatures: ~8.2 →
  ~5.0 s. The frame loop also stands still while a map loads instead of
  drawing the old one under the spinner.
- Reopening a map, or switching maps, no longer grows the editor by the
  map's size each time (~700 MB per reopen of a crowded map, until the
  window ran out of memory). Four things survived a map's close: every
  creature kind's draw geometry, the shared material cache with every
  texture ever shown, the ground-projected parts' overlay textures and the
  cliff rock texture. All four go with the world now; eight reopens hold
  steady where four used to add 1.5 GB.- The creatures' idle and the effects are there with the first frame. The
  bone tables and the particle tables were baked in the window after the map
  was on screen, in workers of its own, with the recordings fetched over a
  third IPC — a second or two of creatures standing at rest and silent
  campfires on A2C1M1, ten seconds on the stress map. They are baked where
  the scene is built now and travel with it; the window's bake workers, their
  bundle and the `map:fx` channel are gone.
- A map's models are decoded once and kept on disk. Every model a map places
  is decoded by a pool of processes (as many as the machine has cores to
  spare) and written to a cache in the editor's temp folder, one entry per
  model with its textures and baked recordings as shared entries beside it;
  an entry is used while every file it was made from is where it was, the
  same size and date — a mod mounted or a texture edited decodes afresh. The
  main process no longer decodes a map at all on the second open: A2C1M1's
  main-side time 1.2–1.5 s → 0.65 s, the stress map's 3.4–4.3 s → 1.4 s; the
  first open of a map costs what it did. The cache trims itself to 4 GB.
- A cached map's bytes never enter the main process. It reads each entry's
  header only (a few kilobytes of a file that may be forty megabytes), the
  models' arrays stay file references, and the map's blob serves those
  ranges off the disk when the window fetches — so the main process holds
  where a map's bytes are, not the bytes: its RSS over four opens of the
  stress map ~720 → ~390 MB, with no array buffers at all, and A2C1M1's
  main-side time 0.65 → 0.44 s. Of what is left, half is the ~1800 stats
  that validate the entries (one stat per file now — the asset chain keeps
  the stat its own search made — where it was a search plus a stat) and
  half the header reads. The dialog scenes go the same way: the builder
  child takes the stage's models from the cache (decoding into it what is
  missing), and the scene's arrays reach the window by blob rather than
  by two structured clones — A2C1/M1/S1's second open is 0.8 s against
  2.1 for the first, which still decoded 43 of its 89 models — and the
  scenes decode DXT textures like the map now (the child was never told
  the GPU takes them).
