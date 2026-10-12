// The check that it is a person who is asking to play, and not a program (2026-10-12: connections made by a
// program came by the dozen, and stood in the world as players). It is Cloudflare's Turnstile: a small box that
// mostly passes a person without asking anything of them, and hands back a slip that the game gives the server,
// which asks Cloudflare whether the slip is good. The server asks for it only when it is set up to (it says so,
// and with which key, when it turns a game away for the want of one: see Net.wantsProof), and only of somebody it
// has not lately had one from.

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

let loading: Promise<Turnstile | null> | null = null;
/** Cloudflare's own script for it, fetched the first time it is wanted. */
function turnstile(): Promise<Turnstile | null> {
  loading ??= new Promise((done) => {
    const w = window as unknown as { turnstile?: Turnstile; __zonaPerson?: () => void };
    if (w.turnstile) return done(w.turnstile);
    const give = () => done(w.turnstile ?? null);
    w.__zonaPerson = give;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__zonaPerson';
    s.async = true;
    s.onerror = () => done(null);
    document.head.appendChild(s);
    // (a script that never says it has come is not waited for for ever)
    setTimeout(give, 15_000);
  });
  return loading;
}

/**
 * The box is shown over the way in, and this is over when it has a slip to give, or cannot.
 * @param sitekey the key the server said to ask with
 * @returns the slip, or null: the script could not be had, the check failed, or a minute and a half went by
 */
export async function askPerson(sitekey: string): Promise<string | null> {
  const ts = await turnstile();
  if (!ts) {
    loading = null;
    return null;
  }
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 18px;' +
    'background:rgba(12,13,11,0.94);border:1px solid rgba(243,239,230,0.25);color:#f3efe6;font:500 14px/1.3 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:0.08em;text-transform:uppercase;pointer-events:auto;';
  const say = document.createElement('div');
  say.textContent = 'One check that you are a person, and you are in';
  const box = document.createElement('div');
  panel.append(say, box);
  document.body.appendChild(panel);
  return new Promise<string | null>((done) => {
    let id = '', over = false;
    const end = (slip: string | null) => {
      if (over) return;
      over = true;
      clearTimeout(late);
      try {
        if (id) ts.remove(id);
      } catch {
        /* gone already */
      }
      panel.remove();
      done(slip);
    };
    const late = setTimeout(() => end(null), 90_000);
    try {
      id = ts.render(box, {
        sitekey,
        theme: 'dark',
        callback: (slip: string) => end(slip),
        'error-callback': () => end(null),
        'timeout-callback': () => end(null),
      });
    } catch {
      end(null);
    }
  });
}
