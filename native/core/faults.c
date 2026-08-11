// A crash that names itself.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT core_faults

// ---------------------------------------------------------------------------
// WHY THIS EXISTS. A fault inside the game is reported by Windows as a module
// and an offset, and that is all: `homm5-editor.dll +0x1f9dc` says which of our
// bytes the processor was on and nothing about how it got there. Working back
// from that costs a launch each time — and every launch is a person's evening.
//
// A vectored handler is told about the fault BEFORE anything unwinds, with the
// registers and the stack still standing. So one launch answers where it was,
// what it was holding, and — from the return addresses still on the stack —
// who called.
//
// IT CHANGES NOTHING. `EXCEPTION_CONTINUE_SEARCH` hands the fault straight on:
// the game crashes exactly as it would have, and we have written a page about
// it first. Only access violations are reported, and only the first few: this
// engine throws C++ exceptions in normal play, and a handler that logged those
// would fill the file with noise on every map.

#define FAULTS_REPORTED 3
static int g_faultsLeft = FAULTS_REPORTED;

/** Ourselves, so an address in the log can be turned back into an offset. */
static HINSTANCE g_ourModule = NULL;

/** Where the game and we are, so an address in the log can be placed. */
static void log_where_modules_are(void) {
  log_hex("       the game is loaded at ", (DWORD)(INT_PTR)GetModuleHandleW(NULL));
  log_hex("       and we are at         ", (DWORD)(INT_PTR)g_ourModule);
}

/**
 * The stack as return addresses: whatever on it points INTO code.
 *
 * Not a real unwind — a frame pointer chain needs frames, and -Os does not keep
 * them. This is the cheap version that answers the question actually being
 * asked ("who called into us"): every word of the top of the stack that looks
 * like an address inside a loaded module is printed, and the first few of those
 * are the callers, in order.
 */
#define STACK_WORDS_LOGGED 32

static void log_stack_words(const BYTE *esp) {
  for (int i = 0; i < STACK_WORDS_LOGGED; i++) {
    const DWORD *at = (const DWORD *)(esp + i * 4);
    if (!readable(at, 4)) return;
    DWORD word = *at;
    if (!points_at_code((void *)(INT_PTR)word)) continue;
    log_hex("       stack holds code address ", word);
  }
}

static LONG CALLBACK on_fault(EXCEPTION_POINTERS *info) {
  if (!info || !info->ExceptionRecord || !info->ContextRecord) return EXCEPTION_CONTINUE_SEARCH;
  if (info->ExceptionRecord->ExceptionCode != EXCEPTION_ACCESS_VIOLATION) {
    return EXCEPTION_CONTINUE_SEARCH;
  }
  if (g_faultsLeft <= 0) return EXCEPTION_CONTINUE_SEARCH;
  g_faultsLeft--;

  CONTEXT *c = info->ContextRecord;
  log_line("crash: an access violation");
  log_hex("       at code address       ", (DWORD)(INT_PTR)info->ExceptionRecord->ExceptionAddress);
  log_hex("       eip ", c->Eip);
  log_hex("       esp ", c->Esp);
  log_hex("       ebp ", c->Ebp);
  log_hex("       eax ", c->Eax);
  log_hex("       ecx ", c->Ecx);
  log_hex("       edx ", c->Edx);
  log_hex("       esi ", c->Esi);
  log_hex("       edi ", c->Edi);
  log_where_modules_are();
  log_stack_words((const BYTE *)(INT_PTR)c->Esp);
  return EXCEPTION_CONTINUE_SEARCH;
}

static void install_fault_report(HINSTANCE self) {
  g_ourModule = self;
  AddVectoredExceptionHandler(1, &on_fault);
}
