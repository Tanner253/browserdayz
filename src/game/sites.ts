// The way down's stops as this game has them (the rules are src/sim/sites.ts, and the server runs them: server/sites.ts): the
// prompts at readers, gates and rides, the strong room's lock and the plant on Level 2. A pass is
// scanned, not put in: see scripts/clearance-pass.mjs.

import { STATIONS, stationAt, untilAt } from '../sim/train-line';
import * as THREE from 'three';
import { audio } from '../core/audio';
import type { C2S, S2C } from '../net/protocol';
import type { Place } from '../sim/bunker';
import { ITEMS } from '../sim/items';
import { GATES, RIDES, SITES, atSpot, sitePoint, siteSpot, spotAt, strongDoor, type SitePhase, PASS_FROM } from '../sim/sites';

export interface SiteHost {
  online(): boolean;
  send(m: C2S): void;
  pressed(code: string): boolean;
  note(text: string, kind?: 'info' | 'warn' | 'good'): void;
  /** the hands at it for so long, and then `done` */
  work(label: string, seconds: number, item: string, done: () => void): void;
  feet(): THREE.Vector3;
  /** a noise that the infected go to */
  noise(x: number, z: number, heard: number, y?: number): void;
  has(id: string): boolean;
  /** the world's doors: where each stands */
  doorAt(i: number): [number, number] | null;
  doors: number;
  /** where the bunker is */
  bunker(): Place | null;
  /** Level 2's plant, and the door at the passage's far end */
  power(on: boolean): void;
  sealed(open: boolean): void;
  stationDoor(open: boolean): void;
  /** what the bolt-hole's hatch says to whoever stands over it */
  bolted(): string | null;
  /** the goods lift, for whoever is in its cab */
  cab(): { stop: number; left: number } | null;
  scene: THREE.Scene;
  /** the train now: where it stands (-1 on the way), for how long, where it is bound, the shared clock, and whether this body is aboard */
  line(): { stop: number; left: number; bound: number; t: number; aboard: boolean };
  /** what lies at a site, stood where it lies */
  stand(kind: string, x: number, y: number, z: number): Promise<THREE.Object3D>;
}

/** how near a reader the prompt comes, metres */
const NEAR = 2.2;
/** how often the infected are told where a place going off is, seconds; and how far off anybody is told of it, metres */
const HEARD = 5;
const TOLD = 1500;

const _at = new THREE.Vector3();

