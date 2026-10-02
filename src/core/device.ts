// What kind of device this is. Decided once at load.

/**
 * A phone or tablet: fingers on glass, no mouse to capture and no keyboard.
 * `?touch=1` forces it on a desktop, to try the touch controls with a mouse.
 */
export const TOUCH =
  typeof window !== 'undefined' &&
  typeof matchMedia === 'function' &&
  ((matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || new URLSearchParams(location.search).has('touch'));
