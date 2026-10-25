# Cleanup catalog: the animation path (motion capture), branch claude/gracious-merkle-a668ca

What the motion capture replaced, and what is now dead or only a stand-in. The owner, 2026-10-25: "keep a catalog of
what is being replaced and what needs to be cleaned and scrubbed from the codebase so we dont have speghetti code bloat".

## Replaced for survivors, still used by the infected (keep while the infected use them)
- The old stride clock in src/game/avatar/update.ts (STRIDES, `phase`/`halves`/`plantWas`, POSE.pace/offset/plant,
  the hip `twist` toward the way of travel and `backing`): survivors step on Gait (gait.ts). The infected's files have
  their own walk and run and still go this way.
- `strike` (the Quaternius blow): survivors strike with the mocap `slash`; the infected's claw lays `strike`.
- DEATH_REST (pose.ts): survivors' bodies are searched where MOCAP_REST says (deeds.ts); the infected keep DEATH_REST.

## Dead for survivors and for everybody: to delete
(Done already: the procedural limp's hip drop, deleted from update.ts with this path; only survivors limp.)
- In survivor.glb (scripts/build-character.mjs, the survivors path's): the clips `walk`, `run`, `crouchWalk`, `idle`,
  `death`, `deathFront`, `deathSide`, `hit`, `hitHead`, `strike` are no longer played on a survivor (their weights go to
  the motion capture). make.ts still requires every name in CLIPS; to drop them from the file, make the requirement
  the infected's only (`file.startsWith('zombie')`) and keep `crouchIdle`, the jumps, `sit`, `dance`, `armed`,
  `proneDown`, `crawl`, which survivors still play.
- `deathFront` and `deathSide` built from poses in build-character.mjs, for the survivor only (the infected have their own).

## Stand-ins until a file has come (keep, or delete by loading the file up front)
- update.ts: the procedural eat/drink reach (used when `deeds.get('drink')` is null) and the old idle/death/hit clips
  (used when `deeds` is missing, a body made before moves.glb could load: not expected).
- weapons.ts: the hand-made swing (`wind`/`strike`/`recover`), the punch's `wind`/`out` curves and the eat/drink cosine,
  used until src/game/avatar/hands.json has come (held-mocap.ts), and in development with `globalThis.__oldHands`.
  If hands.json is imported statically instead (73 KB in the game's own bundle), these three go.
- gestures.ts / update.ts: a punch's shape before the jab paths have come (same as above).

## Development only (not in the build, keep or drop at will)
- src/dev/sandbox.ts `&clip=a,b` one clip per file; src/dev/harness.ts lineup `limp` and the gait phase.
- progress/anim-tools/* (git-excluded): candidates, sheets, game shots, the online walker.
- The mocap sources not used by moves.glb (assets-src, git-ignored): Casual_Walk, Run_03, run_fast_3,
  Lean_Forward_Sprint, Walk_Backward_with_Gun(_1), Walk_Forward/Backward_While_Shooting, Walk_Fight_*,
  Standard_Forward_Charge, Combat_Stance, Idle, Idle_03, Idle_3, Idle_4, Dead, dying_backwards, Knock_Down,
  Shot_in_the_Back_and_Fall, Limping_Walk, Limping_Walk_2, Injured_Walk, Crouch_Walk_Left_with_Gun,
  Over_Shoulder_Throw, Attack, Quick_Walk. Kept as sources; nothing in the game reads them.
