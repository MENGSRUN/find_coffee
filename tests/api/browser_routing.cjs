// Mocked route fixtures verify UI behavior, not actual routes or provider credentials.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    const cafe = {name: "Test Café", osm_id: "9000000000000000001", osm_type: "node",
      latitude: 11.555, longitude: 104.93, distance_m: 180, road_distance_m: 650, duration_s: 500};
    const route = {cafe, profile: "walking", provider: "openrouteservice", distance_m: 650, duration_s: 500,
      geometry: {type: "LineString", coordinates: [[104.9282, 11.5564], [104.929, 11.5564], [104.929, 11.555], [104.93, 11.555]]},
      steps: [{instruction: "Turn left onto Test Street", road: "Test Street", distance_m: 300, duration_s: 200}]};
    await page.route("**/api/v1/config", (r) => r.fulfill({json: {routing_available: true, routing_provider: "openrouteservice"}}));
    await page.route("**/api/v1/nearby", (r) => {
      const body = r.request().postDataJSON(); requests.push(body);
      return r.fulfill({json: {cafes: [cafe], distance_mode: body.distance_mode, profile: body.profile,
        candidate_count: 30, candidate_limit: 30, unreachable_count: 1}});
    });
    await page.route("**/api/v1/route", (r) => {
      const body = r.request().postDataJSON(); requests.push(body);
      return r.fulfill({json: {...route, profile: body.profile}});
    });
    // Avoid consuming public tile traffic during automated fixture tests.
    await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")}));
    await page.goto(process.env.APP_URL || "http://127.0.0.1:8000");
    await page.getByRole("button", {name: "Explore central Phnom Penh"}).click();
    await page.locator(".cafe-card").waitFor();
    assert.equal(requests[0].distance_mode, "road");
    assert.match(await page.locator(".card-distance").innerText(), /650 m/);
    const googleParams = new URL(await page.locator(".directions").getAttribute("href")).searchParams;
    assert.equal(googleParams.get("origin"), "11.5564,104.9282");
    assert.equal(googleParams.get("destination"), `${cafe.latitude},${cafe.longitude}`);
    assert.equal(googleParams.get("travelmode"), "walking");
    assert.match(await page.locator("#distance-note").innerText(), /30 nearby cafés/);
    await page.getByRole("button", {name: "Show route on map"}).click();
    await page.getByText("Turn left onto Test Street", {exact: false}).waitFor();
    await page.locator("#route-map .leaflet-interactive").first().waitFor();
    assert.equal(requests[1].osm_id, "9000000000000000001");
    assert.match(await page.locator("#route-status").innerText(), /650 m/);
    assert.ok(await page.locator("#route-map .leaflet-control-attribution").isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.locator("#profile").selectOption("driving");
    await page.locator(".cafe-card").waitFor();
    assert.equal(await page.locator("#route-panel").isHidden(), true);
    assert.equal(requests.at(-1).profile, "driving");
    assert.match(await page.locator(".directions").getAttribute("href"), /travelmode=driving/);
    assert.equal(new URL(await page.locator(".directions").getAttribute("href")).searchParams.get("origin"), "11.5564,104.9282");
    await page.unroute("**/api/v1/route");
    await page.route("**/api/v1/route", (r) => r.fulfill({status: 429, json: {detail: "Routing quota reached. Try later."}}));
    await page.getByRole("button", {name: "Show route on map"}).click();
    await page.getByText("Routing quota reached. Try later.", {exact: true}).waitFor();
    assert.equal(await page.locator("#route-map").isHidden(), true);

    await page.getByRole("button", {name: "Close route"}).click();
    await page.locator("#distance-mode").selectOption("straight");
    await page.getByText("straight line", {exact: true}).waitFor();
    assert.match(await page.locator(".card-distance").innerText(), /180 m/);
    assert.deepEqual(errors, []);
    console.log("Hosted routing UI checks passed: road meters, profile switching, route map, street instructions, quota error, explicit straight-line mode, mobile layout.");
  } finally { await browser.close(); }
})().catch((error) => {console.error(error); process.exitCode = 1;});
