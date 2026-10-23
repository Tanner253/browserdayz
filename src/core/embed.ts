// Played inside itch.io's page (the owner, 2026-10-23: "now the payout stuff is completley asbtracted from the game so
// we dont have to worry about changing anything, unless you just wanna hide the wallet input on settings"): the address
// says ?embed=itch, read once as the page opens (switching games rewrites the address). itch.io takes no crypto, so what
// touches SOL is not shown there: the payout wallet (Settings, Account), the contract address, the store (paid in SOL),
// the reminder to give a wallet; and no ads in another site's page.

export const EMBED = (() => {
  try {
    return new URLSearchParams(location.search).get('embed') === 'itch';
  } catch {
    return false;
  }
})();

// (the class hides what is drawn in the page's markup: style.css)
if (EMBED) document.documentElement.classList.add('embed-itch');
