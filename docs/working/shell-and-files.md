# The shell, and writing files on this machine

Windows, Git Bash and PowerShell 5.1, and the agent's own tools. Every rule
here is a file that was silently damaged.

- **A file is changed with the editor tools (Edit / Write), not the shell.**
  Always, even for plain ASCII.
  - The agent's Bash tool **un-escapes backslashes inside a heredoc**, even
    with a quoted `<<'EOF'`: `\\n` in a Python string arrives as a real
    newline, a `\b` in a regexp as byte 0x08, and the check built from it goes
    blind without an error. Code that contains `\` is written with Write — to
    the session scratchpad if it is a script — and then run.
  - PowerShell 5.1 reads UTF-8 without BOM as ANSI: `Get-Content … |
    Set-Content` turns every dash and quote into `вЂ”` and writes the garbage
    back as honest UTF-8. `Set-Content -Encoding utf8` adds a BOM; a BOM in
    `package.json` hides `"type": "module"` and the whole e2e set fails with
    "Cannot use 'import.meta' outside a module".
  - Python in text mode turns CRLF into LF (`newline=''` does not bring it
    back). The working copy is CRLF (`core.autocrlf=true`), and git's diff
    hides it — only the "LF will be replaced by CRLF" warning shows.
  - A script is justified only for one uniform change across dozens of files;
    then read and write in binary, and compare CRLF/LF counts with an
    untouched file afterwards. Quick checks: `git diff | grep 'вЂ|Ð|Â'`
    (mojibake), first bytes `ef bb bf` (BOM), the LF/CRLF warning in
    `git diff --stat`. Undo: `git checkout -- <files>`.
  - A rename across a vocabulary: identifiers first, prose second, and a word
    can be real (three "desk"s were a desk); `\bword\b` misses `word1`.
- **Multi-line text for a native program goes through a file.** A PowerShell
  here-string with double quotes is re-quoted into pieces — git sees parts of
  the message as pathspecs. Commit messages: Write the message to the
  scratchpad, `git commit -F <file>`. A heredoc in Git Bash with quotes,
  apostrophes, backticks or `$` breaks too.
- **PowerShell variables are case-insensitive**: `$s` overwrites `$S`.
- **`cat > a || cat > b <<EOF`** — the first `cat` reads stdin and hangs; no
  fallback chained before a heredoc.
- **Set `cwd` whenever the app or a script spawns a process.** For a foreign
  executable `cwd` decides where it finds its own content (the game must start
  in `bin/`, [the-game.md](the-game.md)); for a node script, modules resolve
  from the file, but the script's own relative paths and a relative script path
  on the command line break. A missing `cwd` almost never fails honestly — it
  corrupts quietly. Working dev tools are not rewritten for the formality.
- **`git` in the game folder needs `-c core.longpaths=true`** for rebase,
  merge and push: paths overflow `MAX_PATH` otherwise.
- **`_tmp/` is the project's untracked scratch space** — one-off scripts,
  dumps, probes. Files a scratch viewer drops into `renderer/` (`_tmp_*`) are
  NOT ignored and are deleted after use.
