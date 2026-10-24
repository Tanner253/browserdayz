// How the game's start went on somebody's machine.
//
// The game cannot be looked at on a phone from here, and a phone that cannot start it says nothing: it shows a
// loading screen, or shuts the page. So the game says (src/main.ts) how each start went on a phone, and on
// anything it fails on: one line here for each, written to the site's own log and kept nowhere else.
//
//   npx vercel logs --environment production --no-branch --since 1h --query "boot " --json
//
// What is in a line: how it went (ok, failed, slow, died: the last start never finished, lost: the picture was
// shut down), how far it got and in how many seconds, what went wrong in the page's own words, what kind of
// browser and graphics chip it is, the size of the screen, and how the map was had (`map`: the built file, kept in
// the browser, or made; `mapS`: in how many seconds). Nothing that says who anybody is: no name, no wallet, no
// address. Only what is named below is kept, and only so much of each.

const WORDS = ['how', 'stage', 'err', 'died', 'ua', 'gl', 'screen', 'map'] as const;
const NUMBERS = ['secs', 'deaths', 'lean', 'touch', 'got', 'mem', 'mapS'] as const;

export async function POST(req: Request): Promise<Response> {
  let said: Record<string, unknown>;
  try {
    said = JSON.parse((await req.text()).slice(0, 4000)) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!said || typeof said !== 'object') return new Response(null, { status: 400 });
  const line: Record<string, string | number> = {};
  for (const k of WORDS) if (typeof said[k] === 'string' && said[k]) line[k] = (said[k] as string).slice(0, 300);
  for (const k of NUMBERS) if (typeof said[k] === 'number' && Number.isFinite(said[k])) line[k] = said[k] as number;
  if (!line.how) return new Response(null, { status: 400 });
  console.log(`boot ${JSON.stringify(line)}`);
  return new Response(null, { status: 204 });
}
