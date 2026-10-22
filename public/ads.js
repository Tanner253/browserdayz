// AdSense on zonapvp.fun (2026-10-22). The owner: "can we serve ads on our site to make money and then make vip ad
// free". One box where a page has a place for one (an element with class zona-ad): the main menu, the death screen
// (src/ui/adsense.ts), the landing pages and the changelog. Never during play. Google's own script is loaded only when
// a box is to be filled, so a VIP or a no-ads buyer runs nothing of Google's at all: what this browser has bought is
// read from what the store kept here (src/ui/store/account.ts), which the game page asks the site for afresh.
(function () {
  var CLIENT = 'ca-pub-6477083454892612';
  /** the display ad unit's number (AdSense, Ads, By ad unit): '' until there is one, and until then no box is shown */
  var SLOT = '';
  var live = /(^|\.)zonapvp\.fun$/.test(location.hostname);

  function adFree() {
    try {
      var k = JSON.parse(localStorage.getItem('zona.store.perks') || 'null'), now = Date.now();
      return !!k && !!k.perks && (k.perks.vip > now || k.perks.noads > now);
    } catch (e) {
      return false;
    }
  }

  function fill(host) {
    if (!live || !SLOT || adFree() || !host || host.getAttribute('data-filled')) return false;
    host.setAttribute('data-filled', '1');
    if (!document.querySelector('script[data-zona-adsense]')) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-zona-adsense', '1');
      document.head.appendChild(s);
    }
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', CLIENT);
    ins.setAttribute('data-ad-slot', SLOT);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    host.appendChild(ins);
    host.hidden = false;
    (window.adsbygoogle = window.adsbygoogle || []).push({});
    return true;
  }

  window.zonaAd = fill;
  var boxes = document.querySelectorAll('.zona-ad');
  for (var i = 0; i < boxes.length; i++) fill(boxes[i]);
})();
