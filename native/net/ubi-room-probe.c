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

/**
 * `CGamesView2::AddGame` — where a game becomes a row, and the one place that says
 * which of the two stories is true.
 *
 * It shows a game when `desc[+0x18] != 0`, or when the global at 0x108F938 is set —
 * and that global is read in three places and written in none, so if it is 0 then every
 * game in the list has the byte SET, and the object dumped at draw time is not the one
 * the Join button reads. If it is 1, the byte is clear and setting it is the fix.
 *
 * The return address answers the other half: whoever built this description is the
 * function to read next, instead of searching the executable for whoever writes a byte.
 */
#define ADD_GAME_RVA 0x4dce50u
static const BYTE ADD_GAME_HEAD[DETOUR_LEN] = { 0x53, 0x8B, 0x5C, 0x24, 0x08 };

typedef void(__stdcall *GameRowFn)(void *a, void *b, void *room);
typedef char(__fastcall *AddGameFn)(void *view, void *edx, void *description);
typedef void(__fastcall *JoinRefreshFn)(void *screen, void *edx);
/** A widget's "what is selected", vtable slot 0x24 — a pointer, or null for nothing. */
typedef void *(__fastcall *SelectionFn)(void *list, void *edx);

static GameRowFn g_gameRow = NULL;
static AddGameFn g_addGame = NULL;
static JoinRefreshFn g_joinRefresh = NULL;

/** Is this a pointer to text we could print? Short, printable, and it ends. */
static const char *text_at(void *maybe) {
  const char *text = (const char *)maybe;
  if (!readable((void *)text, 1)) return NULL;
  for (int i = 0; i < 64; i++) {
    unsigned char c = (unsigned char)text[i];
    if (c == 0) return i ? text : NULL;
    if (c < 0x20 || c > 0x7e) return NULL;
    if (!readable((void *)(text + i + 1), 1)) return NULL;
  }
  return NULL;
}

/**
 * The record, whole, the first couple of times a row is drawn.
 *
 * The twenty fields we send land in this struct in an order that has to be READ, and
 * two readings of it by eye have already disagreed. So: every dword of it, and the text
 * behind the ones that are pointers to text. Two rows is enough to see it — the list
 * redraws several times a second and the answer does not change between frames.
 */
static int g_rowsDumped = 0;

static void __stdcall game_row_hook(void *a, void *b, void *room) {
  if (readable(room, 0x194)) {
    // The three the Join button hangs on (0x8768B0 and its predicate 0xDE2660): the
    // version it recognises, the byte it insists is set, and the one it falls back to.
    log_num("room probe: drawing a row, locked = ", *((BYTE *)room + 0x34));
    log_num("room probe:   started = ", *((BYTE *)room + 0x90));
    log_num("room probe:   the byte Join wants set, +0x18 = ", *((BYTE *)room + 0x18));
    log_num("room probe:   the version at +0x8c = ", *(int *)((BYTE *)room + 0x8c));
    log_num("room probe:   the flag behind it, +0xc0 = ", *((BYTE *)room + 0xc0));
    log_num("room probe:   and its answer, +0x17c = ", *((BYTE *)room + 0x17c));
    if (g_rowsDumped < 2) {
      g_rowsDumped++;
      // THE WHOLE payload (0x194 bytes, from 0x8DCE7B), not the head of it: the first
      // run of this stopped at 0xA0 and every numbered field we were looking for was
      // past it.
      log_line("room probe:   the whole record, dword by dword:");
      for (int at = 0; at < 0x194; at += 4) {
        int value = *(int *)((BYTE *)room + at);
        const char *text = text_at((void *)(SIZE_T)value);
        if (text) {
          log_num("room probe:     +0x", at);
          log_text("room probe:       is a string: ", text);
        } else {
          log_num("room probe:     +0x", at);
          log_num("room probe:       = ", value);
        }
      }
    }
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

static char __fastcall add_game_hook(void *view, void *edx, void *description) {
  // Everything this question needs, in four lines and one launch.
  log_num("room probe: a game is offered to the list at ", (int)(SIZE_T)description);
  if (readable(description, 0x20)) log_num("room probe:   its byte +0x18 says ", *((BYTE *)description + 0x18));
  log_num("room probe:   the global that shows games anyway is ", *(BYTE *)(SIZE_T)0x108F938u);
  log_num("room probe:   and it was built by the code at ", (int)(SIZE_T)__builtin_return_address(0));
  return g_addGame(view, edx, description);
}

/** Watch a game row being drawn, and the button under the list. */
static int install_room_probe(void) {
  g_gameRow = (GameRowFn)detour(GAME_ROW_RVA, GAME_ROW_HEAD, GAME_ROW_HEAD_LEN, &game_row_hook, "a games-list row");
  g_joinRefresh = (JoinRefreshFn)detour(JOIN_REFRESH_RVA, JOIN_REFRESH_HEAD, DETOUR_LEN, &join_refresh_hook,
                                        "the Join button's refresh");
  g_addGame = (AddGameFn)detour(ADD_GAME_RVA, ADD_GAME_HEAD, DETOUR_LEN, &add_game_hook, "a game offered to the list");
  return g_gameRow && g_joinRefresh && g_addGame;
}
