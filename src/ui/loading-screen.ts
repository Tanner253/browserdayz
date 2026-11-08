// The loading screen's bar and the line under it. It used to print every file's name as it came down; now one bar
// and a line of the Zone being got ready for you. (No percentage under the bar: the bar is paced by how long each
// stage took on one start, and "every number on a page ... must be true".)

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

/**
 * Something to read while it loads (the owner, 2026-11-08: "we need to give the user something to chew on to not be
 * bored"): how the game is played, in the words of its own how-to-play and guide, so every one of them is so.
 */
const TIPS = [
  'You drop in on the west coast with bare hands. The further east, the better the loot.',
  'Tier 1, where you start, holds no gun. Inland, tier by tier: pistols, then SMGs, then rifles.',
  'Police and army places hold the most.',
  'Anyone you meet can kill you and take everything you carry, your dog tag with it.',
  'Everybody who has lived long enough carries a dog tag. Kill them, loot it, and stay alive with it to cash it in.',
  'The infected see what is in front of them and hear a shot from far off. Crouch past them, or fit a suppressor.',
  'The gas at the Chemical Works hides Tier 4 loot and the keycards to the bunker. A gas mask lets you breathe it: the police stations keep them.',
  'Bunker 17 is dark and shut. A keycard from the gas opens its door, loudly.',
  'Tier 5, the best loot, is down in Bunker 17 and in the fort.',
  'The vault on Level 3 of Bunker 17 pays out night vision.',
  'A cheek rest fits every sniper rifle: a steadier hold, and a quarter less sway.',
  'A fall or a shot in the leg can break it: you limp until you splint it.',
  'A campfire mends you and cooks your meat, but its smoke gives you away.',
  'Blood is not health: when you have lost too much, an IV bag puts it back.',
  'Build a base: a felling axe for logs, a pickaxe for stone, a hand saw for planks, a hammer to nail it up.',
  'Lay a claim on your foundation: nobody else may build near it.',
  'The trader camps, on the map (M), sell nails, planks, the building plan and locks.',
  'Your inventory is on Tab, and its Crafting page shows what you can make by hand.',
];
/** how long a tip is shown, ms: long enough to read twice */
const TIP_EVERY = 7000;

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
  ['Readying the guns', 0.78, 'Oiling the rifles'],
  ['Last touches', 0.94, 'Zeroing the scopes'],
];
/** the share of the bar the files fill before the world is built (assets, up to world) */
const FILES = [0.03, 0.08];
/** how long a line is shown, ms */
const EVERY = 1900;

export class LoadingScreen {
  private fill: HTMLElement;
  private label: HTMLElement;
  private count: HTMLElement | null;
  private at: (typeof STAGES)[number] | null = null;
  private tip: HTMLElement | null;
  private tips = TIPS.map((t) => [Math.random(), t] as const).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  private tipTimer = 0;
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
    this.label = root.querySelector('.load-label') as HTMLElement;
    this.count = root.querySelector('.load-count');
    this.tip = root.querySelector('.load-tip span');
    this.nextTip();
    this.tipTimer = window.setInterval(() => this.nextTip(), TIP_EVERY);
    this.next();
  }

  /** a stage of the start has begun */
  stage(name: string) {
    // (what is being counted, as so many of so many: with the bar alone at its end, a start that was still working
    // looked stuck. The owner, 2026-11-08: "we need to show a #/# progress too ... i think im stuck and want to refresh")
    // (and the bar moves through the stage's share by that count)
    const n = /(\d+)\/(\d+)$/.exec(name), head = n ? name.slice(0, n.index).trim() : name;
    if (n) this.counted(`${head} ${n[1]}/${n[2]}`);
    const s = STAGES.find(([p]) => head.startsWith(p));
    if (!s) return;
    if (s !== this.at) {
      this.at = s;
      this.filing = s[0] === 'assets';
      this.stageAt = s[1];
      this.ends = (STAGES[STAGES.indexOf(s) + 1]?.[1] ?? 1) - 0.005;
      this.to(s[1]);
      if (s[2]) this.say(s[2]);
    }
    if (n) this.to(this.stageAt + (this.ends - this.stageAt) * (Number(n[1]) / Math.max(1, Number(n[2]))));
  }

  /** files come down: they fill their share of the bar while the start waits on them, after that they run behind */
  files(done: number, total: number) {
    if (done < total) this.counted(`files ${done}/${total}`);
    if (this.filing) this.to(FILES[0] + (FILES[1] - FILES[0]) * (done / Math.max(total, 1)));
  }

  done() {
    this.to(1);
    this.counted('');
    this.stop();
  }

  private nextTip() {
    const t = this.tip;
    if (!t) return;
    const line = this.tips.shift()!;
    this.tips.push(line);
    t.style.opacity = '0';
    window.setTimeout(() => {
      t.textContent = line;
      t.style.opacity = '1';
    }, 250);
  }

  private counted(text: string) {
    if (this.count) this.count.textContent = text;
  }

  /** something went wrong: it is said plainly, and the lines stop */
  fail(text: string) {
    this.stop();
    this.label.textContent = text;
  }

  stop() {
    clearInterval(this.tipTimer);
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
