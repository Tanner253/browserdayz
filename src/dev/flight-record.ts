// A play session recorded to be played again, exactly, by the tests (development builds only, never shipped). The
// owner, 2026-10-15: "I am creating the ideal FPS test and i want you to replicate/replay it EXACTLY yourself in the
// real game for the metrics tests data retrieval" (on foot, eating, doors, flying: all of it), begun the same way
// every time: "spawn me in the village next to a helicopter" (played alone at ?at=kamenka, see src/dev/harness.ts).
//
// F8 starts it and F8 again stops it, and it is saved to the Downloads as zona-run-<time>.json:
//   - at the start: the page's address, the graphics settings, the window's size and the screen's density;
//   - every frame: where the eye is and which way it looks, the player's feet, stance, what is in the hands, the
//     hour, and the helicopter or car ridden (where its body is, turned how, going how fast);
//   - every input, to the frame: keys, mouse buttons and wheel, and the pointer over menus and the inventory.
// assets-src/_wf/me/replay.mjs plays it again in the headless game and times every frame of it: the inputs as they
// were given, and the place and look of every frame held to the recording (inputs alone drift at another frame rate).
import type { Game } from '../game/game';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const F8 = 'F8';

export function installFlightRecorder(game: Game) {
  const g = game as Any;
  let run: Any = null, t0 = 0;
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;padding:6px 14px;font:600 15px monospace;color:#fff;background:rgba(160,20,20,.85);border-radius:4px;display:none;pointer-events:none';
  document.body.appendChild(badge);
  const now = () => +(performance.now() - t0).toFixed(1);
  const r2 = (n: number) => Math.round(n * 1000) / 1000;
  /** what is ridden now: its body's place, turn and speed */
  const ride = () => {
    const rd = g.garage?.ride;
    if (!rd) return null;
    const b = rd.jeep.body, p = b.translation(), q = b.rotation(), v = b.linvel(), w = b.angvel();
    return { s: [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map(r2), v: [v.x, v.y, v.z, w.x, w.y, w.z].map(r2) };
  };
  const frameOf = () => {
    const p = g.player, cam = g.s.r.camera;
    return {
      t: now(),
      eye: [cam.position.x, cam.position.y, cam.position.z].map(r2),
      feet: [p.pos.x, p.pos.y, p.pos.z].map(r2),
      yaw: r2(p.yaw), pitch: r2(p.pitch),
      st: (p.crouched ? 1 : 0) | (p.prone ? 2 : 0) | (p.fly ? 4 : 0),
      lk: g.input.locked ? 1 : 0,
      hand: g.weapons?.equippedItem?.id ?? g.inHand?.id ?? null,
      hour: r2(g.hourNow?.() ?? 0),
      ride: ride(),
    };
  };
  // ------------------------------------------------------------ every frame, as the game draws it
  const frame = g.frame.bind(g);
  g.frame = (t: number) => {
    frame(t);
    if (run) {
      run.frames.push(frameOf());
      const s = (performance.now() - t0) / 1000;
      badge.textContent = `● REC ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')} · F8 to stop`;
    }
  };
  // ------------------------------------------------------------ every input
  const ev = (e: Any) => run?.events.push({ t: now(), ...e });
  const opts = { capture: true };
  // (Typing into the chat box is not the game's keys: what is said is kept as said, below. Nor are the keys that
  // open it: played again, "/spawn heli" would be a strafe, a horn and a light.)
  const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '') || ['Enter', 'NumpadEnter', 'Slash', 'NumpadDivide'].includes(e.code);
  window.addEventListener('keydown', (e) => { if (e.code !== F8 && !e.repeat && !typing(e)) ev({ k: 'd', code: e.code, key: e.key }); }, opts);
  window.addEventListener('keyup', (e) => { if (e.code !== F8 && !typing(e)) ev({ k: 'u', code: e.code, key: e.key }); }, opts);
  window.addEventListener('mousedown', (e) => ev({ m: 'd', b: e.button, x: e.clientX, y: e.clientY, lock: !!document.pointerLockElement }), opts);
  window.addEventListener('mouseup', (e) => ev({ m: 'u', b: e.button, x: e.clientX, y: e.clientY, lock: !!document.pointerLockElement }), opts);
  window.addEventListener('dblclick', (e) => ev({ m: 'dbl', x: e.clientX, y: e.clientY }), opts);
  window.addEventListener('contextmenu', (e) => ev({ m: 'ctx', x: e.clientX, y: e.clientY }), opts);
  window.addEventListener('wheel', (e) => ev({ w: Math.sign(e.deltaY), x: e.clientX, y: e.clientY, lock: !!document.pointerLockElement }), { capture: true, passive: true });
  // (the pointer over menus and the inventory, once a frame at most: where it is on a locked screen is the view, kept above)
  let lastMove = 0;
  window.addEventListener('mousemove', (e) => {
    if (!run || document.pointerLockElement) return;
    const t = performance.now();
    if (t - lastMove < 15) return;
    lastMove = t;
    ev({ mv: [e.clientX, e.clientY] });
  }, opts);
  // ------------------------------------------------------------ F8
  const start = () => {
    t0 = performance.now();
    let gfx: unknown = null;
    try { gfx = JSON.parse(localStorage.getItem('zona.gfx') ?? 'null'); } catch { /* none kept */ }
    run = {
      v: 3,
      at: new Date().toISOString(),
      url: location.search,
      win: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      gfx,
      online: !!g.online,
      start: frameOf(),
      frames: [],
      events: [],
    };
    badge.style.display = '';
  };
  const stop = () => {
    const data = run;
    run = null;
    badge.style.display = 'none';
    if (!data || data.frames.length < 3) return;
    data.end = now();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `zona-run-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== F8 || e.repeat) return;
    e.preventDefault();
    if (run) stop();
    else start();
  }, opts);
}
