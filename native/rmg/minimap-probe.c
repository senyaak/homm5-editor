// The minimap's four open readings, measured instead of inferred.
//
// A piece of the ONE translation unit — see native/homm5-editor.c. It sits
// after the oracle because it borrows that file's config word, its
// `rmg_readable`, and the same argument: an instrument, off unless its own
// switch is in `homm5-editor-rmg.txt`.
//
// WHY IT EXISTS. docs/RMG.md now reads the whole minimap drawer out of the
// executable, and four of its statements are still INFERENCES rather than
// measurements — each defensible, each the kind that has been wrong before:
//
//   1. the flat colour. The drawer takes it as a pointer argument and the RMG
//      fills it from its owner's `+0xA0`; nobody has ever seen the value. One
//      dereference settles it.
//   2. "the flat-colour arm never fires on a generated map". That follows from
//      the ground flags being 16 everywhere, which is true of both reference
//      terrains — but it is a fact about two files, not about the predicate.
//      A count of calls against a count of trues is the predicate's own answer.
//   3. "the darkening mask is the passability plane". Measured at 95.4% off the
//      reference picture, with every miss one way round. The mask itself is an
//      argument to the terrain pass; dumping it turns 95.4% into a diff.
//   4. which of the three collected lists each icon loop drains. That was
//      paired by what the names plausibly mean. The name each lookup asks for,
//      in order, says it outright.
//
// WHY A WINDOW. The editor draws its own minimap panel through the SAME
// terrain pass, over and over as the map is edited. So everything here logs
// only between the entry and the exit of the RMG's drawer — one build of one
// map — and the panel stays silent.
//
// EDITOR ADDRESSES. Like the oracle: an ordered run comes from the editor, so
// these are the editor's. Each is named with its twin in the game image, which
// is where docs/RMG.md's addresses come from, and with the `ret` its arity was
// taken from — never from what the signature looks like it should be.

#undef LOG_UNIT
#define LOG_UNIT rmg_minimap_probe

/**
 * The minimap WRITE — game 0xDD1BD0, `ret 8`. The second half of the window.
 *
 * The window used to be the whole step (the editor's 0xCF4E30, game 0xEA30D0),
 * on the reasoning that the build and the write are both inside it. A run said
 * otherwise: the step opened and closed with nothing in it, and the build ran
 * afterwards — so the save path reaches the build some other way than the one
 * direct call the disassembly shows, and a window there watches the wrong
 * thing. Two windows over the two functions we actually care about have no such
 * assumption in them; `g_mmInside` counts rather than flags so they can nest.
 */
#define MM_ED_WRITE_RVA 0x4b6570u
static const BYTE MM_ED_WRITE_HEAD[] = { 0x81, 0xec, 0xa8, 0x01, 0x00, 0x00 };
/** The minimap build — game 0xDD0C70, `ret 4`. The first half of the window. */
#define MM_ED_DRAW_RVA 0x4b5f90u
static const BYTE MM_ED_DRAW_HEAD[] = { 0x81, 0xec, 0x64, 0x01, 0x00, 0x00 };
/** The icon blit — game 0xDCFDE0, `ret 0Ch`. Where each icon actually lands. */
#define MM_ED_BLIT_RVA 0x4b5580u
static const BYTE MM_ED_BLIT_HEAD[] = { 0x83, 0xec, 0x1c, 0x89, 0x0c, 0x24 };
/** The resampler — game 0x9743A0, `ret 4`. Its arguments name the filter. */
#define MM_ED_RESAMPLE_RVA 0x391330u
static const BYTE MM_ED_RESAMPLE_HEAD[] = { 0x55, 0x8b, 0xec, 0x83, 0xe4, 0xf8 };
/** The terrain pass — game 0xDD0660, `ret 0Ch`. Its arguments are the reading. */
#define MM_ED_TERRAIN_RVA 0x4b4fc0u
static const BYTE MM_ED_TERRAIN_HEAD[] = { 0x83, 0xec, 0x18, 0x57, 0x8b, 0xf9 };
/** The flat-colour predicate — game 0x9EC480, `ret 4`. */
#define MM_ED_SEA_RVA 0x8d6070u
static const BYTE MM_ED_SEA_HEAD[] = { 0x8b, 0x41, 0x2c, 0x83, 0xe8, 0x02 };
/** The icon lookup by name — game 0xDD3440, `ret 8`. */
#define MM_ED_ICON_RVA 0x4b5710u
static const BYTE MM_ED_ICON_HEAD[] = { 0x51, 0x89, 0x0c, 0x24, 0x8d, 0x4c, 0x24, 0x08 };
/**
 * The layer walk's COVERAGE sampler — game 0x9ED7D0, `ret 8`.
 *
 * Found by walking the editor's own call chain rather than by matching bytes:
 * the terrain pass (0x8b4fc0) calls the document chooser at 0xCD62E0 (game
 * 0x9EB800), which calls the water walk 0xCD78A0 and the land walk 0xCD79D0
 * (game 0x9ED3E0 / 0x9ED2A0), and both call this. Reading those three in the
 * EDITOR's image also answered a question the port had open: the editor is
 * x87 where the game is SSE, but the walk, the scoring and the bilinear are
 * step for step the same, so the arithmetic is not what makes the port and
 * the reference picture disagree on 53 tiles.
 */
