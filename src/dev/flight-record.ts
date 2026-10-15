// A flight recorded to be flown again by the tests (development builds only). The owner, 2026-10-15: "for tests you
// should fly around in a helicopter around the map at a low enough level to load all the items ... if you let me run a
// flight that you could replicate for your test i could get us an ideal in game test flight path".
//
// F8 starts it and F8 again stops it: where the eye was and which way it looked, twenty times a second, and whether a
// vehicle was being ridden, saved to the Downloads as zona-flight-<time>.json. assets-src/_wf/me/flight-replay.js flies
// it again in the headless game and times every frame of it.
import type { Game } from '../game/game';

const HZ = 20;

export function installFlightRecorder(game: Game) {
  const g = game as unknown as { s: { r: { camera: { position: { x: number; y: number; z: number }; getWorldDirection(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } } } }; garage?: { ride?: unknown } };
  let rows: number[][] | null = null, t0 = 0, timer = 0;
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;padding:6px 14px;font:600 15px monospace;color:#fff;background:rgba(160,20,20,.85);border-radius:4px;display:none;pointer-events:none';
  document.body.appendChild(badge);
  const dir = { x: 0, y: 0, z: 0 };
  const sample = () => {
    if (!rows) return;
    const cam = g.s.r.camera;
    cam.getWorldDirection(dir);
    const t = (performance.now() - t0) / 1000;
    rows.push([+t.toFixed(3), +cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2), +Math.atan2(-dir.x, -dir.z).toFixed(4), +Math.asin(Math.max(-1, Math.min(1, dir.y))).toFixed(4), g.garage?.ride ? 1 : 0]);
    badge.textContent = `● REC ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} · F8 to stop`;
  };
  const save = (data: number[][]) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify({ v: 1, hz: HZ, at: new Date().toISOString(), rows: data })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zona-flight-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F8' || e.repeat) return;
    e.preventDefault();
    if (!rows) {
      rows = [];
      t0 = performance.now();
      badge.style.display = '';
      timer = window.setInterval(sample, 1000 / HZ);
      sample();
    } else {
      window.clearInterval(timer);
      const data = rows;
      rows = null;
      badge.style.display = 'none';
      if (data.length > 2) save(data);
    }
  });
}
