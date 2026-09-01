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

/** The minimap build — game 0xDD0C70, `ret 4`. The window. */
#define MM_ED_DRAW_RVA 0x4b5f90u
static const BYTE MM_ED_DRAW_HEAD[] = { 0x81, 0xec, 0x64, 0x01, 0x00, 0x00 };
/** The terrain pass — game 0xDD0660, `ret 0Ch`. Its arguments are the reading. */
#define MM_ED_TERRAIN_RVA 0x4b4fc0u
static const BYTE MM_ED_TERRAIN_HEAD[] = { 0x83, 0xec, 0x18, 0x57, 0x8b, 0xf9 };
/** The flat-colour predicate — game 0x9EC480, `ret 4`. */
#define MM_ED_SEA_RVA 0x8d6070u
static const BYTE MM_ED_SEA_HEAD[] = { 0x8b, 0x41, 0x2c, 0x83, 0xe8, 0x02 };
/** The icon lookup by name — game 0xDD3440, `ret 8`. */
#define MM_ED_ICON_RVA 0x4b5710u
static const BYTE MM_ED_ICON_HEAD[] = { 0x51, 0x89, 0x0c, 0x24, 0x8d, 0x4c, 0x24, 0x08 };

/** `(image, terrainVector, iconVector)` — `edx` is a real argument here. */
typedef void(__fastcall *MmDrawFn)(void *self, void *terrainVec, void *iconVec);
/** `(image, terrain, mask, colour, border)` — thiscall plus three on the stack. */
typedef void(__fastcall *MmTerrainFn)(void *image, void *terrain, void *mask, const DWORD *colour,
                                      int border);
/** `(terrain, x, y)` — returns non-zero for "this tile is the flat colour". */
typedef char(__fastcall *MmSeaFn)(void *terrain, int x, int y);
/** `(name, -, resource, flag)` — `edx` is the unused filler, as in the oracle. */
typedef void *(__fastcall *MmIconFn)(void *name, void *edx, void *res, int flag);

static MmDrawFn g_mmDrawOrig = NULL;
static MmTerrainFn g_mmTerrainOrig = NULL;
static MmSeaFn g_mmSeaOrig = NULL;
static MmIconFn g_mmIconOrig = NULL;

/** Are we inside the RMG's own minimap build? Nothing logs outside it. */
static int g_mmInside = 0;
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
static void mm_log_mask_row(int y, const BYTE *row, int bytes) {
  static const char digits[] = "0123456789abcdef";
  char line[8 + 3 + 2 * 64 + 1];
  int i = 0, n = 0, k;
  line[i++] = 'm';
  line[i++] = 'm';
  line[i++] = 'k';
  line[i++] = ' ';
  num_to_dec(y, line + i, &n);
  i += n;
  line[i++] = ' ';
  for (k = 0; k < bytes && k < 64; k++) {
    line[i++] = digits[(row[k] >> 4) & 0xf];
    line[i++] = digits[row[k] & 0xf];
  }
  line[i] = 0;
  log_line(line);
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
    mm_dump_mask(mask);
    g_mmSeaCalls = 0;
    g_mmSeaTrue = 0;
  }
  g_mmTerrainOrig(image, terrain, mask, colour, border);
  if (g_mmInside) {
    log_num("mm sea test calls ", g_mmSeaCalls);
    log_num("mm sea test true ", g_mmSeaTrue);
  }
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

/** The window: one map's minimap, and nothing the editor's own panel draws. */
static void __fastcall mm_draw_hook(void *self, void *terrainVec, void *iconVec) {
  log_line("=== minimap build begins");
  g_mmInside = 1;
  g_mmDrawOrig(self, terrainVec, iconVec);
  g_mmInside = 0;
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
  return g_mmTerrainOrig && g_mmSeaOrig && g_mmIconOrig && g_mmDrawOrig;
}
