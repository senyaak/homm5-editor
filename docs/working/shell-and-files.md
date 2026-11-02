# The shell, and writing files on this machine

Windows, Git Bash, PowerShell 5.1, and the agent's tools.

- Change files with the editor tools (Edit / Write), never with shell
  rewrites — even plain ASCII.
- Text containing `\` never goes through a Bash heredoc (the tool un-escapes
  backslashes even under `<<'EOF'`). Write such a script to the scratchpad with
  Write, then run it.
- Never `Get-Content | Set-Content` in PowerShell 5.1 (it mangles UTF-8 and
  adds a BOM; a BOM in `package.json` breaks `"type": "module"`).
- Never rewrite files with Python in text mode (CRLF becomes LF; the working
  copy is CRLF).
- A script editing dozens of files: binary read/write, then compare CRLF/LF
  counts with an untouched file. Checks: mojibake `вЂ|Ð|Â` in `git diff`, BOM
  `ef bb bf`, the LF/CRLF warning in `git diff --stat`. Undo with
  `git checkout -- <files>`.
- Renaming a vocabulary: identifiers first, then prose; check each hit.
- Multi-line text for a native program goes through a file: commit messages
  are written to the scratchpad and committed with `git commit -F <file>`.
- PowerShell variables are case-insensitive (`$s` overwrites `$S`).
- Never chain a fallback before a heredoc (`cat > a || cat > b <<EOF` hangs).
- Code that spawns a process sets `cwd` explicitly (the game: `<game>/bin`).
- `git` in the game folder: `-c core.longpaths=true` for rebase, merge, push.
- `_tmp/` is the untracked scratch space. Scratch files put in `renderer/`
  (`_tmp_*`) are not ignored: delete them after use.
