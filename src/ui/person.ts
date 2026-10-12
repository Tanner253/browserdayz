// The check that it is a person who is asking to play, and not a program (2026-10-12: connections made by a
// program came by the dozen, and stood in the world as players). It is Cloudflare's Turnstile: a box that asks a
// person to tick it when Cloudflare is in any doubt of them, and hands back a slip that the game gives the server,
// which asks Cloudflare whether the slip is good. Where the server is set up for it, it is shown to everybody the
// moment they press Deploy, every time, in the middle of the screen; and nobody is let in without it
// ("an interactive captcha that shows when you click deploy and either allows or prevents the player into the game").

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

const el = (tag: string, css: string, text = '') => {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
};
const TYPE = 'font-family:"Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;';

/**
 * The check is shown over the whole of the way in, and this is over when it has a slip to give, or cannot.
 * @param sitekey the key the server said to ask with
 * @returns the slip, or null: the script could not be had, the check failed, it was given up, or two minutes went by
 */
export async function askPerson(sitekey: string): Promise<string | null> {
  const veil = el('div', 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(6,7,5,0.78);pointer-events:auto;');
  const card = el('div', `display:flex;flex-direction:column;align-items:center;gap:14px;min-width:340px;padding:26px 30px 22px;background:#12140f;border:1px solid rgba(243,239,230,0.28);color:#f3efe6;${TYPE}`);
  const head = el('div', 'font-size:26px;font-weight:700;letter-spacing:0.1em;', 'Are you a person?');
  const say = el('div', 'font-size:15px;font-weight:500;letter-spacing:0.08em;color:#d8cfb8;text-align:center;max-width:320px;line-height:1.35;', 'One check before you go in. Tick the box if it asks you to.');
  const box = el('div', 'min-height:65px;display:flex;align-items:center;justify-content:center;');
  const quit = el('button', `margin-top:2px;padding:6px 14px;background:none;border:1px solid rgba(243,239,230,0.25);color:#d8cfb8;font-size:13px;letter-spacing:0.14em;cursor:pointer;${TYPE}`, 'Not now');
  card.append(head, say, box, quit);
  veil.appendChild(card);
  document.body.appendChild(veil);
  const ts = await turnstile();
  if (!ts) {
    loading = null;
    say.textContent = 'The check could not be fetched from Cloudflare. Something on this machine or this network is stopping it.';
    await new Promise((r) => setTimeout(r, 3500));
    veil.remove();
    return null;
  }
  return new Promise<string | null>((done) => {
    let id = '', over = false;
    const end = (slip: string | null, wait = 0) => {
      if (over) return;
      over = true;
      clearTimeout(late);
      setTimeout(() => {
        try {
          if (id) ts.remove(id);
        } catch {
          /* gone already */
        }
        veil.remove();
        done(slip);
      }, wait);
    };
    const late = setTimeout(() => end(null), 120_000);
    quit.onclick = () => end(null);
    try {
      id = ts.render(box, {
        sitekey,
        theme: 'dark',
        appearance: 'always',
        callback: (slip: string) => {
          // (seen to have passed, for a moment, before the way in is asked for with it)
          head.textContent = 'Passed';
          say.textContent = 'Going in.';
          end(slip, 600);
        },
        'error-callback': () => {
          head.textContent = 'Not passed';
          say.textContent = 'The check did not pass. Press Deploy to try again.';
          end(null, 2200);
        },
        'timeout-callback': () => end(null),
      });
    } catch {
      end(null);
    }
  });
}
