// Reports from the death screen (src/sim/reports.ts has why; the page's form is src/ui/report.ts). Each is kept with the
// death it is about as the server knew it: who killed them, with what, where each of them stood, how far apart, the
// part of the body, and how many times the checks had flagged the killer by then. Kept with the world (keep.ts), told
// to every admin on the server as it comes, and listed by /reports.
import { REPORT } from '../src/sim/reports';

/** a death as the server knew it, for a report of it (set in acts.ts `kill`) */
export interface DeathRecord {
  at: number;
  cause: string;
  by: { name: string; key: string; fp: string; flags: number; at: [number, number, number] } | null;
  w: string;
  zone: string | null;
  dist: number;
  at3: [number, number, number];
  reported?: boolean;
}

export interface Report {
  n: number;
  at: number;
  from: { name: string; key: string };
  reason: string;
  text: string;
  death: DeathRecord;
}

/** the most kept (the latest), and how long */
const MOST = 400, KEEP_MS = 30 * 24 * 3600_000;
const list: Report[] = [];
let next = 1;

export const reports = {
  /** a report made: refused (why) or kept (the report) */
  make(from: { name: string; key: string }, death: DeathRecord | undefined, reason: unknown, text: unknown): Report | string {
    if (!death || Date.now() - death.at > REPORT.within) return 'There is no death of yours to report';
    if (death.reported) return 'That death is reported already';
    const why = REPORT.reasons.includes(String(reason)) ? String(reason) : 'Something else';
    const said = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, REPORT.text);
    const r: Report = { n: next++, at: Date.now(), from, reason: why, text: said, death: { ...death } };
    death.reported = true;
    list.push(r);
    if (list.length > MOST) list.splice(0, list.length - MOST);
    return r;
  },
  /** the latest `most`, the newest first */
  latest(most = 10): Report[] {
    return list.slice(-most).reverse();
  },
  keep(): Report[] {
    const now = Date.now();
    return list.filter((r) => now - r.at < KEEP_MS);
  },
  restore(kept: unknown) {
    if (!Array.isArray(kept)) return;
    const have = new Set(list.map((r) => `${r.at}|${r.from.key}`));
    for (const r of kept as Report[]) if (r && typeof r.at === 'number' && r.death && !have.has(`${r.at}|${r.from?.key}`)) list.push(r);
    list.sort((a, b) => a.at - b.at);
    list.forEach((r, i) => (r.n = i + 1));
    next = list.length + 1;
  },
};

/** how long ago, as an admin reads it */
export const ago = (ms: number) => (ms < 3600_000 ? `${Math.round(ms / 60000)} min` : ms < 48 * 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 86400_000)} days`);

/** a report in lines, for an admin: who, about whom, why and what they said; then the death as the server knew it */
export function reportLines(r: Report, ago: (ms: number) => string): string[] {
  const d = r.death, xz = (p: [number, number, number]) => `${p[0].toFixed(0)}, ${p[2].toFixed(0)}`;
  return [
    `#${r.n} ${ago(Date.now() - r.at)} ago: ${r.from.name} reports ${d.by ? d.by.name : `a death (${d.cause})`} for "${r.reason}"${r.text ? `: ${r.text}` : ''}`,
    `   death: ${d.by ? `killed by ${d.by.name} with ${d.w}${d.zone ? `, ${d.zone}` : ''} at ${d.dist} m; killer at ${xz(d.by.at)}, flagged ${d.by.flags}x by then${d.by.fp ? `, dev:${d.by.fp.slice(0, 8)}` : ''}` : `died of ${d.cause}`}; ${r.from.name} at ${xz(d.at3)}`,
  ];
}
