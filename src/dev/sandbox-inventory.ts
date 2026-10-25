// The sandbox's screens (2026-10-24, the owner: "all sessions should use the stage for development ... then once its all
// tested in the stage we can plug it in to the world"): the real inventory over the plain sandbox, with a kit on, things
// lying about and a body beside to go through; or the hot bar at the foot of the screen alone. No world, no server.
//
//   &ui=inventory&kit=heavy        the inventory, open, as a survivor with that kit has it (src/sim/kits.ts KITS)
//   &body=marksman                 the kit on the body beside (default: assault)
//   &ui=hud                        the hot bar at the foot of the screen, as in play
//   &ui=wheel                      the wheel on T (src/ui/radial.ts) by itself: window.wheel is it, to be pointed by a script
//   &touch=1                       as a phone has it
// What is done in it (a drag, a key, a drop) is done to these pockets alone, and nothing is kept.

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
import { lookFor } from '../game/look';
import type * as THREE from 'three';
import type { Stash, WorldItem } from '../game/loot';

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
  for (const th of kit.things) inv.add(made(th));
  inv.autoBind();
  for (const it of [...inv.carried()]) {
    if (!ITEMS[it.id].use || inv.hot.some((b) => b?.id === it.id)) continue;
    const free = inv.hot.findIndex((b, i) => i >= 3 && !b);
    if (free >= 0) inv.bind(free, it);
  }

  const shown: Record<string, unknown> = { kit: kit.id };
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
  const opened = room ? (() => {
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
    finishFor: () => null,
    applyFinish: () => {},
    plateIcon: () => {},
  };
  screen = new InventoryUI(inv, actions);
  screen.icons = icons;
  // (the survivor, as the inventory shows them until the live figure is ready: the game's still picture, wearing the kit)
  if (env) screen.doll = await renderDoll(renderer, env, lookFor('Stage'), Object.values(inv.slots).flatMap((it) => (it ? [it.id] : [])));
  screen.open(vicinity, opened ?? body, freshVitals());
  (window as unknown as { stageInv: unknown }).stageInv = { inv, screen, vicinity };
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
