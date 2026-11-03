# Investigating: prove it before saying it

- Search what is already written — the project's notes and docs — before
  reading the source, and before saying anything is not there.
- "I could not find it" is never "it is not there". A negative is reported as
  the list of what was searched; a thing a routine does not do lives
  elsewhere — its callers, a table that points at it, the constructor.
- Read a branch from its first line to its last before concluding anything
  about it; a switch is read when every case is followed to its end.
- A value in data means nothing until the code that reads it is found: count
  its readers before calling it unused.
- Fix only what was reported, and prove the cause before fixing it. A guess
  is said as a guess.
- A fix that has to be fixed again means the diagnosis was wrong: go back to
  the source instead of patching the symptom.
- A silent no-op gets a measurement — a debug value, a test that reproduces
  it end to end — not more reasoning.
