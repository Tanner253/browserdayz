// The pads the helicopters stand on (src/sim/heli.ts: on the hospital's roof, and by the fort): a painted circle and
// an H, as every pad has. On the roof, paint on the roof; by the fort, a round of concrete cleared and painted, laid
// on the ground point by point so that it lies on it (judged where it meets it) and neither floats nor sinks.
import * as THREE from 'three';
import { heliSpots } from '../sim/heli';
import { heightAt, type World } from './worldgen';

/** metres across, and how many squares a side the ground's pad is laid in (each corner on the ground) */
const PAD = { wide: 11, cells: 22, lift: 0.04 };

function paint(concrete: boolean): THREE.CanvasTexture {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, m = S / 2;
  if (concrete) {
    // a round of grey concrete, its edge worn into whatever is about it
    const edge = g.createRadialGradient(m, m, m * 0.86, m, m, m);
    edge.addColorStop(0, 'rgba(142,140,134,1)');
    edge.addColorStop(1, 'rgba(142,140,134,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, S, S);
    // (stained and patched: a few hundred darker and lighter flecks)
    for (let i = 0; i < 900; i++) {
      const a = (i * 2.399963) % (Math.PI * 2), r = Math.sqrt((i * 0.618034) % 1) * m * 0.85;
      g.fillStyle = `rgba(${i % 3 ? 90 : 170},${i % 3 ? 88 : 168},${i % 3 ? 84 : 160},0.12)`;
      g.fillRect(m + Math.cos(a) * r, m + Math.sin(a) * r, 3 + (i % 7), 2 + (i % 5));
    }
  }
  // the ring and the H, in white paint gone dull
  g.strokeStyle = g.fillStyle = 'rgba(232,230,220,0.92)';
  g.lineWidth = S * 0.035;
  g.beginPath();
  g.arc(m, m, m * 0.7, 0, Math.PI * 2);
  g.stroke();
  const w = S * 0.07, h = S * 0.42, gap = S * 0.22;
  g.fillRect(m - gap / 2 - w, m - h / 2, w, h);
  g.fillRect(m + gap / 2, m - h / 2, w, h);
  g.fillRect(m - gap / 2, m - w / 2, gap, w);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The pads, as things to put in the scene. `register` is what makes a thing lit as the world is (the atmosphere's). */
export function helipads(world: World, register: (m: THREE.Material) => void): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const s of heliSpots(world)) {
    const mat = new THREE.MeshStandardMaterial({ map: paint(!s.roof), transparent: true, depthWrite: false, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    register(mat);
    const geo = new THREE.PlaneGeometry(PAD.wide, PAD.wide, s.roof ? 1 : PAD.cells, s.roof ? 1 : PAD.cells).rotateX(-Math.PI / 2);
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // (turned as the helicopter stands, so its H lies along it; each corner on the ground under it, or on the roof)
      const lx = pos.getX(i), lz = pos.getZ(i), x = s.x + lx * c + lz * sn, z = s.z - lx * sn + lz * c;
      pos.setXYZ(i, x, (s.roof ? s.y : heightAt(world.surface, x, z)) + PAD.lift, z);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'helipad';
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    out.push(mesh);
  }
  return out;
}
