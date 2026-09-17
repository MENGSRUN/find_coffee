// Simulated phone rotation: no physical sensors, GPS, backend, or routing requests.
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
      window.sensor = {permission: 'granted', calls: [], callbacks: [], cleared: []};
      function Orientation() {}
      Orientation.requestPermission = absolute => {
        sensor.calls.push(absolute);
        if (sensor.permission === 'pending') return new Promise(resolve => { sensor.resolve = resolve; });
        return Promise.resolve(sensor.permission);
      };
      Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: Orientation});
      Object.defineProperty(navigator, 'geolocation', {value: {
        watchPosition(success, error) { sensor.gpsError = error; sensor.callbacks.push(success); return sensor.callbacks.length - 1; },
        clearWatch(id) { sensor.cleared.push(id); },
      }});
    });
    const errors = [], apiRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://coffee.test/**', async r => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/api/v1/config') return r.fulfill({json: {routing_available: false}});
      if (pathname.startsWith('/api/')) { apiRequests.push(pathname); return r.abort(); }
      const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname, '../../app/resources/static', filename)), contentType: types[path.extname(filename)]});
    });
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('https://coffee.test/');
    async function rotate(values, type = 'deviceorientationabsolute') {
      await page.evaluate(({values, type}) => window.dispatchEvent(Object.assign(new Event(type), values)), {values, type});
      await page.clock.runFor(20);
    }
    const status = () => page.locator('#compass-status').innerText();
    assert.deepEqual(await page.evaluate(() => sensor.calls), []);
    await page.locator('#toggle-tracking').click();
    assert.deepEqual(await page.evaluate(() => sensor.calls), [true]);
    for (const [alpha, heading, compass] of [[0, 0, 'N'], [270, 90, 'E'], [180, 180, 'S'], [90, 270, 'W'], [1, 359, 'N'], [359, 1, 'N']]) {
      await rotate({absolute: true, alpha, beta: 0, gamma: 0});
      assert.equal(await status(), `Phone points ${compass} · ${heading}°`);
      assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), heading);
    }
    assert.equal(await page.evaluate(() => sensor.callbacks.length), 1); // One tap starts both sensors.
    assert.equal(await page.locator('#toggle-compass').count(), 0);
    await rotate({absolute: true, alpha: 90, beta: 90, gamma: 0});
    assert.match(await status(), /flatter/);
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await rotate({webkitCompassHeading: 90, webkitCompassAccuracy: 5, absolute: false}, 'deviceorientation');
    assert.equal(await status(), 'Phone points E · 90°');
    await rotate({webkitCompassHeading: 90, webkitCompassAccuracy: -1}, 'deviceorientation');
    assert.match(await status(), /accuracy is poor/);
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await rotate({webkitCompassHeading: 270, webkitCompassAccuracy: 5}, 'deviceorientation');
    await page.evaluate(() => sensor.callbacks.at(-1)({timestamp: Date.now(), coords: {
      latitude: 11.55, longitude: 104.93, accuracy: 5, speed: 0, heading: null,
    }}));
    assert.equal(await page.locator('.live-dot-position').count(), 0);
    assert.equal(await page.locator('.live-arrow').count(), 1);
    assert.equal(await page.locator('.live-arrow').evaluate(e => e.style.transform), 'rotate(270deg)');
    await rotate({webkitCompassHeading: 0, webkitCompassAccuracy: 5}, 'deviceorientation');
    assert.equal(await page.locator('.live-arrow').evaluate(e => e.style.transform), 'rotate(0deg)');
    assert.equal(await page.locator('.live-arrow').count(), 1); // Stationary GPS + compass = one arrow.
    await page.evaluate(() => sensor.callbacks.at(-1)({timestamp: Date.now() + 1, coords: {
      latitude: 11.551, longitude: 104.931, accuracy: 5, speed: 1, heading: 180,
    }}));
    assert.equal(await page.locator('.live-arrow').evaluate(e => e.style.transform), 'rotate(0deg)');
    assert.equal(await page.locator('.live-location-marker').count(), 1);
    assert.deepEqual(apiRequests, []);
    await page.screenshot({path: '/tmp/find-coffee-compass-mobile.png', fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.clock.fastForward(5100);
    await page.clock.runFor(20);
    assert.match(await status(), /stale/);
    assert.equal(await page.locator('.live-arrow').count(), 0);
    await page.locator('#toggle-tracking').click();
    await rotate({webkitCompassHeading: 90}, 'deviceorientation');
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await page.locator('#toggle-tracking').click();
    await rotate({absolute: false, alpha: 270, beta: 0, gamma: 0}, 'deviceorientation');
    await page.clock.fastForward(8100);
    await page.clock.runFor(20);
    assert.match(await status(), /No north-referenced/);
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await page.locator('#toggle-tracking').click();
    await page.evaluate(() => { sensor.permission = 'denied'; });
    await page.locator('#toggle-tracking').click();
    assert.match(await status(), /permission denied/);
    assert.equal(await page.locator('#toggle-tracking').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => sensor.callbacks.at(-1)({timestamp: Date.now(), coords: {
      latitude: 11.55, longitude: 104.93, accuracy: 5, speed: 1, heading: 90,
    }}));
    assert.equal(await page.locator('.live-dot-position').count(), 1);
    await page.locator('#toggle-tracking').click();
    await page.evaluate(() => { sensor.permission = 'pending'; });
    await page.locator('#toggle-tracking').click();
    await page.locator('#toggle-tracking').click();
    await page.evaluate(() => sensor.resolve('granted'));
    await rotate({absolute: true, alpha: 90, beta: 0, gamma: 0});
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await page.locator('#toggle-tracking').click();
    await page.evaluate(() => sensor.gpsError({code: 1}));
    assert.equal(await page.locator('#toggle-tracking').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => sensor.resolve('granted'));
    await rotate({absolute: true, alpha: 90, beta: 0, gamma: 0});
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    // Browsers without requestPermission use the event listener path directly.
    await page.evaluate(() => { delete DeviceOrientationEvent.requestPermission; });
    await page.locator('#toggle-tracking').click();
    await rotate({absolute: true, alpha: 270, beta: 0, gamma: 0});
    assert.equal(await status(), 'Phone points E · 90°');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.match(await page.locator('#tracking-status').innerText(), /page was hidden/);
    assert.equal(await page.evaluate(() => coffeeCompass.getHeading()), null);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: false});
      Object.defineProperty(window, 'DeviceOrientationEvent', {value: undefined});
    });
    await page.locator('#toggle-tracking').click();
    assert.match(await status(), /supported phone browser/);
    assert.deepEqual(errors, []);
    console.log('Compass checks passed: stationary turns, north wrap, Safari/absolute readings, tilt/accuracy, relative-only rejection, map overlay, stale/denied/unsupported sensors, permission races, single-button lifecycle, GPS-only fallback, and no API calls from sensor updates.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
