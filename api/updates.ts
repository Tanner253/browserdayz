// The game's news, for its main menu: the last few posts of its X account, each with what
// it says, its picture or film, and where it is on X.
//
// Which posts: the list in _lib/posts.ts. What each one says and shows: asked of X as the
// game is opened, from the same public source X's own embedded posts are drawn from (one
// post at a time, no key). It is asked at most once in ten minutes however many people open
// the game: the answer is kept at the edge, and an old answer goes on being served while a
// new one is fetched.
//
// A post X will not give (taken down, or X not answering) is left out; with none at all the
// menu shows no news.

import { POSTS, X_ACCOUNT } from './_lib/posts.js';

export interface Media {
  kind: 'photo' | 'video';
  /** the picture; for a film, the still it opens on */
  img: string;
  w: number;
  h: number;
  /** a film's file, at a size a menu can play */
  mp4?: string;
}
export interface Post {
  id: string;
  url: string;
  at: string;
  text: string;
  likes: number;
  replies: number;
  media: Media[];
}

/** what X asks for beside a post's number (it is worked out from the number: see its own embed code) */
const token = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
/** only ever X's own picture and film hosts: nothing else is handed to the menu to load */
const ours = (u: unknown, host: string): u is string => typeof u === 'string' && u.startsWith(`https://${host}/`);

type Raw = {
  __typename?: string;
  id_str?: string;
  created_at?: string;
  text?: string;
  display_text_range?: [number, number];
  favorite_count?: number;
  conversation_count?: number;
  user?: { screen_name?: string };
  entities?: { urls?: { url: string; display_url: string }[] };
  mediaDetails?: { type?: string; media_url_https?: string; original_info?: { width?: number; height?: number }; video_info?: { variants?: { content_type?: string; bitrate?: number; url?: string }[] } }[];
};

async function post(id: string, ask: typeof fetch): Promise<Post | null> {
  try {
    const r = await ask(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token(id)}&lang=en`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; zonapvp.fun menu)' } });
    if (!r.ok) return null;
    const d = (await r.json()) as Raw;
    if (d.__typename !== 'Tweet' || !d.created_at || d.id_str !== id) return null;
    // what is shown of its text is a stretch of it (what follows is the link to its own picture), with its short links said as they read
    const [a, b] = d.display_text_range ?? [0, 9999];
    let text = [...(d.text ?? '')].slice(a, b).join('');
    for (const u of d.entities?.urls ?? []) text = text.split(u.url).join(u.display_url);
    const media: Media[] = [];
    for (const m of d.mediaDetails ?? []) {
      if (!ours(m.media_url_https, 'pbs.twimg.com')) continue;
      const w = m.original_info?.width ?? 16, h = m.original_info?.height ?? 9;
      if (m.type === 'photo') media.push({ kind: 'photo', img: m.media_url_https, w, h });
      else {
        // (the biggest file that is not more than a menu's corner needs)
        const files = (m.video_info?.variants ?? []).filter((v) => v.content_type === 'video/mp4' && ours(v.url, 'video.twimg.com')).sort((x, y) => (y.bitrate ?? 0) - (x.bitrate ?? 0));
        const file = files.find((v) => (v.bitrate ?? 0) <= 2_500_000) ?? files[files.length - 1];
        media.push({ kind: 'video', img: m.media_url_https, w, h, ...(file ? { mp4: file.url } : {}) });
      }
    }
    return { id, url: `https://x.com/${d.user?.screen_name ?? X_ACCOUNT}/status/${id}`, at: d.created_at, text: text.trim(), likes: d.favorite_count ?? 0, replies: d.conversation_count ?? 0, media };
  } catch {
    return null;
  }
}

export async function news(ask: typeof fetch = fetch): Promise<Response> {
  const posts = (await Promise.all(POSTS.slice(0, 8).map((id) => post(id, ask)))).filter((p): p is Post => !!p).sort((a, b) => b.at.localeCompare(a.at));
  // (with nothing to show the answer is not kept long: X may only have been slow)
  return Response.json({ account: X_ACCOUNT, posts }, { headers: { 'cache-control': posts.length ? 'public, s-maxage=600, stale-while-revalidate=86400' : 'public, s-maxage=30' } });
}

export const GET = () => news();
