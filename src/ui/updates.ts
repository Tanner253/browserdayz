// The game's news in a corner of its main menu: the last few posts of its X account, each
// with what it says, its picture or film, and a way to it on X. (What they are comes from
// the site, api/updates.ts; with none to show there is no corner.)

interface Media {
  kind: 'photo' | 'video';
  img: string;
  w: number;
  h: number;
  mp4?: string;
}
interface Post {
  id: string;
  url: string;
  at: string;
  text: string;
  likes: number;
  replies: number;
  media: Media[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
/** how long ago, as a feed says it: 5m, 3h, 2d, and after a week the day */
function ago(at: string): string {
  const then = new Date(at), mins = (Date.now() - then.getTime()) / 60_000;
  if (!(mins >= 0)) return '';
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 60 / 24)}d`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const out = (a: HTMLAnchorElement, href: string) => {
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};

function card(p: Post): HTMLElement {
  const box = el('article', 'sn-post');
  const meta = el('div', 'sn-meta');
  const when = el('time', '', ago(p.at));
  when.dateTime = p.at;
  when.title = new Date(p.at).toLocaleString();
  meta.append(when, el('span', '', `${p.likes} likes · ${p.replies} ${p.replies === 1 ? 'reply' : 'replies'}`));
  box.append(meta);
  if (p.text) box.append(el('p', 'sn-text', p.text));
  const m = p.media[0];
  if (m) {
    const frame = el('div', 'sn-media');
    frame.style.aspectRatio = `${m.w} / ${m.h}`;
    const img = el('img', '');
    img.src = m.img;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    frame.append(img);
    if (m.kind === 'video' && m.mp4) {
      // (a film is played where it is, once it is asked for: until then it is one picture)
      const play = el('button', 'sn-play');
      play.type = 'button';
      play.setAttribute('aria-label', 'Play');
      play.onclick = () => {
        const v = el('video', '');
        v.src = m.mp4!;
        v.poster = m.img;
        v.controls = true;
        v.playsInline = true;
        v.autoplay = true;
        frame.replaceChildren(v);
      };
      frame.append(play);
    } else if (p.media.length > 1) frame.append(el('span', 'sn-more', `+${p.media.length - 1}`));
    box.append(frame);
  }
  box.append(out(el('a', 'sn-view', 'View on X'), p.url));
  return box;
}

/** Put the news in the menu, if there is any. @param host the menu's own element */
export async function mountUpdates(host: HTMLElement): Promise<void> {
  try {
    const r = await fetch('/api/updates');
    if (!r.ok) return;
    const d = (await r.json()) as { account?: string; posts?: Post[] };
    if (!d.posts?.length || !d.account) return;
    const panel = el('aside', 'sm-news');
    const head = el('header', '');
    head.append(el('b', '', 'Updates'), out(el('a', '', `@${d.account}`), `https://x.com/${encodeURIComponent(d.account)}`));
    const list = el('div', 'sn-list');
    for (const p of d.posts.slice(0, 5)) list.append(card(p));
    panel.append(head, list);
    host.append(panel);
  } catch {
    // (no news is not a fault: the menu is whole without it)
  }
}
