// Mocked configuration failures and recovery; no live API, database, or tiles.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    for (const scenario of ['stall', 'http-error', 'malformed', 'invalid-shape', 'available']) {
      const page = await browser.newPage();
      await page.clock.install();
      const requests = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('http://coffee.test/**', async r => {
        const pathname = new URL(r.request().url()).pathname;
        if (pathname === '/api/v1/config') {
          if (scenario === 'stall') return; // Hold the request until its AbortController fires.
          if (scenario === 'http-error') return r.fulfill({status: 503, body: 'Unavailable'});
          if (scenario === 'malformed') return r.fulfill({contentType: 'application/json', body: '{'});
          if (scenario === 'invalid-shape') return r.fulfill({json: {routing_available: 'true'}});
          return r.fulfill({json: {routing_available: true}});
        }
        if (pathname === '/api/v1/nearby') {
          const body = r.request().postDataJSON(); requests.push(body);
          return r.fulfill({json: {total: 1, distance_mode: body.distance_mode,
            candidate_count: 1, unreachable_count: 0, cafes: [{
              osm_type: 'node', osm_id: '1', name: 'Test Café', latitude: 11.557, longitude: 104.93,
              distance_m: 150, road_distance_m: 200, duration_s: 150,
              source_snap_distance_m: 5, destination_snap_distance_m: 25,
            }]}});
        }
        const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
        const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
        if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
        return r.fulfill({body: await readFile(path.join(__dirname, '../../app/resources/static', filename)),
          contentType: types[path.extname(filename)]});
      });
      await page.route('https://tile.openstreetmap.org/**', r => r.abort());
      await page.goto('http://coffee.test/', {waitUntil: 'domcontentloaded'});
      await page.locator('#demo').click();
      if (scenario === 'stall') {
        assert.equal(requests.length, 0);
        await page.clock.fastForward(5100);
      }
      await page.locator('.cafe-card').waitFor();
      const available = scenario === 'available';
      assert.equal(requests.at(-1).distance_mode, available ? 'road' : 'straight');
      assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('#distance-mode option[value="road"]').isDisabled(), !available);
      assert.equal(await page.locator('.route-button').isDisabled(), !available);
      if (available) {
        assert.match(await page.locator('.card-distance').innerText(), /Road access: start 5 m, café 25 m/);
      } else {
        assert.match(await page.locator('#routing-status').innerText(), /couldn’t be checked/);
        // The resolved fallback also permits subsequent searches without another wait.
        await page.locator('#radius').selectOption('1000');
        await page.locator('.cafe-card').waitFor();
        assert.equal(requests.length, 2);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Configuration checks passed: timeout, HTTP/JSON failures, safe fallback, subsequent searches, and road access distances.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
