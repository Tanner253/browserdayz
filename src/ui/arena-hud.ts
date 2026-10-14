// The arena's own screen (2026-10-14). The owner: "we dont need to show the entire inventory bar or the map or
// anything this is gonna be more like CS:GO". So in a wager the open world's HUD is put away (the bar, the map, the
// compass, the survivor's needs, the place names) and this is laid over what is left: the score and the round at
// the top, who killed whom at the right, health and the gun at the foot, a banner as each round starts and ends,
// the scoreboard on Tab; and when the match is won, the result, then a card to go on from ("think like the end of a
// cod match": not cut off). Fed by the arena's own messages, 'score' and 'kill' (arena/match.ts).
import './arena-hud.css';
import type { S2C } from '../net/protocol';
import { ITEMS } from '../sim/items';

type Score = Extract<S2C, { t: 'score' }>;
type Kill = Extract<S2C, { t: 'kill' }>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class ArenaHud {
  private el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private last: Score | null = null;
  private bannerT = 0;
  private shown = { hp: -1, gun: '', mag: '', spec: false, board: false };
  /** where to go once the match is over: the wagers again, or the menu */
  onGo: (again: boolean) => void = () => {};

  constructor(hud: HTMLElement, private watch: boolean, practice: boolean) {
    document.body.classList.add('arena');
    hud.classList.add('arena');
    this.el = document.createElement('div');
    this.el.className = 'arena-hud';
    this.el.innerHTML = `
      <div class="ah-top">
        <div class="ah-team us"><span class="ah-names"></span><span class="ah-pips"></span></div>
        <div class="ah-n us">0</div>
        <div class="ah-mid"><b>${practice ? 'PRACTICE' : 'ROUND 1'}</b><small>${practice ? 'the arena alone' : ''}</small></div>
        <div class="ah-n them">0</div>
        <div class="ah-team them"><span class="ah-names"></span><span class="ah-pips"></span></div>
      </div>
      <div class="ah-feed"></div>
      <div class="ah-banner"><b></b><small></small></div>
      <div class="ah-spec">${watch ? 'WATCHING' : 'SPECTATING'}<small>${watch ? 'fly with WASD, Space and C' : 'you are out for this round'}</small></div>
      <div class="ah-hp"><i>+</i><b>100</b></div>
      <div class="ah-gun"><small></small><b><span class="ah-mag"></span><em>/ ∞</em></b></div>
      <div class="ah-board"></div>
      <div class="ah-end"></div>`;
    hud.appendChild(this.el);
    if (practice) this.el.classList.add('practice');
  }

  /** the match as it stands: the bar at the top, and a banner when a round starts or ends or the match is won */
  score(m: Score) {
    const was = this.last;
    this.last = m;
    const top = this.q<HTMLElement>('.ah-top');
    this.q<HTMLElement>('.ah-n.us').textContent = String(m.us);
    this.q<HTMLElement>('.ah-n.them').textContent = String(m.them);
    this.q<HTMLElement>('.ah-mid b').textContent = m.phase === 'over' ? 'FINAL' : `ROUND ${m.round}`;
    this.q<HTMLElement>('.ah-mid small').textContent = `FIRST TO ${m.first}`;
    const teams = top.querySelectorAll<HTMLElement>('.ah-team');
    m.sides.forEach((names, i) => {
      (teams[i].querySelector('.ah-names') as HTMLElement).textContent = names;
      const size = m.board.filter((b) => b.ours === (i === 0)).length;
      (teams[i].querySelector('.ah-pips') as HTMLElement).innerHTML = Array.from({ length: size }, (_, k) => `<i class="${k < m.up[i] ? 'up' : ''}"></i>`).join('');
    });
    if (this.shown.board || m.phase === 'over') this.drawBoard();
    const ours = this.watch ? `${m.sides[0]}` : '', theirs = this.watch ? `${m.sides[1]}` : '';
    if (m.phase === 'live' && (!was || was.phase !== 'live' || was.round !== m.round)) this.banner(`ROUND ${m.round}`, `first to ${m.first}`, 'go', 1800);
    else if (m.phase === 'gap' && was?.phase !== 'gap') this.banner(this.watch ? `${m.won ? ours : theirs} TAKE THE ROUND` : m.won ? 'ROUND WON' : 'ROUND LOST', `${m.us} : ${m.them}`, m.won ? 'won' : 'lost', 2600);
    else if (m.phase === 'over' && was?.phase !== 'over') {
      this.banner(this.watch ? `${m.won ? ours : theirs} WIN` : m.won ? 'VICTORY' : 'DEFEAT', `${m.us} : ${m.them}`, m.won ? 'won' : 'lost', 0);
      this.el.classList.add('over');
    }
  }

  /** a kill, at the top right: the killer's side's colour, the gun, a mark for the head; this player's own picked out */
  kill(m: Kill) {
    const feed = this.q<HTMLElement>('.ah-feed'), n = document.createElement('div');
    n.className = `ah-kill${m.me ? ' me' : ''}`;
    n.innerHTML = `<b class="${m.ours ? 'us' : 'them'}">${esc(m.by)}</b><span>${esc(ITEMS[m.w]?.name ?? m.w)}${m.head ? ' <em>HEAD</em>' : ''}</span><b class="${m.ours ? 'them' : 'us'}">${esc(m.who)}</b>`;
    feed.appendChild(n);
    setTimeout(() => n.classList.add('out'), 6000);
    setTimeout(() => n.remove(), 6700);
    while (feed.children.length > 5) feed.firstChild?.remove();
  }

  /** once a frame: health, the gun in hand and the rounds in it out of how many (0: no magazine to it), whether this player is only looking on, and Tab held for the scoreboard */
  tick(health: number, gun: string | null, loaded: number, cap: number, out: boolean, board: boolean) {
    const mag = cap ? `${loaded}:${cap}` : '';
    if (mag !== this.shown.mag) {
      this.shown.mag = mag;
      this.q<HTMLElement>('.ah-mag').textContent = cap ? String(loaded) : '';
      this.el.classList.toggle('nomag', !cap);
      // (red when a quarter or less is left, as CS:GO has it; and the key to say what to do about it)
      this.el.classList.toggle('lowmag', !!cap && loaded <= cap / 4);
    }
    const hp = Math.max(0, Math.round(health));
    if (hp !== this.shown.hp) {
      this.shown.hp = hp;
      this.q<HTMLElement>('.ah-hp b').textContent = String(hp);
      this.el.classList.toggle('low', hp <= 30);
    }
    const name = gun ? ITEMS[gun]?.name ?? '' : '';
    if (name !== this.shown.gun) {
      this.shown.gun = name;
      this.q<HTMLElement>('.ah-gun small').textContent = name;
      this.el.classList.toggle('nogun', !name);
    }
    const spec = out || this.watch;
    if (spec !== this.shown.spec) {
      this.shown.spec = spec;
      this.el.classList.toggle('spec', spec);
    }
    if (board !== this.shown.board) {
      this.shown.board = board;
      if (board) this.drawBoard();
      this.el.classList.toggle('board', board);
    }
    if (this.bannerT && performance.now() > this.bannerT) {
      this.bannerT = 0;
      this.q<HTMLElement>('.ah-banner').classList.remove('on');
    }
  }

  private banner(big: string, small: string, kind: string, ms: number) {
    const b = this.q<HTMLElement>('.ah-banner');
    b.className = `ah-banner on ${kind}`;
    (b.querySelector('b') as HTMLElement).textContent = big;
    (b.querySelector('small') as HTMLElement).textContent = small;
    this.bannerT = ms ? performance.now() + ms : 0;
  }

  private boardHtml(m: Score): string {
    const rows = (ours: boolean) => m.board.filter((b) => b.ours === ours).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((b) => `<tr><td>${esc(b.name)}</td><td>${b.kills}</td><td>${b.deaths}</td></tr>`).join('');
    const side = (ours: boolean, i: number) => `<table class="${ours ? 'us' : 'them'}"><thead><tr><th>${esc(m.sides[i])} <em>${ours ? m.us : m.them}</em></th><th>K</th><th>D</th></tr></thead><tbody>${rows(ours)}</tbody></table>`;
    return side(true, 0) + side(false, 1);
  }

  private drawBoard() {
    if (this.last) this.q<HTMLElement>('.ah-board').innerHTML = this.boardHtml(this.last);
  }

  /** the connection has gone: the result as the server last told it, and where to go on to */
  closed(reason: string) {
    const m = this.last, end = this.q<HTMLElement>('.ah-end');
    this.el.classList.add('ended');
    this.q<HTMLElement>('.ah-banner').classList.remove('on');
    const head = m?.phase === 'over' ? (this.watch ? `${m.won ? m.sides[0] : m.sides[1]} WIN` : m.won ? 'VICTORY' : 'DEFEAT') : 'MATCH ENDED';
    end.innerHTML = `
      <div class="ah-card ${m?.phase === 'over' ? (m.won ? 'won' : 'lost') : ''}">
        <h2>${esc(head)}</h2>
        ${m ? `<div class="ah-final"><span>${esc(m.sides[0])}</span><b>${m.us} : ${m.them}</b><span>${esc(m.sides[1])}</span></div><div class="ah-cardboard">${this.boardHtml(m)}</div>` : ''}
        <p>${esc(reason)}</p>
        <div class="ah-btns"><button type="button" class="ah-again">${this.watch ? 'Wagers' : 'Play again'}</button><button type="button" class="ah-menu">Main menu</button></div>
      </div>`;
    (end.querySelector('.ah-again') as HTMLElement).onclick = () => this.onGo(true);
    (end.querySelector('.ah-menu') as HTMLElement).onclick = () => this.onGo(false);
  }
}
