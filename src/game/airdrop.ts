// The helicopter that brings a supply drop, and the crate coming down under its canopy: what is seen of them and
// what is heard (2026-10-13). Where each is at any moment is not decided here: src/sim/airdrop.ts works it out
// from the one line of numbers the server says a flight in, so every game draws the same thing in the same place.
//
// `Helicopter` is a thing of its own with a place, a heading, a speed, a lean into its turns, a nose that goes down
// as it gathers way, rotors that turn, and ONE place where a model is hung (`Helicopter.hang`): since 2026-10-14 an
// Apache, 1.7 times life size ("make sure its nice and large"). With it go four lights, seen at dusk and by night
// and not by day: a red one under it that flashes, a white one at its tail that does not, and one on each wing tip
// (red to its left, green to its right, as every aircraft has them: so which way it is going can be told in the dark).

import * as THREE from 'three';
import { audio, type RotorVoice } from '../core/audio';
import { AIRDROP, crateAt, flightTimes, heliAt, rotorAt, type Flight, type HeliAt, type Times } from '../sim/airdrop';
import { flying } from '../world/atmosphere';

/** what is drawn of it, in one place */
export const HELI_LOOK = {
  /** the lights, in the helicopter's own metres: [to its right, up, toward its tail] and the colour of each: on the Apache (the model `apache`, 27 m nose to tail, its tail 17.9 m behind the hub): under its belly, at its tail, at its wing tips */
  lights: [
    { at: [0, -2.3, 0.6], colour: [1, 0.08, 0.05], flash: true },
    { at: [0, 3.2, 17.8], colour: [1, 0.96, 0.86], flash: false },
    { at: [-4.5, 0.5, -0.4], colour: [1, 0.08, 0.05], flash: false },
    { at: [4.5, 0.5, -0.4], colour: [0.1, 1, 0.3], flash: false },
  ] as { at: [number, number, number]; colour: [number, number, number]; flash: boolean }[],
  /** how far the model is let down from where it stands (its lowest point on its origin): the helicopter's origin is in its cabin, and the crate leaves it AIRDROP.belly metres under that, just under the belly */
  sit: 2.4,
  /** the red one under it is lit for this long, once in this long: seconds */
  flash: [0.14, 1.1] as [number, number],
  /** how big a light is drawn, in pixels of the screen: from far, and from near (within `nearBy` metres) */
  size: [5, 14] as [number, number],
  nearBy: 120,
  /** how bright they are drawn against the picture (more than 1: a light is brighter than anything lit) */
  bright: 2.2,
  /** they are lit once there is less of the day's light than this, and fully by this much (1 is day, 0 night) */
  lit: [0.92, 0.45] as [number, number],
  /** how quickly its lean and the fall of its nose come on, seconds: what the rules say of them changes in a moment, and a helicopter does not */
  ease: 0.7,
  /** how high the canopy stands over the point its lines meet at, metres (as the model is built: scripts/assets.config.mjs), and how far it is laid over once the crate is down, radians */
  canopy: 12,
  laid: 1.35,
};

