// The bot check at the battle royale's door (decision 6, the owner: "yes botcheck but it would be at the door before you
// can even host or find a match or join a lobby"). The open world's own course (src/sim/course.ts) and its judge, dealt
// and judged here as the game server does it (server/index.ts, read and not changed; the numbers of BOT_RULES are read
// from server/botrules.ts, which reads nothing but the host's own setting). Passed, a key is let in for six hours.
// On wherever the host is Render, and wherever BOTCHECK says so ("off": never), as on the game server.
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CIV, CourseJudge, dealCourse } from '../../src/sim/course';
import { RULES, fakeGl } from '../../server/botrules';

const ON = process.env.BOTCHECK ? process.env.BOTCHECK !== 'off' : !!process.env.RENDER;
const HOLDS = 6 * 3600_000, GOES = 4, BUILD = 60_000;
const SIG = (['off', 'watch', 'enforce'].includes(process.env.RANGE_SIG ?? '') ? process.env.RANGE_SIG : 'enforce') as 'off' | 'watch' | 'enforce';
const passed = new Map<string, number>();
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} [br door] ${s}`);

/** whether a key may come straight in */
export const knownAtDoor = (key: string) => !ON || (passed.get(key) ?? 0) > Date.now();

/**
 * Puts a connection on the course. What it says is handed here (`said`, true while the course has it) until it passes
 * (`in` is called) or fails every go (kicked).
 */
export function atDoor(ws: WebSocket, key: string, name: string, letIn: () => void) {
  let r: { judge: CourseJudge; began: number; go: number; dealtAt: number; begun: boolean; said: number; saidAt: number } | null = null;
  let browser: { wd: boolean; gl: string } | null = null;
  const send = (m: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const deal = (go: number) => {
    const bytes = randomBytes(4096);
    let k = 0;
    const course = dealCourse(() => (k + 4 > bytes.length ? Math.random() : bytes.readUInt32LE((k += 4) - 4) / 4294967296), true);
    r = { judge: new CourseJudge(course, SIG, RULES), began: Date.now(), go, dealtAt: Date.now(), begun: false, said: 0, saidAt: 0 };
    send({ t: 'range', turn: course.turn, go, need: course.need, secs: course.secs, lay: { flip: course.flip, shift: course.shift, mover: course.mover, civ: course.civ ? CIV : -1 } });
  };
  const stop = () => {
    clearInterval(sight);
    clearInterval(clock);
    r = null;
  };
  deal(1);
  // the figures in the player's sight, twenty times a second: the game is shown nothing else of them
  const sight = setInterval(() => {
    if (!r || !r.begun || ws.readyState !== 1) return;
    const f = r.judge.reveal(Date.now() - r.began);
    if (f.length) send({ t: 'rfig', f });
  }, 50);
  const clock = setInterval(() => {
    if (!r || ws.readyState !== 1) return stop();
    if (!r.begun && Date.now() - r.dealtAt < BUILD) return;
    if (!r.judge.failed(Date.now() - r.began)) return;
    log(`${name}: ${r.judge.failure} (go ${r.go} of ${GOES})`);
    if (r.go >= GOES) {
      stop();
      send({ t: 'kick', reason: 'The bot check was not passed. Press Find match to try again.' });
      return ws.close();
    }
    deal(r.go + 1);
  }, 500);
  ws.on('close', stop);
  return {
    get on() {
      return !!r;
    },
    said(m: Record<string, unknown>) {
      if (!r) return;
      const now = Date.now();
      if (now - r.saidAt > 1000) (r.saidAt = now), (r.said = 0);
      if (++r.said > 90) return;
      const at = now - r.began;
      if (m.t === 'renv') browser = { wd: m.wd === true, gl: String(m.gl ?? '').slice(0, 160) };
      else if (m.t === 'rgo') {
        if (m.g === r.go && !r.begun && now - r.dealtAt < BUILD) {
          r.begun = true;
          r.began = now;
          r.judge = new CourseJudge(r.judge.course, SIG, RULES);
        }
      } else if ((m.t === 'r' || m.t === 'rs') && m.g !== r.go) return;
      else if (m.t === 'r' && Array.isArray(m.p) && m.p.length === 5) r.judge.seen(Number(m.n), Number(m.p[0]), Number(m.p[1]), Number(m.p[2]), Number(m.p[3]), Number(m.p[4]), at);
      else if (m.t === 'rs' && Array.isArray(m.o) && Array.isArray(m.d) && m.o.length === 3 && m.d.length === 3) {
        const i = r.judge.shot(Number(m.n), (m.o as unknown[]).map(Number), (m.d as unknown[]).map(Number), at);
        if (i >= 0) send({ t: 'rhit', i });
        if (!r.judge.passed) return;
        // (a browser that a program drives, or that draws with no graphics card, has not passed: as on the game server)
        if (!browser || browser.wd || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(browser.gl) || fakeGl(browser.gl)) {
          log(`${name} shot the course in a browser that ${!browser ? 'said nothing of itself' : browser.wd ? 'a program drives' : `draws with "${browser.gl}"`}: turned away`);
          stop();
          send({ t: 'kick', reason: 'The bot check was not passed: this browser is being driven by a program, or has no graphics card to draw with.' });
          return ws.close();
        }
        log(`${name} passed the bot check (go ${r.go})`);
        stop();
        passed.set(key, now + HOLDS);
        if (passed.size > 20000) for (const [k, until] of passed) if (until < now) passed.delete(k);
        send({ t: 'rpass' });
        letIn();
      }
    },
  };
}