#define MM_ED_COVER_RVA 0x8d73c0u
static const BYTE MM_ED_COVER_HEAD[] = { 0x83, 0xec, 0x14, 0xd9, 0x44, 0x24, 0x18 };

/** `(image, terrainVector, iconVector)` — `edx` is a real argument here. */
typedef void(__fastcall *MmDrawFn)(void *self, void *terrainVec, void *iconVec);
/** `(image, terrain, mask, colour, border)` — thiscall plus three on the stack. */
typedef void(__fastcall *MmTerrainFn)(void *image, void *terrain, void *mask, const DWORD *colour,
                                      int border);
/** `(terrain, x, y)` — returns non-zero for "this tile is the flat colour". */
typedef char(__fastcall *MmSeaFn)(void *terrain, int x, int y);
/** `(name, -, resource, flag)` — `edx` is the unused filler, as in the oracle. */
typedef void *(__fastcall *MmIconFn)(void *name, void *edx, void *res, int flag);
/** `(pathBits, images, names, refs)` — thiscall plus two on the stack. */
typedef void(__fastcall *MmWriteFn)(void *self, void *images, void *names, void *refs);
/** `(image, -, x, y, icon)` — `edx` filler again, three on the stack. */
typedef void(__fastcall *MmBlitFn)(void *image, void *edx, int x, int y, void *icon);
/** `(dst, src, filter)` — the two are `{buf, rows, w, h}` sixteen-byte images. */
typedef void(__fastcall *MmResampleFn)(void *dst, void *src, int filter);
/** `(mask, -, x, y)` — thiscall with two floats; `edx` is the filler again. */
typedef int(__fastcall *MmCoverFn)(void *plane, void *edx, float x, float y);

static MmDrawFn g_mmDrawOrig = NULL;
static MmTerrainFn g_mmTerrainOrig = NULL;
static MmSeaFn g_mmSeaOrig = NULL;
static MmIconFn g_mmIconOrig = NULL;
static MmWriteFn g_mmWriteOrig = NULL;
static MmBlitFn g_mmBlitOrig = NULL;
static MmResampleFn g_mmResampleOrig = NULL;
static MmCoverFn g_mmCoverOrig = NULL;

/** Are we inside the RMG's own minimap build? Nothing logs outside it. */
static int g_mmInside = 0;
/** The layer vector's first record, so a coverage call can name its layer. */
static const BYTE *g_mmLayerBase = NULL;
/** The flat-colour predicate, counted over one terrain pass. */
static int g_mmSeaCalls = 0;
static int g_mmSeaTrue = 0;

/**
 * One row of the darkening mask, as hex.
 *
 * The mask is `{+0 width, +8 rows, +0x10 height}` and a row is packed bytes,
 * bit `x & 7` of byte `x >> 3` — the same reading the terrain pass does. Hex
 * rather than a bit string because 96 tiles is 12 bytes, and a diff against
 * the port's passability plane is a diff either way.
 */
