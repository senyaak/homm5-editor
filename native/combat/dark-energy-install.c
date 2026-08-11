// Installing the dark-energy hooks.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT combat_dark_energy_install

static EnergyGetterFn g_energyGetter = NULL;
/** Set while the engine's lookup runs, so the getter knows to say who it read. */
static int g_capturing = 0;
static void *g_capturedPlayer = NULL;

/** The pool getter, replaced in the vtable: passes through, and reports. */
static int __fastcall energy_getter_hook(void *player) {
  if (g_capturing) g_capturedPlayer = player;
  return g_energyGetter(player);
}

/** The dark energy ceiling: two detours and one replaced slot. */
static int install_energy(void) {
  g_originalRefill = (PlayerFn)detour(REFILL_ENERGY_RVA, REFILL_ENERGY_HEAD, 5, &refill_energy_hook, "energy refill");
  if (!g_originalRefill) return 0;
  // Without this one the engine takes back what the refill gave, the next time
  // anything makes it recompute — so it is not optional.
  g_originalRecalc = (PlayerFn)detour(RECALC_ENERGY_RVA, RECALC_ENERGY_HEAD, 5, &recalc_energy_hook, "energy recalc");
  if (!g_originalRecalc) return 0;
  // The bar. A failure here leaves the pool right and the number under it
  // short, which is worth saying out loud but not worth refusing to run for.
  replace_vtable_entry(ENERGY_CAPS_ACCESSOR_RVA, ENERGY_CAPS_ACCESSOR_HEAD,
                       sizeof ENERGY_CAPS_ACCESSOR_HEAD, &energy_caps_hook, "energy bar shows our term");
  return 1;
}

/**
 * The pool getter, so `RestoreDarkEnergy` can see which player was found.
 *
 * Installed whether or not any row asks for energy: the Lua function is offered
 * to scripts regardless, and it is useless without this. A pass-through costs
 * one comparison on a getter that reads one field.
 */
static int install_energy_getter(void) {
  BYTE *original = (BYTE *)GetModuleHandleW(NULL) + ENERGY_GETTER_RVA;
  for (int i = 0; i < (int)sizeof ENERGY_GETTER_HEAD; i++) {
    if (original[i] != ENERGY_GETTER_HEAD[i]) {
      log_line("the energy getter is not the shape we know - RestoreDarkEnergy will not work");
      return 0;
    }
  }
  g_energyGetter = (EnergyGetterFn)original;
  return replace_vtable_entry(ENERGY_GETTER_RVA, ENERGY_GETTER_HEAD, sizeof ENERGY_GETTER_HEAD,
                              &energy_getter_hook, "energy getter reports which player was read");
}