let dot: THREE.Texture | null = null;
/** a light as it is drawn: a round bright middle and a glow round it */
function lightDot(): THREE.Texture {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

/**
 * The helicopter. It is moved by being told where the rules put it (`set`); everything that would be drawn of it
 * hangs from `root`.
 *
 * WHERE A MODEL GOES: `hang(model, rotor?, tail?)`, and nowhere else. What it expects of the model:
 *   - in metres, as big as the thing is (a Black Hawk: 15 m nose to tail, 16.4 m across its rotor, 5 m high);
 *   - its nose toward -z, its top toward +y, its own right toward +x (as a three.js camera looks);
 *   - its origin in the middle of its cabin, under the rotor's hub: the crate leaves it `AIRDROP.belly` metres
 *     under that point, and the lights are placed about it (HELI_LOOK.lights);
 *   - its main rotor, if it is a piece apart, given as `rotor` (it is turned about y, 4.3 turns a second), and its
 *     tail rotor as `tail` (turned about x): each must have its origin on its own hub.
 * With a model hung, the lights can stay (they are an aircraft's own) or be turned off with `lights.visible`.
 */
export class Helicopter {
  /** where it is, and which way it points */
  readonly root = new THREE.Group();
  /** how it leans and how its nose stands: the model hangs here */
  readonly mount = new THREE.Group();
  /** what turns: the main rotor about y, the tail rotor about x */
  readonly rotor = new THREE.Group();
  readonly tail = new THREE.Group();
  readonly lights: THREE.Points;
  readonly place = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  speed = 0;
  bank = 0;
  pitch = 0;
  private colours: THREE.BufferAttribute;
  private paint: THREE.PointsMaterial;

  constructor() {
    this.root.add(this.mount);
    this.mount.add(this.rotor, this.tail);
    this.mount.rotation.order = 'YXZ';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HELI_LOOK.lights.flatMap((l) => l.at)), 3));
    this.colours = new THREE.BufferAttribute(new Float32Array(HELI_LOOK.lights.length * 3), 3);
    g.setAttribute('color', this.colours);
    this.paint = new THREE.PointsMaterial({ map: lightDot(), size: HELI_LOOK.size[0], sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.lights = new THREE.Points(g, this.paint);
    // (four points a few metres apart, somewhere in the sky: never worth asking whether they are on the screen)
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 6;
    this.mount.add(this.lights);
  }

  /** The one place a model is hung (see what it expects of one, above). */
  hang(model: THREE.Object3D, rotor?: THREE.Object3D, tail?: THREE.Object3D) {
    this.mount.add(model);
    // (each turning group is first stood on its own piece's hub: turned where it stood, at the helicopter's middle,
    // a tail rotor fourteen metres back went round in a circle that size)
    this.root.updateMatrixWorld(true);
    for (const [group, piece] of [[this.rotor, rotor], [this.tail, tail]] as const) {
      if (!piece) continue;
      group.position.copy(this.mount.worldToLocal(piece.getWorldPosition(new THREE.Vector3())));
      group.updateMatrixWorld(true);
      group.attach(piece);
    }
  }

  /**
   * Put where the rules say it is.
   * @param t seconds since it appeared (the red light flashes by it, at the same moments in every game)
   * @param dt seconds since it was last put anywhere (0: at once, with no easing)
   * @param light how much of the day's light there is, 1 by day to 0 at night
   * @param away how far off whoever is looking is, metres
   */
  set(at: HeliAt, t: number, dt: number, light: number, away: number) {
    this.place.set(at.x, at.y, at.z);
    this.velocity.set(at.vx, at.vy, at.vz);
    this.heading = at.heading;
    this.speed = at.speed;
    const k = dt > 0 ? 1 - Math.exp(-dt / HELI_LOOK.ease) : 1;
    this.bank += (at.bank - this.bank) * k;
    this.pitch += (at.pitch - this.pitch) * k;
    this.root.position.copy(this.place);
    this.root.rotation.y = this.heading;
    // (its nose is toward -z: nose down is a turn about x the other way; leaning to its right is a turn about z the other way)
    this.mount.rotation.set(-this.pitch, 0, -this.bank);
    this.rotor.rotation.y = at.rotor;
    this.tail.rotation.x = at.rotor * 4.6;
    const lit = Math.min(1, Math.max(0, (HELI_LOOK.lit[0] - light) / (HELI_LOOK.lit[0] - HELI_LOOK.lit[1])));
    this.lights.visible = lit > 0.01 && at.phase !== 'gone';
    if (!this.lights.visible) return;
    const flash = t % HELI_LOOK.flash[1] < HELI_LOOK.flash[0];
    HELI_LOOK.lights.forEach((l, i) => {
      const b = (l.flash && !flash ? 0 : 1) * lit * HELI_LOOK.bright;
      this.colours.setXYZ(i, l.colour[0] * b, l.colour[1] * b, l.colour[2] * b);
    });
    this.colours.needsUpdate = true;
    this.paint.size = HELI_LOOK.size[0] + (HELI_LOOK.size[1] - HELI_LOOK.size[0]) * Math.min(1, HELI_LOOK.nearBy / Math.max(away, 1));
  }

  dispose() {
    this.root.removeFromParent();
    this.lights.geometry.dispose();
    this.paint.dispose();
  }
}

/** what this file needs of the game */
export interface AirdropHost {
  /** a crate as a supply drop stands in the world, to be let down under the canopy: a thing of its own, its foot at its origin */
  crate: () => Promise<THREE.Object3D>;
  /** the canopy (the model `parachute`) */
  canopy: () => Promise<THREE.Object3D>;
  /** the helicopter itself (the model `apache`, a copy: stood on its lowest point under its rotor's hub, its rotors pieces of their own) */
  heli?: () => Promise<THREE.Object3D>;
  /** a thing that is lit is made known to the sky and the shadows before it is drawn */
  register: (o: THREE.Object3D) => void;
  /** things got ready to be drawn before they are seen: their shaders made, their pictures on the card (the renderer's `ready`) */
  ready?: (o: THREE.Object3D[]) => Promise<unknown>;
  /** the crate of a flight has touched the ground (once for each flight; not for one that had landed before this game heard of it) */
  landed: (f: Flight) => void;
}

