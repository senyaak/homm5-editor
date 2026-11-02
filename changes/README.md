# Changelog entries

One file per user-visible change, folded into [CHANGELOG.md](../CHANGELOG.md)
when a version is cut. Never edit CHANGELOG.md for a change.

- **Name**: `<issue>-<slug>.md` (`412-faction-preset.md`); without an issue,
  `<yyyy-mm-dd>-<slug>.md`.
- **Content**: exactly one entry — `- ` and its paragraph(s), continuation
  lines indented two spaces, no headings. It says what was wrong and what a
  person will see, in the changelog's tone; not what changed in the code.
- **No entry** for internal work: reverse engineering, tests, refactoring.

```bash
node tools/changelog.ts               # preview the release section
node tools/changelog.ts --cut 0.12.0  # fold the entries in (newest first) and delete them
```

`npm test` checks every file here (`tools/test-changelog.ts`).
