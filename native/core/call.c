// Calling the engine by hand: measured addresses and vtable slots.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** An address we mean to CALL rather than hook — checked against the bytes it
 *  was measured by, because calling the wrong function is a crash with no
 *  explanation, and the byte check is the explanation. */
static void *code_at(DWORD rva, const BYTE *head, int headLen, const char *what) {
  BYTE *at = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < headLen; i++) {
    if (at[i] == head[i]) continue;
    log_text("this is not the function measured: ", what);
    return NULL;
  }
  return at;
}

/** A virtual call this code makes by hand, and whether it is safe to make. */
static void *vtable_entry(void *obj, DWORD offset) {
  if (readable_bytes(obj, 4) < 4) return NULL;
  void *vtable = *(void **)obj;
  if (readable_bytes(vtable, offset + 4) < offset + 4) return NULL;
  void *fn = *(void **)((BYTE *)vtable + offset);
  return points_at_code(fn) ? fn : NULL;
}

