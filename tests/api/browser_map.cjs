// Self-contained UI fixtures: no running app, database, routing key, or public tile traffic.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cafes = [
      {name: '<b>Test Café</b>', osm_id: '1', osm_type: 'node', latitude: 11.555, longitude: 104.93, distance_m: 180},
      {name: 'Second Café', osm_id: '2', osm_type: 'way', latitude: 11.56, longitude: 104.935, distance_m: 750},
    ];
    let results = cafes;
    let failSearch = false;
    let routingAvailable = false;
    await page.route('http://coffee.test/**', async r => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/api/v1/config') return r.fulfill({json: {routing_available: routingAvailable}});
      if (pathname === '/api/v1/route') return r.fulfill({json: {
        distance_m: 250, duration_s: 180, profile: 'walking', steps: [],
        geometry: {type: 'LineString', coordinates: [[104.9282, 11.5564], [104.93, 11.555]]},
      }});
      if (pathname === '/api/v1/nearby') return failSearch
        ? r.fulfill({status: 503, json: {detail: 'Search unavailable'}})
        : r.fulfill({json: {cafes: results, distance_mode: 'straight'}});
      const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname, '../../app/static', filename)), contentType: types[path.extname(filename)]});
    });
    // Deliberately fail tiles to verify that café markers still work.
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('http://coffee.test/');
    assert.equal(await page.locator('#cafes-map-panel').isHidden(), true);
    await page.locator('#demo').click();
    await page.locator('.cafe-marker').first().waitFor();
    assert.equal(await page.locator('.cafe-marker').count(), 2);
    assert.equal(await page.locator('#cafes-map .leaflet-control-attribution').isVisible(), true);
    await page.getByText('Background map unavailable.', {exact: false}).waitFor();
    await page.locator('.cafe-card .map-button').first().click();
    await page.locator('.cafe-popup').waitFor();
    assert.equal(await page.locator('.cafe-popup strong').innerText(), cafes[0].name);
    assert.equal(await page.locator('.cafe-popup b').count(), 0);
    await page.getByRole('button', {name: 'View café in list', exact: true}).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cafe-0');
    assert.equal(await page.locator('.route-button').first().isDisabled(), true);
    await page.locator('#fit-cafes').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: '/tmp/find-coffee-map-mobile.png', fullPage: true});
    await page.setViewportSize({width: 1280, height: 1000});
    await page.locator('#fit-cafes').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: '/tmp/find-coffee-map-desktop.png', fullPage: true});
    results = [cafes[1]];
    await page.locator('#radius').selectOption('1000');
    await page.waitForFunction(() => document.querySelectorAll('.cafe-marker').length === 1);
    assert.equal(await page.locator('.cafe-marker').getAttribute('title'), '1. Second Café');
    results = [];
    await page.locator('#radius').selectOption('500');
    await page.getByText('No mapped cafés within this distance.', {exact: false}).waitFor();
    assert.equal(await page.locator('.cafe-marker').count(), 0);
    assert.equal(await page.locator('#cafes-map .leaflet-interactive').count(), 1);
    failSearch = true;
    await page.locator('#radius').selectOption('3000');
    await page.getByText('Search unavailable', {exact: true}).waitFor();
    assert.equal(await page.locator('#cafes-map-panel').isHidden(), true);
    failSearch = false;
    routingAvailable = true;
    results = cafes;
    await page.reload();
    await page.locator('#distance-mode').selectOption('straight');
    await page.locator('#demo').click();
    await page.locator('.cafe-card .map-button').first().click();
    await page.getByRole('button', {name: 'Show route', exact: true}).click();
    await page.locator('#route-map .leaflet-interactive').first().waitFor();
    assert.match(await page.locator('#route-status').innerText(), /250 m/);
    assert.equal(await page.locator('.cafe-marker').count(), 2);
    await page.locator('#close-route').click();
    assert.equal(await page.locator('#cafes-map-panel').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Café map checks passed: markers, safe popups, list focus, no routing key, replacement, empty/error states, failed tiles, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
