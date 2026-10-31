// The way down's stops as this game has them (the rules are src/sim/sites.ts, and the server runs them: server/sites.ts): the
// reader's prompt, the strong room's lock, and the siren for as long as it goes.

import * as THREE from 'three';
import { audio } from '../core/audio';
import type { C2S, S2C } from '../net/protocol';
import { ITEMS } from '../sim/items';
import { SITES, sitePoint, strongDoor, type SitePhase } from '../sim/sites';

export interface SiteHost {
  online(): boolean;
  send(m: C2S): void;
  pressed(code: string): boolean;
  note(text: string, kind?: 'info' | 'warn' | 'good'): void;
  /** the hands at it for so long, and then `done` */
  work(label: string, seconds: number, item: string, done: () => void): void;
  feet(): THREE.Vector3;
  /** a noise that the infected go to */
  noise(x: number, z: number, heard: number): void;
  has(id: string): boolean;
  /** the world's doors: where each stands */
  doorAt(i: number): [number, number] | null;
  doors: number;
}

/** how near a reader the prompt comes, metres */
const NEAR = 2.2;
/** how often the siren sounds, seconds, and how far off anybody is told of it, metres */
const SIREN = 5;
const TOLD = 1500;

const _at = new THREE.Vector3();

export class Sites {
  private state = new Map<string, { phase: SitePhase; until: number }>();
  private doors = new Map<number, string>();
  private found = false;
  private siren = 0;

  constructor(private h: SiteHost) {}

  private phase(id: string): SitePhase {
    return this.state.get(id)?.phase ?? 'idle';
  }

  /** what the server says of one */
  onSite(m: Extract<S2C, { t: 'site' }>) {
    const was = this.phase(m.s), s = SITES[m.s];
    this.state.set(m.s, { phase: m.phase, until: performance.now() + m.left * 1000 });
    if (!s || was === m.phase) return;
    const [x, z] = sitePoint(s, s.reader), me = this.h.feet(), d = Math.hypot(x - me.x, z - me.z);
    if (m.phase === 'alarm' && d < TOLD) this.h.note(`A siren is going at ${s.name}`, 'warn');
    if (m.phase === 'spent' && d < 120) this.h.note(`The locker at ${s.name} has opened`, 'good');
  }

  /** the prompt at a reader, if one is near; and the card goes in if F has just gone down */
  prompt(free: boolean): string | null {
    const me = this.h.feet();
    for (const [id, s] of Object.entries(SITES)) {
      const [x, z] = sitePoint(s, s.reader);
      if (Math.hypot(x - me.x, z - me.z) > NEAR) continue;
      const phase = this.phase(id), name = ITEMS[s.card].name;
      if (phase === 'alarm') return `<small>The alarm is going · ${this.left(id)}</small>`;
      if (phase === 'spent') return `<small>Spent · back on line in ${this.left(id)}</small>`;
      if (!this.h.has(s.card)) return `<small>Locked. A ${name.toLowerCase()} opens it: they are kept down Bunker 17</small>`;
      if (free && this.h.pressed('KeyF')) this.h.work(`Putting in the ${name.toLowerCase()}`, 2, s.card, () => this.h.send({ t: 'site', s: id }));
      return `<kbd>F</kbd>Put in the ${name.toLowerCase()}`;
    }
    return null;
  }

  private left(id: string) {
    const s = Math.max(0, Math.round(((this.state.get(id)?.until ?? 0) - performance.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** is this door a strong room's, and shut to everybody for now? */
  locked(i: number) {
    if (!this.found) {
      this.found = true;
      for (const [id, s] of Object.entries(SITES)) {
        const d = strongDoor(s, this.h.doorAt, this.h.doors);
        if (d >= 0) this.doors.set(d, id);
      }
    }
    const id = this.doors.get(i);
    return !!id && this.h.online() && this.phase(id) === 'idle';
  }

  update(dt: number, cam: THREE.Vector3) {
    this.siren -= dt;
    if (this.siren > 0) return;
    this.siren = SIREN;
    for (const [id, s] of Object.entries(SITES)) {
      if (this.phase(id) !== 'alarm') continue;
      const [x, z] = sitePoint(s, s.reader);
      _at.set(x, cam.y, z);
      audio.alarm(_at, _at.distanceTo(cam), true);
      this.h.noise(x, z, s.heard);
    }
  }

  reset() {
    this.state.clear();
  }
}
