// Controlled GPS events, APIs, and tiles: no real location or routing quota required.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.clock.install();
    await page.addInitScript(() => {
      window.gps = {callbacks: [], cleared: [], options: []};
      Object.defineProperty(window, 'DeviceOrientationEvent', {value: undefined});
      Object.defineProperty(navigator, 'geolocation', {value: {
        watchPosition(success, error, options) {
          gps.callbacks.push({success, error}); gps.options.push(options);
          return gps.callbacks.length - 1; // ID 0 must also be stopped.
        },
        clearWatch(id) { gps.cleared.push(id); },
      }});
    });
    const requests = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://coffee.test/**', async r => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/api/v1/config') return r.fulfill({json: {routing_available: true}});
      if (pathname.startsWith('/api/')) requests.push({path: pathname, body: r.request().postDataJSON()});
      if (pathname === '/api/v1/nearby') return r.fulfill({json: {
        distance_mode: 'road', total: 1, candidate_count: 1, unreachable_count: 0,
        cafes: [{osm_type: 'node', osm_id: '1', name: 'Test Café', latitude: 11.56, longitude: 104.935,
          distance_m: 100, road_distance_m: 200, duration_s: 100}],
      }});
      if (pathname === '/api/v1/route') return r.fulfill({json: {
        distance_m: 200, duration_s: 100, profile: 'walking', steps: [],
        geometry: {type: 'LineString', coordinates: [[104.93, 11.55], [104.935, 11.56]]},
      }});
      const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname, '../../app/resources/static', filename)), contentType: types[path.extname(filename)]});
    });
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('https://coffee.test/');
    async function emit(coords, id = null) {
      await page.clock.fastForward(1000);
      await page.evaluate(({coords, id}) => gps.callbacks[id ?? gps.callbacks.length - 1].success({
        coords: {latitude: 11.55, longitude: 104.93, accuracy: 5, speed: null, heading: null, ...coords},
        timestamp: Date.now(),
      }), {coords, id});
    }
    const status = () => page.locator('#tracking-status').innerText();
    assert.equal(await page.locator('#cafe-search-form #toggle-tracking').count(), 1);
    assert.equal(await page.locator('#follow-location, #search-live-location').count(), 0);
    assert.equal(await page.evaluate(() => gps.callbacks.length), 0);
    await page.locator('#toggle-tracking').click();
    assert.equal(await page.evaluate(() => gps.callbacks.length), 1);
    assert.equal(await page.evaluate(() => gps.options[0].maximumAge), 0);
    await emit({});
    assert.match(await status(), /GPS location/);
    assert.equal(await page.locator('.live-dot-position').count(), 1);
    assert.equal(await page.locator('.live-accuracy').count(), 1);
    assert.equal(requests.length, 0);
    // GPS updates must not dismiss tile failures; unrelated successful tiles
    // must not hide failures elsewhere in the same viewport either.
    await page.evaluate(() => {
      window.failedTile = document.createElement('img');
      cafesMap.eachLayer(l => { if (l instanceof L.TileLayer) l.fire('tileerror', {tile: failedTile}); });
    });
    await emit({});
    assert.equal(await page.locator('#cafes-map-note').isVisible(), true);
    await page.evaluate(() => cafesMap.eachLayer(l => {
      if (l instanceof L.TileLayer) l.fire('tileload', {tile: document.createElement('img')});
    }));
    assert.equal(await page.locator('#cafes-map-note').isVisible(), true);
    await page.evaluate(() => cafesMap.eachLayer(l => {
      if (l instanceof L.TileLayer) {
        // Remove other failed mocked tiles, then simulate recovery.
        Object.values(l._tiles).forEach(t => l.fire('tileunload', {tile: t.el}));
        l.fire('tileload', {tile: failedTile});
      }
    }));
    assert.equal(await page.locator('#cafes-map-note').isVisible(), false);
    // GPS position and movement must never masquerade as phone compass direction.
    for (const heading of [0, 90, 180, 270, 359]) {
      await emit({heading, speed: 1, longitude: 104.9301});
      assert.equal(await page.locator('.live-arrow').count(), 0);
      assert.equal(await page.locator('.live-dot-position').count(), 1);
    }
    await emit({longitude: 104.931, latitude: 11.551});
    assert.equal(await page.locator('.live-arrow').count(), 0);
    await emit({heading: 90, speed: 1, accuracy: 200});
    assert.equal(await page.evaluate(() => {
      let radius; cafesMap.eachLayer(l => { if (l instanceof L.Circle) radius = l.getRadius(); }); return radius;
    }), 200);
    await emit({heading: 180, speed: 1});
    await page.evaluate(() => cafesMap.fire('dragstart'));
    assert.equal(await page.evaluate(() => coffeeTracking.isFollowing()), false);
    const center = await page.evaluate(() => cafesMap.getCenter());
    await emit({latitude: 11.552, heading: 180, speed: 1});
    assert.deepEqual(await page.evaluate(() => cafesMap.getCenter()), center);
    await page.evaluate(() => coffeeTracking.prepareSearch());
    assert.ok(Math.abs(await page.evaluate(() => cafesMap.getCenter().lat) - 11.552) < 0.00001);
    assert.equal(requests.length, 0);
    await page.locator('#cafe-search-form button[type=submit]').click();
    await page.locator('.cafe-card').waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.latitude, 11.552);
    assert.equal(await page.evaluate(() => coffeeTracking.isFollowing()), true);
    assert.ok(Math.abs(await page.evaluate(() => cafesMap.getCenter().lat) - 11.552) < 0.00001);
    await page.locator('.route-button').click();
    await page.locator('#route-map .live-location-marker').waitFor();
    assert.equal(requests.length, 2);
    assert.equal(await page.locator('#route-progress').isVisible(), true);
    assert.match(await page.locator('#route-progress').innerText(), /route/);
    await emit({latitude: 11.556, longitude: 104.933});
    assert.match(await page.locator('#route-progress').innerText(), /remaining/);
    await emit({latitude: 11.57, longitude: 104.95});
    assert.match(await page.locator('#route-progress').innerText(), /off route/);
    await emit({accuracy: 100});
    assert.match(await page.locator('#route-progress').innerText(), /accuracy is low/);
    assert.equal(requests.length, 2);
    await emit({latitude: 11.553, heading: 180, speed: 1});
    assert.ok(Math.abs(await page.evaluate(() => cafesMap.getCenter().lat) - 11.553) < 0.00001);
    assert.equal(await page.locator('.live-dot-position').count(), 2);
    assert.equal(requests.length, 2);
    const link = await page.locator('.directions').getAttribute('href');
    assert.equal(new URL(link).searchParams.get('origin'), '11.552,104.93');
    await page.locator('#cafe-search-form button[type=submit]').click();
    await page.locator('.cafe-card').waitFor();
    assert.equal(requests.at(-1).body.latitude, 11.553);
    assert.equal(await page.locator('#route-progress').isVisible(), false);
    assert.equal(await page.evaluate(() => coffeeTracking.isFollowing()), true);
    await page.locator('#fit-cafes').click();
    assert.equal(await page.evaluate(() => coffeeTracking.isFollowing()), false);
    await page.evaluate(() => coffeeTracking.prepareSearch());
    await page.clock.fastForward(15100);
    assert.match(await status(), /stale/);
    assert.equal(await page.locator('.live-location-marker').count(), 0);
    const countBeforeStaleSearch = requests.length;
    await page.locator('#cafe-search-form button[type=submit]').click();
    assert.equal(requests.length, countBeforeStaleSearch);
    assert.match(await page.locator('#notice').innerText(), /fresh GPS/);
    await emit({heading: 270, speed: 1});
    assert.match(await status(), /GPS location/);
    await page.screenshot({path: '/tmp/find-coffee-tracking-mobile.png', fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#toggle-tracking').click();
    assert.deepEqual(await page.evaluate(() => gps.cleared), [0]);
    await emit({heading: 90, speed: 1}, 0); // A queued callback after stop cannot resurrect tracking.
    assert.equal(await page.locator('.live-location-marker').count(), 0);
    await page.locator('#toggle-tracking').click();
    await emit({heading: 90, speed: 1}, 0);
    assert.equal(await page.locator('.live-location-marker').count(), 0);
    await emit({heading: 90, speed: 1});
    await page.evaluate(() => gps.callbacks.at(-1).error({code: 2}));
    assert.match(await status(), /unavailable or timed out/);
    assert.equal(await page.locator('.live-location-marker').count(), 0);
    await emit({heading: 90, speed: 1});
    assert.equal(await page.locator('.live-location-marker').count(), 1);
    await page.evaluate(() => gps.callbacks.at(-1).error({code: 1}));
    assert.match(await status(), /permission denied/);
    assert.equal(await page.locator('#toggle-tracking').getAttribute('aria-pressed'), 'false');
    await page.locator('#toggle-tracking').click();
    await emit({heading: 45, speed: 1});
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.match(await status(), /page was hidden/);
    assert.equal(await page.locator('.live-location-marker').count(), 0);
    assert.equal(await page.locator('#toggle-tracking').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
    console.log('Tracking checks passed: GPS-only fallback, position/compass separation, accuracy, map following, search separation, route overlay, stale fixes, stop/restart, permission errors, and hidden-page cleanup.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