static void mm_log_row(const char *tag, int y, const BYTE *row, int bytes) {
  static const char digits[] = "0123456789abcdef";
  char line[16 + 2 * 512 + 1];
  int i = 0, n = 0, k;
  while (tag[i] && i < 8) { line[i] = tag[i]; i++; }
  line[i++] = ' ';
  num_to_dec(y, line + i, &n);
  i += n;
  line[i++] = ' ';
  for (k = 0; k < bytes && k < 512; k++) {
    line[i++] = digits[(row[k] >> 4) & 0xf];
    line[i++] = digits[row[k] & 0xf];
  }
  line[i] = 0;
  log_line(line);
}

/**
 * A few numbers on one line, under THIS file's switch.
 *
 * Not the oracle's `rmg_log_ints`: that one writes to the oracle's own file,
 * so the first run's blit and resample lines went to `homm5-editor-rmg.log`
 * while everything else went to the run log. The data was all there and the
 * log was not one log, which is worse than either.
 */
static void mm_log_ints(const char *prefix, const int *vals, int count) {
  char line[256];
  int i = 0, n = 0, k;
  while (prefix[i] && i < 40) { line[i] = prefix[i]; i++; }
  for (k = 0; k < count && i < (int)sizeof(line) - 14; k++) {
    if (k) line[i++] = ' ';
    num_to_dec(vals[k], line + i, &n);
    i += n;
  }
  line[i] = 0;
  log_line(line);
}

/**
 * A `V x V` byte plane of the terrain object, row by row.
 *
 * The two that matter are the GROUND FLAGS (`+0x28` rows, `+0x2C`/`+0x30`
 * dims) and whatever `+0x6C` is (`+0x70`/`+0x74` dims) — the plane the arm
 * that sets most of the darkening mask reads as `== 0`. docs/RMG.md says that
 * one is the passability plane, off a 95.4% agreement with the picture; having
 * the bytes makes it a comparison instead of a score.
 */
static void mm_dump_plane(const char *tag, const void *terrain, unsigned rowsOff,
                          unsigned wOff, unsigned hOff) {
  const BYTE *t = (const BYTE *)terrain;
  const BYTE *const *rows;
  int w, h, y;
  if (!terrain || !rmg_readable(terrain, hOff + 4)) {
    log_text(tag, " unreadable");
    return;
  }
  rows = *(const BYTE *const *const *)(t + rowsOff);
  w = *(const int *)(t + wOff);
  h = *(const int *)(t + hOff);
  log_num(tag, w);
  log_num(tag, h);
  if (w <= 0 || w > 512 || h <= 0 || h > 512 || !rows || !rmg_readable(rows, (unsigned)h * 4)) {
    log_text(tag, " rows unreadable");
    return;
  }
  for (y = 0; y < h; y++) {
    if (!rows[y] || !rmg_readable(rows[y], (unsigned)w)) continue;
    mm_log_row(tag, y, rows[y], w);
  }
}

/**
 * The terrain's LAYER VECTOR, whole: every record's document and its mask.
 *
 * This is the reading the port is now stuck on. `0x9EB800` picks a tile's
 * document by walking `[terrain+8] .. [terrain+0xC]`, records of 0x18 bytes —
 * `{+0 ?, +4 rows, +8 w, +0xC h, +0x10 document}` — backwards, scoring each by
 * `remaining * coverage`. The port reproduces 8,783 tiles of 8,836 that way
 * and loses 53, all at zone boundaries and all to the LOWEST-priority layer;
 * and searching every one of the 5,040 orders of the seven layers under both
 * scorings never reaches zero, so the order is not what differs. What is left
 * is the input: whether the vector the drawer walks holds the same masks, in
 * the same number, as the `GroundTerrain.bin` the save then writes. Dumping
 * the whole thing answers that without another guess — and if the masks do
 * match, the `mmc` lines below say which layer the engine measured what at.
 *
 * The document is read rather than resolved: `[rec+0x10]` is a reference whose
 * first word is the object once the map is loaded, and `+0x60` / `+0x64` are
 * its `Type` and `MinimapColor`, which is enough to name the layer.
 */
