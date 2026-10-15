// The Elite's crown by a name in chat, and a word about them with the pointer on it (the owner, 2026-10-15: "we
// should show the elite icon in the chat next to player names, and when hovered on it says something honorable about
// the player and why they have the icon ... dont sound self rtchous or make it too long"). The crown is the payouts
// page's (api/cashins.ts); who wears it is the server's to say (server/elite.ts).

const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.3 13h13.4v2H5.3v-2z"/></svg>';
const SAYS = '<b>Elite</b>A top-tier $ZONA holder, backing the project and its developer.';

let tip: HTMLElement | null = null;

const hide = () => tip?.classList.remove('show');

export function crownEl(): HTMLElement {
  const c = document.createElement('span');
  c.className = 'chat-elite';
  c.setAttribute('aria-label', 'Elite');
  c.innerHTML = CROWN;
  c.addEventListener('pointerenter', () => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chat-tip';
      tip.setAttribute('role', 'tooltip');
      tip.innerHTML = SAYS;
      document.body.appendChild(tip);
    }
    const r = c.getBoundingClientRect();
    tip.style.left = `${Math.round(r.left)}px`;
    tip.style.top = `${Math.round(r.top - 6)}px`;
    tip.classList.add('show');
  });
  c.addEventListener('pointerleave', hide);
  return c;
}

/** (the chat shut with the pointer on a crown: its word goes with it) */
export const hideCrownTip = hide;
