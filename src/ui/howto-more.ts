// The How to Play card's second half (the owner, 2026-10-19: "enhance it to make it better with everything the user
// needs to know like where to find a flashlight or the best guns and which guns are the most dangerous (tappers)").
// Every figure is read off the rules the game plays by, so the card cannot say what the game does not do: the tiers
// are the map's own (src/sim/tiers.ts), the hits are the server's (hitDamage in src/sim/combat.ts) and armour cuts
// a hit as takeHit (src/game/game/drops.ts) does.

import { GUNS } from '../sim/gunplay';
import { ONE_SHOT, WEAPON_RULES, hitDamage } from '../sim/combat';
import { ITEMS } from '../sim/items';
import { TIERS, type Tier } from '../sim/tiers';
import { freshVitals } from '../game/player';
import { shown } from '../core/keys';

/** how far off the hits are counted: a fight across a street */
const AT = 25;
const LIFE = freshVitals().health;
const pct = (k: number) => Math.round((1 - k) * 100);

/** the tiers a thing is laid out as loot in (`loot.at`, a weight for each), and the one it is most often found in */
function tiersOf(id: string): { most: Tier | null; all: Tier[] } {
  const at = (ITEMS[id] as { loot?: { at?: number[] } }).loot?.at ?? [];
  const all = at.map((w, i) => (w > 0 ? ((i + 1) as Tier) : null)).filter((t): t is Tier => t !== null);
  return { most: all.length ? all.reduce((a, b) => (at[b - 1] > at[a - 1] ? b : a)) : null, all };
}

interface Gun { id: string; name: string; tier: Tier | null; found: Tier[]; body: number; head: number; kill: boolean; pellets: boolean }

function guns(): Gun[] {
  const out: Gun[] = [];
  for (const id of Object.keys(GUNS)) {
    const r = WEAPON_RULES[id], d = ITEMS[id];
    // (the grenade launcher's round is a blast, not a hit: it is with the grenades)
    if (!r || !d || r.blast) continue;
    const n = r.pellets ?? 1;
    const body = hitDamage(id, 'torso', AT, false, 0, n), head = hitDamage(id, 'head', AT, false, 0, n);
    if (body <= 0) continue;
    const t = tiersOf(id);
    out.push({ id, name: d.name, tier: t.most, found: t.all, body, head, kill: !!r.kill, pellets: n > 1 });
  }
  return out;
}

const hits = (dmg: number) => (dmg >= ONE_SHOT ? 1 : Math.ceil(LIFE / dmg));

function gunChip(g: Gun): string {
  const t = g.tier ? TIERS[g.tier] : null;
  return `<li style="--tc:${t?.colour ?? 'var(--ink-faint)'}" title="${t ? `Most often in ${t.name}: ${t.where}. Found in ${g.found.map((f) => TIERS[f].name).join(', ')}` : 'Not laid out as loot'}"><b>${g.name}${g.pellets ? '*' : ''}</b>${t ? `<em>${t.name}</em>` : ''}</li>`;
}

/** what kills fastest: every gun, by how many hits it takes to a body with nothing on it */
function tappers(): string {
  const all = guns();
  const rows = new Map<string, Gun[]>();
  for (const g of all.sort((a, b) => b.body - a.body)) {
    const k = g.kill ? 'any' : String(hits(g.body));
    rows.set(k, [...(rows.get(k) ?? []), g]);
  }
  const said: Record<string, string> = { any: 'Anywhere, through any armour', 1: 'To the body', 2: 'To the body', 3: 'To the body', 4: 'To the body' };
  const html = [...rows].map(([k, gs]) => `<div class="ht-tap${k === 'any' || k === '1' ? ' one' : ''}"><i>${k === 'any' ? '1' : k}</i><div><small>${k === 'any' || k === '1' ? 'hit kills' : 'hits kill'} · ${said[k] ?? 'To the body'}</small><ul>${gs.map(gunChip).join('')}</ul></div></div>`).join('');
  // (a bare head: said only as far as it is true of every one of them at this range)
  const notHead = all.filter((g) => hits(g.head) > 1).map((g) => g.name);
  const head = notHead.length ? `One hit to a bare head kills with all but the ${notHead.join(', ')}.` : 'One hit to a bare head kills with every one of them.';
  return `<p class="ht-sub">Hits it takes to kill a player with no armour, ${AT} m away. ${head}${all.some((g) => g.pellets) ? ' *A shotgun: every pellet on target.' : ''} Each is marked with the tier it is most often found in.</p><div class="ht-taps">${html}</div>`;
}

/** the five tiers, from the coast to the bunker: where each is, and what is found there */
function wayUp(): string {
  return `<div class="ht-tiers">${([1, 2, 3, 4, 5] as Tier[]).map((t) => `<div style="--tc:${TIERS[t].colour}"><b>${TIERS[t].name}</b><em>${TIERS[t].where}</em><span>${TIERS[t].finds}</span></div>`).join('')}</div>`;
}

/** worn armour: what each takes off a hit where it covers */
function armour(): string {
  const body = Object.values(ITEMS).filter((d) => d.wear?.armor !== undefined).sort((a, b) => a.wear!.armor! - b.wear!.armor!);
  const head = Object.values(ITEMS).filter((d) => d.wear?.head !== undefined).sort((a, b) => a.wear!.head! - b.wear!.head!)[0];
  return `${body.map((d) => `the ${d.name} ${pct(d.wear!.armor!)}%`).join(', ')} off a hit to the body; the ${head.name} ${pct(head.wear!.head!)}% off one to the head.`;
}

export function howtoMore(): string {
  return `<h3 class="ht-h">The way up</h3>${wayUp()}
    <h3 class="ht-h">Tappers: what kills fastest</h3>${tappers()}
    <h3 class="ht-h">Good to know</h3>
    <ul class="ht-know">
      <li><b>A flashlight</b><span>In sheds, barns and garages, shops and town houses. Carried anywhere on you, <kbd>${shown('KeyL')}</kbd> switches it on. It shows you the dark, and shows the dark where you are.</span></li>
      <li><b>Armour</b><span>Worn armour takes a share off every hit: ${armour()}</span></li>
    </ul>`;
}
