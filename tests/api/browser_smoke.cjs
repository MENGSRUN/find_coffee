// Run against a running local app. Optional overrides: PLAYWRIGHT_MODULE, CHROMIUM_PATH, APP_URL.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const url = process.env.APP_URL || "http://127.0.0.1:8000";
  const straightLineOnly = (page) => page.route("**/api/v1/config", (route) =>
    route.fulfill({json: {routing_available: false, routing_provider: "openrouteservice"}}));
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await straightLineOnly(desktop);
    const errors = [];
    desktop.on("pageerror", (error) => errors.push(error.message));
    await desktop.goto(url);
    assert.equal(await desktop.locator(".cafe-card").count(), 0);
    await desktop.screenshot({ path: "/tmp/find-coffee-desktop.png", fullPage: true });

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      geolocation: { latitude: 11.5564, longitude: 104.9282, accuracy: 20 },
      permissions: ["geolocation"],
    });
    const phone = await context.newPage();
    await straightLineOnly(phone);
    phone.on("pageerror", (error) => errors.push(error.message));
    await phone.goto(url);
    await phone.getByRole("button", { name: "Use my location" }).click();
    await phone.locator(".cafe-card").first().waitFor();
    assert.match(await phone.locator("#location-info").innerText(), /Your current location/);
    assert.ok(await phone.locator(".cafe-card").count() > 0);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.match(await phone.locator(".directions").first().getAttribute("href"), /^https:\/\/www.google.com\/maps\/dir\//);
    await phone.screenshot({ path: "/tmp/find-coffee-mobile.png", fullPage: true });
    const radiusResponse = phone.waitForResponse((response) => response.url().endsWith("/api/v1/nearby"));
    await phone.locator("#radius").selectOption("500");
    assert.equal((await radiusResponse).request().postDataJSON().radius_m, 500);
    await phone.locator(".manual summary").click();
    await phone.locator("#latitude").fill("0");
    await phone.locator("#longitude").fill("0");
    await phone.getByRole("button", { name: "Find cafés", exact: true }).click();
    await phone.getByText("No mapped cafés within this distance.", { exact: false }).waitFor();
    assert.equal(await phone.locator(".cafe-card").count(), 0);

    await desktop.route("**/api/v1/nearby", (route) => route.fulfill({ status: 503, body: "{}" }));
    await desktop.getByRole("button", { name: "Explore central Phnom Penh" }).click();
    await desktop.getByText("Coffee search is temporarily unavailable.", { exact: false }).waitFor();
    await desktop.unroute("**/api/v1/nearby");

    const denied = await browser.newPage();
    await straightLineOnly(denied);
    await denied.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: {
        getCurrentPosition: (_success, failure) => failure({ code: 1 }),
      } });
    });
    await denied.goto(url);
    await denied.getByRole("button", { name: "Use my location" }).click();
    await denied.getByText("Location access was denied.", { exact: false }).waitFor();
    assert.equal(await denied.locator("#locate").isEnabled(), true);

    const stale = await browser.newPage();
    await straightLineOnly(stale);
    await stale.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: {
        getCurrentPosition: (success) => { window.pendingLocation = success; },
      } });
    });
    await stale.goto(url);
    await stale.getByRole("button", { name: "Use my location" }).click();
    await stale.getByRole("button", { name: "Explore central Phnom Penh" }).click();
    await stale.locator(".cafe-card").first().waitFor();
    await stale.evaluate(() => window.pendingLocation({coords: {latitude: 0, longitude: 0, accuracy: 20}}));
    assert.match(await stale.locator("#location-info").innerText(), /example location, not your GPS/);
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: mobile GPS, layout, radius, directions, empty state, API error, permission denial, stale GPS callback. Screenshots: /tmp/find-coffee-{desktop,mobile}.png");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
