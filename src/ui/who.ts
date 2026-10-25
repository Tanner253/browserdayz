// Which survivor you are, picked on the main menu as DayZ has it (the owner, 2026-10-24: "we should make a higher
// quality player model and perhaps even variations"): the four bodies (src/game/survivors.ts), one at a time on a
// card beside the way in, turned through with the arrows. What is picked is kept and told to everybody (src/sim/survivor.ts).

import './who.css';
import { BODY_NAMES } from '../sim/survivor';

export class WhoPicker {
  readonly root = document.createElement('div');
  /** a body picked */
  onPick: (body: number) => void = () => {};
  private body = 0;
  private img: HTMLImageElement;
  private name: HTMLElement;
  private dots: HTMLElement;

  constructor() {
    this.root.className = 'sm-who';
    this.root.innerHTML = `<span class="sw-label">Your survivor</span>
      <div class="sw-stage"><button type="button" class="sw-go" data-by="-1" aria-label="The one before">&lsaquo;</button><img alt=""><button type="button" class="sw-go" data-by="1" aria-label="The next one">&rsaquo;</button></div>
      <b class="sw-name"></b><div class="sw-dots">${BODY_NAMES.map(() => '<i></i>').join('')}</div>`;
    this.img = this.root.querySelector('img')!;
    this.name = this.root.querySelector('.sw-name')!;
    this.dots = this.root.querySelector('.sw-dots')!;
    this.root.addEventListener('click', (e) => {
      const by = Number((e.target as HTMLElement).closest<HTMLElement>('.sw-go')?.dataset.by ?? 0);
      if (!by) return;
      this.show((this.body + by + BODY_NAMES.length) % BODY_NAMES.length);
      this.onPick(this.body);
    });
    // (every picture fetched once the card is up, so turning through them shows each at once)
    for (let n = 0; n < BODY_NAMES.length; n++) new Image().src = `/survivors/body_${n}.webp`;
  }

  show(body: number) {
    this.body = body;
    this.img.src = `/survivors/body_${body}.webp`;
    this.img.alt = BODY_NAMES[body];
    this.name.textContent = BODY_NAMES[body];
    [...this.dots.children].forEach((d, n) => d.classList.toggle('on', n === body));
  }
}
