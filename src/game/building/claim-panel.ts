// The claim's own screen, as Rust's tool cupboard (the owner, 2026-10-25: "when I open my claim the ui is terrible ... think
// like rust"; then "daily upkeep ui blocks inventory store for the flag... we should have a ui for this. like rust"): while
// a claim's store is open, the inventory's middle column (what is worn) gives way to the upkeep: the store's grid on the
// left, the upkeep in the middle, the pockets on the right, none over another, at any size the inventory is drawn.

import { ITEMS } from '../../sim/items';
import { saidTime } from '../../sim/build/upkeep';

export interface ClaimPanel {
  /** seconds protected (Infinity: no upkeep; null: not yet known), and whether it is rotting */
  left: number | null;
  dry: boolean;
  /** what the base takes a day, by material, and how much of each is in the store */
  day: [string, number][];
  have: (id: string) => number;
  /** who is on the claim, and whether the player is */
  names: string[];
  on: boolean;
}

const CSS = `
.inv-wrap.cl-on .inv-gear{display:none}
.inv-col.cl-panel{display:flex;flex-direction:column;gap:12px}
.cl-panel h3{margin:0}
.cl-left{font-size:30px;font-weight:700;line-height:1.1}
.cl-left.dry{color:#ff5a4a}.cl-left.low{color:#f0b44a}
.cl-panel p{margin:0;color:#bfc4c0;font-size:14px;line-height:1.45}
.cl-rows{display:flex;flex-direction:column}
.cl-row{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}
.cl-row i{width:44px;height:44px;background:rgba(0,0,0,.35) center/contain no-repeat;border-radius:3px}
.cl-row b{font-size:16px}.cl-row span{font-size:14px;color:#bfc4c0;text-align:right;white-space:nowrap}
.cl-row span.short{color:#ff7a6a}
.cl-who{margin-top:auto;font-size:14px;color:#bfc4c0;line-height:1.5}
`;

/** the screen's words, as they are now */
export function claimPanelHtml(d: ClaimPanel, icons: Record<string, string>): string {
  const head = d.dry ? 'Decaying' : d.left === null ? '…' : d.left === Infinity ? 'No upkeep needed' : `Protected for ${saidTime(d.left)}`;
  const rows = d.day.filter(([, n]) => n > 0).map(([id, n]) => {
    const got = d.have(id);
    return `<div class="cl-row"><i style="background-image:url(${icons[id] ?? ''})"></i><b>${ITEMS[id]?.name ?? id}</b><span class="${got < n ? 'short' : ''}">${Math.ceil(n)} a day · ${got} in store</span></div>`;
  }).join('');
  return `<h3>Claim · upkeep</h3><div class="cl-left ${d.dry ? 'dry' : d.left !== null && d.left < 12 * 3600 ? 'low' : ''}">${head}</div>
    <p>Every day each piece of the base takes its upkeep from this store, in what its tier is gathered as: planks for wood, stone for stone, metal fragments for metal, iron bars for armoured. The bigger the base, the more each piece takes. Drag materials into the store; when it runs dry, the base decays.</p>
    <div class="cl-rows">${rows || '<p>Nothing to pay: the base costs no upkeep.</p>'}</div>
    <div class="cl-who"><b>Authorised:</b> ${d.names.length ? d.names.join(', ') : 'nobody'}<br>${d.on ? 'Hold <kbd>F</kbd> at the claim to leave it.' : 'Hold <kbd>F</kbd> at the claim to join it and build here.'}</div>`;
}

/** the screen put in the inventory as its middle column (again, each time the inventory is drawn afresh): false while
 * the inventory is not up */
export function mountClaimPanel(panel: HTMLElement): boolean {
  if (!document.getElementById('cl-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cl-css', textContent: CSS }));
  const wrap = document.querySelector<HTMLElement>('.inv-wrap'), vic = wrap?.querySelector('.inv-vicinity');
  if (!wrap || !vic) return false;
  panel.classList.add('inv-col', 'cl-panel');
  if (panel.previousElementSibling !== vic) vic.after(panel);
  wrap.classList.add('cl-on');
  return true;
}

/** and taken out: what is worn back in the middle */
export function unmountClaimPanel(panel: HTMLElement | null) {
  panel?.remove();
  document.querySelector('.inv-wrap.cl-on')?.classList.remove('cl-on');
}
