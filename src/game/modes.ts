// The three games of one page (the owner, 2026-10-21: "Shouldn't I be able to switch between all modes without refresh
// ... why does the main menu download have to go everytime"). The whole map is built once, whichever game the page came
// up in. The Arena and the battle royale hide what stands outside their own ground instead of throwing it away (they
// were cut for frames: "we have smaller maps for performance"), and each game's screens, edges and connection are made
// and taken down in place. Which game is played is still the page's address: /zona, /arena, /battleroyale?kills=<map>.
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, GLASS_GROUPS } from '../core/physics';
import { CUT, arenaCorners, nearArena } from '../../arena/rules';
import { MAPS as BR_MAPS } from '../../arena/br/rules';
import { brCorners, brMapOfPage } from './br/cut';
import { heightAt } from '../world/worldgen';
import { ArenaMenu } from '../ui/arena-menu';
import { BrMenu } from '../ui/br/menu';
import type { Mode } from '../ui/door';
import type { Game } from './game';
import { freshVitals } from './player';

/** how far past a battle royale map's edge what stands is still drawn, metres (what is seen over the edge; then the ground alone) */
const BR_MARGIN = 60;
/** and past the Arena's square */
const ARENA_MARGIN = 4;

export class Modes {
  mode: Mode = 'zona';
  /** the battle royale's map, while it is played (-1: none) */
  brMap = -1;
  /** what is the Zone's alone, out of sight in the Arena: the sea, the rivers, the west's towns, the pass, the road */
  readonly zonaOnly: THREE.Object3D[] = [];
  /** what stops a body at the edge of the ground played on: the Arena's square or the battle royale's map */
  private edge: RAPIER.Collider[] = [];
  private arenaMenu: ArenaMenu | null = null;
  private brMenu: BrMenu | null = null;

  constructor(private game: Game) {}

  /** whether a thing standing at x, z is on the ground the game is played on, or near enough its edge to be seen (null: the whole map) */
  private area(): ((x: number, z: number) => boolean) | null {
    const world = this.game.s.world;
    if (this.mode === 'arena') return (x, z) => nearArena(world, x, z, ARENA_MARGIN);
    if (this.mode === 'br') {
      const m = BR_MAPS[this.brMap];
      return (x, z) => x > m.x0 - BR_MARGIN && x < m.x1 + BR_MARGIN && z > m.z0 - BR_MARGIN && z < m.z1 + BR_MARGIN;
    }
    return null;
  }

