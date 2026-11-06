# November loading screen (first snow)

- [x] (deleted with it) the blood on the loading screen's letters (`Splash`, `FEET`, `FIRST`, drips in `src/ui/loading-fx.ts`; `.load-blood`, `.ld-*` in `src/ui/style.css`) | replaced by the frost, `src/ui/loading-frost.ts` | this commit | `grep -rn "load-blood\|ld-run" src index.html`
- [x] (deleted with it) October's pumpkins: `src/ui/loading-pumpkins.ts`, `scripts/halloween-sprites.mjs`, `public/brand/halloween-*.webp`, `.load-pumpkins`/`.lp*` CSS, the model's line in CREDITS.md; the bars' season set (`SEASON = null` in `scripts/live-mark.mjs`) | replaced by the mark alone | this commit | `grep -rn "halloween-\|loading-pumpkins" src scripts public index.html`
- [ ] `src/dev/loading-film.ts`, `scripts/loading-film.mjs`: the Halloween loading film's tool (its pumpkin click finds nothing now) | nothing | this commit | keep only if the films want the loading screen again