static void mm_dump_layers(const void *terrain) {
  const BYTE *t = (const BYTE *)terrain;
  const BYTE *begin, *end;
  int count, i;
  g_mmLayerBase = NULL;
  if (!terrain || !rmg_readable(terrain, 0x10)) {
    log_line("mml unreadable");
    return;
  }
  begin = *(const BYTE *const *)(t + 8);
  end = *(const BYTE *const *)(t + 0xc);
  log_num("mml tiles x ", *(const int *)(t + 0));
  log_num("mml tiles y ", *(const int *)(t + 4));
  if (!begin || !end || end < begin) {
    log_line("mml vector unreadable");
    return;
  }
  g_mmLayerBase = begin;
  count = (int)((end - begin) / 0x18);
  log_num("mml count ", count);
  for (i = 0; i < count && i < 32; i++) {
    const BYTE *rec = begin + i * 0x18;
    const BYTE *doc;
    char tag[8];
    int n = 0;
    if (!rmg_readable(rec, 0x18)) {
      log_num("mml record unreadable ", i);
      continue;
    }
    log_num("mml layer ", i);
    doc = *(const BYTE *const *)(rec + 0x10);
    if (doc && rmg_readable(doc, 0x70)) {
      log_num("mml type ", *(const int *)(doc + 0x60));
      log_hex("mml colour x ", *(const DWORD *)(doc + 0x64));
      log_hex("mml colour y ", *(const DWORD *)(doc + 0x68));
      log_hex("mml colour z ", *(const DWORD *)(doc + 0x6c));
    } else {
      log_line("mml document unreadable");
    }
    // Tag the rows with the layer's index, so one pass of the log splits them.
    tag[0] = 'm'; tag[1] = 'm'; tag[2] = 'l';
    num_to_dec(i, tag + 3, &n);
    tag[3 + n] = 0;
    mm_dump_plane(tag, rec, 4, 8, 0xc);
  }
}

/**
 * The terrain LAYER the pass just filled — one pixel a tile, before Lanczos.
 *
 * This is the reading that needs no model at all: the picture in the file has
 * been through a resample, so every statement about a tile's colour has had to
 * be made about pixels that survived it. Here the tile IS the pixel, so the
 * colour rule and the halving can be checked tile for tile against what the
 * port computes. The image is `{+0x18 buffer, +0x1C rows, +0x20 w, +0x24 h}`.
 */
static void mm_dump_image(const char *tag, const void *image) {
  const BYTE *im = (const BYTE *)image;
  const BYTE *const *rows;
  int w, h, y;
  if (!image || !rmg_readable(image, 0x28)) {
    log_text(tag, " unreadable");
    return;
  }
  rows = *(const BYTE *const *const *)(im + 0x1c);
  w = *(const int *)(im + 0x20);
  h = *(const int *)(im + 0x24);
  log_num(tag, w);
  log_num(tag, h);
  if (w <= 0 || w > 256 || h <= 0 || h > 256 || !rows || !rmg_readable(rows, (unsigned)h * 4)) {
    log_text(tag, " rows unreadable");
    return;
  }
  for (y = 0; y < h; y++) {
    if (!rows[y] || !rmg_readable(rows[y], (unsigned)w * 4)) continue;
    mm_log_row(tag, y, rows[y], w * 4);
  }
}

/** As `mm_log_row`, under the mask's own tag. */
static void mm_log_mask_row(int y, const BYTE *row, int bytes) {
  mm_log_row("mmk", y, row, bytes);
}

/** The whole mask, or a line saying why not. */
static void mm_dump_mask(const void *mask) {
  const DWORD *m = (const DWORD *)mask;
  int w, h, bytes, y;
  const BYTE *const *rows;
  if (!mask || !rmg_readable(mask, 0x14)) {
    log_line("mmk none");
    return;
  }
  w = (int)m[0];
  h = (int)m[4];
  rows = (const BYTE *const *)m[2];
  log_num("mmk width ", w);
  log_num("mmk height ", h);
  if (w <= 0 || w > 512 || h <= 0 || h > 512 || !rows || !rmg_readable(rows, (unsigned)h * 4)) {
    log_line("mmk rows unreadable");
    return;
  }
  bytes = (w + 7) / 8;
  for (y = 0; y < h; y++) {
    if (!rows[y] || !rmg_readable(rows[y], (unsigned)bytes)) {
      log_num("mmk row unreadable ", y);
      continue;
    }
    mm_log_mask_row(y, rows[y], bytes);
  }
}