interface Live {
  f: Flight;
  T: Times;
  /** this game's clock (performance.now, ms) at the moment it appeared */
  t0: number;
  heli: Helicopter;
  voice: RotorVoice | null;
  /** the crate under its canopy: [what swings, the canopy, the crate], once they have been fetched */
  hung: { pivot: THREE.Group; canopy: THREE.Object3D; crate: THREE.Object3D; tall: number } | null;
  asked: boolean;
  touched: boolean;
  /** the crate that stays there has been stood in its place (or was there before this game heard of the flight) */
  stood: boolean;
}

/** Every flight in the air: begun when the server says one (or the game itself, playing alone), put where it is every frame, taken away when it has gone. */
export class Airdrops {
  private live: Live[] = [];
  /** for looking at one moment of a flight (the harness, and the pictures): seconds since it appeared, held still; null lets the clock run */
  held: number | null = null;

  constructor(private scene: THREE.Scene, private host: AirdropHost) {}

  /** A flight has been said: `f.age` seconds old already (somebody who joins half way through is told it so). */
  begin(f: Flight) {
    if (this.live.some((l) => l.f.uid === f.uid)) return;
    const T = flightTimes(f);
    if (f.age >= T.gone) return;
    const heli = new Helicopter();
    this.scene.add(heli.root);
    // (one that had landed before this game heard of it: the crate is told of apart, as a drop standing)
    const was = f.age >= T.land;
    const l: Live = { f, T, t0: performance.now() - f.age * 1000, heli, voice: null, hung: null, asked: false, touched: was, stood: was };
    this.live.push(l);
    void this.dress(l).catch(() => {});
    // (The canopy and the crate are fetched and got ready NOW, while the helicopter is still on its way: they were
    // fetched at the moment the crate was let go, and their shaders made in the frame they were first drawn in, with
    // everybody looking at the sky. Found by an independent reading, 2026-10-13.)
    if (!was) void this.hang(l).catch(() => {});
  }

  /** the flights in the air, and where each has got to: for the map, and for looking */
  list(): { f: Flight; t: number; T: Times; heli: Helicopter }[] {
    return this.live.map((l) => ({ f: l.f, t: this.clock(l), T: l.T, heli: l.heli }));
  }

  /** the crate that stays is standing where this flight's came down: the one that was let down is taken away */
  stood(uid: string) {
    const l = this.live.find((x) => x.f.uid === uid);
    if (!l) return;
    l.stood = true;
    if (l.hung) l.hung.crate.visible = false;
  }

  private clock(l: Live) {
    return this.held ?? (performance.now() - l.t0) / 1000;
  }

  /** The model put on a helicopter as it appears (far off: it is a small thing, fetched and made ready long before it is near). Without one, it is its lights and its sound. */
  private async dress(l: Live) {
    if (!this.host.heli) return;
    const model = await this.host.heli();
    if (!this.live.includes(l)) return;
    model.position.y = -HELI_LOOK.sit;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.host.register(model);
    if (this.host.ready) await Promise.race([this.host.ready([model]), new Promise<void>((done) => setTimeout(done, 6000))]).catch(() => {});
    if (!this.live.includes(l)) return;
    l.heli.hang(model, model.getObjectByName('apache_rotor'), model.getObjectByName('apache_tail'));
  }

