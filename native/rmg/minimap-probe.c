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

/**
 * The icon ANCHOR — game 0xDCFF70, a plain `ret`: `(out, object)` in ecx/edx.
 *
 * Found through the collector rather than by matching bytes, because the two
 * builds do not agree here: the game's anchor is SSE and the editor's x87, so
 * the heads differ from the first instruction. The collector is the same
 * function in both — it dynamic_casts to `SAdvMapBuildingShared` and tests the
 * `+0xEC` type against 0x63/0x64 — and the editor's copy of that test sits at
 * 0x8B5DFD, three instructions above `call 0x8B51C0`.
 *
 * WHY IT IS HOOKED. docs/RMG.md, 09.09: one icon of the corpus, a Fairie Tree,
 * is anchored on the UNROTATED footprint while the SAME object's blocked tiles
 * register from the rotated one. Both readings are of `obj+0x58` / `obj+0x64`,
 * which one function writes, so the two must be reads at different times. This
 * prints what the anchor actually gets: the object, the point it comes out
 * with, and both lists entry by entry.
 */
#define MM_ED_ANCHOR_RVA 0x4b51c0u
static const BYTE MM_ED_ANCHOR_HEAD[] = { 0x83, 0xec, 0x28, 0x53, 0x55, 0x56, 0x8b, 0xe9 };
/** The resampler — game 0x9743A0, `ret 4`. Its arguments name the filter. */
#define MM_ED_RESAMPLE_RVA 0x391330u
static const BYTE MM_ED_RESAMPLE_HEAD[] = { 0x55, 0x8b, 0xec, 0x83, 0xe4, 0xf8 };
/** The Lanczos filter — game 0x975800, `ret 8`: one double in, one in st(0) out. */
#define MM_ED_FILTER_RVA 0x3911c0u
static const BYTE MM_ED_FILTER_HEAD[] = { 0xdd, 0x44, 0x24, 0x04, 0x83, 0xec, 0x08 };
/**
 * The table sine the filter's two sinc terms call — game 0x9573B0, `ret 4`.
 *
 * FIVE bytes and not seven: `push ecx` and `fld dword [esp+8]` are 1 and 4,
 * and what follows is a six-byte `fmul dword [1191CB8h]`. Seven matched the
 * image and split that multiply down the middle — the trampoline ran two bytes
 * of it and jumped into the rest, and the editor died with a stack dump rather
 * than with anything that named the cause.
 */
#define MM_ED_SIN_RVA 0xad3a80u
static const BYTE MM_ED_SIN_HEAD[] = { 0x51, 0xd9, 0x44, 0x24, 0x08 };
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

/**
 * THE GAME'S IMAGE, five of the same functions — the window and the icons.
 *
 * WHY A SECOND SET. The corpus's one open icon is on a map the GAME generated,
 * and the two executables do not make the same map from the same order: the
 * port replays one with `--game-build` and the other without, because the
 * game's generator takes the two coordinate draws into the opposite axes. So
 * an editor run cannot reach that map at all, however many seeds it is given —
 * six of them, 270 icons, every one of them anchored on the rotated footprint.
 *
 * Only these five. The terrain pass, the resampler, the filter, the sine and
 * the coverage sampler are the arithmetic half of the probe, they were settled
 * in the editor, and each of them writes tens of thousands of lines; what is
 * open here is one icon, so what goes in is the window that keeps the game's
 * own minimap panel out of the log, and the three that speak about icons.
 */
