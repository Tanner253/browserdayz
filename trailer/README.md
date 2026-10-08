# The ZONA trailer

Every frame is the real game. It is put on a clock that only moves when the film script
says so, advanced one sixtieth of a second, photographed, and advanced again. The sound is
not recorded: every sound the game asks for is logged with its time, and the soundtrack
(those sounds plus a score written in code) is rendered afterwards.

## Re-render

The dev server has to be running (`npm run dev`), and nothing in `src/`, `trailer/` or
`trailer.html` may be edited while a take runs: the dev server would reload the page.

```bash
npm run film
```

That writes `trailer/out/zona-trailer.mp4` (1920x1080, 60 fps, H.264 + AAC, 75 s) and
`zona-trailer-first-frame.jpg`. A full take is about 16 minutes on the RTX 3070 Ti laptop.

## Drafts

```bash
npm run film -- --draft --no-video --stills 15              # the whole cut as contact sheets, about 3 minutes
npm run film -- --draft --from 18.75 --to 30 --out fight    # one stretch, half size, 30 fps, with sound
npm run film -- --draft --no-video --twice --from 19.5 --to 21.5   # film a stretch twice and compare the takes
node trailer/probe.mjs trailer/out/zona-trailer.mp4         # what is in the file
```

`--stills N` keeps every Nth frame and lays them out twenty to a sheet, each stamped with
its time. Look at the sheets before watching anything.

## Where things are

| File | What it is |
|---|---|
| `trailer.html` | the stage page: the game, with the clock loaded first and the director after |
| `trailer/clock.js` | virtual time, virtual timers and animation frames, seeded `Math.random` |
| `src/trailer/director.ts` | stages the offline match, runs the shot list a frame at a time, logs sound, encodes |
| `src/trailer/shots.ts` | the trailer itself: every shot, cue, camera and title, on a 128 BPM grid (a bar is 1.875 s) |
| `src/trailer/music.ts` | the score: one row per bar |
| `src/trailer/trailer.css` | titles, letterbox, the money |
| `scripts/film.mjs` | starts a headless Chrome, steps the page, takes the pictures, writes the file |

To change a caption, edit the `titles` of its shot in `shots.ts` and re-render. To move a
cut, change the bar numbers in its `add(start, length, …)`; keep them on the grid and the
music still lands on it. A shot marked `chain: true` carries on from the one before it.

## What is the game and what is the film

The game: the world, the bodies, every animation, bullets and where they land, blood,
wounds, deaths, the inventory, the dog tag and its clock, the HUD, every sound effect.

The film's own: the people are the game's player bodies with a small brain written for the
trailer (face the enemy, shoot when the weapon allows, miss sometimes); the cameras; the
titles; the money falling when the tag is cashed in (marked "in development"); a drawn
bullet and trail for the one shot that follows the bullet (the game does not draw its
bullets); the tag's thirty minutes run in under four seconds.

## The second trailer (the update)

`src/trailer/shots2.ts` is a second cut with none of the first one's scenes: a fist fight, a
raid on the police station, a supply drop and the grenade that ends the fight over it, a tag
taken and the map giving its carrier away, a cabin door held until the clock runs out; then
two facts, the list of what is new, what is coming, eight quick endings and the name.

```bash
npm run character -- --emotes     # once: writes trailer/emotes.glb (the dancing and the gestures)
npm run film -- --cut 2           # trailer/out/zona-trailer-2.mp4, about 14 minutes
npm run film -- --cut 2 --draft --no-video --stills 12 --out d    # the cut as contact sheets, about 3 minutes
```

`--cut 2` loads `trailer.html?cut=2`; without it everything above still films the first
trailer. The score is the same band on the same grid with its own rows, in E minor
(`ARRANGEMENT` at the top of `shots2.ts`).

The game in it: everything the first trailer lists, and also the fists, the doors, the
inventory answering a real drag, the supply drop with its smoke and its mark on the map, the
grenade and its blast, the kill feed, the leaderboard, the map ping on whoever carries a tag,
the tag's clock.

The film's own, besides cameras, titles and the money (still marked "in development"):

- The five at the crate are already hurt from fighting each other when the grenade lands.
  At full health the game's grenade kills inside about two and a half metres; these five
  stand within that of where it lands, and are set to 60 health as well.
- The grenade goes off when the film says (on the bar line), not when its four seconds are up.
- The leaderboard's other names and scores, and the hero's name (Sable).
- The tag's thirty minutes run in a few seconds, twice.
- A lamp in the cabin (`lamp`, `handLamp`): the room has one small window.
- Everything under COMING SOON: the dancing and the hand gestures are clips from the same
  free animation library the character's own movements come from, played on the game's
  bodies; the speech bubbles are drawn by the film. Neither is in the game.
- The queue outside the police station is a picture of the server's waiting line, not a
  thing players stand in.
