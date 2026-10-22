// A player pressing to play, counted as a Google Ads conversion (the owner, 2026-10-22: "we need to track clicks for all
// game modes, zona, battle royale and arena"): the owner's event snippet in index.html (gtag_report_conversion), once a
// page for each game. Nothing happens where the tag did not load (a blocker, a dev page).

const told = new Set<string>();

export function reportPlay(game: 'zona' | 'arena' | 'br') {
  if (told.has(game)) return;
  told.add(game);
  try {
    (window as unknown as { gtag_report_conversion?: () => boolean }).gtag_report_conversion?.();
  } catch {
    /* the tag's own trouble is never the game's */
  }
}
