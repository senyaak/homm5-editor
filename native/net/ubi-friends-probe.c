// Why a friend the server says is online is drawn as offline.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY. The server pushes a friend with message 74 and the client's own log prints it
// back whole — `FriendsRcv_UpdateFriend: (Guest,1,Ranked,2,1560,)` — and the panel
// then draws that friend as "не в сети". Everything between those two facts has been
// READ, and the reading says it should work:
//
//   0xDFE210  CLib::ProcessFriendsRcv_UpdateFriend keeps TWO things out of the six
//             fields — the name, and `field 1 == 1` as a bool. Nothing else about a
//             friend is stored anywhere; whatever the panel draws it draws from these.
//   0xDFF160  finds the friend by name and either updates that bool (and says
//             "::Changed") or inserts him (and says "::New").
//   0x910A00  the panel's listener: builds a row — name, rating **-1 always**, the
//             bool at +0x1C, "this is a friend" at +0x20 — and only while the panel's
//             tab field (controller+0x28) is 1, which is the friends tab. The member
//             listener at 0x9108F0 is the same thing gated on that field being 0.
//
// So either the bool is 0 by the time a row is built, or it is 1 and the word on the
// screen comes from something else — the rating of -1 is the candidate, and it is the
// client's own invention, not ours. Those two have different fixes and reading cannot
// tell them apart: the bool is on the stack and the screen is a data-bound widget.
// Measure. One launch, three lines.
//
// This file is a PROBE. It answers a question and then it goes — it is not a feature
// and nothing should come to depend on it.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_ubi_friends_probe

/** `CLib::ProcessFriendsRcv_UpdateFriend` — the six fields, as the client kept them. */
#define FRIEND_UPDATE_RVA 0x9fe210u
static const BYTE FRIEND_UPDATE_HEAD[DETOUR_LEN] = { 0x55, 0x8B, 0xEC, 0x6A, 0xFF };

/** `CPlayersController`'s friend listener: a friend appeared. */
#define FRIEND_ROW_RVA 0x510a00u
#define FRIEND_ROW_HEAD_LEN 6
static const BYTE FRIEND_ROW_HEAD[FRIEND_ROW_HEAD_LEN] = { 0x83, 0xEC, 0x0C, 0x57, 0x8B, 0xF9 };

/** And: a friend already on the list changed. */
#define FRIEND_CHANGED_RVA 0x510a90u
static const BYTE FRIEND_CHANGED_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x0C, 0x53, 0x57 };

/** The same panel's other half, for the order of the two — a member joined. */
#define MEMBER_ROW_RVA 0x5108f0u
static const BYTE MEMBER_ROW_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x0C, 0x53, 0x56 };

typedef void(__fastcall *FriendUpdateFn)(void *lib, void *edx, void *message);
typedef void(__fastcall *FriendRowFn)(void *listener, void *edx, void *friendPair);
typedef void(__fastcall *MemberRowFn)(void *listener, void *edx, void *member);

static FriendUpdateFn g_friendUpdate = NULL;
static FriendRowFn g_friendRow = NULL;
static FriendRowFn g_friendChanged = NULL;
static MemberRowFn g_memberRow = NULL;

/**
 * The text of one of this build's strings.
 *
 * Three pointers — data, end, capacity — and the data one is first. The row's own
 * destructor (0x90F830) frees exactly that pointer, which is what says it is a
 * pointer and not a buffer in place.
 */
static const char *string_text(void *string) {
  if (!readable(string, 4)) return "<unreadable>";
  const char *text = *(const char **)string;
  return readable((void *)text, 1) ? text : "<unreadable>";
}

static void __fastcall friend_update_hook(void *lib, void *edx, void *message) {
  // The struct the parser filled: name at +0x0C, then our six fields as it kept them —
  // field 1 at +0x18 is the only one that survives into the friends collection.
  if (readable(message, 0x34)) {
    log_text("friends probe: an update for ", string_text((BYTE *)message + 0x0c));
    log_num("friends probe:   field 1, which becomes his online flag: ", *(int *)((BYTE *)message + 0x18));
    log_text("friends probe:   field 2, which the client drops: ", string_text((BYTE *)message + 0x1c));
    log_num("friends probe:   field 3, dropped too: ", *(int *)((BYTE *)message + 0x28));
    log_num("friends probe:   field 4, dropped too: ", *(int *)((BYTE *)message + 0x2c));
  }
  g_friendUpdate(lib, edx, message);
}

static void __fastcall friend_row_hook(void *listener, void *edx, void *friendPair) {
  // The pair the collection hands its listeners: the name, then the bool at +0x0C.
  // And the gate: the listener sits at controller+0x10, so its own +0x18 is the
  // controller's +0x28 — the tab. 1 is the friends tab, and on any other value this
  // function does nothing at all, which would be the whole answer by itself.
  if (readable(listener, 0x1c)) log_num("friends probe: a friend row, with the panel's tab at ", *(int *)((BYTE *)listener + 0x18));
  if (readable(friendPair, 0x10)) {
    log_text("friends probe:   for ", string_text(friendPair));
    log_num("friends probe:   and his online flag says ", *(int *)((BYTE *)friendPair + 0x0c));
  }
  g_friendRow(listener, edx, friendPair);
}

static void __fastcall friend_changed_hook(void *listener, void *edx, void *friendPair) {
  if (readable(friendPair, 0x10)) {
    log_text("friends probe: a friend changed: ", string_text(friendPair));
    log_num("friends probe:   his online flag now says ", *(int *)((BYTE *)friendPair + 0x0c));
  }
  g_friendChanged(listener, edx, friendPair);
}

static void __fastcall member_row_hook(void *listener, void *edx, void *member) {
  // The other listener, for the order of things: a member record carries his name at
  // +8 and his rating at +0x38, and its row is built with that rating where a friend's
  // row carries -1.
  if (readable(member, 0x3c)) {
    log_text("friends probe: a member row for ", string_text((BYTE *)member + 8));
    log_num("friends probe:   rated ", *(int *)((BYTE *)member + 0x38));
  }
  g_memberRow(listener, edx, member);
}

/** Watch a friend from the wire to the row he becomes. */
static int install_friends_probe(void) {
  g_friendUpdate = (FriendUpdateFn)detour(FRIEND_UPDATE_RVA, FRIEND_UPDATE_HEAD, DETOUR_LEN,
                                          &friend_update_hook, "friend update kept");
  g_friendRow = (FriendRowFn)detour(FRIEND_ROW_RVA, FRIEND_ROW_HEAD, FRIEND_ROW_HEAD_LEN,
                                    &friend_row_hook, "friend row built");
  g_friendChanged = (FriendRowFn)detour(FRIEND_CHANGED_RVA, FRIEND_CHANGED_HEAD, DETOUR_LEN,
                                        &friend_changed_hook, "friend row changed");
  g_memberRow = (MemberRowFn)detour(MEMBER_ROW_RVA, MEMBER_ROW_HEAD, DETOUR_LEN, &member_row_hook,
                                    "member row built");
  return g_friendUpdate && g_friendRow && g_friendChanged && g_memberRow;
}