  private async hang(l: Live) {
    l.asked = true;
    const [crate, canopy] = await Promise.all([this.host.crate(), this.host.canopy()]);
    if (!this.live.includes(l)) return;
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    const tall = new THREE.Box3().setFromObject(crate).max.y;
    canopy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      // (a wide thin thing that is drawn narrow and laid over: its measure as it was built says nothing of where it is)
      m.frustumCulled = false;
    });
    crate.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.host.register(canopy);
    this.host.register(crate);
    // (never waited on for long: a card that will not say its shaders are made does not keep the crate out of the sky)
    if (this.host.ready) await Promise.race([this.host.ready([canopy, crate]), new Promise<void>((done) => setTimeout(done, 6000))]).catch(() => {});
    if (!this.live.includes(l)) return;
    pivot.add(canopy, crate);
    pivot.visible = false;
    this.scene.add(pivot);
    l.hung = { pivot, canopy, crate, tall };
  }

  /**
   * Every frame.
   * @param ear where whoever plays is listening from
   * @param light how much of the day's light there is (1 by day, 0 at night)
   * @param indoors under a roof  @param under how far down in the bunker, 0..1
   */
  update(dt: number, ear: THREE.Vector3, light: number, indoors: boolean, under: number) {
    for (const l of [...this.live]) {
      const t = this.clock(l), T = l.T;
      if (t >= Math.max(T.gone, T.cleared + 1)) {
        this.end(l);
        continue;
      }
      // ---- the helicopter, and its sound from where it is
      const at = heliAt(l.f, t), h = l.heli;
      const dx = at.x - ear.x, dy = at.y - ear.y, dz = at.z - ear.z, away = Math.max(0.001, Math.hypot(dx, dy, dz));
      h.set(at, t, this.held === null ? dt : 0, light, away);
      // (its shadow drawn every frame, wherever it lies: see flying. The ground under it taken as the drop's own)
      if (at.phase !== 'gone' && away < 600) flying(at.x, at.y, at.z, l.f.y);
      if (at.phase === 'gone') {
        l.voice?.stop();
        l.voice = null;
      } else {
        l.voice ??= audio.rotor();
        // (how fast it and the ear are coming together: its own speed along the line between them)
        const closing = -(at.vx * dx + at.vy * dy + at.vz * dz) / away;
        const r = rotorAt(away, closing, indoors, under);
        l.voice?.set(h.place, r.gain, r.rate, r.cutoff);
      }
      // ---- the crate under its canopy
      const c = crateAt(l.f, t);
      if (!c) {
        if (l.hung) l.hung.pivot.visible = false;
        continue;
      }
      // (a canopy or a crate that cannot be fetched is not asked for again: the flight goes on without them, and the crate that stays is still stood there)
      if (!l.asked) void this.hang(l).catch(() => {});
      if (c.landed && !l.touched) {
        l.touched = true;
        this.host.landed(l.f);
      }
      const g = l.hung;
      if (!g) continue;
      const H = HELI_LOOK.canopy, since = t - T.release;
      g.pivot.visible = true;
      // (what swings, swings about the canopy: it is the canopy that holds, and the crate that hangs)
      g.pivot.position.set(c.x, c.y + g.tall + H, c.z);
      g.pivot.rotation.set(c.swing[0], c.spin, c.swing[1]);
      g.crate.position.set(0, -H - g.tall, 0);
      // (the crate that stays has been stood in its place, or is a moment late in being said: this one is not drawn twice, and not for long)
      g.crate.visible = !l.stood && t < T.land + 4;
      g.canopy.position.set(0, -H, 0);
      if (!c.landed) {
        // paid out behind the crate as it falls, a streamer; then it fills
        const out = Math.min(1, Math.max(0, (since - 0.25) / Math.max(0.1, AIRDROP.free - 0.25)));
        const wide = 0.08 + 0.92 * c.open;
        g.canopy.visible = since > 0.25;
        g.canopy.scale.set(wide, (0.35 + 0.8 * out) * (1 - 0.13 * c.open), wide);
        g.canopy.rotation.set(0, 0, 0);
      } else {
        // down: with nothing hanging from it the canopy goes over to one side, empties, and is drawn in to nothing
        const k = c.settled, over = k * k * (3 - 2 * k), gone = Math.min(1, Math.max(0, (k - 0.72) / 0.28));
        g.canopy.visible = k < 1;
        g.canopy.rotation.set(HELI_LOOK.laid * Math.min(1, over * 1.25), 0, 0);
        const shrink = 1 - gone * gone;
        g.canopy.scale.set((1 + 0.1 * over) * shrink, (1 - 0.6 * over) * shrink, (1 + 0.1 * over) * shrink);
      }
    }
  }

  private end(l: Live) {
    l.voice?.stop();
    l.heli.dispose();
    if (l.hung) {
      l.hung.pivot.removeFromParent();
      // (the canopy and the crate are copies: their shapes and pictures belong to the models they were copied from)
    }
    this.live = this.live.filter((x) => x !== l);
  }

  clear() {
    for (const l of [...this.live]) this.end(l);
  }
}
