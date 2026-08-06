// The editor's own extension, loaded into the game.
//
// WHAT IT IS FOR. An artifact record carries six hero stats and nothing else.
// Everything a shipped artifact does beyond that is compiled into the
// executable against a specific id, so a new id gets none of it — see
// docs/ENGINE_INTERNALS.md. This adds our own terms to the engine's own
// arithmetic: it calls the original calculation, appends what our config says,
// and returns the sum. Nothing shipped changes behaviour.
//
// HOW IT GETS LOADED. Not by taking another library's name: `H5_Game_H5E.exe`
// is our copy already, and it names this file in its import table. So no file
// of the game's is touched, and turning the mod off is what it always was —
// launch the game's own executable instead.
//
// WHAT IT HOOKS, for now. `CNecromancy::RaisePercent` — one function, called
// once, that sums base + skill + perk + amplifiers + grail + pendant + set. Its
// last term is "count worn pieces of set 5, if at least 4 add a number from
// data"; ours is the same shape with our set and our number. The dark energy
// ceiling is the same again, one object up. And the first aid tent, which is
// where a SPECIALIZATION of ours enters — the same bargain one rung down: an
// enum value the executable has never heard of, and a term added where the
// engine sums its own.
//
// WHAT ASKS FOR A TERM. Three subjects, one shape: an artifact (or a set of
// them) answered by `CountEquipped`, a specialization answered by
// `HasSpecialization`, and a SKILL answered by the hero's `GetSkillMastery`.
// Each is a value the executable was never built with, and each is asked about
// through a question it already knows how to answer — so adding a subject costs
// a config row and a virtual call, while adding a SUM still costs a detour.
//
// ONE ADDRESS, AND ONLY ONE. The hero arrives as `this`, and the engine asks
// how many pieces of a set are worn through the hero's OWN vtable (+0x328), so
// that call needs no address at all — we make it the way the engine makes it,
// two instructions above where we cut in. The single address we do need is
// verified against the bytes we expect before anything is written.
//
// NO C RUNTIME. Only kernel32: this is injected into a 2007 executable, and a
// runtime that has to initialise is one more thing that can fail in a process
// that is not ours. Parsing and formatting are done by hand below; there is not
// much of either.

#include <windows.h>

// ---------------------------------------------------------------------------
// ONE translation unit, in pieces.
//
// Each include below is a WHOLE .c file, spliced in place: the compiler still
// sees a single file, in exactly this order, so every static helper and every
// global is shared without a header and invisible outside the DLL. A file sees
// what was included before it and nothing after — which is why the order below
// is not alphabetical: it is the order of need. The unusual spelling
// (#include of .c) is deliberate; see docs/ENGINE_INTERNALS.md.

