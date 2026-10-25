# The infected remade (`claude/dreamy-nightingale-19fdcc`)

The owner, 2026-10-25: "our zombies models need to be completley redone and our zombies animations and rigging is subject to be redone now as well". Twelve kinds from Higgsfield (scripts/infected.mjs, src/game/infected-kinds.ts).

- [x] `public/assets/characters/zombie_male.glb`, `zombie_female.glb`, `zombie_cop.glb` | replaced by the twelve `zombie_<kind>.glb` (`zombie_hazmat.glb` is remade in place) | (this commit) | `grep -rn "zombie_male\|zombie_female\|zombie_cop" src scripts test` finds only scripts/zombies.mjs
- [x] `scripts/zombies.mjs` (the old build: the cop's skeleton, the two statues, the toxic idle) | replaced by `scripts/infected.mjs` | (this commit) | nothing runs it; the comments that name it in `scripts/build-character.mjs` (line 57) and `scripts/mixamo.mjs` (line 3) to be pointed at infected.mjs
- [x] the old procedural gait in `src/game/avatar/sick.ts` (the limp, the bent carried arm and the full stoop: everything behind `own`) and `SICK_GAIT.pace` in `src/game/avatar.ts` | replaced by the infected's motion capture (`src/game/infected-moves.ts`, `moves-infected.glb`) | (this commit) | every Avatar given `sick` is given `zombieMoves` first (Infected.load, menu-scenes.ts): grep `sick = {`
