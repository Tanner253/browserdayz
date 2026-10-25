# The cleanup catalog

The owner, 2026-10-25: "keep a catalog of what is being replaced and what needs to be cleaned and scruibbbed from the codebase so we dont have speghetti code bloat after the fact".

Every path keeps one file here, `docs/cleanup/<path>.md`, so branches never fight over one list. Each entry is one line:

`- [ ] <what is now dead: file, function, model, asset, setting> | replaced by <what> | <commit> | <how to check nothing still uses it>`

- Write an entry in the same commit that makes something dead.
- Tick it (`[x]`) only when it is deleted.
- Before a release the navigator works through every file: deletes what is listed, re-runs the type-check and the tests that cover it, and moves ticked lines to the bottom.
- A stand-in model, a fallback branch kept "just in case", or an old code path beside its replacement all count. Nothing stays for safety once its replacement is judged better and live on the branch.
