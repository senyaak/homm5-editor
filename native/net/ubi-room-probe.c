// Why "Join" stays grey with a game sitting in the list.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY. The other player's game arrives, the client builds it ("ProcessNewRoom: new
// room (Name=…,GroupID=100)") and draws it — and the button under the list is dead.
// Reading gives two candidates and no way to choose between them:
//
//   the row itself. 0x8DD160 draws one, and it reads two flags out of the room
//   record: `[record+0x34]` puts a padlock on it, `[record+0x90]` marks it STARTED.
//   Either one, on a game that is neither, would explain a game you cannot enter.
//   Both come out of the twenty fields we send, and which field lands where is what
//   the record's own reader (0x41FC80) says only up to the four numbers at its end.
//
//   the button. 0x799140 asks the LIST (`[screen+0x194]`, vtable slot 0x24) for its
//   selection and enables the button when there is one. A row nobody can select is
//   a button nobody can press, and that has nothing to do with what we sent.
//
// So: print the flags each row is drawn with, and print whether the list has a
// selection when the button is refreshed. One launch decides which half to fix.
//
// This file is a PROBE. It answers a question and then it goes.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_ubi_room_probe

/** `draw one row of the games list` — the room record is its third argument. */
#define GAME_ROW_RVA 0x4dd160u
#define GAME_ROW_HEAD_LEN 8
static const BYTE GAME_ROW_HEAD[GAME_ROW_HEAD_LEN] = { 0x83, 0xEC, 0x44, 0x53, 0x8B, 0x5C, 0x24, 0x54 };

/** `decide whether the Join button is live` — the screen is `ecx`. */
#define JOIN_REFRESH_RVA 0x399140u
static const BYTE JOIN_REFRESH_HEAD[DETOUR_LEN] = { 0x51, 0x53, 0x56, 0x8B, 0xF1 };

typedef void(__stdcall *GameRowFn)(void *a, void *b, void *room);
typedef void(__fastcall *JoinRefreshFn)(void *screen, void *edx);
/** A widget's "what is selected", vtable slot 0x24 — a pointer, or null for nothing. */
typedef void *(__fastcall *SelectionFn)(void *list, void *edx);

static GameRowFn g_gameRow = NULL;
static JoinRefreshFn g_joinRefresh = NULL;

static void __stdcall game_row_hook(void *a, void *b, void *room) {
  // The two flags the row reads, and the numbers around them — because if one of them
  // is set, the next question is immediately which of our fields it came from.
  if (readable(room, 0x94)) {
    log_num("room probe: drawing a row, locked = ", *((BYTE *)room + 0x34));
    log_num("room probe:   started = ", *((BYTE *)room + 0x90));
    log_num("room probe:   the numbers before it: +0x84 = ", *(int *)((BYTE *)room + 0x84));
    log_num("room probe:     +0x88 = ", *(int *)((BYTE *)room + 0x88));
    log_num("room probe:     +0x8c = ", *(int *)((BYTE *)room + 0x8c));
    log_num("room probe:   and the pair at +0x24: ", *(int *)((BYTE *)room + 0x24));
    log_num("room probe:     +0x28 = ", *(int *)((BYTE *)room + 0x28));
  }
  g_gameRow(a, b, room);
}

static void __fastcall join_refresh_hook(void *screen, void *edx) {
  // The same question the function is about to ask, asked first: has the list got a
  // selection? A null here is the whole answer — the button is grey because nothing is
  // selected, and nothing we send about the game could have changed that.
  void *list = readable(screen, 0x198) ? *(void **)((BYTE *)screen + 0x194) : NULL;
  if (list && readable(list, 4)) {
    void **table = *(void ***)list;
    if (readable(table, 0x28)) {
      SelectionFn selection = (SelectionFn)table[9];
      log_num("room probe: the Join refresh ran, and the list's selection is ", (int)(SIZE_T)selection(list, NULL));
    }
  } else {
    log_line("room probe: the Join refresh ran, and there is no list to ask");
  }
  g_joinRefresh(screen, edx);
}

/** Watch a game row being drawn, and the button under the list. */
static int install_room_probe(void) {
  g_gameRow = (GameRowFn)detour(GAME_ROW_RVA, GAME_ROW_HEAD, GAME_ROW_HEAD_LEN, &game_row_hook, "a games-list row");
  g_joinRefresh = (JoinRefreshFn)detour(JOIN_REFRESH_RVA, JOIN_REFRESH_HEAD, DETOUR_LEN, &join_refresh_hook,
                                        "the Join button's refresh");
  return g_gameRow && g_joinRefresh;
}
