// The sandbox's screens (2026-10-24, the owner: "all sessions should use the stage for development ... then once its all
// tested in the stage we can plug it in to the world"): the real inventory over the plain sandbox, with a kit on, things
// lying about and a body beside to go through; or the hot bar at the foot of the screen alone. No world, no server.
//
//   &ui=inventory&kit=heavy        the inventory, open, as a survivor with that kit has it (src/sim/kits.ts KITS)
//   &body=marksman                 the kit on the body beside (default: assault)
//   &who=2                         the figure in the middle one of the survivors' bodies (default 0)
//   &ui=hud                        the hot bar at the foot of the screen, as in play
//   &ui=wheel                      the wheel on T (src/ui/radial.ts) by itself: window.wheel is it, to be pointed by a script
//   &craft=1                       and the things crafting is made of in the pockets: dragged onto each other they open
//                                  a recipe's card (src/ui/craft-card.ts), whose Craft makes it at once here
//   &tab=craft                     the Crafting tab open (src/ui/crafting-ui.ts)
//   &bench=1|2|3                   and a workbench of that level as if near, three jobs on its queue, the first part way
//   &table=1                       and a research table as if near
//   &learned=all|tree1|none        the blueprints learned: every one, Bench I's tree, or none (the default) beyond the start's
//   &view=tree|research|weapons    the Crafting tab on that view of its rail
//   &scrap=n                       and n scrap in the pockets (with a pistol, a pipe, a spring and a pistol body, to research)
//   &touch=1                       as a phone has it
// What is done in it (a drag, a key, a drop) is done to these pockets alone, and nothing is kept.

import { claimPanelHtml, mountClaimPanel } from '../game/building/claim-panel';
import { STORE } from '../sim/build/upkeep';
import '../ui/style.css';
import '../ui/hud.css';
import { InventoryUI, type InvActions } from '../ui/inventory-ui';
import { fitScreen, hotbarCells, type HotbarEntry } from '../ui/hud';
import { Radial } from '../ui/radial';
import { RINGS, wheelEntries, wheelSlots } from '../ui/wheel-slots';
import { WHEEL_RING } from '../sim/emotes';
import { BODY_GRID, Container, PlayerInventory, layOnBody } from '../sim/inventory';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import { KITS, type KitThing } from '../sim/kits';
import { freshVitals } from '../game/player';
import { assets } from '../core/assets';
import { renderDoll } from '../ui/icons';
import { wornKey } from '../game/survivors';
import { lookFor } from '../game/look';
import type * as THREE from 'three';
import type { Stash, WorldItem } from '../game/loot';
import { CraftCard } from '../ui/craft-card';
import { CraftingScreen } from '../ui/crafting-ui';
import { LEVEL_NAME, RECIPE, RECIPES, type Level } from '../sim/craft/recipes';
import { madeItems, plan, pocketsOf, recipesFor } from '../sim/craft/plan';
import { TREE, knows, waysToLearn } from '../sim/craft/learn';

const made = (th: KitThing): ItemInstance => {
  const it = makeItem(th.id, th.qty);
  if (th.mag !== undefined) it.mag = th.mag;
  if (th.loaded !== undefined) it.loaded = th.loaded;
  if (th.mods) it.mods = [...th.mods];
  if (th.rounds !== undefined) it.rounds = th.rounds;
  return it;
};
const kitOf = (name: string | null) => KITS.find((k) => k.id === name) ?? KITS[0];

/**
 * the screen asked for, drawn over the sandbox; resolves once its pictures are in
 * @param renderer, env the sandbox's, for the survivor's picture in the middle of the inventory (the live figure is the game's)
 */
