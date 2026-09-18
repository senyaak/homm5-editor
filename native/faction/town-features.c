// What a building DOES — the town-feature table, ours, with the engine's rows in it.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT faction_town_features

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HAS. Every compiled effect a special building has — the
// Library's extra spell, the Hall of Trial's three warcry tiers, the Capitol
// — is a FEATURE, a number 0…0x2E, and one table at 0x10909B0 says which
// building of which town grants it:
//
//   struct { int feature; int town; int building; int minLevel; }  ×47
//
// `town` 2 (TOWN_NO_TYPE) means any: the Capitol row (0x2E, TB_TOWN_HALL ≥ 4)
// is the one such. The rest are the eight towns' specials, one row per
// (town, slot, level) — Sylvan's SPECIAL_0 at levels 1 and 2 are two features,
// Stronghold's SPECIAL_1 at levels 1, 2, 3 are 0x27, 0x28, 0x29. Six small
// readers of CAdvMapTown scan it, all with the same test — row.town == 2 or
// row.town == GetType() (slot +0xD4) — and they are vtable slots +0x40 … +0x54:
//
//   +0x40  0xAC8970  may this feature be built here (row → +0x5C, +0xB4)
//   +0x44  0xAC8A10  HasFeature(f):  BuildingLevel(row.building) >= row.minLevel
//   +0x48  0xAC8A80  FeatureOf(building): the FIRST row's feature, else -1
//   +0x4C  0xAC8AD0  BuildingOf(f): the row's building, else 0x1A
//   +0x50  0xAC8B20  a feature's building through RowOf (0xAD0710), by index
//   +0x54  0xAC8B90  as +0x40, another verdict
//
// and `OnBuildingBuilt` (0xAC7FF0) asks FeatureOf and, for 0x27 at level 0,
// fills the town's warcry list (0xAC4740) — which is why a hall of ours stood
// empty in launch 35: three levels built, no row, no feature, no warcries.
//
// WHAT WE DO. The table is OURS: the engine's 47 rows copied, then a row per
// `feature` line of `bin/homm5-editor-buildings.txt`:
//
//   feature <townType> <buildingType> <minLevel> <feature>
//
// and every one of the twenty places the six readers name the engine's table
// — its start, its end, a column — is pointed at ours instead, at the same
// offset from the start. The readers' loops, tests and index arithmetic stay
// the engine's; only the address moves. Nothing in the executable is
// extended in place: the compiled table stays as it is, unread.
//
// The order matters and is kept: FeatureOf answers the FIRST row for a
// (town, building), so a hall's rows go in as 0x27, 0x28, 0x29 like
// Stronghold's, and the editor writes them so. The engine's rows come first,
// so a town of ours never shadows a shipped one — its type matches no shipped
// row but the Capitol's, which is any town's.
//
// The address bytes of those twenty references are the loader's to rewrite
// under ASLR, so each is checked against the table's address as loaded — the
// opcode bytes before it against what was read — and refused, all twenty or
// none, when a build differs.

#define FEATURE_TABLE_RVA 0xc909b0u
#define SHIPPED_FEATURE_ROWS 47
#define MAX_OWN_FEATURE_ROWS 64

typedef struct {
  int feature;
  int town;
  int building;
  int minLevel;
} FeatureRow;

static FeatureRow g_ownFeatures[MAX_OWN_FEATURE_ROWS];
static int g_ownFeatureCount = 0;

static void load_town_features(void) {
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-buildings.txt", &got);
  if (!buf) return;
  const char *p = buf, *end = buf + got;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;
    const char *q = line;
    if (!take_word(&q, stop, "feature")) continue;
    FeatureRow r;
    if (!read_int(&q, stop, &r.town) || !read_int(&q, stop, &r.building)) continue;
    if (!read_int(&q, stop, &r.minLevel) || !read_int(&q, stop, &r.feature)) continue;
    if (r.town < 3 || r.building < 0 || r.minLevel < 1 || r.feature < 0) continue;
    if (g_ownFeatureCount < MAX_OWN_FEATURE_ROWS) g_ownFeatures[g_ownFeatureCount++] = r;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("town features: rows of ours: ", g_ownFeatureCount);
}

// ---------------------------------------------------------------------------
// The twenty references: where each instruction sits, the opcode bytes before
// its address operand, and what the operand points at as an offset into the
// table (0x2F0 is one past the last row; 0x2F8 is that plus the column one
// loop starts from).

typedef struct {
  DWORD rva;
  BYTE opcode[2];
  int opcodeLen;
  DWORD offset;
} TableRef;