  /** The page set up for a game (and the battle royale's map): what is drawn, its edges, its menu. */
  async enter(mode: Mode, brMap = -1) {
    const g = this.game, { world, veg, buildings } = g.s;
    this.mode = mode;
    this.brMap = mode === 'br' ? brMap : -1;
    // (the Arena's menu circles its fort, and none of the open world's scenes are played behind it: Game.menuCamera)
    CUT.arena = mode === 'arena';
    const area = this.area();
    veg.only(area);
    buildings.only(area);
    g.cellars.only(area);
    for (const p of g.pads) {
      const s = (p as THREE.Mesh).geometry?.boundingSphere;
      p.visible = !area || !s || area(s.center.x, s.center.z);
    }
    // (the ground about the Arena's square out to the hills round it, as its page was once built: bare ground is cheap,
    // and cut off at the wall it hung in the sky in pieces. A tile is kept if its middle is within 300 m and half its
    // own breadth of the square.)
    g.s.terrain.shown(mode === 'arena' ? (x0, z0, x1, z1) => nearArena(world, (x0 + x1) / 2, (z0 + z1) / 2, 300 + Math.hypot(x1 - x0, z1 - z0) / 2) : null);
    for (const o of this.zonaOnly) o.visible = mode !== 'arena';
    if (mode === 'arena') {
      // what stops a body at the arena's edge, over its low wall: as a pane of glass does, a body and not a shot
      const c = arenaCorners(world);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4], yaw = Math.atan2(-(bz - az), bx - ax), y = Math.max(...[[ax, az], [bx, bz]].map(([x, z]) => heightAt(world.heights, x, z)));
        this.edge.push(physics.addStaticQuat(physics.R.ColliderDesc.cuboid(Math.hypot(bx - ax, bz - az) / 2, 40, 0.3), 'concrete', { x: (ax + bx) / 2, y, z: (az + bz) / 2 }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, undefined, GLASS_GROUPS));
      }
      this.arenaMenu = new ArenaMenu(g.hud);
      // (out of the wait for a match: still loading, the Deploy that waits for it is let go; connected, the place given up)
      this.arenaMenu.onLeave = (waiting) => (!waiting ? g.toArena() : g.wantIn ? ((g.wantIn = false), g.hud.showStart(true)) : g.net.leaveQueue());
      // (its fort made whole now, not as somebody comes near it)
      if (g.castle) await g.castle.whole();
    }
    if (mode === 'br') {
      // the battle royale map's edge: a wall nobody sees and nobody walks through (its own circle of gas is what is seen)
      const c = brCorners(BR_MAPS[brMap]);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4], yaw = Math.atan2(-(bz - az), bx - ax);
        this.edge.push(physics.addStaticQuat(physics.R.ColliderDesc.cuboid(Math.hypot(bx - ax, bz - az) / 2, 400, 0.3), 'concrete', { x: (ax + bx) / 2, y: 0, z: (az + bz) / 2 }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, undefined, GLASS_GROUPS));
      }
      this.brMenu = new BrMenu(g.hud, brMap);
      // (its Leave says so to the server first, then back at its menu with the page as it is: Game.toBr)
      this.brMenu.onLeave = () => {
        g.br?.leave();
        setTimeout(() => g.toBr(), 150);
      };
    }
  }

  /** Out of the game played now, back to the page as it was built: its connection, its people and things, its menu, its edges. */
  leave() {
    const g = this.game;
    // (a way in still on its way: let go, and what comes of it nobody's, see Game.join)
    g.joinGen++;
    if (g.joining) g.net.leaveQueue();
    // (dead in the Zone, and gone from it by the main menu: alive in the next game, the body left to the Zone's server)
    if (g.player.dead) {
      g.player.dead = false;
      g.player.vitals = freshVitals();
      g.deathInfo = '';
    }
    if (g.invUI.isOpen) g.toggleInventory(false);
    g.idle();
    // (whatever the Zone's server had put down: taken up, as a welcome would take it up, see Game.leaveOnline)
    g.leaveOnline();
    this.arenaMenu?.destroy();
    this.arenaMenu = null;
    this.brMenu?.destroy();
    this.brMenu = null;
    g.br?.detach();
    g.br = null;
    // (the Arena's and the battle royale's free reload: the Zone's guns are filled from magazines)
    g.weapons.freeReload = false;
    for (const c of this.edge) physics.world.removeCollider(c, false);
    this.edge = [];
    CUT.arena = false;
  }

  /**
   * Another game on this page as it is (the main menu's pick, or the battle royale's lobby on another map): nothing
   * loaded again. `brMap`: the battle royale's map, left out the server's pick (its open lobby's); `search`: its address
   * (a lobby to go straight into, src/ui/br/menu.ts).
   */
  async switchTo(mode: Mode, brMap?: number, search?: string) {
    const g = this.game;
    this.leave();
    if (mode === 'br' && brMap === undefined) {
      history.replaceState(null, '', '/battleroyale');
      brMap = await brMapOfPage();
    }
    history.replaceState(null, '', mode === 'br' ? `/battleroyale?${search ?? `kills=${brMap}`}` : `/${mode}`);
    // (the way in up first: the menu made next shows itself over it, and one sent straight into a lobby goes in from it)
    g.hud.showStart(true);
    await this.enter(mode, brMap ?? -1);
  }
}
