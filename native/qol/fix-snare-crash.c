// A snare under a summoned wall: the crash, and why the fix is not his.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// WHAT CRASHES. The snare asks whatever stepped on it for the creature standing
// there — a virtual getter at slot +0x6C, called four times over — and
// dereferences the answer without ever testing it. Arcane Crystal and Blade
// Barrier are summoned OBSTACLES, not creatures: the getter comes back null,
// `mov edx,[eax]` reads address zero, and the battle is over.
//
// THE FIX IS THE SAME BUG, NOT THE SAME BYTES. dredknight's writes fourteen
// bytes over the retail build so that the FIRST call's answer is tested and,
// when null, the damage arithmetic is jumped over — landing in the tail with a
// stale `ebx` that was never initialised, and applying whatever number that
// leaves. Our build inlined the function, allocated its registers differently
// and put its tail somewhere else; transliterating that patch is not possible
// (the same work plus a test and a jump does not fit in the bytes there are),
// and copying its stale-register landing would not be worth doing if it did.
//
// WHAT WE DO INSTEAD. Test the same answer, and on null jump to the function's
// OWN "nothing happened" exit — `xor eax,eax` and return, which is the value
// the engine already returns from this function when there is nothing to do.
// Nothing is stale, nothing is invented, and the later three calls that
// dereference the same null are skipped along with it.
//
// HOW IT FITS. The second call is DROPPED: both calls ask the same object the
// same getter, one instruction apart, and the retail fix already assumes as
// much when it tests the first answer and lets the second be dereferenced. Its
// three bytes, plus one saved by `xchg eax,ecx` in place of `mov ecx,eax`, pay
// for the test and the jump exactly.
//
//   test eax,eax / je <exit> / mov esi,eax / xchg eax,ecx / mov edx,[ecx] / call [edx]
//
// BOTH COPIES. Our build emitted this code twice: once inlined into its only
// caller (`0xDC3090`, the live one) and once standing alone (`0xDC3220`). The
// standalone has no call, no jump and no pointer to it anywhere in the image —
// dead by every measure available from the outside — but "no reference I can
// find" is a weaker claim than "no reference", and patching it costs one more
// verified write. So both are patched, and the log says how many took.

/** The live copy, inlined into its caller; exits through the caller's `xor eax,eax`. */
#define SNARE_INLINED_RVA 0x9c30a6u
/** The standalone copy, which nothing appears to reach; exits through its own tail. */
#define SNARE_STANDALONE_RVA 0x9c3236u

/** `mov edx,[edi] / mov ecx,edi / mov esi,eax / call [edx+6Ch] / mov ecx,eax /
 *  mov edx,[eax] / call [edx]` — the second getter call and the unguarded
 *  dereference that follows it. The same fifteen bytes in both copies. */
static const BYTE SNARE_UNGUARDED[15] = {
  0x8B, 0x17, 0x8B, 0xCF, 0x8B, 0xF0, 0xFF, 0x52, 0x6C, 0x8B, 0xC8, 0x8B, 0x10, 0xFF, 0x12
};
/** The same, guarded: `je` reaches `0xDC31C9`, the caller's return-zero exit. */
static const BYTE SNARE_GUARDED_INLINED[15] = {
  0x85, 0xC0, 0x0F, 0x84, 0x1B, 0x01, 0x00, 0x00, 0x8B, 0xF0, 0x91, 0x8B, 0x11, 0xFF, 0x12
};
/** And here `je` reaches `0xDC32CD`, this copy's own epilogue, with eax zero. */
static const BYTE SNARE_GUARDED_STANDALONE[15] = {
  0x85, 0xC0, 0x0F, 0x84, 0x8F, 0x00, 0x00, 0x00, 0x8B, 0xF0, 0x91, 0x8B, 0x11, 0xFF, 0x12
};

static void install_snare_fix(void) {
  int done = 0;
  done += overwrite_code(SNARE_INLINED_RVA, SNARE_UNGUARDED, SNARE_GUARDED_INLINED,
                         sizeof SNARE_UNGUARDED, "the snare's unguarded creature, inlined");
  done += overwrite_code(SNARE_STANDALONE_RVA, SNARE_UNGUARDED, SNARE_GUARDED_STANDALONE,
                         sizeof SNARE_UNGUARDED, "the snare's unguarded creature, standalone");
  log_num("snare crash: copies guarded, of two: ", done);
}
