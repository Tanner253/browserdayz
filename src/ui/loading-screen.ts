// The loading screen's bar, its counter and the line under them. It used to print every file's name as it came
// down; now one bar, how far it has got, and a line of the Zone being got ready for you.

/** said in turn, in a shuffled order, while nothing more particular is happening */
const LINES = [
  'Hosing down the infected',
  'Dragging bodies off the road',
  'Mopping up last night’s firefight',
  'Teaching the dead to walk again',
  'Counting the bullets. Twice',
  'Burying the last guy who said “it’s safe here”',
  'Sharpening the axes',
  'Checking the radio. Static. Good',
  'Bleaching the hospital floors',
  'Putting the teeth back in the zombies',
  'Restocking the canned beans',
  'Telling the bandits you’re coming',
  'Rinsing the dog tags',
  'Re-hanging the “keep out” signs',
  'Painting over the bullet holes',
  'Flicking the lights off in the basements',
  'Unjamming the doors',
  'Loading the magazines one round at a time',
  'Hiding the bandages',
  'Feeding the infected. Not you. Yet',
  'Sweeping up the brass',
  'Rolling the fog in',
  'Warming up the gas',
  'Wiping the blood off the lens',
  'Spinning the compass',
];

/** each stage of the start (src/main.ts, Game.init): where the bar stands when it begins (in step with how long
 * each took on a 75 s start), and what is said */
const STAGES: [prefix: string, at: number, line?: string][] = [
  ['renderer', 0.01],
  ['assets', 0.03],
  ['world', 0.08, 'Raising the Zone out of the mud'],
  ['sky', 0.3, 'Hanging the clouds. Some of them are gas'],
  ['ground', 0.31, 'Laying the mud. Lots of mud'],
  ['buildings', 0.34, 'Boarding up the windows'],
  ['forest', 0.36, 'Planting a forest to get lost in'],
  ['game', 0.45, 'Waking up the infected'],
  ['loading loot', 0.46, 'Hiding the good loot where you won’t look'],
  ['loading weapons', 0.55, 'Oiling the rifles'],
  ['compiling shaders', 0.62],
  ['preparing graphics', 0.63],
  ['rendering icons', 0.72, 'Labelling the tins'],
  ['fort', 0.74, 'Pouring concrete for the fort'],
  ['last files', 0.75, 'Last bodies off the road'],
  ['shaders', 0.76],
];
/** the share of the bar the files fill before the world is built (assets, up to world) */
const FILES = [0.03, 0.08];
/** how long a line is shown, ms */
const EVERY = 1900;

export class LoadingScreen {
  private fill: HTMLElement;
  private count: HTMLElement;
  private label: HTMLElement;
  private shown = 0;
  private stageAt = 0;
  private filing = false;
  private bag: string[] = [];
  private timer = 0;
  /** where the stage under way ends: the bar creeps towards it, so a long stage never looks stuck */
  private ends = FILES[1];
  private creep = window.setInterval(() => this.to(this.shown + (this.ends - this.shown) * 0.03), 250);

  constructor(root: HTMLElement) {
    this.fill = root.querySelector('.load-fill') as HTMLElement;
    this.count = root.querySelector('.load-count') as HTMLElement;
    this.label = root.querySelector('.load-label') as HTMLElement;
    this.next();
  }

  /** a stage of the start has begun */
  stage(name: string) {
    const s = STAGES.find(([p]) => name.startsWith(p));
    if (!s) return;
    this.filing = s[0] === 'assets';
    this.stageAt = s[1];
    this.ends = (STAGES[STAGES.indexOf(s) + 1]?.[1] ?? 1) - 0.005;
    this.to(s[1]);
    if (s[2]) this.say(s[2]);
  }

  /** files come down: they fill their share of the bar while the start waits on them, after that they run behind */
  files(done: number, total: number) {
    if (this.filing) this.to(FILES[0] + (FILES[1] - FILES[0]) * (done / Math.max(total, 1)));
  }

  done() {
    this.to(1);
    this.stop();
  }

  /** something went wrong: it is said plainly, and the lines stop */
  fail(text: string) {
    this.stop();
    this.label.textContent = text;
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.creep);
    this.timer = 0;
  }

  /** the bar only goes forwards */
  private to(f: number) {
    f = Math.max(this.shown, this.stageAt, Math.min(1, f));
    if (f === this.shown) return;
    this.shown = f;
    this.fill.style.width = `${f * 100}%`;
    this.count.textContent = `${Math.floor(f * 100)}%`;
  }

  private say(line: string) {
    this.label.textContent = `${line}…`;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.next(), EVERY);
  }

  private next() {
    if (!this.bag.length) {
      this.bag = LINES.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    this.say(this.bag.pop()!);
  }
}
