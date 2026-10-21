// The battle royale's screen (2026-10-21), the owner: "we want to make it look liek fortnite visually ... color coated
// slots and generally streamalined gameplay for UX". Six slots filled and lit in their rarity's colour, the rounds by
// calibre, armour, helmet and pack as badges, a radar with the circle and the plane's line, the alive count, the kill
// feed, numbers off every hit, the lobby's vote, and the end. Drawn when something on it changes, never every frame for
// nothing (2026-10-18: the HUD's own work had been a fifth of the frame).
import './br.css';
import { ITEMS } from '../../sim/items';
import { BR, HEALS, MAPS, RARITY, capOf, rarityOf, type Circle } from '../../../arena/br/rules';
import type { BrS2C, Phase } from '../../../arena/br/wire';

type Of<K extends BrS2C['k']> = Extract<BrS2C, { k: K }>;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id: string) => `/assets/icons/${id}.webp`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const CAL: Record<string, string> = { ammo_9mm: '9mm', ammo_45: '.45', ammo_50: '.50 AE', ammo_12: '12g', ammo_739: '7.62×39', ammo_556: '5.56', ammo_762: '7.62', ammo_127x55: '12.7', ammo_50bmg: '.50 BMG' };

export interface Tick {
  now: number;
  phase: Phase;
  me: Of<'me'> | null;
  held: number;
  loaded: { n: number; ammo: string } | null;
  zone: Of<'zone'> | null;
  circle: Circle | null;
  out: boolean;
  map: number;
  at: { x: number; z: number };
  yaw: number;
  plane: Of<'plane'> | null;
  air: 'plane' | 'fall' | 'chute' | null;
  /** in the plane: seconds until it is over the map (0: jump now) */
  jumpIn: number;
}

export class BrHud {
  private el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private radar: CanvasRenderingContext2D;
  private drawn = '';
  private lob: Of<'lobby'> | null = null;
  private off = 0;
  voted = false;
  private radarT = 0;

  constructor(root: HTMLElement, private onVote: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'br-hud';
    this.el.innerHTML = `
      <div class="br-top"><div class="br-phase"></div><div class="br-time"></div></div>
      <div class="br-right"><canvas class="br-radar" width="200" height="200"></canvas>
        <div class="br-count"><span class="br-alive">0</span> ALIVE <i></i> <span class="br-kills">0</span> KILLS</div><div class="br-mates"></div></div>
      <div class="br-feed"></div>
      <div class="br-hits"></div>
      <div class="br-bar"><div class="br-bar-label"></div><div class="br-bar-track"><div class="br-bar-fill"></div></div></div>
      <div class="br-bottom">
        <div class="br-vit"><div class="br-gear"></div><div class="br-hp"><div class="br-hp-fill"></div><b class="br-hp-n">100</b></div></div>
        <div class="br-slots"></div>
        <div class="br-pools"></div>
      </div>
      <div class="br-lobby"><b>LOBBY</b><span class="br-lobby-n"></span><span class="br-lobby-v"></span><button class="br-vote">Vote to start <kbd>V</kbd></button><small class="br-lobby-code"></small></div>
      <div class="br-gas">IN THE GAS</div>
      <div class="br-knock">KNOCKED<small>A teammate can get you up: F, standing, 10 s</small><b class="br-kn"></b></div>
      <div class="br-end"><div class="br-end-place"></div><div class="br-end-what"></div><div class="br-end-rows"></div>
        <div class="br-end-go"><button class="br-again">Play again</button><button class="br-menu">Main menu</button></div></div>`;
    root.appendChild(this.el);
    this.radar = this.q<HTMLCanvasElement>('.br-radar').getContext('2d')!;
    this.q('.br-vote').addEventListener('click', () => this.onVote());
    this.q('.br-again').addEventListener('click', () => location.assign('/battleroyale'));
    this.q('.br-menu').addEventListener('click', () => location.assign('/'));
  }

  note(text: string, kind: 'good' | 'info' = 'info') {
    const n = document.createElement('div');
    n.className = `br-note ${kind}`;
    n.textContent = text;
    this.el.appendChild(n);
    setTimeout(() => n.remove(), 3200);
  }

  lobby(m: Of<'lobby'>, off: number) {
    this.lob = m;
    this.off = off;
    this.voted = m.voted;
    this.q('.br-lobby-n').textContent = `${m.have} of ${m.max} in · ${m.mode.toUpperCase()} · ${MAPS[m.map].name}`;
    this.q('.br-lobby-v').textContent = m.at ? 'Starting' : `${m.votes} of ${m.need} votes to start${m.have < BR.min ? ` · needs ${BR.min} players` : ''}`;
    this.q('.br-vote').textContent = m.voted ? 'Voted: take it back (V)' : 'Vote to start (V)';
    this.q('.br-vote').classList.toggle('on', m.voted);
    this.q('.br-lobby-code').textContent = m.code ? `Lobby code ${m.code}: friends join with it` : '';
  }

  state(m: Of<'state'>) {
    this.el.classList.toggle('lobbying', m.phase === 'wait' || m.phase === 'count');
    this.q('.br-alive').textContent = String(m.alive);
    this.q('.br-kills').textContent = String(m.kills);
  }