/**
 * The terrain pass, with its arguments written down before it runs and the
 * predicate's tally after.
 *
 * `[image+0x28]` is the side the pass iterates, which is the map size less
 * twice the border — the number docs/RMG.md measured off the reference picture
 * as 94. Having the engine say it removes the last step of that inference.
 */
static void __fastcall mm_terrain_hook(void *image, void *terrain, void *mask, const DWORD *colour,
                                       int border) {
  int side = (image && rmg_readable(image, 0x2c)) ? (int)((const DWORD *)image)[0xa] : -1;
  if (g_mmInside) {
    log_line("--- minimap terrain pass");
    log_num("mm side ", side);
    log_num("mm border ", border);
    if (colour && rmg_readable(colour, 4)) log_hex("mm flat colour ", *colour);
    else log_line("mm flat colour unreadable");
    mm_dump_layers(terrain);
    mm_dump_mask(mask);
    mm_dump_plane("mmf", terrain, 0x28, 0x2c, 0x30);
    mm_dump_plane("mmp", terrain, 0x6c, 0x70, 0x74);
    g_mmSeaCalls = 0;
    g_mmSeaTrue = 0;
  }
  g_mmTerrainOrig(image, terrain, mask, colour, border);
  if (g_mmInside) {
    log_num("mm sea test calls ", g_mmSeaCalls);
    log_num("mm sea test true ", g_mmSeaTrue);
    // AFTER the pass, because before it the buffer is the zero fill.
    mm_dump_image("mmi", image);
  }
}

/** The other half of the window: the write, which is where the resample is. */
static void __fastcall mm_write_hook(void *self, void *images, void *names, void *refs) {
  log_line("=== minimap write begins");
  g_mmInside++;
  g_mmWriteOrig(self, images, names, refs);
  g_mmInside--;
  log_line("=== minimap write ends");
}

/**
 * Where an icon lands, right after the line that says which icon it is.
 *
 * The blit takes the point already converted and truncated; the anchor rule
 * docs/RMG.md reads — top-left at `trunc(p) - trunc(size/2)` — is then a
 * subtraction away from the sizes on disk.
 */
static void __fastcall mm_blit_hook(void *image, void *edx, int x, int y, void *icon) {
  if (g_mmInside) {
    int pair[2];
    pair[0] = x;
    pair[1] = y;
    mm_log_ints("mm blit at ", pair, 2);
  }
  g_mmBlitOrig(image, edx, x, y, icon);
}

/**
 * Every resample the step runs: the two sides and the filter number.
 *
 * The filter is the whole reason this hook is here — docs/RMG.md takes mode 6
 * through a jump table to a `sinc(x) * sinc(x/3)` with support 3, and one
 * logged argument says whether the minimap is really the one asking for it.
 */
static void __fastcall mm_resample_hook(void *dst, void *src, int filter) {
  if (g_mmInside) {
    int vals[5];
    const int *d = (const int *)dst, *s = (const int *)src;
    vals[0] = (dst && rmg_readable(dst, 0x10)) ? d[2] : -1;
    vals[1] = (dst && rmg_readable(dst, 0x10)) ? d[3] : -1;
    vals[2] = (src && rmg_readable(src, 0x10)) ? s[2] : -1;
    vals[3] = (src && rmg_readable(src, 0x10)) ? s[3] : -1;
    vals[4] = filter;
    mm_log_ints("mm resample dst/src/filter ", vals, 5);
  }
  g_mmResampleOrig(dst, src, filter);
}

/**
 * Every coverage the walk measures: which layer, which tile, what it got.
 *
 * One line per layer per tile — 94 x 94 x 7 of them, which is a big log and
 * the right size for the question. With the layer dump above naming the
 * records, this turns the disagreement into arithmetic: if the engine's
 * coverage matches what the port computes from the same mask, the walk is
 * what differs; if it does not, the mask is.
 *
 * The point arrives as the tile centre, so `(int)x` is the tile.
 */
static int __fastcall mm_cover_hook(void *plane, void *edx, float x, float y) {
  int r = g_mmCoverOrig(plane, edx, x, y);
  if (g_mmInside && g_mmLayerBase) {
    int vals[4];
    vals[0] = (int)(((const BYTE *)plane - g_mmLayerBase) / 0x18);
    vals[1] = (int)x;
    vals[2] = (int)y;
    vals[3] = r;
    mm_log_ints("mmc ", vals, 4);
  }
  return r;
}

