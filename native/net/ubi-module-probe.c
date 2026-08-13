// Where a module reply dies: the three places it has to pass, watched from inside.
//
// A piece of the ONE translation unit — see the top of core/detour.c.
//
// WHY. The client asks two things over a "module" — its profile (`persistantdata`,
// request 0x401) and its rating (`ladderquery`, 0x501) — and it ignores our answer
// in total silence: no reply line, no reason, and it sits in its wait state until it
// is interrupted. Every gate on the path has been READ (h5e-lobby's
// docs/NETWORK_STATE.md has the map) and the answer we send satisfies all of them.
// Reading has now been wrong twice — once about which getter reads what, once about
// which connection matters — and each wrong guess costs a launch. So: measure.
//
// The three points, in the order a reply passes them:
//
//   0x4285E0  push onto a queue      — did our bytes become a message at all, and
//                                      which queue did they land in
//   0x426D50  dispatch by request    — did the drainer key it as 1025 / 1281
//   0x4286F0  scan for a match       — was it found for the number being waited on
//
// A silence at the first means the transport never delivered it; at the second, the
// router dropped or mis-keyed it; at the third, the shape is wrong. Only one of those
// three is a protocol question, and this says which.
//
// HOW. All three are `__thiscall` with one stack argument. The head each one gives
// up has to end on an INSTRUCTION boundary, because the trampoline is the copied
// head plus a jump to what follows it — five bytes is what the jump needs, not what
// the head is, and the first version of this file took five from a function whose
// fifth byte was the first of a three-byte `mov`. The game died at once, in the
// trampoline, with an address that belongs to nothing. So the lengths below are the
// instructions, counted: 7, 5 and 6.
//
// None of them is on a hot path: the queue sees one push per message received, the
// other two run once per module reply.
//
// This file is a PROBE. It answers a question and then it goes, like the vertex-light
// one before it — it is not a feature and nothing should come to depend on it.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_ubi_module_probe

/** `push a received message onto a queue` — the queue is `ecx`. */
#define MODULE_QUEUE_PUSH_RVA 0x0285e0u
#define MODULE_QUEUE_PUSH_HEAD_LEN 7
static const BYTE MODULE_QUEUE_PUSH_HEAD[MODULE_QUEUE_PUSH_HEAD_LEN] = { 0x56, 0x57, 0x8B, 0xF9, 0x8B, 0x47, 0x14 };

/** `dispatch a drained reply by its request number` — 0x400 profile, 0x500 ladder. */
#define MODULE_DISPATCH_RVA 0x026d50u
static const BYTE MODULE_DISPATCH_HEAD[DETOUR_LEN] = { 0x53, 0x8B, 0x5C, 0x24, 0x08 };

/** `find the queued reply for this request number`, or null. */
#define MODULE_SCAN_RVA 0x0286f0u
#define MODULE_SCAN_HEAD_LEN 6
static const BYTE MODULE_SCAN_HEAD[MODULE_SCAN_HEAD_LEN] = { 0x83, 0xEC, 0x28, 0x56, 0x8B, 0xF1 };

// FOUR MORE, AND WHY. The first three said the reply gets queued, keyed and FOUND —
// so the envelope and the routing are right and only the body is left. These four are
// the readers of that body, and each returns false without a word when a field is not
// the kind it wants:
//
//   0x427170  the status and the number, for either request
//   0x42C7F0  the ladder's own fields, after that
//   0x42AEC0  the profile's length, and 0x42B400 the rest of its record
//
// So a run says which of them says no, and there is nothing else in between.

/** `read the status and the request number out of a matched reply`. */
#define MODULE_STATUS_RVA 0x027170u
static const BYTE MODULE_STATUS_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x44, 0x33, 0xC0 };

/** `read a ladder reply` — everything after the status. */
#define LADDER_READ_RVA 0x02c7f0u
#define LADDER_READ_HEAD_LEN 6
static const BYTE LADDER_READ_HEAD[LADDER_READ_HEAD_LEN] = { 0x83, 0xEC, 0x4C, 0x53, 0x33, 0xC0 };

