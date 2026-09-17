// Offline browser fixtures: no ORS key, database, or tile traffic.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1360, height: 1000}});
    const errors = [], requests = [];
    let empty = false, fail = false;
    page.on('pageerror', e => errors.push(e.message));
    const area = {type: 'Polygon', coordinates: [[[104.92,11.55],[104.94,11.55],
      [104.94,11.565],[104.93,11.57],[104.92,11.55]]]};
    await page.route('http://coffee.test/**', async r => {
      const url = new URL(r.request().url());
      if (url.pathname === '/api/v1/config') return r.fulfill({json: {routing_available: true}});
      if (url.pathname === '/api/v1/nearby') {
        const body = r.request().postDataJSON(); requests.push(body);
        if (fail) return r.fulfill({status: 429, json: {detail: 'Routing quota reached'}});
        const cafes = empty ? [] : Array.from({length: 12}, (_,i) => ({osm_id: String(i+1),
          osm_type: 'node', name: `Garden Café ${i+1}`, latitude: 11.556+i*0.0001,
          longitude: 104.928+i*0.0003, distance_m: 60+i*32}));
        return r.fulfill({json: {cafes, total: cafes.length, distance_mode: body.distance_mode,
          ...(body.distance_mode === 'walk_area' ? {area, walk_minutes: body.walk_minutes} : {})}});
      }
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.replace('/static/','');
      const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
      if (filename.includes('/') || !types[path.extname(filename)]) return r.abort();
      return r.fulfill({body: await readFile(path.join(__dirname,'../../app/resources/static',filename)),contentType:types[path.extname(filename)]});
    });
    await page.route('https://tile.openstreetmap.org/**',r => r.fulfill({status: 200,
      contentType: 'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef1e8"/></svg>'}));
    await page.goto('http://coffee.test/');
    await page.selectOption('#distance-mode','walk_area');
    assert.equal(await page.locator('#radius').isVisible(), false);
    assert.equal(await page.locator('#profile').isVisible(), false);
    await page.click('#demo');
    await page.locator('.cafe-card').first().waitFor();
    assert.equal(requests.at(-1).profile, 'walking');
    assert.equal(requests.at(-1).walk_minutes,10);
    assert.equal(requests.at(-1).limit,'all');
    assert.equal(await page.locator('.cafe-card').count(),10);
    assert.equal(await page.evaluate(() => cafesLayer.getLayers().some(l => l instanceof L.GeoJSON)),true);
    assert.match(await page.locator('#walk-area-summary').innerText(),/10-minute/);
    const count=requests.length;
    await page.click('#next-page');
    await page.waitForFunction(() => document.querySelectorAll('.cafe-card').length===2);
    assert.equal(requests.length,count);
    await page.selectOption('#page-size','all');
    await page.waitForFunction(() => document.querySelectorAll('.cafe-card').length===12);
    assert.equal(requests.length,count);
    await page.screenshot({path:'/tmp/coffee-walking-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/tmp/coffee-walking-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    empty=true;
    await page.selectOption('#walk-minutes','15');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('No mapped cafés in this walking area'));
    assert.equal(await page.evaluate(() => cafesLayer.getLayers().some(l => l instanceof L.GeoJSON)),true);
    fail=true;
    await page.selectOption('#walk-minutes','5');
    await page.getByText('Routing quota reached',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => cafesLayer===null),true);
    fail=false; empty=false;
    await page.selectOption('#distance-mode','straight');
    await page.locator('.cafe-card').first().waitFor();
    assert.equal(await page.locator('#walk-control').isHidden(),true);
    assert.equal(await page.locator('#radius').isVisible(),true);
    assert.equal(await page.evaluate(() => cafesLayer.getLayers().some(l => l instanceof L.GeoJSON)),false);
    assert.deepEqual(errors,[]);
    console.log('Walking area: polygon, controls, cache, empty/error states, mode switch, mobile layout passed');
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