#define FEATURE_REF_01_RVA 0x6c8986u
static const BYTE FEATURE_REF_01_MARK[5] = { 0xBA, 0xB0, 0x09, 0x09, 0x01 };  // mov edx,table         +0x40's scan
#define FEATURE_REF_02_RVA 0x6c89a4u
static const BYTE FEATURE_REF_02_MARK[6] = { 0x81, 0xFA, 0xA0, 0x0C, 0x09, 0x01 };  // cmp edx,end
#define FEATURE_REF_03_RVA 0x6c89d2u
static const BYTE FEATURE_REF_03_MARK[6] = { 0xFF, 0xB7, 0xBC, 0x09, 0x09, 0x01 };  // push [edi+minLevel]
#define FEATURE_REF_04_RVA 0x6c89d8u
static const BYTE FEATURE_REF_04_MARK[6] = { 0xFF, 0xB7, 0xB8, 0x09, 0x09, 0x01 };  // push [edi+building]
#define FEATURE_REF_05_RVA 0x6c8a23u
static const BYTE FEATURE_REF_05_MARK[5] = { 0xBA, 0xB0, 0x09, 0x09, 0x01 };  // mov edx,table         HasFeature
#define FEATURE_REF_06_RVA 0x6c8a3cu
static const BYTE FEATURE_REF_06_MARK[6] = { 0x81, 0xFA, 0xA0, 0x0C, 0x09, 0x01 };  // cmp edx,end
#define FEATURE_REF_07_RVA 0x6c8a60u
static const BYTE FEATURE_REF_07_MARK[6] = { 0xFF, 0xB6, 0xB8, 0x09, 0x09, 0x01 };  // push [esi+building]
#define FEATURE_REF_08_RVA 0x6c8a69u
static const BYTE FEATURE_REF_08_MARK[6] = { 0x3B, 0x86, 0xBC, 0x09, 0x09, 0x01 };  // cmp eax,[esi+minLevel]
#define FEATURE_REF_09_RVA 0x6c8a92u
static const BYTE FEATURE_REF_09_MARK[5] = { 0xB9, 0xB8, 0x09, 0x09, 0x01 };  // mov ecx,table+8       FeatureOf
#define FEATURE_REF_10_RVA 0x6c8aabu
static const BYTE FEATURE_REF_10_MARK[6] = { 0x81, 0xF9, 0xA8, 0x0C, 0x09, 0x01 };  // cmp ecx,end+8
#define FEATURE_REF_11_RVA 0x6c8ac0u
static const BYTE FEATURE_REF_11_MARK[6] = { 0x8B, 0x80, 0xB0, 0x09, 0x09, 0x01 };  // mov eax,[eax+feature]
#define FEATURE_REF_12_RVA 0x6c8ae2u
static const BYTE FEATURE_REF_12_MARK[5] = { 0xB9, 0xB0, 0x09, 0x09, 0x01 };  // mov ecx,table         BuildingOf
#define FEATURE_REF_13_RVA 0x6c8afbu
static const BYTE FEATURE_REF_13_MARK[6] = { 0x81, 0xF9, 0xA0, 0x0C, 0x09, 0x01 };  // cmp ecx,end
#define FEATURE_REF_14_RVA 0x6c8b12u
static const BYTE FEATURE_REF_14_MARK[6] = { 0x8B, 0x80, 0xB8, 0x09, 0x09, 0x01 };  // mov eax,[eax+building]
#define FEATURE_REF_15_RVA 0x6c8b60u
static const BYTE FEATURE_REF_15_MARK[6] = { 0xFF, 0xB0, 0xB8, 0x09, 0x09, 0x01 };  // push [eax+building]   +0x50
#define FEATURE_REF_16_RVA 0x6c8ba6u
static const BYTE FEATURE_REF_16_MARK[5] = { 0xBA, 0xB0, 0x09, 0x09, 0x01 };  // mov edx,table         +0x54's scan
#define FEATURE_REF_17_RVA 0x6c8bc4u
static const BYTE FEATURE_REF_17_MARK[6] = { 0x81, 0xFA, 0xA0, 0x0C, 0x09, 0x01 };  // cmp edx,end
#define FEATURE_REF_18_RVA 0x6c8bf0u
static const BYTE FEATURE_REF_18_MARK[6] = { 0xFF, 0xB6, 0xB8, 0x09, 0x09, 0x01 };  // push [esi+building]
#define FEATURE_REF_19_RVA 0x6d0728u
static const BYTE FEATURE_REF_19_MARK[5] = { 0xB9, 0xB0, 0x09, 0x09, 0x01 };  // mov ecx,table         RowOf
#define FEATURE_REF_20_RVA 0x6d0744u
static const BYTE FEATURE_REF_20_MARK[6] = { 0x81, 0xF9, 0xA0, 0x0C, 0x09, 0x01 };  // cmp ecx,end

