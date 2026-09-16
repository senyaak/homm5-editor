# The batch's eyes on one editor process — see tools/rmg-batch.ts.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/rmg-batch-watch.ps1 -ProcessId <pid>
#
# One job, ten times a second, until the process is gone: KILL the process
# when its top window is the CRT's abort box — the generator's abort()
# otherwise sits there waiting for OK until the batch's timeout. Prints one
# word on stdout when it acted: `aborted`.
#
# It does NOT hide the editor's frame, though it once did: with the frame
# hidden the extension's "waiting for the editor to come up" never ends —
# the readiness it waits for is the visible window — and every order timed
# out. The frame shows itself from the application's own code, so a hidden
# STARTUPINFO does not reach it either. It takes the foreground once a map;
# that is the price of the batch for now.
param([Parameter(Mandatory = $true)][int]$ProcessId)

while ($true) {
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $p.Refresh()
  $h = $p.MainWindowHandle
  if ($h -ne [IntPtr]::Zero) {
    if ($p.MainWindowTitle -match 'Runtime Library|Runtime Error') {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
      Write-Output 'aborted'
      break
    }
  }
  Start-Sleep -Milliseconds 100
}
