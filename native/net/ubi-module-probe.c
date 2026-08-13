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
// HOW. All three are `__thiscall` with one stack argument, and all three are big
// enough to take a five-byte jump without splitting an instruction (the head bytes
// below are the check). None of them is on a hot path: the queue sees one push per
// message received, the other two run once per module reply.
//
// This file is a PROBE. It answers a question and then it goes, like the vertex-light
// one before it — it is not a feature and nothing should come to depend on it.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT net_ubi_module_probe

/** `push a received message onto a queue` — the queue is `ecx`. */
#define MODULE_QUEUE_PUSH_RVA 0x0285e0u
static const BYTE MODULE_QUEUE_PUSH_HEAD[DETOUR_LEN] = { 0x56, 0x57, 0x8B, 0xF9, 0x8B };

/** `dispatch a drained reply by its request number` — 0x400 profile, 0x500 ladder. */
#define MODULE_DISPATCH_RVA 0x026d50u
static const BYTE MODULE_DISPATCH_HEAD[DETOUR_LEN] = { 0x53, 0x8B, 0x5C, 0x24, 0x08 };

/** `find the queued reply for this request number`, or null. */
#define MODULE_SCAN_RVA 0x0286f0u
static const BYTE MODULE_SCAN_HEAD[DETOUR_LEN] = { 0x83, 0xEC, 0x28, 0x56, 0x8B };

typedef void(__fastcall *ModuleQueuePushFn)(void *queue, void *edx, void *message);
typedef char(__fastcall *ModuleDispatchFn)(void *transport, void *edx, unsigned int request);
typedef void *(__fastcall *ModuleScanFn)(void *client, void *edx, unsigned int request);

static ModuleQueuePushFn g_moduleQueuePush = NULL;
static ModuleDispatchFn g_moduleDispatch = NULL;
static ModuleScanFn g_moduleScan = NULL;

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

/** Watch the three points a module reply has to pass. */
static int install_module_probe(void) {
  g_moduleQueuePush = (ModuleQueuePushFn)detour(MODULE_QUEUE_PUSH_RVA, MODULE_QUEUE_PUSH_HEAD, DETOUR_LEN,
                                               &module_queue_push_hook, "module queue push");
  g_moduleDispatch = (ModuleDispatchFn)detour(MODULE_DISPATCH_RVA, MODULE_DISPATCH_HEAD, DETOUR_LEN,
                                              &module_dispatch_hook, "module reply dispatch");
  g_moduleScan = (ModuleScanFn)detour(MODULE_SCAN_RVA, MODULE_SCAN_HEAD, DETOUR_LEN,
                                      &module_scan_hook, "module reply scan");
  return g_moduleQueuePush && g_moduleDispatch && g_moduleScan;
}
