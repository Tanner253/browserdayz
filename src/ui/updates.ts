// The game's news in a corner of its main menu: the last few posts of its X account, each
// with what it says, its picture or film, and a way to it on X. (What they are comes from
// the site, api/updates.ts; with none to show there is no corner.)
//
// And the asking (2026-10-10): the players are asked, here and wherever else the game has a
// free moment (see `backing`), to like, answer and repost what the game posts. Why is said
// with it, and is no more than how the money goes: the treasury that pays for dog tags is
// topped up from the fees on trades of the coin (api/_lib/payouts.ts), so what brings people
// to the game is what fills it. Each button is X's own way in to the thing it names (its
// "web intents": x.com/intent/like, /retweet, /tweet?in_reply_to, /follow), which opens X
// with the post and the thing ready to be done; nothing is done for anybody.

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

/** why a player would: said wherever they are asked */
export const BACK_WHY = 'Like, reply, repost: it costs nothing, and it is how new players find the game. The reward treasury is topped up from the fees on $ZONA trades, and every dog tag you cash in is paid out of it.';
/** the same in a line, for the chat and under a button */
export const BACK_SHORT = 'Fees on $ZONA trades fill the treasury your dog tags are paid from.';
/**
 * Where "back us on X" leads: the game's newest post once the news has come, its account until then. Kept here
 * so that everything that asks (the menu, the pause, the death screen) leads to the same place.
 */
export const backing = { account: '', url: '' };
const INTENT = 'https://x.com/intent';
/** to like, repost or answer one post (and to see it): each a way into X, opened beside the game */
function acts(p: Post, view: boolean): HTMLElement {
  const row = el('div', 'sn-acts');
  // (a post's number is digits and nothing else: anything else is not put in a link)
  if (/^\d{5,25}$/.test(p.id)) {
    row.append(out(el('a', '', 'Like'), `${INTENT}/like?tweet_id=${p.id}`), out(el('a', '', 'Repost'), `${INTENT}/retweet?tweet_id=${p.id}`), out(el('a', '', 'Reply'), `${INTENT}/tweet?in_reply_to=${p.id}`));
  }
  if (view) row.append(out(el('a', '', 'View'), p.url));
  return row;
}

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
  box.append(acts(p, true));
  return box;
}

/**
 * Put the news in the menu, if there is any, with the asking over it.
 * @param host the menu's own element
 * @param account the game's account on X, for what asks before the news has come (and if it never does)
 */
export async function mountUpdates(host: HTMLElement, account: string): Promise<void> {
  backing.account = account;
  backing.url = `https://x.com/${encodeURIComponent(account)}`;
  const lead = () => {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-back]')) out(a, backing.url);
  };
  lead();
  try {
    const r = await fetch('/api/updates');
    if (!r.ok) return;
    const d = (await r.json()) as { account?: string; posts?: Post[] };
    if (!d.posts?.length || !d.account) return;
    const newest = d.posts[0];
    backing.account = d.account;
    backing.url = newest.url;
    lead();
    const panel = el('aside', 'sm-news');
    const head = el('header', '');
    head.append(el('b', '', 'Updates'), out(el('a', '', `@${d.account}`), `https://x.com/${encodeURIComponent(d.account)}`));
    // the asking: over the posts, where it does not scroll away
    const ask = el('div', 'sn-back');
    const row = acts(newest, false);
    if (row.firstElementChild) row.firstElementChild.textContent = 'Like the newest post';
    row.append(out(el('a', '', 'Follow'), `${INTENT}/follow?screen_name=${encodeURIComponent(d.account)}`));
    ask.append(el('b', '', 'Back ZONA on X'), el('p', '', BACK_WHY), row);
    const list = el('div', 'sn-list');
    for (const p of d.posts.slice(0, 5)) list.append(card(p));
    panel.append(head, ask, list);
    host.append(panel);
    host.classList.add('has-news');
  } catch {
    // (no news is not a fault: the menu is whole without it)
  }
}
