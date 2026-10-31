// Night vision: carried, and N puts it to the eye (src/sim/items/toys.ts). The world is lit as an admin's night sight lights it, and seen through
// a green veil. Off by itself when it is no longer carried.

export class Goggles {
  on = false;
  private veil: HTMLDivElement | null = null;

  /** @param press N has just gone down @param has it is carried */
  update(press: boolean, has: boolean, say: (text: string) => void) {
    const was = this.on;
    if (press && has) this.on = !this.on;
    else if (!has) this.on = false;
    if (press && !has) return;
    if (was === this.on) return;
    if (press) say(this.on ? 'Night vision on' : 'Night vision off');
    if (!this.veil && this.on) {
      this.veil = Object.assign(document.createElement('div'), { className: 'goggles-veil' });
      Object.assign(this.veil.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '4', mixBlendMode: 'multiply', background: 'radial-gradient(circle at 50% 50%, rgb(150, 255, 160) 55%, rgb(40, 110, 50) 100%)' });
      document.body.appendChild(this.veil);
    }
    if (this.veil) this.veil.style.display = this.on ? 'block' : 'none';
  }
}
