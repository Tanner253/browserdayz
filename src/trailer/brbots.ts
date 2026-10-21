// The other players in the battle royale's film (shots25.ts): sockets this page opens to the film's arena server
// (tools/br-film/vclock.mjs, whose clock the film moves on frame by frame) and moves itself, as people move
// (src/trailer/human.ts). Each says only what a player's own game says: the hello of src/net/client.ts, the pose 's',
// shots, and the battle royale's 'br' words (arena/br/wire.ts). The server cannot tell them from a player.
import { PROTOCOL } from '../net/protocol';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** the pose's flags (src/net/protocol.ts) a body on its feet sends */
export const F_GROUND = 8, F_CROUCH = 1, F_SPRINT = 2, F_AIM = 4;

export class BrBot {
  ws: WebSocket;
  id = -1;
  /** the server's latest words to it, by kind */
  lobby: Any = null;
  me: Any = null;
  state: Any = null;
  plane: Any = null;
  zone: Any = null;
  over: Any = null;
  hp = 100;
  put: [number, number, number] | null = null;
  pose: number[] = [0, 0, 0, 0, 0, 0];
  /** the gun in its hands, as the pose says it */
  w: string | null = null;
  constructor(url: string, public name: string, seed: number) {
    const key = `film-${name}-${seed}-xxxxxxxxxxxxxxxx`.slice(0, 40);
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL, key, name });
    this.ws.onmessage = (e) => {
      let m: Any;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === 'welcome') this.id = m.you;
      else if (m.t === 'put') this.put = [m.x, m.y, m.z];
      else if (m.t === 'hp') this.hp = m.health;
      else if (m.t === 'br') {
        if (m.k === 'lobby') this.lobby = m;
        else if (m.k === 'me') this.me = m;
        else if (m.k === 'state') this.state = m;
        else if (m.k === 'plane') this.plane = m;
        else if (m.k === 'zone') this.zone = m;
        else if (m.k === 'over') this.over = m;
      } else if (m.t === 'kick') console.log(`[tr] ${this.name} was sent away: ${m.reason}`);
    };
  }
  get open() { return this.ws.readyState === 1; }
  send(m: object) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  br(m: object) {
    this.send({ t: 'br', ...m });
  }
  /** where it is this frame, and what it is doing (the flags), as its game would say it */
  move(x: number, y: number, z: number, yaw: number, pitch = 0, flags = F_GROUND) {
    this.pose = [x, y, z, yaw, pitch, flags];
    this.send({ t: 's', p: this.pose, w: this.w, m: [] });
  }
  /** a round fired from its eye along a direction, as its game says one (the server traces it: arena/br/match.ts shot) */
  fire(o: [number, number, number], d: [number, number, number]) {
    this.send({ t: 'shot', o, d, w: this.w ?? 'm9' });
  }
  close() {
    try { this.ws.close(); } catch { /* gone */ }
  }
}
