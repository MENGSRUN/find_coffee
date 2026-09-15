// Mocked browser checks; no app service, PostGIS, public tiles, or routing quota needed.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    const rows = Array.from({length: 45}, (_, i) => ({name: `Café ${i + 1}`, osm_type: 'node', osm_id: String(i + 1),
      latitude: 11.55 + i * 0.0001, longitude: 104.92, distance_m: i * 30,
      road_distance_m: i * 40, duration_s: i * 20}));
    let empty = false;
    await page.route('http://coffee.test/**', async r => {
      const pathname = new URL(r.request().url()).pathname;
      if (pathname === '/api/v1/config') return r.fulfill({json: {routing_available: true}});
      if (pathname === '/api/v1/nearby') {
        const body = r.request().postDataJSON(); requests.push(body);
        const matching = rows.filter(c => c.name.toLowerCase().includes((body.query || '').toLowerCase()));
        const candidates = empty ? [] : body.distance_mode === 'road' ? matching.slice(0, 30) : matching;
        const limit = body.limit === "all" ? candidates.length : body.limit;
        const offset = (body.page - 1) * limit;
        return r.fulfill({json: {cafes: candidates.slice(offset, offset + limit), total: candidates.length,
          distance_mode: body.distance_mode, candidate_count: 30, candidate_limit: 30, unreachable_count: 0}});
      }
      const filename = pathname === '/' ? 'index.html' : pathname.replace('/static/', '');
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname, '../../app/static', filename)), contentType: types[path.extname(filename)]});
    });
    await page.route('https://tile.openstreetmap.org/**', r => r.abort());
    await page.goto('http://coffee.test/');
    await page.locator('#distance-mode').selectOption('straight');
    await page.locator('#demo').click();
    await page.getByText('1–10 of 45', {exact: true}).waitFor();
    assert.equal(await page.locator('#first-page').isDisabled(), true);
    await page.locator('#next-page').click();
    await page.getByText('11–20 of 45', {exact: true}).waitFor();
    assert.equal(requests.at(-1).page, 2);
    assert.equal(await page.locator('.cafe-card h3').first().innerText(), 'Café 11');
    assert.equal(await page.locator('.rank').first().innerText(), '11');
    assert.equal(await page.locator('.cafe-marker').first().getAttribute('title'), '11. Café 11');
    assert.equal(await page.locator('.cafe-marker').count(), 10);
    await page.locator('#last-page').click();
    await page.getByText('41–45 of 45', {exact: true}).waitFor();
    assert.equal(await page.locator('#next-page').isDisabled(), true);
    assert.equal(await page.locator('.cafe-marker').count(), 5);
    await page.locator('#page-size').selectOption('20');
    await page.getByText('1–20 of 45', {exact: true}).waitFor();
    assert.equal(requests.at(-1).limit, 20);
    assert.equal(requests.at(-1).page, 1);
    await page.locator('#next-page').click();
    await page.getByText('21–40 of 45', {exact: true}).waitFor();
    await page.locator('#radius').selectOption('5000');
    await page.getByText('1–20 of 45', {exact: true}).waitFor();
    await page.locator('#page-size').selectOption('10');
    await page.getByText('1–10 of 45', {exact: true}).waitFor();
    await page.locator('#distance-mode').selectOption('road');
    await page.getByText('1–10 of 30', {exact: true}).waitFor();
    assert.match(await page.locator('#search-scope').innerText(), /maximum 30/);
    assert.equal(await page.locator('#result-count').innerText(), '30 cafés ranked by road');
    assert.match(await page.locator('.card-distance').nth(1).innerText(), /40 m/);
    assert.match(await page.locator('.card-distance').nth(1).innerText(), /30 m straight line/);
    const count = requests.length;
    await page.locator('#next-page').click();
    await page.getByText('11–20 of 30', {exact: true}).waitFor();
    await page.locator('#first-page').click();
    await page.getByText('1–10 of 30', {exact: true}).waitFor();
    await page.locator('#page-size').selectOption('50');
    await page.getByText('1–30 of 30', {exact: true}).waitFor();
    assert.equal(requests.length, count, 'Road page navigation must reuse one ranked response');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#pagination').screenshot({path: '/tmp/find-coffee-pagination-mobile.png'});
    await page.setViewportSize({width: 1280, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#cafe-search').fill('Café 45');
    await page.locator('#cafe-search-form button[type="submit"]').click();
    await page.getByText('1–1 of 1', {exact: true}).waitFor();
    assert.equal(requests.at(-1).query, 'Café 45');
    assert.equal(await page.locator('.cafe-card h3').first().innerText(), 'Café 45');
    assert.equal(await page.locator('#cafe-search-form #page-size').count(), 1);
    assert.equal(await page.locator('#pagination #page-size').count(), 0);
    await page.locator('#clear-cafe-search').click();
    await page.getByText('1–30 of 30', {exact: true}).waitFor();
    await page.locator('#page-size').selectOption('all');
    await page.getByText('1–30 of 30', {exact: true}).waitFor();
    await page.locator('#distance-mode').selectOption('straight');
    await page.getByText('1–45 of 45', {exact: true}).waitFor();
    assert.equal(requests.at(-1).limit, 'all');
    assert.equal(await page.locator('.cafe-card').count(), 45);
    assert.equal(await page.locator('#next-page').isDisabled(), true);
    await page.locator('#page-size').selectOption('100');
    await page.waitForFunction(() => document.querySelector('#results').getAttribute('aria-busy') === 'false');
    assert.equal(requests.at(-1).limit, 100);
    empty = true;
    await page.locator('#radius').selectOption('500');
    await page.getByText('0–0 of 0', {exact: true}).waitFor();
    assert.equal(await page.locator('#previous-page').isDisabled(), true);
    assert.equal(await page.locator('#next-page').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('Pagination checks passed: server pages, counts, page size, ranks/markers, reset, road cache, empty state, mobile/desktop layout.');
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode = 1;});
