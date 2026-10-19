// The server: the numbers the bot rules go by, kept off the public code (the owner, 2026-10-18: "the github repo has been
// made public so the cheaters are being creative now with the source code"). BOT_RULES, set on the host only, is a JSON
// object of any of the fields below; what it leaves out is the default here. The defaults are looser than what the
// host is given, so a program tuned to what this file says is still caught by what is set there. Nothing of what is
// set is written to the log or said on any page.

export interface BotRules {
  /** the course: a go with at least `hits` shots landed by the course, and `aim` of every shot fired landed, is too sure for a hand */
  hits: number;
  aim: number;
  /** the course: how many things said that could not be so a go may have and pass */
  wrong: number;
  /** a graphics name in this pattern is not a browser's own (Chrome and Firefox on Windows name the card through ANGLE: "ANGLE (vendor, card Direct3D11 vs_5_0 ps_5_0, D3D11)") */
  gl: string;
  /** the world: degrees a second the aim may come round in the 0.6 s before a hit on a player (the course's "faster than a hand" is 1432) */
  snap: number;
  /** the world: degrees off the line to a player hit by a gun that the shooter may have been looking, in every telling of the 0.4 s before it */
  off: number;
  /** the world: things the two above flag, in ten minutes, before the player is sent back to the bot check */
  strikes: number;
}

const DEFAULTS: BotRules = { hits: 11, aim: 0.8, wrong: 1, gl: '^(?!ANGLE \\().*Direct3D', snap: 2500, off: 40, strikes: 3 };

/** what is said of BOT_RULES in the log at start-up (how many were set, never what) */
export let RULES_NOTE = 'BOT_RULES: not set on the host, the defaults are used';

function read(): BotRules {
  const raw = process.env.BOT_RULES?.trim();
  if (!raw) return { ...DEFAULTS };
  try {
    const said = JSON.parse(raw) as Partial<Record<keyof BotRules, unknown>>;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof BotRules)[]) {
      const v = said[k];
      if (k === 'gl' ? typeof v === 'string' && v : typeof v === 'number' && Number.isFinite(v)) (out as Record<string, unknown>)[k] = v;
    }
    new RegExp(out.gl);
    RULES_NOTE = `BOT_RULES: ${Object.keys(said).length} of the bot rules' numbers set on the host`;
    return out;
  } catch {
    RULES_NOTE = 'BOT_RULES is not a JSON object of the bot rules (or its graphics pattern does not read): the defaults are used';
    return { ...DEFAULTS };
  }
}

export const RULES = read();
const GL = new RegExp(RULES.gl);
/** a graphics name that no browser of its own gives (see `gl`) */
export const fakeGl = (gl: string) => !!gl && GL.test(gl);