/** `read how long the stored profile is` — the first half of a profile read. */
#define PROFILE_SIZE_RVA 0x02aec0u
static const BYTE PROFILE_SIZE_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x38, 0x33, 0xC0 };

/** `read the profile itself` — the second half, into the buffer just allocated. */
#define PROFILE_READ_RVA 0x02b400u
static const BYTE PROFILE_READ_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x38, 0x33, 0xC0 };

// AND THE GETTERS THEMSELVES, on their FAILURES only. The reader says no; these say
// which field it was reading when it did. Both take (destination, index) and both
// refuse a field whose kind is not theirs — a list getter given a number, a number
// getter given a list — which is the whole class of mistake left. A success is not
// logged: these run for every field of every message, and the answer wanted here is
// one line, not two thousand.

/** `read field <index> as a LIST`. */
#define GET_LIST_RVA 0x042f10u
static const BYTE GET_LIST_HEAD[DETOUR_LEN] = { 0x8B, 0x44, 0x24, 0x08, 0x50 };

/** `read field <index> as an INT` — a string, through atoi. */
#define GET_INT_RVA 0x0435c0u
#define GET_INT_HEAD_LEN 8
static const BYTE GET_INT_HEAD[GET_INT_HEAD_LEN] = { 0x83, 0xEC, 0x28, 0xA1, 0x08, 0xFD, 0x08, 0x01 };

typedef void(__fastcall *ModuleQueuePushFn)(void *queue, void *edx, void *message);
typedef char(__fastcall *ModuleDispatchFn)(void *transport, void *edx, unsigned int request);
typedef void *(__fastcall *ModuleScanFn)(void *client, void *edx, unsigned int request);
typedef char(__fastcall *ModuleStatusFn)(void *client, void *edx, unsigned int request, void *status, void *out);
typedef char(__fastcall *LadderReadFn)(void *client, void *edx, void *a, void *b, void *c);
typedef char(__fastcall *ProfileSizeFn)(void *client, void *edx, void *size);
typedef char(__fastcall *ProfileReadFn)(void *client, void *edx, void *a, void *b, void *c, void *buffer, void *size);
typedef char(__fastcall *GetFieldFn)(void *list, void *edx, void *into, unsigned int index);

static ModuleQueuePushFn g_moduleQueuePush = NULL;
static ModuleDispatchFn g_moduleDispatch = NULL;
static ModuleScanFn g_moduleScan = NULL;
static ModuleStatusFn g_moduleStatus = NULL;
static LadderReadFn g_ladderRead = NULL;
static ProfileSizeFn g_profileSize = NULL;
static ProfileReadFn g_profileRead = NULL;
static GetFieldFn g_getList = NULL;
static GetFieldFn g_getInt = NULL;

/**
 * A message's type byte, or -1 when the pointer is not one.
 *
 * The type is at +4 and the body list at +8; that layout is what the client's own
 * router reads (`mov al,[esi+4]`, `mov ecx,[esi+8]`).
 */
static int module_message_type(void *message) {
  if (!readable(message, 12)) return -1;
  return *((BYTE *)message + 4);
}

static void __fastcall module_queue_push_hook(void *queue, void *edx, void *message) {
  // The queue address is the point of this one: several live on the client at fixed
  // offsets — the module's at +0x1B8, the lobby's at +0x1A0 — so which one a message
  // goes into says how the client classified it.
  log_num("module probe: queued a message of type ", module_message_type(message));
  log_num("module probe:   into the queue at ", (int)(SIZE_T)queue);
  g_moduleQueuePush(queue, edx, message);
}

static char __fastcall module_dispatch_hook(void *transport, void *edx, unsigned int request) {
  log_num("module probe: dispatching request ", (int)request);
  char result = g_moduleDispatch(transport, edx, request);
  log_num("module probe:   dispatch returned ", result);
  return result;
}

static void *__fastcall module_scan_hook(void *client, void *edx, unsigned int request) {
  void *found = g_moduleScan(client, edx, request);
  log_num("module probe: scanned for request ", (int)request);
  log_num("module probe:   found a message of type ", found ? module_message_type(found) : -1);
  return found;
}

