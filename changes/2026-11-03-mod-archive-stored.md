- **Saving anything in the mod windows no longer stalls the editor on the first
  save.** Every save writes the whole mod, and the editor compressed all of it:
  with a faction in the mod, the first save after starting the editor took
  15–25 seconds, the later ones a second more than they needed. The mod is now
  written uncompressed, which the game reads as it reads its own archives; the
  file on disk is about twice as large.