const _card = new THREE.Vector3(), _way = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Sites {
  private swept = 0;
  private state = new Map<string, { phase: SitePhase; until: number; fuel: boolean; done: number[] }>();
  private gates = new Map<string, { open: boolean; until: number }>();
  private doors = new Map<number, string>();
  private found = false;
  private heard = 0;
  /** what lies at each site, once it has been fetched */
  private lying = new Map<string, THREE.Object3D | null>();

  constructor(private h: SiteHost) {}

  private phase(id: string): SitePhase {
    return this.state.get(id)?.phase ?? 'idle';
  }

  /** what the server says of one */
  onSite(m: Extract<S2C, { t: 'site' }>) {
    const was = this.phase(m.s), s = SITES[m.s], before = this.state.get(m.s)?.done.length ?? 0;
    this.state.set(m.s, { phase: m.phase, until: performance.now() + m.left * 1000, fuel: !!m.fuel, done: m.done ?? [] });
    if (s?.steps && m.phase === 'alarm') {
      const me = this.h.feet(), [sx, sz] = sitePoint(s, s.reader), done = m.done?.length ?? 0, n = s.steps.at.length;
      if (Math.hypot(sx - me.x, sz - me.z) < 300) {
        if (was !== 'alarm') this.h.note(`${n} ${s.steps.name} to turn before the time is up. They are round the place`, 'warn');
        else if (done > before) this.h.note(done < n ? `${done} of ${n} ${s.steps.name}` : `All ${n} ${s.steps.name}: the strong room is open`, 'good');
      }
    }
    if (s?.level === 2) this.h.power(m.phase !== 'idle');
    if (s?.fuel) {
      const had = this.lying.get(m.s);
      if (had) had.visible = !!m.fuel;
      else if (had === undefined) {
        this.lying.set(m.s, null);
        const [x, y, z] = spotAt(siteSpot(s, s.fuel.at), this.h.bunker());
        void this.h.stand(ITEMS[s.fuel.item].model, x, y ?? 0, z).then((o) => {
          o.visible = this.state.get(m.s)?.fuel ?? false;
          this.lying.set(m.s, o);
        });
      }
    }
    if (!s || was === m.phase) return;
    const [x, z] = sitePoint(s, s.reader), me = this.h.feet(), d = Math.hypot(x - me.x, z - me.z);
    // (out in the world a flare goes up, and that is all that is heard of it. Told of as it happens, not to somebody who comes in later)
    if (was === 'idle' && m.phase !== 'idle' && !s.level && d < TOLD && m.left + 5 > (m.phase === 'spent' ? s.again : s.hold)) this.h.note(`A flare has gone up over ${s.name}`, 'warn');
    if (m.phase === 'alarm' && s.level && !s.quiet) {
      const [, y] = spotAt(siteSpot(s, s.reader), this.h.bunker());
      audio.alarm(_at.set(x, y ?? me.y, z), d, true);
    }
    if (m.phase === 'alarm' && s.quiet && d < 90) this.h.note('The plant turns over and the lamps come up. Everything down here heard it', 'warn');
    if (m.phase === 'spent' && d < 120 && s.level) this.h.note(`The locker at ${s.name} has opened`, 'good');
  }

  /** A pass shown to a reader: its lamp comes on red and a beam sweeps the card held up to it, a beep, and when the server has it the lamp goes green (the owner, 2026-10-31). */
  private scanFx: { at: THREE.Vector3; t: number; secs: number; green: number } | null = null;
  private beam: THREE.Mesh | null = null;
  private lamp: THREE.Mesh | null = null;

  private scanning(spot: Parameters<typeof atSpot>[0], secs: number) {
    const [x, y, z] = spotAt(spot, this.h.bunker()), me = this.h.feet();
    this.beam ??= new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lamp ??= new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.h.scene.add(this.beam, this.lamp);
    this.scanFx = { at: new THREE.Vector3(x, (y ?? me.y) + 1.22, z), t: 0, secs, green: 0 };
    this.lamp.position.copy(this.scanFx.at);
    (this.lamp.material as THREE.MeshBasicMaterial).color.set(0xff2a1a);
    this.beam.visible = true;
  }

  /** once a frame, with the prompt */
  private sweep(dt: number) {
    const f = this.scanFx, beam = this.beam, lamp = this.lamp;
    if (!f || !beam || !lamp) return;
    f.t += dt;
    const me = this.h.feet();
    if (f.green) {
      f.green -= dt;
      if (f.green <= 0) {
        this.h.scene.remove(beam, lamp);
        this.scanFx = null;
      }
      return;
    }
    if (f.t > f.secs + 0.4 || Math.hypot(me.x - f.at.x, me.z - f.at.z) > 3) {
      this.h.scene.remove(beam, lamp);
      this.scanFx = null;
      return;
    }
    const card = _card.set(me.x, me.y + 1.15 + Math.sin(f.t * 7) * 0.16, me.z).lerp(f.at, 0.2), len = card.distanceTo(f.at);
    beam.position.copy(card).add(f.at).multiplyScalar(0.5);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(_up, _way.copy(f.at).sub(card).normalize());
  }

  /** the pass went through */
  private passed() {
    const f = this.scanFx;
    audio.click(2300, 0.45, 0.07, 0);
    audio.click(3100, 0.45, 0.09, 0.1);
    if (!f || !this.lamp || !this.beam) return;
    f.green = 2.6;
    this.beam.visible = false;
    (this.lamp.material as THREE.MeshBasicMaterial).color.set(0x35ff6a);
  }

  /** what the server says of a gate */
  onGate(m: Extract<S2C, { t: 'gate' }>) {
    this.gates.set(m.g, { open: m.open, until: performance.now() + m.left * 1000 });
    if (m.g === 'lift') this.h.sealed(m.open);
    if (m.g === 'train') this.h.stationDoor(m.open);
  }

  private at(spot: Parameters<typeof atSpot>[0], reach = NEAR) {
    const me = this.h.feet();
    return atSpot(spot, this.h.bunker(), me.x, me.y, me.z, reach);
  }

  /** the prompt at a reader, a gate or a ride, if one is near; and it is done if F has just gone down */
  prompt(free: boolean): string | null {
    const go = free && this.h.pressed('KeyF');
    const stamp = performance.now(), dt = Math.min(0.1, (stamp - this.swept) / 1000);
    this.swept = stamp;
    this.sweep(dt);
    for (const [id, s] of Object.entries(SITES)) {
      if (s.steps && this.phase(id) === 'alarm') {
        const k = s.steps.at.findIndex((at, n) => !this.state.get(id)?.done.includes(n) && this.at(siteSpot(s, at), 1.9));
        if (k >= 0) {
          if (go) this.h.work(s.steps.doing, s.steps.secs, '', () => this.h.send({ t: 'sitestep', s: id, k }));
          return `<kbd>F</kbd>${s.steps.use}`;
        }
      }
      if (s.fuel && this.at(siteSpot(s, s.fuel.at)) && this.state.get(id)?.fuel) {
        if (go) this.h.send({ t: 'sitefuel', s: id });
        return `<kbd>F</kbd>Take the ${ITEMS[s.fuel.item].name.toLowerCase()}`;
      }
      if (!this.at(siteSpot(s, s.reader), s.level ? 2.6 : NEAR)) continue;
      const phase = this.phase(id), name = s.card ? ITEMS[s.card].name.toLowerCase() : '';
      if (phase === 'alarm') return `<small>${s.quiet ? 'It is running' : s.steps ? `${s.steps.name[0].toUpperCase()}${s.steps.name.slice(1)} first` : 'It is running'} · ${this.left(this.state.get(id)?.until)}</small>`;
      if (phase === 'spent') return `<small>Open · shuts in ${this.left(this.state.get(id)?.until)}</small>`;
      if (s.card && !this.h.has(s.card)) return `<small>${s.what?.none ?? `Locked. It scans a ${name}, ${PASS_FROM[s.card]}`}</small>`;
      if (go) {
        if (!s.what) this.scanning(siteSpot(s, s.reader), 2);
        this.h.work(s.what?.doing ?? `Scanning the ${name}`, s.what ? (s.card ? 6 : 3) : 2, s.card, () => {
          if (!s.what) this.passed();
          this.h.send({ t: 'site', s: id });
        });
      }
      return `<kbd>F</kbd>${s.what?.use ?? `Scan the ${name}`}`;
    }
    for (const [id, g] of Object.entries(GATES)) {
      if (!this.at(g.at, 1.8) && !(g.also && this.at(g.also, 1.8))) continue;
      const state = this.gates.get(id), name = g.card ? ITEMS[g.card].name.toLowerCase() : '';
      if (state?.open) return `<small>Open · ${this.left(state.until)}</small>`;
      if (!g.card) {
        if (go) this.h.send({ t: 'gate', g: id });
        return `<kbd>F</kbd>${g.use}`;
      }
      if (!this.h.has(g.card)) return `<small>Locked. It scans a ${name}, ${PASS_FROM[g.card]}</small>`;
      if (go) {
        this.scanning(this.at(g.at, 1.8) ? g.at : g.also!, 2);
        this.h.work(`Scanning the ${name}`, 2, g.card, () => {
          this.passed();
          this.h.send({ t: 'gate', g: id });
        });
      }
      return `<kbd>F</kbd>Scan the ${name}`;
    }
    for (const [id, w] of Object.entries(RIDES)) {
      if (!this.at(w.from, 1.8) || (w.gate && !this.gates.get(w.gate)?.open) || (w.unless && this.gates.get(w.unless)?.open)) continue;
      if (go) this.h.work(w.doing, w.secs, '', () => this.h.send({ t: 'ride', w: id }));
      return `<kbd>F</kbd>${w.label}`;
    }
    const bolted = this.h.bolted();
    if (bolted) return bolted;
    // (you always know when the train is, on a platform and aboard it; and the lift, in its cab)
    const cab = this.h.cab();
    if (cab) return cab.stop ? `<small>The lift goes ${cab.stop === 1 ? 'down' : 'up'} in ${Math.ceil(cab.left)} s</small>` : `<small>Level ${cab.left < 0 ? 1 : 2}</small>`;
    const me = this.h.feet(), line = this.h.line(), st = stationAt(me.x, me.y, me.z), clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    if (line.aboard) return line.stop >= 0 ? `<small>${STATIONS[line.stop].name} · leaves in ${clock(line.left)}</small>` : `<small>Next stop ${STATIONS[line.bound].name} · ${clock(line.left)}</small>`;
    if (st) return line.stop === st.stop ? `<small>The train is in · it leaves in ${clock(line.left)}</small>` : `<small>Next train in ${clock(untilAt(st.stop, line.t))}</small>`;
    return null;
  }

  /** has a site's time run out, its room open? */
  spent(id: string) {
    return this.phase(id) === 'spent';
  }

  /** is a site's alarm going? */
  going(id: string) {
    return this.phase(id) === 'alarm';
  }

  /** is this gate open now? */
  gateOpen(id: string) {
    return !!this.gates.get(id)?.open;
  }

  private left(until = 0) {
    const s = Math.max(0, Math.round((until - performance.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** is this door a strong room's, and shut to everybody for now? */
  locked(i: number) {
    if (!this.found) {
      this.found = true;
      for (const [id, s] of Object.entries(SITES)) {
        if (s.level) continue;
        const d = strongDoor(s, this.h.doorAt, this.h.doors);
        if (d >= 0) this.doors.set(d, id);
      }
    }
    const id = this.doors.get(i);
    return !!id && this.h.online() && this.phase(id) === 'idle';
  }

  update(dt: number) {
    this.heard -= dt;
    if (this.heard > 0) return;
    this.heard = HEARD;
    for (const [id, s] of Object.entries(SITES)) {
      if (this.phase(id) !== 'alarm') continue;
      const [x, z] = sitePoint(s, s.reader);
      const [, y] = spotAt(siteSpot(s, s.reader), this.h.bunker());
      this.h.noise(x, z, s.heard, y ?? undefined);
    }
  }

  reset() {
    this.state.clear();
    this.gates.clear();
  }
}
