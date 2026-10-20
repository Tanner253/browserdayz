// Your party (2026-10-19, the lite first one: see server/party.ts). Who is in it; a small green dot over each of them who
// is about (the owner: "Teamates should see some indicator abover their teamates letting them know friendly. it should be
// small and subtle. like rust"); and their names, small, at the side of the screen. The dot is a few pixels at any
// distance and is seen through walls, as Rust's are; the names are written only when the party changes (the HUD's
// writing every frame cost a fifth of the frame once, 2026-10-18).
import * as THREE from 'three';

type Member = { id: number | null; name: string };
type Body = { pos: THREE.Vector3; alive: boolean; crouched: boolean };

/** how long an invite stands, ms (as the server holds it) */
const ASKED_FOR = 120_000;
/** the dot's size, of the view's height at a metre: about seven pixels on a 720-line screen */
const DOT = 0.014;

export class Party {
  members: Member[] = [];
  /** the ids, on this server, of the others in it */
  ids = new Set<number>();
  /** who asked you to join theirs, and when */
  private asked = new Map<number, number>();
  /** whom you asked, and when (an F held down is not ten asks) */
  private sentTo = new Map<number, number>();
  private dots = new Map<number, THREE.Sprite>();
  private material: THREE.SpriteMaterial;
  private list = document.createElement('div');

  constructor(private scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.beginPath();
    g.arc(16, 16, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#86d46f';
    g.beginPath();
    g.arc(16, 16, 10, 0, Math.PI * 2);
    g.fill();
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false });
    this.list.style.cssText = 'position:fixed;left:14px;top:38%;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.78);text-shadow:0 1px 2px #000;pointer-events:none;display:none;z-index:5';
    document.getElementById('ui')?.appendChild(this.list);
  }

  /** who is in it now (none: in no party); `me` is this player's own id, who is not marked */
  set(members: Member[], me: number) {
    this.members = members;
    this.ids = new Set(members.filter((m) => m.id !== null && m.id !== me).map((m) => m.id!));
    for (const [id, dot] of this.dots) {
      if (this.ids.has(id)) continue;
      dot.removeFromParent();
      this.dots.delete(id);
    }
    this.list.style.display = members.length ? 'block' : 'none';
    this.list.replaceChildren(
      ...members.map((m) => {
        const row = document.createElement('div');
        row.textContent = m.name + (m.id === null ? ' (away)' : '');
        row.style.opacity = m.id === null ? '0.5' : '1';
        row.style.cssText += ';padding-left:12px;background:radial-gradient(circle at 4px 50%, #86d46f 3px, transparent 3.5px)';
        return row;
      }),
    );
  }

  ask(from: number) {
    this.asked.set(from, performance.now());
  }

  sent(id: number) {
    this.sentTo.set(id, performance.now());
  }

  /** did you ask them a moment ago */
  wasSent(id: number) {
    const at = this.sentTo.get(id);
    return at !== undefined && performance.now() - at < 8000;
  }

  /** did the player of this id ask you to join theirs, not long ago */
  askedBy(id: number) {
    const at = this.asked.get(id);
    return at !== undefined && performance.now() - at < ASKED_FOR;
  }

  /** each frame: a dot over the head of each member who is about and alive */
  update(bodies: Map<number, Body>) {
    for (const id of this.ids) {
      const b = bodies.get(id);
      let dot = this.dots.get(id);
      if (!dot) {
        dot = new THREE.Sprite(this.material);
        dot.scale.setScalar(DOT);
        dot.renderOrder = 999;
        dot.frustumCulled = false;
        this.dots.set(id, dot);
        this.scene.add(dot);
      }
      dot.visible = !!b?.alive;
      if (b) dot.position.set(b.pos.x, b.pos.y + (b.crouched ? 1.4 : 1.98), b.pos.z);
    }
  }
}
