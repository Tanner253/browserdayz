// ZONA PvP, the platform both games stand under (2026-10-14). The owner: "even tho the paths are seperate. the entire
// ecosysrtem is umbrellad together", and of the money: "the entire platform is zonapvp so it should be aknowlsegd on
// each respective payouts screen or wherrveer we discuss the money, that the entire platform has paid out X amount".
// The figure is the payouts store's own (api/cashins.ts, format=total): what has gone out on chain, never a guess.

export interface PlatformPaid {
  /** SOL paid to players in all, and by each game */
  paidSol: number;
  /** how many dog tags have been paid for */
  paid: number;
  zona: number;
  arena: number;
  /** when the record begins (ISO) */
  since: string;
}

let asked: Promise<PlatformPaid | null> | null = null;

/** what the platform has paid, asked once a page (null: the site's API cannot be reached, as on a development page) */
export function platformPaid(): Promise<PlatformPaid | null> {
  return (asked ??= fetch('/api/cashins?format=total', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<PlatformPaid>) : null))
    .then((j) => (j && Number.isFinite(j.paidSol) ? j : null))
    .catch(() => null));
}

/** "2.995 SOL paid to players since 8 Oct": as the door and the payouts screens say it */
export function paidLine(p: PlatformPaid): string {
  const since = new Date(p.since);
  const when = Number.isFinite(since.getTime()) ? ` since ${since.getUTCDate()} ${since.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}` : '';
  return `${+p.paidSol.toFixed(3)} SOL paid to players${when}`;
}
