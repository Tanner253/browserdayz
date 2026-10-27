// three.js hands every scene and renderer it makes to window.__THREE_DEVTOOLS__ when a page has one (its inspector's
// hook): a script that sets it before the game loads is given the whole world, and can draw everybody through walls
// (the owner, 2026-10-27: "someone is cheating running code in the browser to get ESP hacks on"). Nothing of ours sets
// it, so one found here is a script's, and the server is told as for window.__game (src/net/bait.ts). It is then taken
// away before three loads, so three finds none: this file is main.ts's first import for that.
import { spring } from './bait';

const NAME = '__THREE_DEVTOOLS__';

const BAITED = !import.meta.env.DEV || new URLSearchParams(location.search).has('bait');

if (BAITED) {
  // (set at the page's start, before any of the game ran)
  if (NAME in window) spring(NAME);
  try {
    Object.defineProperty(window, NAME, { configurable: false, enumerable: false, get: () => undefined, set: () => spring(NAME) });
  } catch {
    // (one laid so that it cannot be taken away: three is handed the world all the same, and the server was told)
  }
}

// And a script that hooks the game rather than reading it (the owner, 2026-10-27: "nobody should be running client code
// on the game"): what an ESP or a wallhack must wrap to work, the socket the positions come in on and WebGL's drawing,
// is held against what the browser made. A wrapped one is no longer the browser's own code: its source is the proof,
// read with the toString of a frame of the page's own that no script has touched. Nothing of ours wraps these.
const WATCHED: [string, () => unknown][] = [
  ['WebSocket', () => window.WebSocket],
  ['WebSocket.send', () => WebSocket.prototype.send],
  ['MessageEvent.data', () => Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')?.get],
  ['JSON.parse', () => JSON.parse],
  ...(['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'uniformMatrix4fv', 'useProgram'] as const).flatMap((k): [string, () => unknown][] => [
    [`WebGL2.${k}`, () => (globalThis.WebGL2RenderingContext?.prototype as unknown as Record<string, unknown> | undefined)?.[k]],
    [`WebGL.${k}`, () => (globalThis.WebGLRenderingContext?.prototype as unknown as Record<string, unknown> | undefined)?.[k]],
  ]),
  ['Function.toString', () => Function.prototype.toString],
];

/** the first watched function that is not the browser's own, and its source (null: none) */
function hooked(source: (f: unknown) => string): { name: string; code: string } | null {
  for (const [name, get] of WATCHED) {
    let f: unknown;
    try {
      f = get();
    } catch {
      continue;
    }
    if (typeof f !== 'function') continue;
    const code = source(f);
    if (code && !/\{\s*\[native code\]\s*\}\s*$/.test(code)) return { name, code };
  }
  return null;
}

if (BAITED) {
  const watch = () => {
    // (a frame of the page's own, blank: its Function.toString is the browser's, whatever was done to this one's)
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    document.body.append(frame);
    const own = (frame.contentWindow as (Window & typeof globalThis) | null)?.Function.prototype.toString;
    if (!own) return;
    const source = (f: unknown) => {
      try {
        return own.call(f);
      } catch {
        return '';
      }
    };
    const look = () => {
      const h = hooked(source);
      if (h) spring(`hooked ${h.name}`, h.code);
      else setTimeout(look, 20_000);
    };
    look();
  };
  if (document.body) watch();
  else addEventListener('DOMContentLoaded', watch, { once: true });
}
