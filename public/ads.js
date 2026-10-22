// AdSense on zonapvp.fun (2026-10-22). The owner: "can we serve ads on our site to make money and then make vip ad
// free", and where: "when a player dies we should serve the highest paying ad type from adsense. no popup ads during
// gameplay only on refresh on the different pages of the site, and during death/respawn loops. we can serve 1 popup
// ad before the bot check starts as well so any stale session starts with an ad for us."
//   - the site's own pages (landing pages, changelog, privacy): a box wherever a page has an element .zona-ad, filled
//     with the "Sitepages" unit as the page loads;
//   - the game's page (src/ui/adsense.ts): a break before the way in and at a death, by AdSense's ads for HTML5 games
//     (adBreak: an interstitial, its best-paying kind, which Google itself keeps from coming too often), and the
//     "Death" unit on the death screen where no break was shown. Never during play.
// Google's script is loaded only when an ad is to be shown, so a VIP or a no-ads buyer runs nothing of Google's at all:
// what this browser has bought is read from what the store kept here (src/ui/store/account.ts).
(function () {
  var CLIENT = 'ca-pub-6477083454892612';
  var SLOT = { site: '8331552554', death: '3773360448' };
  var live = /(^|\.)zonapvp\.fun$/.test(location.hostname);

  function adFree() {
    try {
      var k = JSON.parse(localStorage.getItem('zona.store.perks') || 'null'), now = Date.now();
      return !!k && !!k.perks && (k.perks.vip > now || k.perks.noads > now);
    } catch (e) {
      return false;
    }
  }

  // (always the page's own: Google's script, once loaded, puts its own in place of the list)
  function push(o) {
    (window.adsbygoogle = window.adsbygoogle || []).push(o);
  }
  function lib() {
    if (document.querySelector('script[data-zona-adsense]')) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-ad-client', CLIENT);
    // (the games ads' own pacing: Google's word on how often a break may show, at most)
    s.setAttribute('data-ad-frequency-hint', '120s');
    s.setAttribute('data-zona-adsense', '1');
    document.head.appendChild(s);
    push({ preloadAdBreaks: 'on', sound: 'on' });
  }

  /** a display box filled with one of the units (site or death); false where none is to be shown */
  function fill(host, kind) {
    var slot = SLOT[kind || host.getAttribute('data-unit') || 'site'];
    if (!live || !slot || adFree() || !host || host.getAttribute('data-filled')) return false;
    host.setAttribute('data-filled', '1');
    lib();
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', CLIENT);
    ins.setAttribute('data-ad-slot', slot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    host.appendChild(ins);
    host.hidden = false;
    push({});
    return true;
  }

  /**
   * A break for an HTML5 game: 'start' (before the game) or 'next' (between lives). Calls back with what became of it
   * ('viewed', 'notReady', 'frequencyCapped', ...), or 'none' where none may be shown here. `before` and `after` are
   * told when an ad takes the screen and gives it back (the game's sound goes quiet in between). An ad blocker that
   * stopped Google's script would leave the call unanswered: so, unless an ad has begun, it is answered in four
   * seconds.
   */
  function brk(type, name, before, after) {
    return new Promise(function (done) {
      if (!live || adFree()) return done('none');
      lib();
      var begun = false, over = false;
      var end = function (status) {
        if (over) return;
        over = true;
        done(status);
      };
      setTimeout(function () {
        if (!begun) end('timeout');
      }, 4000);
      push({
        type: type,
        name: name,
        beforeAd: function () {
          begun = true;
          if (before) before();
        },
        afterAd: function () {
          if (after) after();
        },
        adBreakDone: function (info) {
          end((info && info.breakStatus) || 'other');
        },
      });
    });
  }

  window.zonaAd = fill;
  window.zonaBreak = brk;
  var boxes = document.querySelectorAll('.zona-ad');
  for (var i = 0; i < boxes.length; i++) fill(boxes[i]);
})();
