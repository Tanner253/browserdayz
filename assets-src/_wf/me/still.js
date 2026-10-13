// PLAY_PRE=assets-src/_wf/me/still.js : the dev server's word that a file has changed is never heard by this page, so
// it is not loaded afresh in the middle of being looked at. For when something else is editing the tree while the
// game is photographed: with several hands in it, a page told of every save never finishes loading. The game's own
// socket to its server is left alone.
(() => {
  const Real = window.WebSocket;
  const Still = function (url, protocols) {
    const p = Array.isArray(protocols) ? protocols : [protocols];
    if (!p.includes('vite-hmr') && !p.includes('vite-ping')) return new Real(url, protocols);
    const quiet = new EventTarget();
    Object.assign(quiet, { send() {}, close() {}, readyState: 1, url: String(url), protocol: p[0] });
    setTimeout(() => quiet.dispatchEvent(new Event('open')), 0);
    return quiet;
  };
  Still.prototype = Real.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Still[k] = Real[k];
  window.WebSocket = Still;
})();
