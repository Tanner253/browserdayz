// A place the player marks on the map for themself (double-click or double-tap the sheet opened large, M): a pin
// there, and the same pin on the corner map, on its rim when the place is out of its view, with how far it is.
// One pin at a time, kept in this browser only: it is a note to oneself, never sent to the server or anybody else.

export interface Pin { x: number; z: number }

const KEY = 'zona.bookmark';

let pin: Pin | null = load();
/** raised on every change, so a map that draws only when something moved knows to draw again */
let rev = 0;

function load(): Pin | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Pin | null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null;
  } catch {
    return null;
  }
}

export function bookmark(): Pin | null {
  return pin;
}

export function bookmarkRev(): number {
  return rev;
}

export function setBookmark(p: Pin | null) {
  pin = p && { x: Math.round(p.x), z: Math.round(p.z) };
  rev++;
  try {
    if (pin) localStorage.setItem(KEY, JSON.stringify(pin));
    else localStorage.removeItem(KEY);
  } catch {
    /* a browser that keeps nothing: the pin lasts this session */
  }
}

/** metres as a player reads them: "85 m", "1.4 km" */
export function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** how a map draws its player's arrow: the pin is drawn the same way on it, so it reads as yours */
export interface Ink { fill: string; edge: string; halo?: string }

/** a map pin with its point at (x, y), its head r across the middle */
export function drawPin(g: CanvasRenderingContext2D, x: number, y: number, r: number, ink: Ink) {
  const cy = y - r * 1.9;
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x - r * 0.35, cy + r * 0.95, x - r, cy + r * 0.6, x - r, cy);
  g.arc(x, cy, r, Math.PI, 0);
  g.bezierCurveTo(x + r, cy + r * 0.6, x + r * 0.35, cy + r * 0.95, x, y);
  g.closePath();
  if (ink.halo) {
    g.lineWidth = Math.max(2, r * 0.55);
    g.strokeStyle = ink.halo;
    g.stroke();
  }
  g.fillStyle = ink.fill;
  g.fill();
  g.lineWidth = Math.max(1.2, r * (ink.halo ? 0.16 : 0.28));
  g.strokeStyle = ink.edge;
  g.stroke();
  g.beginPath();
  g.arc(x, cy, r * 0.38, 0, Math.PI * 2);
  g.fillStyle = ink.edge;
  g.fill();
}

/** a label with a dark shadow under it, as the maps' other words are */
export function drawLabel(g: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, align: CanvasTextAlign = 'center') {
  g.font = `700 ${Math.round(px)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
  g.textAlign = align;
  g.fillStyle = 'rgba(0, 0, 0, 0.75)';
  g.fillText(s, x + 1, y + 1);
  g.fillStyle = '#fff8e0';
  g.fillText(s, x, y);
}
