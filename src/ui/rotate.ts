// The screen a phone shows while it is held upright. Turning the phone only helps when
// its auto-rotate is on, and on many phones it is off: so the screen has a button that
// goes full screen and turns the page on its side itself. Android browsers allow that;
// iPhones do not, and there the screen says which setting to change instead.

type Orientation = { lock?: (o: string) => Promise<void> };

export function initRotatePrompt() {
  const go = document.getElementById('rotate-go') as HTMLButtonElement | null;
  const hint = document.getElementById('rotate-hint');
  if (!go || !hint) return;
  const manual = 'Switch on auto-rotate in your phone’s quick settings (or turn off rotation lock), then turn the phone.';
  const root = document.documentElement;
  const orient = screen.orientation as unknown as Orientation | undefined;
  if (!root.requestFullscreen || !orient?.lock) {
    // nothing the page can do here: say what the player can
    go.hidden = true;
    hint.textContent = manual;
    return;
  }
  go.addEventListener('click', async () => {
    // whatever the browser does or does not do, the player is not left staring at a dead button
    setTimeout(() => {
      if (matchMedia('(orientation: portrait)').matches) hint.textContent = manual;
    }, 1500);
    try {
      if (!document.fullscreenElement) await root.requestFullscreen({ navigationUI: 'hide' });
      await orient.lock!('landscape');
    } catch {
      hint.textContent = manual;
    }
  });
}
