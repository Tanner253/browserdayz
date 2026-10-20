// The keys that do something now, for the bottom-left corner: swapped as what the player is doing changes. The owner,
// 2026-10-20: "notice we dont render the controls all the tim ein the bottom left like we should, we do it for mouse
// sometimes but we should also add for other things like QE strafe in the heli, C go down etc".
// Each key is the one the code reads for that thing (garage.ts for the seats, player.ts for the feet, weapons.ts for
// the guns, frame.ts and hands.ts for an admin's, gamepad.ts for a controller's), asked of the bindings as they are
// now (`shown`), so a key put elsewhere in Settings is shown where it is. A phone has its own buttons: nothing here.
import { ITEMS } from '../sim/items';
import { GUNS } from '../sim/gunplay';
import { POLICE_CAR } from '../sim/vehicles';
import { shown } from '../core/keys';
import { Heli } from './heli';
import type { Game } from './game';

/** a key or two and what they do; `mouse` draws the mouse with that button lit in place of a key */
export interface KeyRow {
  keys: string[];
  text: string;
  mouse?: 'l' | 'r' | 'w';
}
export interface KeyHints {
  rows: KeyRow[];
  /** how many of the first rows are this moment's own (a seat's, a gun's): kept when the rest go quiet */
  own: number;
  /** what the player is doing, as far as the keys go (a seat, a gun, a view): all of them are shown again only when
   * this changes, not as the sights go up and down */
  mode: string;
}

/** a controller's buttons, as gamepad.ts reads them, named as the pad in the hands has them */
const padNames = (xbox: boolean) => ({
  r2: xbox ? 'RT' : 'R2', l2: xbox ? 'LT' : 'L2', x: xbox ? 'A' : '✕', o: xbox ? 'B' : '○', sq: xbox ? 'X' : '□', tri: xbox ? 'Y' : '△',
  l1: xbox ? 'LB' : 'L1', r1: xbox ? 'RB' : 'R1', l3: xbox ? 'LS' : 'L3', r3: xbox ? 'RS' : 'R3', menu: xbox ? 'View' : 'Touchpad', stick: 'L stick',
});

