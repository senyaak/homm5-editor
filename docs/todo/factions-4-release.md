# Factions 4 — the release

**What.** Cut the changelog (`node tools/changelog.ts --cut <version>`), run the
full gate (`npm test`, `npm run test-e2e` with `PW_ALL=1`), and hand the owner
the version for tagging.

**Source.** [docs/working/git.md](../working/git.md),
[docs/working/testing.md](../working/testing.md).

**Acceptance.** Everything green; the version section reads as a person
deciding whether to update would read it.

**Depends on.** factions-3-play-test.

**Needs.** The owner tags.