  feed(by: string, who: string, w: string, head: boolean, me: boolean) {
    const f = this.q('.br-feed'), row = document.createElement('div');
    row.className = `br-kill${me ? ' me' : ''}`;
    row.innerHTML = by === who || by === 'the gas' ? `<b>${esc(who)}</b> ${w === 'gas' ? 'was lost in the gas' : 'is out'}` : `<b>${esc(by)}</b> <span>${esc(w)}${head ? ' ✦' : ''}</span> <b>${esc(who)}</b>`;
    f.prepend(row);
    while (f.children.length > 5) f.lastChild!.remove();
    setTimeout(() => row.classList.add('old'), 7000);
  }

  hitNumber(n: number, head: boolean) {
    const h = document.createElement('div');
    h.className = `br-hit${head ? ' head' : ''}`;
    h.textContent = String(Math.round(n));
    h.style.left = `${50 + (Math.random() - 0.5) * 8}%`;
    this.q('.br-hits').appendChild(h);
    setTimeout(() => h.remove(), 900);
  }

  out(m: Of<'out'>) {
    this.end(`#${m.place}`, m.by ? `Out, by ${esc(m.by)}` : 'Out', `${m.kills} kills · ${m.dmg} damage`);
  }

  over(m: Of<'over'>, won: boolean) {
    const rows = m.board.slice(0, 10).map((r) => `<div><b>#${r.place}</b> ${esc(r.name)} <span>${r.kills} kills · ${r.dmg} dmg</span></div>`).join('');
    if (won || !this.el.classList.contains('ended')) this.end(won ? '#1' : 'Match over', won ? 'LAST ONES STANDING' : `Won by ${esc(m.winners.join(' & '))}`, '', won);
    this.q('.br-end-rows').innerHTML = rows;
  }

  /** the connection gone before the end */
  closed(reason: string) {
    if (!this.el.classList.contains('ended')) this.end('', esc(reason || 'The connection to the match was lost'), '');
  }

  private end(place: string, what: string, more: string, won = false) {
    this.el.classList.add('ended');
    this.el.classList.toggle('won', won);
    this.q('.br-end-place').textContent = place;
    this.q('.br-end-what').innerHTML = `${what}${more ? `<small>${more}</small>` : ''}`;
    // (the mouse let go for its buttons: the pause it brings, or one already up, is not shown over it)
    document.getElementById('br-menu')?.classList.remove('show', 'paused', 'pset');
    document.exitPointerLock?.();
  }

  tick(t: Tick) {
    const me = t.me;
    // the top: what the circle is doing, or the lobby's count
    let phase = '', time = '';
    if (t.phase === 'wait') phase = 'Waiting for the vote';
    else if (t.phase === 'count' && this.lob) (phase = 'The plane leaves in'), (time = mmss((this.lob.at - (Date.now() + this.off)) / 1000 + 0.99));
    else if (t.air === 'plane') t.jumpIn > 0 ? ((phase = 'Over the map in'), (time = mmss(t.jumpIn))) : (phase = 'Space to jump');
    else if (t.air === 'fall') phase = 'Hold W to dive · the canopy opens by itself';
    else if (t.zone && t.phase !== 'over') {
      const z = t.zone;
      if (t.now < z.t0) (phase = z.phase === 0 && t.plane ? 'The circle closes in' : 'The circle closes in'), (time = mmss((z.t0 - t.now) / 1000));
      else if (t.now < z.t1) (phase = 'The circle is closing'), (time = mmss((z.t1 - t.now) / 1000));
      else phase = 'Final circle';
    }
    this.text('.br-phase', phase);
    this.text('.br-time', time);
    this.el.classList.toggle('gassed', t.out && !this.el.classList.contains('ended'));
    // the vitals, slots and rounds: drawn again only when they change
    const key = JSON.stringify([me?.slots.map((s) => s && [s.uid, s.qty]), me?.vest, me?.helmet, me?.pack, me?.pools, me?.hp, me?.knocked, Math.round(me?.kn ?? 0), t.held, t.loaded?.n, me?.using?.until, me?.rev?.until, me?.mates]);
    if (key !== this.drawn && me) {
      this.drawn = key;
      this.draw(t, me);
    }
    // the bar: a heal being used, or a revive either way
    const bar = me?.using ? { label: `Using ${ITEMS[me.slots[me.using.slot]?.id ?? '']?.name ?? ''}`, until: me.using.until, secs: HEALS[me.slots[me.using.slot]?.id ?? '']?.secs ?? 1 } : me?.rev ? { label: me.rev.me ? 'Getting them up: stay standing' : 'Being got up', until: me.rev.until, secs: BR.revive } : null;
    this.el.classList.toggle('barring', !!bar);
    if (bar) {
      this.text('.br-bar-label', bar.label);
      this.q('.br-bar-fill').style.width = `${Math.max(0, Math.min(100, 100 - ((bar.until - t.now) / 1000 / bar.secs) * 100))}%`;
    }
    this.radarT -= 1;
    if (this.radarT <= 0) {
      this.radarT = 6;
      this.drawRadar(t);
    }
  }