export function keyHints(g: Game): KeyHints | null {
  const p = g.player, w = g.weapons;
  if (!g.started || g.paused || p.dead || g.touch || g.awaitClick) return null;
  if (g.invUI.isOpen || g.shop.isOpen || g.map.open || g.adminUI.isOpen || g.hud.emotes.isOpen || g.hud.chatOpen) return null;
  const pad = g.input.pad, P = padNames(document.body.dataset.pad === 'xbox');
  const own: KeyRow[] = [], rest: KeyRow[] = [];
  /** a row with its keyboard keys and a controller's buttons (null: it has none there, and is left out) */
  const put = (to: KeyRow[], text: string, kb: string[] | null, pd: string[] | null) => {
    const keys = pad ? pd : kb;
    if (keys) to.push({ keys, text });
  };
  /** a mouse button: drawn, unless the player has put what it does on a key */
  const click = (to: KeyRow[], text: string, on: 'l' | 'r', pd: string) => {
    if (pad) return void to.push({ keys: [pd], text });
    const k = shown(on === 'l' ? 'Mouse0' : 'Mouse2');
    to.push(k === (on === 'l' ? 'LMB' : 'RMB') ? { keys: [], text, mouse: on } : { keys: [k], text });
  };
  const k = shown;
  const done = (mode: string): KeyHints => ({ rows: [...own, ...rest], own: own.length, mode: `${pad ? 'pad ' : ''}${mode}` });

  // an admin's views: the view flown off by itself, and the body flown (frame.ts reads K and N, hands.ts and
  // player.ts the rest). Theirs are a keyboard's whatever is plugged in: there is no button for either.
  if (g.freecam) {
    own.push({ keys: [k('KeyW'), k('KeyA'), k('KeyS'), k('KeyD')], text: 'Fly' }, { keys: [k('Space')], text: 'Up' }, { keys: [k('KeyC')], text: 'Down' });
    own.push({ keys: [k('ShiftLeft')], text: 'Faster' }, { keys: [k('AltLeft')], text: 'Slower' }, { keys: [], text: 'Speed', mouse: 'w' });
    own.push({ keys: ['H'], text: 'Bring the body here' }, { keys: ['K'], text: 'Back to the body' });
    return done('freecam');
  }
  if (p.fly) {
    own.push({ keys: [k('KeyW'), k('KeyA'), k('KeyS'), k('KeyD')], text: 'Fly' }, { keys: [k('Space')], text: 'Up' }, { keys: [k('KeyC')], text: 'Down' });
    own.push({ keys: [k('ShiftLeft')], text: 'Faster' }, { keys: [k('AltLeft')], text: 'Slower' }, { keys: ['N'], text: 'Land' });
    return done('fly');
  }

  // in a seat (garage.ts step; F out in interact.ts; Ctrl and a number in frame.ts)
  const r = g.garage.ride;
  if (r) {
    const seats = g.garage.seatList()?.length ?? 0;
    if (r.seat === 0 && r.jeep instanceof Heli) {
      put(own, 'Up', [k('Space')], [P.x]);
      put(own, 'Down', [k('KeyC')], [P.o]);
      if (pad) put(own, 'Forward · back · turn', null, [P.stick]);
      else own.push({ keys: [k('KeyW'), k('KeyS')], text: 'Forward · back' }, { keys: [k('KeyA'), k('KeyD')], text: 'Turn' });
      put(own, 'Strafe', [k('KeyQ'), k('KeyE')], [P.l1, P.r1]);
    } else if (r.seat === 0) {
      put(own, 'Drive', [k('KeyW'), k('KeyA'), k('KeyS'), k('KeyD')], [P.stick]);
      put(own, 'Handbrake', [k('Space')], [P.x]);
      put(own, 'Horn (hold)', ['H'], [P.l3]);
      if (r.jeep.kind === POLICE_CAR.kind) put(own, 'Siren', ['J'], [P.r3]);
    }
    // (a controller has no way out of a seat yet: its □ is F only facing something, and nothing is faced from a seat)
    put(own, 'Get out', [k('KeyF')], null);
    if (seats > 1) put(own, 'Change seat', ['Ctrl', `1–${Math.min(4, seats)}`], null);
    put(rest, 'Map', [k('KeyM')], ['↑']);
    put(rest, 'Talk (hold)', [k('KeyV')], ['→ held']);
    return done(`seat ${r.jeep.kind} ${r.seat === 0 ? 0 : 1}`);
  }

  // what is in the hands (weapons.ts update: the gun's keys, a blade's, the bare fists')
  const it = w.equippedItem, def = it ? ITEMS[it.id] : null, gun = def?.weapon;
  if (it && gun) {
    if (gun.akimbo) {
      click(own, 'Fire left', 'l', P.r2);
      click(own, 'Fire right', 'r', P.l2);
    } else {
      click(own, 'Fire', 'l', P.r2);
      click(own, 'Aim', 'r', P.l2);
    }
    put(own, 'Reload', [k('KeyR')], [P.sq]);
    const mode = w.modeKey(it);
    if (mode) put(own, mode, [k('KeyB')], ['←']);
    if ((GUNS[it.id]?.zero?.length ?? 0) >= 2) put(own, 'Sights range', [k('PageUp'), k('PageDown')], null);
    if (w.scoped && w.zoom !== null) pad ? put(own, 'Zoom', null, [P.l1, P.r1]) : own.push({ keys: [], text: 'Zoom', mouse: 'w' });
    if (w.aiming) put(own, 'Hold breath', [k('ShiftLeft')], [`${P.l3} held`]);
    else {
      put(own, 'Look it over', [k('KeyI')], ['→']);
      pad ? put(own, 'Next gun', null, [P.tri]) : own.push({ keys: [], text: 'Next gun', mouse: 'w' });
    }
    put(own, 'Empty hands', [k('KeyX')], [`${P.tri} held`]);
  } else if (it && def?.melee) {
    click(own, 'Swing', 'l', P.r2);
    click(own, 'Block', 'r', P.l2);
    put(own, 'Empty hands', [k('KeyX')], [`${P.tri} held`]);
  } else if (g.inHand) {
    // (the mouse for what is held is drawn above, by handActs)
    put(own, 'Empty hands', [k('KeyX')], [`${P.tri} held`]);
    put(own, 'Drop it (hold)', [k('KeyG')], ['← held']);
  } else if (!it) {
    click(own, 'Punch', 'l', P.r2);
    click(own, 'Guard', 'r', P.l2);
  }

  // on foot (player.ts step), and what is always to hand
  if (!w.aiming) put(rest, 'Sprint', [k('ShiftLeft')], [P.l3]);
  put(rest, 'Crouch', [k('KeyC')], [P.o]);
  put(rest, 'Lie down', [k('KeyZ')], [`${P.o} held`]);
  put(rest, 'Lean', [k('KeyQ'), k('KeyE')], w.aiming ? [P.l3, P.r3] : null);
  put(rest, 'Inventory', [k('Tab')], [P.menu]);
  put(rest, 'Map', [k('KeyM')], ['↑']);
  put(rest, 'Call out (hold)', [k('KeyT')], ['↓ held']);
  if (w.hasLamp || g.inv.count('flashlight') > 0) put(rest, 'Light', [k('KeyL')], w.aiming ? null : [P.r3]);
  // (the panel is anyone's with a role; N and K an admin's: frame.ts)
  if (g.role && g.online) put(rest, 'Admin panel', [k('Backquote')], null);
  if (g.role === 'admin' && g.online) {
    put(rest, 'Noclip', ['N'], null);
    put(rest, 'Free camera', ['K'], null);
  }
  return done(it ? it.id : g.inHand ? 'hand' : 'fists');
}
