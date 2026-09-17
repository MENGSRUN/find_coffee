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
      {name: '<b>Test Café</b>', address: '<img src=x onerror=alert(1)>', opening_hours: 'Mo-Su 07:00-20:00', phone: '+855 12 345 678', website: 'javascript:alert(1)', osm_id: '1', osm_type: 'node', latitude: 11.555, longitude: 104.93, distance_m: 180},
      {name: 'Second Café', osm_id: '2', osm_type: 'way', latitude: 11.56, longitude: 104.935, distance_m: 750},
    ];
    let results = cafes;
    let lastNearbyRequest;
    let failSearch = false;
    let routingAvailable = false;
    await page.route('http://coffee.test/**', async r => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/api/v1/config') return r.fulfill({json: {routing_available: routingAvailable}});
      if (pathname === '/api/v1/route') return r.fulfill({json: {
        distance_m: 250, duration_s: 180, profile: 'walking', steps: [],
        geometry: {type: 'LineString', coordinates: [[104.9282, 11.5564], [104.93, 11.555]]},
      }});
      if (pathname === '/api/v1/nearby') lastNearbyRequest = r.request().postDataJSON();
      if (pathname === '/api/v1/nearby') return failSearch
        ? r.fulfill({status: 503, json: {detail: 'Search unavailable'}})
        : r.fulfill({json: {cafes: results, distance_mode: 'straight'}});
      const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname, '../../app/resources/static', filename)), contentType: types[path.extname(filename)]});
    });
    // Deliberately fail tiles to verify that café markers still work.
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('http://coffee.test/');
    assert.equal(await page.locator('#cafes-map-panel').isHidden(), true);
    await page.locator('#demo').click();
    await page.locator('.cafe-marker').first().waitFor();
    await page.locator('.cafe-details summary').first().click();
    assert.match(await page.locator('.cafe-details').first().innerText(), /Mo-Su 07:00-20:00/);
    assert.equal(await page.locator('.cafe-details img').count(), 0);
    assert.equal(await page.locator('.cafe-details a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('.cafe-details a[href="tel:+85512345678"]').count(), 1);
    assert.equal(await page.locator('.cafe-marker').count(), 2);
    assert.equal(await page.locator('#cafes-map .leaflet-control-attribution').isVisible(), true);
    await page.getByText('Background map unavailable.', {exact: false}).waitFor();
    await page.locator('.cafe-card .save-cafe').first().click();
    assert.equal(await page.locator('#saved-summary').innerText(), 'Saved cafés (1)');
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('find-coffee.saved.v1')));
    assert.deepEqual(Object.keys(persisted[0]).sort(), ['latitude', 'longitude', 'name', 'osm_id', 'osm_type']);
    await page.reload();
    assert.equal(await page.locator('#saved-summary').innerText(), 'Saved cafés (1)');
    await page.locator('.saved-cafes summary').click();
    await page.getByRole('button', {name: 'Search near this café', exact: true}).click();
    await page.locator('.cafe-card').first().waitFor();
    assert.equal(lastNearbyRequest.latitude, cafes[0].latitude);
    assert.equal(await page.locator('.cafe-card .save-cafe').first().getAttribute('aria-pressed'), 'true');
    await page.locator('#saved-list .save-cafe').click();
    assert.equal(await page.locator('#saved-summary').innerText(), 'Saved cafés (0)');
    await page.evaluate(() => cafesMap.setView([11.57, 104.96], 15, {animate: false}));
    await page.locator('#search-map-area').click();
    await page.locator('.cafe-card').first().waitFor();
    assert.ok(Math.abs(lastNearbyRequest.latitude - 11.57) < 0.00001);
    assert.ok(Math.abs(lastNearbyRequest.longitude - 104.96) < 0.00001);
    assert.equal(lastNearbyRequest.radius_m, 3000);
    assert.match(await page.locator('#location-info').innerText(), /map center/);

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
    // Dense results cluster without counting the blue search location.
    results = Array.from({length: 100}, (_, i) => ({...cafes[0], name: `Dense ${i}`,
      osm_id: String(100 + i), latitude: 11.555 + (i % 10) * 0.00001,
      longitude: 104.93 + Math.floor(i / 10) * 0.00001}));
    await page.locator('#page-size').selectOption('all');
    await page.locator('.cafe-cluster').first().waitFor();
    assert.equal(await page.evaluate(() => cafeClusters.getLayers().length), 100);
    assert.equal(await page.locator('.cafe-cluster').first().innerText(), '100');
    await page.locator('.cafe-card .map-button').first().click();
    await page.locator('.cafe-popup').waitFor();
    assert.equal(await page.locator('.cafe-popup strong').innerText(), 'Dense 0');
    // Coincident cafés can still be individually selected.
    results = [cafes[0], {...cafes[0], osm_id: '9', name: 'Same coordinates'}];
    await page.locator('#radius').selectOption('1000');
    await page.locator('.cafe-cluster').first().waitFor();
    assert.equal(await page.locator('.cafe-cluster').first().innerText(), '2');
    await page.locator('.cafe-cluster').first().click();
    await page.locator('.cafe-marker').first().waitFor();
    assert.equal(await page.locator('.cafe-marker').count(), 2);
    await page.locator('.cafe-card .map-button').nth(1).click();
    await page.locator('.cafe-popup').waitFor();
    assert.equal(await page.locator('.cafe-popup strong').innerText(), 'Same coordinates');
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
    await page.route('**/leaflet.markercluster.js', r => r.abort());
    await page.reload();
    await page.locator('#distance-mode').selectOption('straight');
    await page.locator('#demo').click();
    await page.locator('.cafe-marker').first().waitFor();
    assert.equal(await page.locator('.cafe-marker').count(), 2);
    assert.equal(await page.locator('.cafe-cluster').count(), 0);
    await page.locator('.cafe-card .map-button').first().click();
    await page.locator('.cafe-popup').waitFor();
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    });
    await page.locator('.cafe-card .save-cafe').first().click();
    assert.equal(await page.locator('#saved-summary').innerText(), 'Saved cafés (0)');
    assert.match(await page.locator('#saved-status').innerText(), /Could not save/);
    assert.deepEqual(errors, []);
    console.log('Café map checks passed: markers, safe popups, list focus, no routing key, replacement, empty/error states, failed tiles, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