#define MM_GAME_WRITE_RVA 0x9d1bd0u
static const BYTE MM_GAME_WRITE_HEAD[] = { 0x55, 0x8b, 0xec, 0x83, 0xe4, 0xf8 };
#define MM_GAME_DRAW_RVA 0x9d0c70u
static const BYTE MM_GAME_DRAW_HEAD[] = { 0x81, 0xec, 0xa0, 0x01, 0x00, 0x00 };
#define MM_GAME_BLIT_RVA 0x9cfde0u
static const BYTE MM_GAME_BLIT_HEAD[] = { 0x83, 0xec, 0x10, 0x89, 0x0c, 0x24 };
#define MM_GAME_ICON_RVA 0x9d3440u
static const BYTE MM_GAME_ICON_HEAD[] = { 0x51, 0x53, 0x55, 0x56, 0x89, 0x4c, 0x24, 0x0c };
#define MM_GAME_ANCHOR_RVA 0x9cff70u
static const BYTE MM_GAME_ANCHOR_HEAD[] = { 0x83, 0xec, 0x20, 0x53, 0x55, 0x8b, 0xea };

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
/** `(out, object)` — both register arguments; the answer is `out`, two floats. */
typedef void *(__fastcall *MmAnchorFn)(void *out, void *obj);
/** A footprint list getter, `vtable[+0xB4]` / `[+0xB8]`: `{begin, end}` of byte pairs. */
typedef void *(__fastcall *MmTilesFn)(void *self);
/** `(self, -, out)` — the world position, `ret 4`; `edx` is the filler again. */
typedef float *(__fastcall *MmPosFn)(void *self, void *edx, float *out);
/** `(dst, src, filter)` — the two are `{buf, rows, w, h}` sixteen-byte images. */
typedef void(__fastcall *MmResampleFn)(void *dst, void *src, int filter);
/** `double(double)` — its `ret 8` says stdcall, and the resampler calls it by pointer. */
typedef double(__stdcall *MmFilterFn)(double x);
/** `double(float)` — a float32 argument, the answer in st(0); its `ret 4` says so. */
typedef double(__stdcall *MmSinFn)(float x);
/** `(mask, -, x, y)` — thiscall with two floats; `edx` is the filler again. */
typedef int(__fastcall *MmCoverFn)(void *plane, void *edx, float x, float y);

