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
/** a name's height over its dot, of the view's (about sixteen pixels on a 720-line screen), and how near it is written */
const NAME_H = 0.022;
const NAMES_TO = 250;

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
  /**
   * Each member's name over their dot, near enough, and where each about and alive stands, for the maps and the compass
   * (the owner, 2026-10-27, said yes to "map/compass marks for members, names over their heads"): the names one
   * picture each, made when first wanted; the marks made again twice a second.
   */
  private names = new Map<number, THREE.Sprite>();
  private nameOf = new Map<number, string>();
  marks: { x: number; z: number; name: string }[] = [];
  private marksT = 0;

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
    // (the names made again when they are next wanted: a party changes seldom)
    this.nameOf = new Map(members.flatMap((m) => (m.id !== null ? [[m.id, m.name] as const] : [])));
    for (const tag of this.names.values()) {
      tag.removeFromParent();
      tag.material.map?.dispose();
      tag.material.dispose();
    }
    this.names.clear();
    this.marksT = 0;
    this.list.style.display = members.length ? 'block' : 'none';
    this.list.replaceChildren(
      ...members.map((m) => {
        const row = document.createElement('div');
        row.textContent = m.name + (m.id === null ? ' (away)' : '');
        row.style.opacity = m.id === null ? '0.5' : '1';
        row.style.cssText += ';padding-left:12px;background:radial-gradient(circle at 4px 50%, #86d46f 3px, transparent 3.5px)';
        return row;
      }),
      // (and how to get out of it: "we need commands for players to leave their party once they join one")
      Object.assign(document.createElement('div'), { textContent: '/leave to leave', style: 'margin-top:3px;font-size:10px;opacity:0.55' }),
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

  /**
   * Each frame: a dot over the head of each member who is about and alive, and their name over it when near `from`.
   * @returns whether `marks` were made again
   */
  update(bodies: Map<number, Body>, from: THREE.Vector3, dt: number): boolean {
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
      const near = dot.visible && !!b && b.pos.distanceTo(from) < NAMES_TO;
      let tag = this.names.get(id);
      if (!tag && near) {
        tag = this.nameTag(this.nameOf.get(id) ?? '');
        this.names.set(id, tag);
        this.scene.add(tag);
      }
      if (!tag) continue;
      tag.visible = near;
      tag.position.copy(dot.position);
    }
    if ((this.marksT -= dt) > 0) return false;
    this.marksT = 0.5;
    this.marks = [...this.ids].flatMap((id) => {
      const b = bodies.get(id);
      return b?.alive ? [{ x: b.pos.x, z: b.pos.z, name: this.nameOf.get(id) ?? '' }] : [];
    });
    return true;
  }

  /** a name, drawn once, standing over the dot at the same size at any distance */
  private nameTag(name: string) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 40;
    const g = c.getContext('2d')!;
    g.font = "600 26px 'Barlow Condensed', 'Bahnschrift', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.strokeText(name, 128, 21);
    g.fillStyle = '#d6f0cc';
    g.fillText(name, 128, 21);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false }));
    tag.scale.set(NAME_H * (c.width / c.height), NAME_H, 1);
    // (its foot a little over the dot's middle, on the screen, whatever the distance)
    tag.center.set(0.5, -0.25);
    tag.renderOrder = 999;
    tag.frustumCulled = false;
    return tag;
  }
}