static const TableRef FEATURE_REFS[] = {
  { FEATURE_REF_01_RVA, { 0xBA }, 1, 0x000 }, { FEATURE_REF_02_RVA, { 0x81, 0xFA }, 2, 0x2F0 },
  { FEATURE_REF_03_RVA, { 0xFF, 0xB7 }, 2, 0x00C }, { FEATURE_REF_04_RVA, { 0xFF, 0xB7 }, 2, 0x008 },
  { FEATURE_REF_05_RVA, { 0xBA }, 1, 0x000 }, { FEATURE_REF_06_RVA, { 0x81, 0xFA }, 2, 0x2F0 },
  { FEATURE_REF_07_RVA, { 0xFF, 0xB6 }, 2, 0x008 }, { FEATURE_REF_08_RVA, { 0x3B, 0x86 }, 2, 0x00C },
  { FEATURE_REF_09_RVA, { 0xB9 }, 1, 0x008 }, { FEATURE_REF_10_RVA, { 0x81, 0xF9 }, 2, 0x2F8 },
  { FEATURE_REF_11_RVA, { 0x8B, 0x80 }, 2, 0x000 }, { FEATURE_REF_12_RVA, { 0xB9 }, 1, 0x000 },
  { FEATURE_REF_13_RVA, { 0x81, 0xF9 }, 2, 0x2F0 }, { FEATURE_REF_14_RVA, { 0x8B, 0x80 }, 2, 0x008 },
  { FEATURE_REF_15_RVA, { 0xFF, 0xB0 }, 2, 0x008 }, { FEATURE_REF_16_RVA, { 0xBA }, 1, 0x000 },
  { FEATURE_REF_17_RVA, { 0x81, 0xFA }, 2, 0x2F0 }, { FEATURE_REF_18_RVA, { 0xFF, 0xB6 }, 2, 0x008 },
  { FEATURE_REF_19_RVA, { 0xB9 }, 1, 0x000 }, { FEATURE_REF_20_RVA, { 0x81, 0xF9 }, 2, 0x2F0 },
};
#define FEATURE_REF_COUNT (int)(sizeof FEATURE_REFS / sizeof *FEATURE_REFS)

/** The engine's table as loaded; the first and last rows are the anchor. */
static const FeatureRow *engine_feature_table(void) {
  const FeatureRow *t = (const FeatureRow *)((BYTE *)GetModuleHandleW(NULL) + FEATURE_TABLE_RVA);
  const FeatureRow *first = &t[0], *last = &t[SHIPPED_FEATURE_ROWS - 1];
  if (first->feature != 0 || first->town != 3 || first->building != 17 || first->minLevel != 1) return NULL;
  if (last->feature != 0x2E || last->town != 2 || last->building != 0 || last->minLevel != 4) return NULL;
  return t;
}

static int install_town_features(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  const FeatureRow *engine = engine_feature_table();
  if (!engine) { log_line("town features: the engine's table is not the one we read - nothing done"); return 0; }
  DWORD tableAddress = (DWORD)base + FEATURE_TABLE_RVA;

  // Every reference or none.
  for (int i = 0; i < FEATURE_REF_COUNT; i++) {
    const TableRef *r = &FEATURE_REFS[i];
    const BYTE *at = base + r->rva;
    for (int b = 0; b < r->opcodeLen; b++) {
      if (at[b] != r->opcode[b]) { log_hex("town features: not the bytes we know at ", r->rva); return 0; }
    }
    DWORD have = *(const DWORD *)(at + r->opcodeLen);
    if (have != tableAddress + r->offset) { log_hex("town features: not the table's address at ", r->rva); return 0; }
  }

  int rows = SHIPPED_FEATURE_ROWS + g_ownFeatureCount;
  FeatureRow *ours = (FeatureRow *)VirtualAlloc(NULL, (SIZE_T)rows * sizeof(FeatureRow) + 16, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (!ours) { log_line("town features: no memory for the table"); return 0; }
  for (int i = 0; i < SHIPPED_FEATURE_ROWS; i++) ours[i] = engine[i];
  for (int i = 0; i < g_ownFeatureCount; i++) ours[SHIPPED_FEATURE_ROWS + i] = g_ownFeatures[i];
  DWORD end = (DWORD)(ours + rows);

  for (int i = 0; i < FEATURE_REF_COUNT; i++) {
    const TableRef *r = &FEATURE_REFS[i];
    BYTE *at = base + r->rva + r->opcodeLen;
    // A reference past the last row is the loop's end, and moves with it; a
    // column reference moves with the start.
    DWORD to = r->offset >= 0x2F0 ? end + (r->offset - 0x2F0) : (DWORD)ours + r->offset;
    DWORD old = 0;
    if (!VirtualProtect(at, 4, PAGE_EXECUTE_READWRITE, &old)) { log_hex("town features: could not write at ", r->rva); return 0; }
    *(DWORD *)at = to;
    VirtualProtect(at, 4, old, &old);
    FlushInstructionCache(GetCurrentProcess(), at, 4);
  }
  log_num("town features: the table is ours, rows: ", rows);
  return 1;
}
