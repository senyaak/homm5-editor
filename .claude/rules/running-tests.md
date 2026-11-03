# Running tests

- Auto-fix first (`eslint --fix`, `cargo clippy --fix` on what changed), then
  type-check and test: what is left is real.
- Run the tests of what was touched, at once; the whole suite only for a
  shared change or a release. In a session with the owner, nothing runs
  unasked beyond the test of what the change touches.
- Write a run's output to a file and read the file: a tail hides the error
  that matters.
- On a machine shared by several sessions, one heavy run at a time, in a
  queue every run waits in; start such a run in the background and read its
  log when it ends.
- `project.md` § Verify names the project's commands, its harness and its
  queue.
