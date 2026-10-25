# Melee (`claude/nifty-kowalevski-c635f1`, 2026-10-25)

Melee weapons remodelled, new knives and their store finishes, and every melee weapon animated in both views. Each line becomes dead once its replacement is judged better on this branch.

- [ ] today's melee models (`hatchet`, `machete`, `crowbar_01`, `baseball_bat`, `shovel`, `pitchfork`, `pitchfork_fp`, `knife`, `fish_knife`) | replaced by the Higgsfield remodels and new knives | - | no item or pack points at them; their manifest entries, LODs, lean copies and `public/assets/models/hi/` files go
- [ ] `MELEE_STYLE` strokes `CUT` and `BACK`, `MELEE` wrist and curl, `animateMelee` in `src/game/weapons.ts` | replaced by the captured swings fitted into the view | - | grep `MELEE_STYLE`
- [ ] the body's `strike` clip (Sword_Attack) for every melee blow, `strikeAt`/`strikeShare` in `src/game/avatar.ts` | replaced by the captured melee clips | - | grep `strikeT`; the infected's claw still uses `strike` until zombies replace it
- [ ] `scripts/melee-paths.mjs` writes every frame of every movement (paths.json ~230 KB in the game's bundle) | replaced by the frames of the cuts used (cuts.ts), three decimals | - | paths.json under 60 KB
- [ ] `_mocaptmp/` (a copy of movement's mocap.mjs, mixamo.mjs, mocap-pose.mjs to build melee.glb meanwhile; not committed) | replaced by movement's committed mocap.mjs with a melee table | - | the folder is gone; melee.glb rebuilt by `node scripts/mocap.mjs` and committed
