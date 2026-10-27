// A report from the death screen (the owner, 2026-10-27: "we need a report button on death, when a player dies and is in
// the respawn menu they need to be able to press a key or click a button to report, and enter a message and reason for
// the report. attached to the report is the death information for audit by admin"). The page's form is
// src/ui/report.ts; the server keeps them with the death it was about (server/reports.ts), for an admin's /reports.

export const REPORT = {
  reasons: ['Shot through a wall', 'Saw me through walls (ESP)', 'Aimbot', 'Speed or teleporting', 'Flying or under the ground', 'Abuse in chat', 'Something else'],
  /** the most letters of a message */
  text: 500,
  /** how long after a death it may be reported, ms */
  within: 15 * 60_000,
};