export async function stageScreen(q: URLSearchParams, renderer: THREE.WebGLRenderer, env: THREE.Texture | null): Promise<Record<string, unknown>> {
  const touch = q.get('touch') === '1';
  document.body.classList.toggle('touch', touch);
  // (the page scaled to the window as the game scales it)
  fitScreen(touch);
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  // (the pictures of things, as the game has them: public/assets/icons)
  const kept = (await fetch(assets.url('assets/icons/index.json')).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))) as Record<string, string>;
  const icons: Record<string, string> = {};
  for (const id of Object.keys(ITEMS)) if (kept[id]) icons[id] = assets.url(`assets/icons/${id}.webp`);

  // the survivor's pockets: the kit, as a kit is put on (Game.kitUp), and the keys a new life gives (Game.autoHot)
  const inv = new PlayerInventory();
  inv.clear();
  const kit = kitOf(q.get('kit'));
  // (with &craft=1, what is worn first, then the things crafting is made of, and the rest of the kit where it finds room)
  const crafting = q.get('craft') === '1' ? ([['field_trousers'], ['knife'], ['rags', 9], ['rubbing_alcohol', 5], ['ammo_556', 20], ['stone', 10], ['planks', 4], ['bones', 4]] as [string, number?][]) : [];
  for (const th of kit.things) if (!crafting.length || ITEMS[th.id].wear) inv.add(made(th));
  for (const [id, k] of crafting) inv.add(makeItem(id, k));
  // (to research: a found pistol, the parts of one, and scrap)
  const scrapN = Number(q.get('scrap') ?? 0);
  if (scrapN > 0) for (const it of [makeItem('scrap', scrapN), ...madeItems('colt', 1), makeItem('metal_pipe', 1), makeItem('spring', 2), makeItem('gun_body_pistol', 1), makeItem('metal_frags', 120), makeItem('iron_bar', 6)]) inv.add(it);
  if (crafting.length) for (const th of kit.things) if (!ITEMS[th.id].wear) inv.add(made(th));
  inv.autoBind();
  for (const it of [...inv.carried()]) {
    if (!ITEMS[it.id].use || inv.hot.some((b) => b?.id === it.id)) continue;
    const free = inv.hot.findIndex((b, i) => i >= 3 && !b);
    if (free >= 0) inv.bind(free, it);
  }

  const shown: Record<string, unknown> = { kit: kit.id };
  // (the portraits a list of people shows: src/dev/sandbox-heads.ts)
  if (q.get('ui') === 'heads' && env) return { ...shown, ...(await (await import('./sandbox-heads')).stageHeads(q, renderer, env, ui)) };
  if (q.get('ui') === 'wheel') {
    const hud = document.createElement('div');
    hud.id = 'hud';
    ui.appendChild(hud);
    const wheel = new Radial({ rings: RINGS, per: WHEEL_RING, className: 'hud-wheel' });
    wheel.set(wheelEntries(wheelSlots()));
    hud.appendChild(wheel.el);
    (window as unknown as { wheel: Radial }).wheel = wheel;
    return shown;
  }
  if (q.get('ui') === 'hud') {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `<div class="hud-hotbar">${hotbarCells(entries(inv), icons)}</div>`;
    ui.appendChild(hud);
    await pictures(ui);
    return shown;
  }

  // things lying about: a rifle, rounds, a tin, a bottle and a pack with something in it
  let n = 0;
  const lying = (it: ItemInstance) => ({ loot: { uid: `stage-${++n}`, item: it, x: 0, y: 0, z: 0, rot: 0 } }) as unknown as WorldItem;
  const pack = makeItem('black_bag');
  pack.cargo = [{ item: makeItem('beans'), x: 0, y: 0, rot: false }, { item: makeItem('bandage', 3), x: 1, y: 0, rot: false }];
  const vicinity: WorldItem[] = [made({ id: 'ak', mag: 'mag_ak', loaded: 31 }), made({ id: 'ammo_739', qty: 20 }), makeItem('beans'), makeItem('flask'), made({ id: 'mag_ak', rounds: 12 }), pack].map(lying);
  // and the body beside: another kit, laid on it as a body is (layOnBody)
  const box = Object.assign(new Container('stage-body', 'Body', BODY_GRID[0], BODY_GRID[1], [], true), { tagsHere: true });
  layOnBody(box, kitOf(q.get('body') ?? 'assault').things.map(made));
  const body = { uid: 'stage-body', label: 'Body of Sam', container: box, corpse: true, known: true } as unknown as Stash;
  // (`&open=stash_kit`: a stash of that kind open beside them instead, the guns of a kit in it: its width against the screen's)
  const stashId = q.get('open'), room = stashId ? ITEMS[stashId]?.stash : undefined;
  // (`&open=claim`: a claim's store, as big as one is, with its upkeep beside it: src/game/building/claim-panel.ts)
  const claim = stashId === 'claim';
  const opened = claim ? (() => {
    const c = new Container('stage-claim', 'Claim', STORE.w, STORE.h, []);
    for (const [id, n] of [['planks', 60], ['planks', 60], ['stone', 80], ['metal_frags', 40], ['nails', 30]] as [string, number][]) c.add(makeItem(id, n));
    return { uid: 'stage-claim', label: 'Claim', container: c, corpse: false, known: true } as unknown as Stash;
  })() : room ? (() => {
    const c = new Container('stage-stash', ITEMS[stashId!].name, room[0], room[1], []);
    for (const th of kitOf('heavy').things.map(made)) c.add(th);
    return { uid: 'stage-stash', label: ITEMS[stashId!].name, container: c, corpse: false, known: true } as unknown as Stash;
  })() : null;

  let screen: InventoryUI | null = null;
  const actions: InvActions = {
    take: (w) => {
      vicinity.splice(vicinity.indexOf(w), 1);
      return w.loot.item;
    },
    drop: (it) => void vicinity.push(lying(it)),
    use: () => {},
    open: () => {},
    onGround: () => {},
    unload: () => {},
    cut: () => {},
    canCut: () => true,
    attachTargets: () => [],
    attach: () => {},
    detach: () => null,
    fillMag: () => {},
    fillAllMags: () => {},
    emptyMag: () => {},
    looseFor: (mag) => inv.count(ITEMS[mag.id].mag?.ammo ?? ''),
    assignHot: (it, i) => inv.bind(i, it),
    hotIndex: (it) => inv.hotOf(it),
    // (the hands as the game has them: a place of their own, and nothing drawn in them here)
    hold: (it) => {
      const ok = inv.hold(it);
      if (!ok) console.info('no room to put away what is in the hands');
      screen?.render();
      return ok;
    },
    inHands: () => inv.held(),
    goingIn: () => null,
    lying: () => 'mine',
    changed: () => {
      inv.forgetGone();
      screen?.render();
    },
    sound: () => {},
    note: (text) => console.info(text),
    finishFor: () => [],
    applyFinish: () => {},
    plateIcon: () => {},
    reclaim: () => {},
    craftWith: (a, b) => recipesFor(a, b).length > 0,
    craftOnto: (a, b, at) => card.float(recipesFor(a, b), at, [a.uid, b.uid]),
    craftOpen: () => card.open,
  };
  // (made at once here, by the same rule: the hold and the server are the game's)
  const makeNow = (rid: string, k: number, u: string[]) => {
    const got = plan(RECIPE[rid], k, pocketsOf(inv.serialize()), u);
    if (typeof got === 'string') return console.info(got);
    for (const [id, m] of Object.entries(got.pay)) inv.take(id, m);
    for (const uid of got.uids) {
      const it = inv.everything().get(uid);
      if (it) inv.remove(it);
    }
    if (got.makes) for (const it of madeItems(RECIPE[rid].makes, got.makes)) inv.add(it);
    screen?.render();
  };
  const card = new CraftCard({ icons: () => icons, pockets: () => pocketsOf(inv.serialize()), craft: makeNow });
  screen = new InventoryUI(inv, actions);
  screen.icons = icons;
  const ui2 = screen;
  const lv = (Number(q.get('bench') ?? 0) || 0) as Level | 0, table = q.get('table') === '1', jobs = lv ? [{ r: 'hammer', n: 3 }, { r: 'sheet_metal', n: 1 }, { r: 'sledgehammer', n: 1 }] : [];
  const learnedQ = q.get('learned') ?? 'none';
  const known = new Set<string>(learnedQ === 'all' ? RECIPES.map((x) => x.id) : learnedQ === 'tree1' ? TREE[1].map(([id]) => id) : []);
  const where = (x: (typeof RECIPES)[number]) => (x.at === 'hand' ? null : x.at === 'forge' ? 'Smelted at a forge' : lv >= (x.lv ?? 1) ? null : (x.lv ?? 1) > 1 ? `Needs a ${LEVEL_NAME[x.lv ?? 1]} near` : 'Needs a workbench near');
  screen.craftPane = new CraftingScreen({
    icons: () => icons,
    pockets: () => pocketsOf(inv.serialize()),
    craft: makeNow,
    where,
    ways: (x) => waysToLearn(x, known, pocketsOf(inv.serialize()).all, lv, table),
    unlock: (rid) => void known.add(rid),
    research: () => {},
    knows: (id) => knows(known, id),
    level: () => lv,
    atTable: () => table,
    light: (ids) => ui2.lightUp(ids),
    making: () => null,
    queue: () => jobs,
    running: () => (jobs[0] ? { r: RECIPE[jobs[0].r], t: 0.4, left: RECIPE[jobs[0].r].time * 0.6, paused: false } : null),
    unqueue: (i) => void jobs.splice(i, 1),
  });
  // (the survivor, as the inventory shows them until the live figure is ready: the game's still picture, wearing the kit)
  // (the figure as the game draws it still: one of the survivors' bodies, &who=0..3, the first unsaid)
  if (env) screen.doll = await renderDoll(renderer, env, lookFor('Stage'), Object.values(inv.slots).flatMap((it) => (it ? [wornKey(it)] : [])), undefined, false, +(q.get('who') ?? 0));
  screen.open(vicinity, opened ?? body, freshVitals());
  if (claim) {
    const panel = document.createElement('div');
    mountClaimPanel(panel);
    const had: Record<string, number> = { planks: 120, stone: 80, metal_frags: 40 };
    panel.innerHTML = claimPanelHtml({ left: 2 * 86400 + 14 * 3600, dry: false, day: [['planks', 42], ['stone', 18], ['metal_frags', 6]], have: (id) => had[id] ?? 0, names: ['Survivor753', 'Kasia'], on: true }, icons);
  }
  const view = q.get('view');
  if (view) (screen.craftPane as CraftingScreen).showView(view as Parameters<CraftingScreen['showView']>[0]);
  if (q.get('tab') === 'craft') screen.setMode('craft');
  (window as unknown as { stageInv: unknown }).stageInv = { inv, screen, vicinity, card, recipesFor };
  await pictures(ui);
  shown.carried = [...inv.carried()].length;
  shown.lying = vicinity.length;
  shown.onBody = box.items.length;
  return shown;
}

/** the hot bar's entries, as Game.hotbar makes them */
function entries(inv: PlayerInventory): HotbarEntry[] {
  return inv.hot.map((b, i) => {
    const it = b ? inv.hotItem(i) : null, d = it ? ITEMS[it.id] : null;
    const label = !it || !d ? '' : d.weapon ? String(it.loaded ?? 0) : d.mag ? String(it.rounds ?? 0) : d.use?.sips ? `${it.left ?? d.use.sips}/${d.use.sips}` : d.melee || d.slot ? '' : String(inv.count(it.id));
    return { key: String((i + 1) % 10), id: it?.id ?? b?.id ?? null, label, active: false, dim: !!b && !it };
  });
}

/** every picture on the screen decoded, and a frame drawn with them */
async function pictures(root: HTMLElement) {
  const urls = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>('[style*="background-image"]')) {
    const m = /url\(["']?([^"')]+)/.exec(el.style.backgroundImage);
    if (m) urls.add(m[1]);
  }
  await Promise.all([...urls].map((u) => { const img = new Image(); img.src = u; return img.decode().catch(() => {}); }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