#include "core/landmarks.c"
#include "combat/tent-worth.c"
#include "combat/dark-energy-pool.c"
#include "lua/registered-shape.c"
#include "core/config-rows.c"
#include "core/text.c"
#include "core/log.c"
#include "core/config-read.c"
#include "qol/config.c"
#include "combat/term.c"
#include "core/detour.c"
#include "combat/dark-energy-install.c"
#include "lua/registry.c"
#include "lua/battle.c"
#include "combat/tent-term.c"
#include "combat/tent-charges.c"
#include "combat/tent-health.c"
#include "combat/tent-mana.c"
#include "combat/spell-cast.c"
#include "qol/borderless.c"
#include "qol/own-profile.c"
#include "qol/quick-split.c"
#include "core/call.c"
#include "qol/quick-split-gestures.c"
#include "qol/stack-plates.c"
#include "qol/combat-ai.c"
#include "qol/fix-encourage.c"
#include "qol/fix-barbarian-learning.c"
#include "qol/fix-snare-crash.c"
#include "qol/fix-payback.c"
#include "qol/fix-dragon-form.c"
#include "qol/fix-empowered-armageddon.c"
#include "qol/fix-book-of-power.c"
#include "qol/fix-master-of-fire.c"
#include "qol/fix-imbue-ballista.c"

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(self);
  find_our_dir(self);
  log_line("--- homm5-editor extension loaded");
  load_config();
  if (g_rowCount || g_skillRowCount) install_hooks();
  // Independent of the config: the functions are ours to offer whether or not
  // any artifact asks for a bonus, and a script that calls one is a different
  // user from an artifact that carries one.
  install_lua_functions();
  // The same argument, one context over — and the one thing here that a battle
  // has to answer for itself, so it says what it saw whether or not anything
  // asked. See "Saying something to a battle's script" above.
  if (install_combat_scripts()) log_line("battles will be spoken to");
  install_energy_getter();
  if (g_specRowCount) install_specialization_hooks();
  if (rows_for(STAT_TENT_CHARGES)) {
    // Both halves, or neither: the constructor notes the tent down and the
    // amount hook is where the note is redeemed.
    install_tent_term();
    if (install_machine_charges()) log_line("first aid tent charges hook installed");
  }
  // The healing, the cleanse and the ultimate's tent all share the charges'
  // hook — it is the same function, asked more questions — and the machine's own
  // hit points are decided elsewhere.
  if (rows_for(STAT_TENT_HEALING) || rows_for(STAT_TENT_CLEANSE) || rows_for(STAT_TENT_MANA)) {
    install_tent_term();
  }
  // Not only for the row that spends it: mana changing hands is an EVENT a
  // script can ask for (`H5E_HERO_MANA_CHANGED`), and a trigger nobody has
  // registered for costs one comparison in the fired path. Hooked always, and
  // the log says so once.
  if (install_caster_mana()) log_line("combat caster mana hook installed");
  // What a battle actually casts, by id — the first half of carrying a spell of
  // our own. It says whether an id the executable never heard of reaches the
  // engine's resolver at all, which is the question everything above a new spell
  // rests on. Unconditional, like the battle scripts and for the same reason: a
  // log that has to be switched on says nothing on the run that mattered.
  install_spell_log();
  if (rows_for(STAT_TENT_HEALTH) && install_machine_health()) {
    log_line("first aid tent health hook installed");
  }
  // A player's own settings, read from their own file. The window has to be met
  // before the game makes it, and the game makes it from its entry point — which
  // is why this happens here and not on the first frame.
  load_qol();
  if (g_qol[QOL_BORDERLESS]) install_borderless();
  // Before the game asks, which it does early: the profile it loads decides
  // what the main menu already shows.
  if (g_qol[QOL_OWN_PROFILE]) install_own_profile(self);
  // Code of the game's own, so unlike the two above it can only be written once
  // the image is there to write on — which at DLL_PROCESS_ATTACH it is.
  if (g_qol[QOL_QUICK_SPLIT]) install_quick_split();
  if (g_qol[QOL_STACK_HEALTH] || g_qol[QOL_STACK_LOSSES]) install_stack_plates();
  // Code of the game's own again, and the whole feature is the writing of it:
  // with the flag clear not a byte of the image is touched, which is what makes
  // this switch the game's own behaviour rather than a mode of ours.
  if (g_qol[QOL_COMBAT_AI_FIX]) install_combat_ai_fix();
  // Rules the shipped game gets wrong, each a byte of its own — see
  // docs/engineInternals/RULES_FIXES.md.
  if (g_qol[QOL_ENCOURAGE_FIX]) install_encourage_fix();
  if (g_qol[QOL_BARBARIAN_LEARNING_FIX]) install_barbarian_learning_fix();
  if (g_qol[QOL_SNARE_CRASH_FIX]) install_snare_fix();
  if (g_qol[QOL_PAYBACK_FIX]) install_payback_fix();
  if (g_qol[QOL_DRAGON_FORM_FIX]) install_dragon_form_fix();
  if (g_qol[QOL_EMPOWERED_ARMAGEDDON_FIX]) install_empowered_armageddon_fix();
  if (g_qol[QOL_BOOK_OF_POWER_FIX]) install_book_of_power_fix();
  if (g_qol[QOL_MASTER_OF_FIRE_FIX]) install_master_of_fire_fix();
  if (g_qol[QOL_IMBUE_BALLISTA_FIX]) install_imbue_ballista_fix();
  return TRUE;
}

/** So the import that loads us has something to name. */
__declspec(dllexport) int homm5_editor_present(void) { return 1; }