  private text(sel: string, s: string) {
    const e = this.q(sel);
    if (e.textContent !== s) e.textContent = s;
  }

  private draw(t: Tick, me: Of<'me'>) {
    this.el.classList.toggle('knocked', me.knocked);
    this.text('.br-kn', me.knocked ? String(me.kn) : '');
    const hp = me.knocked ? me.kn : me.hp;
    this.q('.br-hp-fill').style.width = `${Math.max(0, Math.min(100, hp))}%`;
    this.q('.br-hp').classList.toggle('low', hp < 35);
    this.text('.br-hp-n', String(Math.round(hp)));
    this.q('.br-gear').innerHTML = (['vest', 'helmet', 'pack'] as const).map((k) => {
      const id = me[k];
      return `<div class="br-badge ${id ? 'r' + rarityOf(id) : 'none'}" title="${id ? esc(ITEMS[id]?.name ?? id) : k}">${id ? `<img src="${icon(id)}" alt="">` : `<span>${k === 'vest' ? 'ARMOUR' : k.toUpperCase()}</span>`}</div>`;
    }).join('');
    this.q('.br-slots').innerHTML = me.slots.map((s, k) => {
      if (!s) return `<div class="br-slot empty${k === t.held ? ' held' : ''}"><kbd>${k + 1}</kbd></div>`;
      const r = rarityOf(s.id), def = ITEMS[s.id], gun = def?.weapon;
      const n = gun ? `<b>${k === t.held && t.loaded ? t.loaded.n : s.loaded ?? 0}<small>/${me.pools[gun.ammo] ?? 0}</small></b>` : HEALS[s.id] ? `<b>×${s.qty ?? 1}</b>` : '';
      return `<div class="br-slot r${r}${k === t.held ? ' held' : ''}" style="--c:${RARITY[r].colour}"><kbd>${k + 1}</kbd><img src="${icon(s.id)}" alt=""><em>${esc(def?.name ?? s.id)}</em>${n}</div>`;
    }).join('');
    this.q('.br-pools').innerHTML = Object.entries(me.pools).filter(([, n]) => n > 0).map(([a, n]) => `<div class="${t.loaded?.ammo === a ? 'on' : ''}"><span>${CAL[a] ?? a}</span><b>${n}</b><small>/${capOf(a, me.pack)}</small></div>`).join('');
    this.q('.br-mates').innerHTML = me.mates.map((m) => `<div class="${m.alive ? (m.knocked ? 'down' : '') : 'gone'}"><span>${esc(m.name)}</span><i style="width:${m.alive ? Math.max(0, Math.min(100, m.hp)) : 0}%"></i></div>`).join('');
  }

  private drawRadar(t: Tick) {
    const c = this.radar, W = 200, m = MAPS[t.map], s = W / Math.max(m.x1 - m.x0, m.z1 - m.z0);
    const X = (x: number) => (x - m.x0) * s + (W - (m.x1 - m.x0) * s) / 2, Z = (z: number) => (z - m.z0) * s + (W - (m.z1 - m.z0) * s) / 2;
    c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(10,12,11,0.5)';
    c.fillRect(X(m.x0), Z(m.z0), (m.x1 - m.x0) * s, (m.z1 - m.z0) * s);
    const ring = (o: Circle, style: string, dash: number[], wide = 2) => {
      c.beginPath();
      c.setLineDash(dash);
      c.strokeStyle = style;
      c.lineWidth = wide;
      c.arc(X(o.x), Z(o.z), Math.max(1, o.r * s), 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    };
    if (t.phase === 'wait' || t.phase === 'count') ring(m.wait, '#c9b27c', [], 1.5);
    if (t.circle) {
      // the gas outside the circle, tinted
      c.save();
      c.beginPath();
      c.rect(0, 0, W, W);
      c.arc(X(t.circle.x), Z(t.circle.z), Math.max(1, t.circle.r * s), 0, Math.PI * 2, true);
      c.fillStyle = 'rgba(120,128,70,0.32)';
      c.fill();
      c.restore();
      ring(t.circle, 'rgba(233,228,216,0.9)', [], 1.5);
    }
    if (t.zone) ring(t.zone.b, 'rgba(233,228,216,0.6)', [4, 4], 1);
    if (t.plane) {
      c.strokeStyle = '#c9b27c';
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.beginPath();
      c.moveTo(X(t.plane.a[0]), Z(t.plane.a[1]));
      c.lineTo(X(t.plane.b[0]), Z(t.plane.b[1]));
      c.stroke();
      c.setLineDash([]);
    }
    // this player: an arrow the way they face (the game's yaw looks down -z at 0)
    const px = X(t.at.x), pz = Z(t.at.z), fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
    c.fillStyle = '#e9e4d8';
    c.beginPath();
    c.moveTo(px + fx * 8, pz + fz * 8);
    c.lineTo(px - fx * 4 + fz * 5, pz - fz * 4 - fx * 5);
    c.lineTo(px - fx * 4 - fz * 5, pz - fz * 4 + fx * 5);
    c.closePath();
    c.fill();
  }
}
