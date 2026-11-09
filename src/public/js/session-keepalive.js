// Keeps the 15-minute access token fresh while a tab stays open, so a dean or
// student who pauses to read a page is not bounced to the login screen.
// Uses the httpOnly refresh cookie; nothing sensitive is exposed to JavaScript.
(function () {
  var REFRESH_URL = '/auth/refresh';
  var INTERVAL_MS = 10 * 60 * 1000;
  var lastRefresh = Date.now();
  var inFlight = false;

  function refresh() {
    if (inFlight) return;
    inFlight = true;
    lastRefresh = Date.now();

    var body = '{}';
    try {
      body = JSON.stringify({ next: window.location.pathname || '/' });
    } catch (err) { /* keep empty body */ }

    fetch(REFRESH_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body,
      cache: 'no-store'
    }).catch(function () {
      // Offline or server restarting: the next page load will retry.
    }).then(function () {
      inFlight = false;
    });
  }

  window.setInterval(refresh, INTERVAL_MS);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > INTERVAL_MS) {
      refresh();
    }
  });
})();