static MmDrawFn g_mmDrawOrig = NULL;
static MmTerrainFn g_mmTerrainOrig = NULL;
static MmSeaFn g_mmSeaOrig = NULL;
static MmIconFn g_mmIconOrig = NULL;
static MmWriteFn g_mmWriteOrig = NULL;
static MmBlitFn g_mmBlitOrig = NULL;
static MmAnchorFn g_mmAnchorOrig = NULL;
static MmResampleFn g_mmResampleOrig = NULL;
static MmCoverFn g_mmCoverOrig = NULL;
static MmFilterFn g_mmFilterOrig = NULL;
static MmSinFn g_mmSinOrig = NULL;

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
  // A 256-wide RGBA row is 1024 bytes, and a row that is silently halved is a
  // picture that looks compared and is not.
  char line[16 + 2 * 1024 + 1];
  int i = 0, n = 0, k;
  while (tag[i] && i < 8) { line[i] = tag[i]; i++; }
  line[i++] = ' ';
  num_to_dec(y, line + i, &n);
  i += n;
  line[i++] = ' ';
  for (k = 0; k < bytes && k < 1024; k++) {
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
static void mm_dump_image_at(const char *tag, const void *image, unsigned bufOff, unsigned rowsOff,
                             unsigned wOff, unsigned hOff) {
  const BYTE *im = (const BYTE *)image;
  const BYTE *const *rows;
  int w, h, y;
  (void)bufOff; // the rows are the buffer, one pointer a line
  if (!image || !rmg_readable(image, hOff + 4)) {
    log_text(tag, " unreadable");
    return;
  }
  rows = *(const BYTE *const *const *)(im + rowsOff);
  w = *(const int *)(im + wOff);
  h = *(const int *)(im + hOff);
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

/** The drawer's own image object, whose four fields sit 0x18 further in. */
static void mm_dump_image(const char *tag, const void *image) {
  mm_dump_image_at(tag, image, 0x18, 0x1c, 0x20, 0x24);
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
 * One footprint list, entry by entry, as the anchor reads it.
 *
 * The list is `{begin, end}` of two signed bytes, so its length is
 * `(end - begin) / 2` — the same `sar edx,1` the anchor does. Printed as the
 * pairs themselves and not as a mean: a mean that matches proves nothing about
 * WHICH list produced it, and the whole question here is which list this is.
 */
static void mm_log_tiles(const char *tag, void *list) {
  int vals[1 + 2 * 24];
  const signed char *begin;
  int count, k, n = 0;
  if (!list) {
    log_line(tag);
    log_line("  (null)");
    return;
  }
  begin = (const signed char *)((void **)list)[0];
  count = (int)((const signed char *)((void **)list)[1] - begin) / 2;
  if (count < 0) count = 0;
  vals[n++] = count;
  for (k = 0; k < count && k < 24; k++) {
    vals[n++] = begin[2 * k];
    vals[n++] = begin[2 * k + 1];
  }
  mm_log_ints(tag, vals, n);
}

/**
 * The icon anchor: which object, where it says the icon goes, and both lists.
 *
 * The object's own tile comes out of the same `[+0xA0]` the anchor uses, so
 * the line names the object the way the port does — by where it stands — and
 * a run can be lined up with `tools/rmg-run.ts` object for object without
 * anything being guessed at this end.
 */
static void *__fastcall mm_anchor_hook(void *out, void *obj) {
  void *res = g_mmAnchorOrig(out, obj);
  if (g_mmInside && obj && res) {
    void **vt = *(void ***)obj;
    float world[4];
    const float *p = ((MmPosFn)vt[0xA0 / 4])(obj, NULL, world);
    int vals[4];
    vals[0] = p ? (int)(p[0] * 0.5f) : -1;
    vals[1] = p ? (int)(p[1] * 0.5f) : -1;
    // The point in thousandths: the log is integers, and a half-tile mean is
    // the whole question, so a rounded tile would throw the answer away.
    vals[2] = (int)(((const float *)res)[0] * 1000.0f);
    vals[3] = (int)(((const float *)res)[1] * 1000.0f);
    mm_log_ints("mm anchor tile+point*1000 ", vals, 4);
    mm_log_tiles("  blocked ", ((MmTilesFn)vt[0xB4 / 4])(obj));
    mm_log_tiles("  active  ", ((MmTilesFn)vt[0xB8 / 4])(obj));
  }
  return res;
}

/**
 * The x87 control word, as the editor has it when it resamples.
 *
 * Two fields decide what every float instruction in this path does, and
 * neither is necessarily the compiler's default: bits 8-9 are the PRECISION
 * (00 single, 10 double, 11 extended) and bits 10-11 the ROUNDING (00 nearest,
 * 11 toward zero). The port assumed the defaults; the engine's own sine says
 * otherwise, and this is the field itself rather than an inference from it.
 */
static void mm_log_control_word(void) {
  unsigned short cw = 0;
  __asm__ __volatile__("fnstcw %0" : "=m"(cw));
  log_hex("mm x87 control word ", cw);
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
    mm_log_control_word();
    // THE PICTURE GOING IN. Ten channel bytes of the reference minimap were
    // unexplained for weeks, and the two suspects — the picture the resampler
    // is handed and the weights it resamples with — cannot be told apart from
    // the far side. This is the first of them: the port draws the same 98x98
    // and can be held to it pixel for pixel.
    mm_dump_image_at("mmrs", src, 0x00, 0x04, 0x08, 0x0c);
  }
  g_mmResampleOrig(dst, src, filter);
  // And the picture coming out, for the same reason from the other end: with
  // the input pinned, a differing output IS the resampler's arithmetic.
  if (g_mmInside) mm_dump_image_at("mmrd", dst, 0x00, 0x04, 0x08, 0x0c);
}

/**
 * The sine itself, argument and answer, bit for bit.
 *
 * The filter is two of these over a division, so a filter that disagrees is
 * either the sine or the arithmetic around it, and nothing but the sine's own
 * numbers tells the two apart. The argument is a float — the caller stores it
 * with `fstp dword` — and the answer comes back in st(0).
 *
 * This is what settled the minimap: 6208 of 6208 answers of one build are the
 * port's `engineSin24` exactly, and eight are its double version.
 */
static double __stdcall mm_sin_hook(float x) {
  double r = g_mmSinOrig(x);
  if (g_mmInside) {
    union { double d; int i[2]; } b;
    union { float f; int i; } a;
    int vals[3];
    a.f = x;
    b.d = r;
    vals[0] = a.i;
    vals[1] = b.i[0];
    vals[2] = b.i[1];
    mm_log_ints("mms ", vals, 3);
  }
  return r;
}

/**
 * The Lanczos filter, argument and result, bit for bit.
 *
 * `0x7911c0` is `__stdcall double(double)` — its `ret 8` says so — and it is
 * reached through the pointer the resampler was handed, so a detour on the
 * function catches it either way. It is called once per tap of the two
 * contribution tables, a few thousand lines for a 98x98 into 256x256, and the
 * port reproduces all 3072 of them.
 */
static double __stdcall mm_filter_hook(double x) {
  double r = g_mmFilterOrig(x);
  if (g_mmInside) {
    union { double d; int i[2]; } a, b;
    int vals[4];
    a.d = x;
    b.d = r;
    vals[0] = a.i[0];
    vals[1] = a.i[1];
    vals[2] = b.i[0];
    vals[3] = b.i[1];
    mm_log_ints("mmw ", vals, 4);
  }
  return r;
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
 * OBJECT REGISTRATION — editor 0xD52770, game 0xA55C10, `ret 4`: the world in
 * ecx, the object on the stack. `CWorld`'s vtable slot `+0x14C`, which is why
 * a search for its callers finds none and why the ORDER it runs in cannot be
 * read out of the image at all.
 *
 * WHY IT IS WATCHED. Three tiles in the whole corpus have one object claiming
 * them with its ACTIVE list while another BLOCKS them, and the engine darkens
 * exactly one of the three. Two readings closed off the easy answers: the veto
 * (editor 0xD4B050, game 0xA46E80) cannot be telling the objects apart by
 * class — seven of its eight predicates are one shared `xor eax,eax; ret` for
 * the shrine, the treasure and the static alike — and the descriptor's
 * write-back (0xAD1F10) is an unconditional field-by-field copy, which rules
 * out "the first write stands". What is left is the order these calls arrive
 * in and the veto's own answer, and both are one line each from in here.
 *
 * The lists come off the object's OWN getters, the same three `0xA4FF00` uses:
 * `+0xA4` hands back a holder whose first dword is the packed tile key (x in
 * bits 0..9, y in 10..19, the floor in 20..23), `+0xB4` the blocked list and
 * `+0xB8` the active one, each a `{begin, end}` over signed (dx, dy) byte
 * pairs already in world orientation.
 *
 * The veto is ASKED rather than inferred from what the registration then does
 * — asking it twice is safe, it is a chain of getters and boolean predicates
 * with nothing to write — and it is asked BEFORE the original call, because
 * that is where the engine asks it.
 */
#define MM_ED_REG_RVA 0x952770u
static const BYTE MM_ED_REG_HEAD[] = { 0x56, 0x8b, 0x74, 0x24, 0x08, 0x85, 0xf6, 0x57 };
/** The veto itself — editor 0xD4B050, game 0xA46E80, thiscall, `al` back. */
#define MM_ED_VETO_VA 0xd4b050u
/**
 * THE TWO WRITES THEMSELVES — editor 0xD50310 (blocked, kind 1) and 0xD4F880
 * (active, kind 2); game 0xA4FF00 and 0xA500D0. Same shape as the caller
 * above: the world in ecx, the object on the stack.
 *
 * They are hooked BESIDE the caller and not instead of it, because the caller
 * turned out not to be the door a generated map goes through: with the hook on
 * `0xD52770` in and its own log line printed, a full run of a two-level map
 * registered NOTHING. So whatever places objects during generation reaches
 * these two some other way, and the only honest place to watch a write is at
 * the write.
 */
#define MM_ED_BLOCKED_RVA 0x950310u
#define MM_ED_ACTIVE_RVA 0x94f880u
/**
 * THE SAME THREE IN THE GAME — 0xA55C10, 0xA4FF00, 0xA500D0.
 *
 * They are here because the editor could not answer. A full console-ordered
 * run with all three editor hooks in — and the minimap probe's own window on
 * top — logged NOTHING: not one registration, not one stamp, and not one
 * `minimap build begins`. So the editor's "generate and save" path reaches
 * neither the registration nor the minimap build through the functions those
 * addresses name, exactly the way the icon question turned out: what the
 * corpus asks about lives in the GAME's image, and the reading has to be taken
 * there. The blocked stamp needs EIGHT bytes here and five there — the game's
 * copy loads its argument three instructions in, and cutting `mov ebx,[esp+34h]`
 * in half is what killed the editor twice.
 */
#define MM_GAME_REG_RVA 0x655c10u
static const BYTE MM_GAME_REG_HEAD[] = { 0x56, 0x8b, 0x74, 0x24, 0x08 };
#define MM_GAME_BLOCKED_RVA 0x64ff00u
static const BYTE MM_GAME_BLOCKED_HEAD[] = { 0x83, 0xec, 0x2c, 0x53, 0x8b, 0x5c, 0x24, 0x34 };
#define MM_GAME_ACTIVE_RVA 0x6500d0u
static const BYTE MM_GAME_ACTIVE_HEAD[] = { 0x83, 0xec, 0x2c, 0x53, 0x55 };
/** The veto in the game — 0xA46E80, the twin of the editor's 0xD4B050. */
#define MM_GAME_VETO_VA 0xa46e80u
/** The veto's address in whichever image this is. */
static DWORD g_mmVetoVa = MM_ED_VETO_VA;
/**
 * FIVE bytes, and the reason is the same one the sine hook above carries.
 * `83 ec 2c 53 55` is `sub esp,2Ch; push ebx; push ebp` — three whole
 * instructions, exactly the five a jump needs. Eight bytes looked like a
 * stronger signature and cut `mov esi,[esp+3Ch]` in half: the trampoline ran
 * two bytes of it and jumped into the rest, the body read its object argument
 * out of a stack slot that was never written, and the editor died with `esi`
 * holding 0xB2 and a heap address in `eip` — twice, before any hook of ours
 * had logged a line, which is what made it look like the reads were at fault.
 */
static const BYTE MM_ED_STAMP_HEAD[] = { 0x83, 0xec, 0x2c, 0x53, 0x55 };

typedef void(__fastcall *MmRegFn)(void *world, void *edx, void *obj);
typedef char(__fastcall *MmVetoFn)(void *obj, void *edx);
typedef void *(__fastcall *MmGetFn)(void *obj, void *edx);
static MmRegFn g_mmRegOrig;
static MmRegFn g_mmBlockedOrig;
static MmRegFn g_mmActiveOrig;
static int g_mmRegSeq;

/**
 * Is this a code address in the EXECUTABLE itself?
 *
 * A vtable slot is; a heap word that happens to sit where a vtable pointer was
 * looked for is not. The first version of this probe called `vt[0xA4/4]`
 * behind nothing but a readability check and the editor died on an access
 * violation at `0x02390006` — a heap address, called as a function. So every
 * slot is checked against the image's own range before it is called, and a
 * pointer that fails says so in the log rather than taking the process down.
 */
static int mm_is_exe_code(const void *p) {
  static DWORD base = 0, span = 0;
  DWORD a = (DWORD)(size_t)p;
  if (!span) {
    HMODULE self = GetModuleHandleA(NULL);
    const IMAGE_DOS_HEADER *dos = (const IMAGE_DOS_HEADER *)self;
    const IMAGE_NT_HEADERS *nt;
    if (!self || !rmg_readable(self, sizeof(*dos))) return 0;
    nt = (const IMAGE_NT_HEADERS *)((const BYTE *)self + dos->e_lfanew);
    if (!rmg_readable(nt, sizeof(*nt))) return 0;
    base = (DWORD)(size_t)self;
    span = nt->OptionalHeader.SizeOfImage;
  }
  return a > base && a < base + span;
}

/** One list of (dx, dy) pairs as absolute tiles, or a note when it cannot be read. */
static void mm_log_foot(const char *tag, int seq, void *obj, unsigned slot, int keyX, int keyY) {
  void **vt;
  MmGetFn get;
  signed char **vec;
  signed char *begin, *end;
  int vals[64];
  int n = 0, i;
  if (!obj || !rmg_readable(obj, 4)) return;
  vt = *(void ***)obj;
  if (!vt || !rmg_readable(vt, slot + 4)) return;
  if (!mm_is_exe_code(vt[slot / 4])) return;
  get = (MmGetFn)vt[slot / 4];
  vec = (signed char **)get(obj, 0);
  if (!vec || !rmg_readable(vec, 8)) return;
  begin = vec[0];
  end = vec[1];
  if (!begin || end < begin || !rmg_readable(begin, (unsigned)(end - begin))) return;
  vals[n++] = seq;
  for (i = 0; begin + 2 * i + 1 < end && n < 62; i++) {
    vals[n++] = keyX + begin[2 * i];
    vals[n++] = keyY + begin[2 * i + 1];
  }
  if (n > 1) mm_log_ints(tag, vals, n);
}

/**
 * ONE WRITE: which list it is, whose object, where it stands and which tiles
 * it stamps. The vtable goes in raw — RTTI turns it into a class name offline,
 * which keeps the hook to getters the engine already has.
 */
static void mm_log_stamp(int kind, void *obj) {
  int vals[4];
  void **vt;
  if (!obj || !rmg_readable(obj, 4)) { log_line("mmw object unreadable"); return; }
  vt = *(void ***)obj;
  // NOTHING IS CALLED FROM HERE. The first two versions of this hook asked the
  // object for its tile key and its lists through `vt+0xA4`/`+0xB4`, the way
  // the stamp itself does two instructions later, and the editor died the same
  // way both times: an access violation at a HEAP address, before a single line
  // of ours reached the log, with the stamp on the stack and its own `esi`
  // holding 0xB2 rather than an object. Adding an image-range check on the slot
  // changed nothing, which says the fault is not a bad slot — calling ANYTHING
  // from in front of this function is what the process does not survive. So the
  // probe now only READS: the object pointer, and the vtable word behind it.
  // The tiles come from matching this sequence against the port's own object
  // list offline, which is the reading this was for anyway.
  vals[0] = ++g_mmRegSeq;
  vals[1] = kind;
  vals[2] = (int)(size_t)obj;
  vals[3] = (int)(size_t)(rmg_readable(vt, 4) ? vt : 0);
  mm_log_ints("mmw ", vals, 4);
}

static void __fastcall mm_reg_hook(void *world, void *edx, void *obj) {
  int seq = ++g_mmRegSeq;
  int vals[8];
  int keyX = -1, keyY = -1;
  if (obj && rmg_readable(obj, 4)) {
    void **vt = *(void ***)obj;
    if (vt && rmg_readable(vt, 0xbc)) {
      MmGetFn getKey = (MmGetFn)vt[0xa4 / 4];
      const DWORD *holder = (const DWORD *)getKey(obj, 0);
      DWORD key = (holder && rmg_readable(holder, 4)) ? *holder : 0xffffffffu;
      MmVetoFn veto = (MmVetoFn)g_mmVetoVa;
      if (key != 0xffffffffu) {
        keyX = (int)(key & 0x3ffu);
        keyY = (int)((key >> 10) & 0x3ffu);
      }
      vals[0] = seq;
      vals[1] = (int)(size_t)vt;              /* the class, offline through RTTI */
      vals[2] = veto(obj, 0) ? 1 : 0;
      vals[3] = keyX;
      vals[4] = keyY;
      vals[5] = (int)((key >> 20) & 0xfu);
      mm_log_ints("mmr ", vals, 6);
      mm_log_foot("mmrb ", seq, obj, 0xb4, keyX, keyY);
      mm_log_foot("mmra ", seq, obj, 0xb8, keyX, keyY);
    }
  }
  g_mmRegOrig(world, edx, obj);
}

/** The blocked list going in — kind 1, the one that darkens. */
static void __fastcall mm_blocked_hook(void *world, void *edx, void *obj) {
  mm_log_stamp(1, obj);
  g_mmBlockedOrig(world, edx, obj);
}

/** The active list going in — kind 2, which takes a tile back. */
static void __fastcall mm_active_hook(void *world, void *edx, void *obj) {
  mm_log_stamp(2, obj);
  g_mmActiveOrig(world, edx, obj);
}

/**
 * The mask probe: the caller and both writes, and nothing to nest inside.
 *
 * It is NOT under the minimap probe's window — the stamping happens while the
 * generator places objects, long before the minimap is drawn — so it has its
 * own word in the config (`mask`) and logs every write the process makes. A
 * launch that only generates makes no others.
 */
static int install_mask_probe(void) {
  g_mmVetoVa = MM_ED_VETO_VA;
  g_mmRegOrig = (MmRegFn)detour(MM_ED_REG_RVA, MM_ED_REG_HEAD, sizeof(MM_ED_REG_HEAD),
                                &mm_reg_hook, "object registration");
  g_mmBlockedOrig = (MmRegFn)detour(MM_ED_BLOCKED_RVA, MM_ED_STAMP_HEAD, sizeof(MM_ED_STAMP_HEAD),
                                    &mm_blocked_hook, "blocked list stamp");
  g_mmActiveOrig = (MmRegFn)detour(MM_ED_ACTIVE_RVA, MM_ED_STAMP_HEAD, sizeof(MM_ED_STAMP_HEAD),
                                   &mm_active_hook, "active list stamp");
  return g_mmRegOrig && g_mmBlockedOrig && g_mmActiveOrig;
}

/**
 * The same three in the GAME, which is where the reading has to be taken.
 *
 * The editor's copies are installed by the function above and stayed silent
 * through a whole ordered run; the maps the question is about — a torch over a
 * shrine's active tile, and a torch over a GUARDED ore pile's — were generated
 * by the game. So this goes in beside the icon half, under the same word.
 */
static int install_mask_probe_game(void) {
  g_mmVetoVa = MM_GAME_VETO_VA;
  g_mmRegOrig = (MmRegFn)detour(MM_GAME_REG_RVA, MM_GAME_REG_HEAD, sizeof(MM_GAME_REG_HEAD),
                                &mm_reg_hook, "object registration");
  g_mmBlockedOrig = (MmRegFn)detour(MM_GAME_BLOCKED_RVA, MM_GAME_BLOCKED_HEAD,
                                    sizeof(MM_GAME_BLOCKED_HEAD), &mm_blocked_hook,
                                    "blocked list stamp");
  g_mmActiveOrig = (MmRegFn)detour(MM_GAME_ACTIVE_RVA, MM_GAME_ACTIVE_HEAD,
                                   sizeof(MM_GAME_ACTIVE_HEAD), &mm_active_hook,
                                   "active list stamp");
  return g_mmRegOrig && g_mmBlockedOrig && g_mmActiveOrig;
}

/**
 * The icon half of the probe in the GAME, where the open map was generated.
 *
 * The hooks themselves are the editor's, unchanged: only one of the two
 * executables is ever patched in a process, so one set of trampolines serves
 * either. The window goes in LAST for the same reason it does below — until it
 * is in, `g_mmInside` is zero and everything above it is inert.
 */
static int install_minimap_probe_game(void) {
  g_mmIconOrig = (MmIconFn)detour(MM_GAME_ICON_RVA, MM_GAME_ICON_HEAD, sizeof(MM_GAME_ICON_HEAD),
                                  &mm_icon_hook, "minimap icon lookup");
  g_mmBlitOrig = (MmBlitFn)detour(MM_GAME_BLIT_RVA, MM_GAME_BLIT_HEAD, sizeof(MM_GAME_BLIT_HEAD),
                                  &mm_blit_hook, "minimap icon blit");
  g_mmAnchorOrig = (MmAnchorFn)detour(MM_GAME_ANCHOR_RVA, MM_GAME_ANCHOR_HEAD,
                                      sizeof(MM_GAME_ANCHOR_HEAD), &mm_anchor_hook,
                                      "minimap icon anchor");
  g_mmDrawOrig = (MmDrawFn)detour(MM_GAME_DRAW_RVA, MM_GAME_DRAW_HEAD, sizeof(MM_GAME_DRAW_HEAD),
                                  &mm_draw_hook, "minimap build");
  g_mmWriteOrig = (MmWriteFn)detour(MM_GAME_WRITE_RVA, MM_GAME_WRITE_HEAD,
                                    sizeof(MM_GAME_WRITE_HEAD), &mm_write_hook, "minimap write");
  return g_mmIconOrig && g_mmBlitOrig && g_mmAnchorOrig && g_mmDrawOrig && g_mmWriteOrig;
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
  g_mmAnchorOrig = (MmAnchorFn)detour(MM_ED_ANCHOR_RVA, MM_ED_ANCHOR_HEAD,
                                      sizeof(MM_ED_ANCHOR_HEAD), &mm_anchor_hook,
                                      "minimap icon anchor");
  g_mmResampleOrig = (MmResampleFn)detour(MM_ED_RESAMPLE_RVA, MM_ED_RESAMPLE_HEAD,
                                          sizeof(MM_ED_RESAMPLE_HEAD), &mm_resample_hook,
                                          "minimap resample");
  g_mmCoverOrig = (MmCoverFn)detour(MM_ED_COVER_RVA, MM_ED_COVER_HEAD, sizeof(MM_ED_COVER_HEAD),
                                    &mm_cover_hook, "minimap layer coverage");
  g_mmFilterOrig = (MmFilterFn)detour(MM_ED_FILTER_RVA, MM_ED_FILTER_HEAD,
                                      sizeof(MM_ED_FILTER_HEAD), &mm_filter_hook,
                                      "minimap resample filter");
  g_mmSinOrig = (MmSinFn)detour(MM_ED_SIN_RVA, MM_ED_SIN_HEAD, sizeof(MM_ED_SIN_HEAD),
                                &mm_sin_hook, "minimap resample sine");
  // LAST, because it is the window: until it is in, every hook above is inert,
  // and a half-installed probe that still opens its window would write a log
  // that looks complete and is not.
  g_mmWriteOrig = (MmWriteFn)detour(MM_ED_WRITE_RVA, MM_ED_WRITE_HEAD, sizeof(MM_ED_WRITE_HEAD),
                                    &mm_write_hook, "minimap write");
  return g_mmTerrainOrig && g_mmSeaOrig && g_mmIconOrig && g_mmDrawOrig && g_mmBlitOrig
      && g_mmAnchorOrig && g_mmResampleOrig && g_mmCoverOrig && g_mmFilterOrig && g_mmSinOrig
      && g_mmWriteOrig;
}
