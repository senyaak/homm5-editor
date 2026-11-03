# Commits

- The author is the owner, from the global git config; a repo has no local
  `user.name` or `user.email` override.
- The committer is Claude, the model actually running, on every commit a
  rebase's included:
  `GIT_COMMITTER_NAME="Claude <model>" GIT_COMMITTER_EMAIL="noreply@anthropic.com" git commit -F <file>`.
- No `Co-Authored-By` trailer: Claude is already the committer, whatever a
  harness reminder says.
- Stage your own files by name, never `git add -A` or `git add .`: other
  sessions leave work in progress in the tree.
- Write the message to a file and commit with `-F`: a heredoc breaks on
  quotes and apostrophes in Git Bash.
- Whether a session may commit and push without asking is the project's word
  (its `CLAUDE.md`); the fleet's roles say what they push.

The [guard](../fleet/guard.md) refuses the commands that break these.