/** The flat-colour predicate: counted, never narrated — it runs once a tile. */
static char __fastcall mm_sea_hook(void *terrain, int x, int y) {
  char r = g_mmSeaOrig(terrain, x, y);
  if (g_mmInside) {
    g_mmSeaCalls++;
    if (r) g_mmSeaTrue++;
  }
  return r;
}

/**
 * Every icon the build asks for, by name and in order.
 *
 * The name arrives as `this`: a `{begin, end}` pair, which is what the lookup
 * itself hands to `strncmp`. Reading it the same way keeps the probe honest
 * about what the engine compared.
 */
static void *__fastcall mm_icon_hook(void *name, void *edx, void *res, int flag) {
  if (g_mmInside && name && rmg_readable(name, 8)) {
    const char *begin = ((const char *const *)name)[0];
    const char *end = ((const char *const *)name)[1];
    int len = (int)(end - begin);
    if (begin && len > 0 && len < 64 && rmg_readable(begin, (unsigned)len)) {
      char text[80];
      int i;
      for (i = 0; i < len; i++) text[i] = begin[i];
      text[len] = 0;
      log_text("mm icon ", text);
    } else {
      log_line("mm icon unreadable");
    }
  }
  return g_mmIconOrig(name, edx, res, flag);
}

/** The first half of the window: the build. */
static void __fastcall mm_draw_hook(void *self, void *terrainVec, void *iconVec) {
  log_line("=== minimap build begins");
  g_mmInside++;
  g_mmDrawOrig(self, terrainVec, iconVec);
  g_mmInside--;
  log_line("=== minimap build ends");
}

/**
 * In, or not at all: a probe that installed three hooks out of four would write
 * a log that reads like a measurement and is missing its window.
 */
static int install_minimap_probe(void) {
  g_mmTerrainOrig = (MmTerrainFn)detour(MM_ED_TERRAIN_RVA, MM_ED_TERRAIN_HEAD,
                                        sizeof(MM_ED_TERRAIN_HEAD), &mm_terrain_hook,
                                        "minimap terrain pass");
  g_mmSeaOrig = (MmSeaFn)detour(MM_ED_SEA_RVA, MM_ED_SEA_HEAD, sizeof(MM_ED_SEA_HEAD),
                                &mm_sea_hook, "minimap flat-colour test");
  g_mmIconOrig = (MmIconFn)detour(MM_ED_ICON_RVA, MM_ED_ICON_HEAD, sizeof(MM_ED_ICON_HEAD),
                                  &mm_icon_hook, "minimap icon lookup");
  g_mmDrawOrig = (MmDrawFn)detour(MM_ED_DRAW_RVA, MM_ED_DRAW_HEAD, sizeof(MM_ED_DRAW_HEAD),
                                  &mm_draw_hook, "minimap build");
  g_mmBlitOrig = (MmBlitFn)detour(MM_ED_BLIT_RVA, MM_ED_BLIT_HEAD, sizeof(MM_ED_BLIT_HEAD),
                                  &mm_blit_hook, "minimap icon blit");
  g_mmResampleOrig = (MmResampleFn)detour(MM_ED_RESAMPLE_RVA, MM_ED_RESAMPLE_HEAD,
                                          sizeof(MM_ED_RESAMPLE_HEAD), &mm_resample_hook,
                                          "minimap resample");
  g_mmCoverOrig = (MmCoverFn)detour(MM_ED_COVER_RVA, MM_ED_COVER_HEAD, sizeof(MM_ED_COVER_HEAD),
                                    &mm_cover_hook, "minimap layer coverage");
  // LAST, because it is the window: until it is in, every hook above is inert,
  // and a half-installed probe that still opens its window would write a log
  // that looks complete and is not.
  g_mmWriteOrig = (MmWriteFn)detour(MM_ED_WRITE_RVA, MM_ED_WRITE_HEAD, sizeof(MM_ED_WRITE_HEAD),
                                    &mm_write_hook, "minimap write");
  return g_mmTerrainOrig && g_mmSeaOrig && g_mmIconOrig && g_mmDrawOrig && g_mmBlitOrig
      && g_mmResampleOrig && g_mmCoverOrig && g_mmWriteOrig;
}
