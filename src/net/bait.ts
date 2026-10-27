// window.__game was the whole game, open to the console of every player's page, until 2026-10-20: a script passed
// round among players reached through it to draw everybody through walls and light the night (the owner, 2026-10-20:
// "confirm this vilnerability and then fix it with emergency restart server and ban anyone using this exploit").
// The game is set on it in development builds only now. In a player's page the name is a trap: nothing of the game
// reads it, so whatever does is a script pasted in, and the server is told (server/admin.ts, baited).
// (The console's preview as a name is typed runs nothing that writes, so it never springs this.)

let read: string | null = null;
let tell: ((what: string) => void) | null = null;

/** These names on window, laid as traps. */
export function layBait(names: string[]) {
  for (const name of names) {
    Object.defineProperty(window, name, {
      configurable: false,
      enumerable: false,
      get() {
        spring(name);
        return undefined;
      },
      set() {
        spring(name);
      },
    });
  }
}

/** a trap sprung: the first only is told (src/net/hook-trap.ts springs one of its own) */
export function spring(name: string) {
  if (read) return;
  read = name;
  tell?.(name);
}

/** Who is told when a trap is sprung: at once if one already was (sprung before the game was connected). */
export function onBait(f: (what: string) => void) {
  tell = f;
  if (read) f(read);
}