static char __fastcall module_status_hook(void *client, void *edx, unsigned int request, void *status, void *out) {
  char ok = g_moduleStatus(client, edx, request, status, out);
  log_num("module probe: reading the status for request ", (int)(request & 0xffff));
  log_num("module probe:   the status read said ", ok);
  // The status byte itself, once it is there: 38 is success, 39 a refusal, and which
  // one we sent is a thing to be sure of rather than to assume.
  if (ok && readable(status, 1)) log_num("module probe:   and the status is ", *(BYTE *)status);
  return ok;
}

static char __fastcall ladder_read_hook(void *client, void *edx, void *a, void *b, void *c) {
  char ok = g_ladderRead(client, edx, a, b, c);
  log_num("module probe: the ladder read said ", ok);
  return ok;
}

static char __fastcall profile_size_hook(void *client, void *edx, void *size) {
  char ok = g_profileSize(client, edx, size);
  log_num("module probe: the profile length read said ", ok);
  if (ok && readable(size, 4)) log_num("module probe:   and the length is ", *(int *)size);
  return ok;
}

static char __fastcall profile_read_hook(void *client, void *edx, void *a, void *b, void *c, void *buffer,
                                         void *size) {
  char ok = g_profileRead(client, edx, a, b, c, buffer, size);
  log_num("module probe: the profile record read said ", ok);
  return ok;
}

static char __fastcall get_list_hook(void *list, void *edx, void *into, unsigned int index) {
  char ok = g_getList(list, edx, into, index);
  if (!ok) log_num("module probe: no LIST at index ", (int)index);
  return ok;
}

static char __fastcall get_int_hook(void *list, void *edx, void *into, unsigned int index) {
  char ok = g_getInt(list, edx, into, index);
  if (!ok) log_num("module probe: no NUMBER at index ", (int)index);
  return ok;
}

/** Watch every point a module reply has to pass. */
static int install_module_probe(void) {
  g_moduleQueuePush = (ModuleQueuePushFn)detour(MODULE_QUEUE_PUSH_RVA, MODULE_QUEUE_PUSH_HEAD,
                                               MODULE_QUEUE_PUSH_HEAD_LEN, &module_queue_push_hook,
                                               "module queue push");
  g_moduleDispatch = (ModuleDispatchFn)detour(MODULE_DISPATCH_RVA, MODULE_DISPATCH_HEAD, DETOUR_LEN,
                                              &module_dispatch_hook, "module reply dispatch");
  g_moduleScan = (ModuleScanFn)detour(MODULE_SCAN_RVA, MODULE_SCAN_HEAD, MODULE_SCAN_HEAD_LEN,
                                      &module_scan_hook, "module reply scan");
  g_moduleStatus = (ModuleStatusFn)detour(MODULE_STATUS_RVA, MODULE_STATUS_HEAD, DETOUR_LEN,
                                          &module_status_hook, "module reply status");
  g_ladderRead = (LadderReadFn)detour(LADDER_READ_RVA, LADDER_READ_HEAD, LADDER_READ_HEAD_LEN,
                                      &ladder_read_hook, "ladder reply read");
  g_profileSize = (ProfileSizeFn)detour(PROFILE_SIZE_RVA, PROFILE_SIZE_HEAD, DETOUR_LEN,
                                        &profile_size_hook, "profile length read");
  g_profileRead = (ProfileReadFn)detour(PROFILE_READ_RVA, PROFILE_READ_HEAD, DETOUR_LEN,
                                        &profile_read_hook, "profile record read");
  g_getList = (GetFieldFn)detour(GET_LIST_RVA, GET_LIST_HEAD, DETOUR_LEN, &get_list_hook, "get a list field");
  g_getInt = (GetFieldFn)detour(GET_INT_RVA, GET_INT_HEAD, GET_INT_HEAD_LEN, &get_int_hook, "get a number field");
  return g_moduleQueuePush && g_moduleDispatch && g_moduleScan && g_moduleStatus && g_ladderRead
         && g_profileSize && g_profileRead && g_getList && g_getInt;
}
