"use strict";

// Live GPS state is deliberately separate from the origin used by café/route searches.
(() => {
  const FRESH_MS = 15000;
  let watchId = null;
  let following = false;
  let run = 0;
  let fix = null;
  let lastTimestamp = -Infinity;
  let freshnessTimer = null;
  const overlays = new Map();

  function removeOverlays() {
    for (const [map, overlay] of overlays) map.removeLayer(overlay.layer);
    overlays.clear();
  }

  function invalidate(message) {
    clearTimeout(freshnessTimer);
    fix = null;
    window.coffeeRouteProgress?.update(null);
    removeOverlays();
    $("tracking-status").textContent = message;
  }

  function stop(message = "Tracking stopped.") {
    run += 1;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    following = false;
    invalidate(message);
    window.coffeeCompass?.stop();
    lastTimestamp = -Infinity;
    $("toggle-tracking").textContent = "Start tracking";
    $("toggle-tracking").setAttribute("aria-pressed", "false");
  }

  function directionLabel() {
    const heading = window.coffeeCompass?.getHeading();
    if (!Number.isFinite(heading)) return "Compass direction unavailable.";
    const degrees = Math.round(heading) % 360;
    const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
    return `Phone points ${compass} · ${degrees}°`;
  }

  function draw(map) {
    if (!map || !fix) return;
    let overlay = overlays.get(map);
    if (!overlay) {
      const layer = L.featureGroup().addTo(map);
      const accuracy = L.circle([fix.lat, fix.lon], {radius: fix.accuracy, color: "#2563a6",
        weight: 1, fillOpacity: 0.12, interactive: false, className: "live-accuracy"}).addTo(layer);
      const marker = L.marker([fix.lat, fix.lon], {zIndexOffset: 1000,
        icon: L.divIcon({className: "live-location-marker", html: ""})}).addTo(layer);
      overlay = {layer, accuracy, marker};
      overlays.set(map, overlay);
    }
    const shape = document.createElement("span");
    const phoneHeading = window.coffeeCompass?.getHeading();
    shape.className = Number.isFinite(phoneHeading) ? "live-arrow" : "live-dot-position";
    shape.setAttribute("aria-hidden", "true");
    if (Number.isFinite(phoneHeading)) shape.style.transform = `rotate(${phoneHeading}deg)`;
    overlay.marker.setIcon(L.divIcon({className: "live-location-marker", html: shape,
      iconSize: [32, 32], iconAnchor: [16, 16]}));
    overlay.marker.setLatLng([fix.lat, fix.lon]);
    const label = `Live location · accuracy about ${Math.round(fix.accuracy)} m. ${directionLabel()}`;
    overlay.marker.getElement().setAttribute("aria-label", label);
    overlay.marker.bindTooltip(() => document.createTextNode(label));
    overlay.accuracy.setLatLng([fix.lat, fix.lon]).setRadius(fix.accuracy);
  }

  function refresh() {
    draw(cafesMap);
    if (!$("route-panel").hidden) draw(routeMap);
  }

  function follow() {
    if (!fix || !following) return;
    cafesMap.panTo([fix.lat, fix.lon], {animate: false});
    if (routeMap && !$("route-panel").hidden) routeMap.panTo([fix.lat, fix.lon], {animate: false});
  }

  function receive(position, token) {
    if (token !== run || document.hidden) return;
    const c = position.coords, timestamp = position.timestamp;
    if (!c || !Number.isFinite(timestamp) || timestamp <= lastTimestamp) return;
    if (!Number.isFinite(c.latitude) || Math.abs(c.latitude) > 90
        || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180
        || !Number.isFinite(c.accuracy) || c.accuracy < 0
        || Date.now() - timestamp > FRESH_MS || timestamp > Date.now() + 1000) {
      invalidate("Waiting for a fresh, valid GPS location…");
      return;
    }
    lastTimestamp = timestamp;
    const next = {lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, timestamp};
    fix = next;
    window.coffeeRouteProgress?.update(fix);
    if (!ensureCafesMap()) { stop("The map could not load. Reload before starting tracking."); return; }
    if (!Number.isFinite(cafesMap.getZoom())) cafesMap.setView([fix.lat, fix.lon], 17);
    if (!cafesLayer) $("cafes-map-summary").textContent = "Live location. Tap Search to find cafés nearby.";
    refresh();
    follow();
    $("tracking-status").textContent = `GPS location · accuracy about ${Math.round(fix.accuracy)} m`;
    clearTimeout(freshnessTimer);
    freshnessTimer = setTimeout(() => invalidate("GPS location is stale. Waiting for an update…"),
      Math.max(0, FRESH_MS - (Date.now() - timestamp)));
  }

  $("toggle-tracking").addEventListener("click", () => {
    $("tracking-statuses").hidden = false;
    if (watchId !== null) { stop(); return; }
    if (!window.isSecureContext || !navigator.geolocation) {
      stop("Tracking needs HTTPS, location permission, and a browser with location support."); return;
    }
    if (!window.L) { stop("The map could not load. Reload before starting tracking."); return; }
    const token = ++run;
    following = true;
    $("toggle-tracking").textContent = "Stop tracking";
    $("toggle-tracking").setAttribute("aria-pressed", "true");
    $("tracking-status").textContent = "Finding your live location… Allow location access when asked.";
    try {
      // Start sensor permission directly in the same tap, before awaiting anything.
      // Compass denial is handled independently and does not block GPS updates.
      window.coffeeCompass?.start();
      watchId = navigator.geolocation.watchPosition(p => receive(p, token), error => {
        if (token !== run) return;
        if (error.code === 1) stop("Location permission denied. Allow location in your browser settings to track.");
        else invalidate("GPS is unavailable or timed out. Waiting for an update…");
      }, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
    } catch {
      stop("Location tracking could not start. Check your browser location permissions.");
    }
  });
  function prepareSearch() {
    if (watchId === null) return true;
    if (!fix || Date.now() - fix.timestamp >= FRESH_MS) {
      notice("Waiting for a fresh GPS location before searching. Stop tracking to use the previous search location.");
      return false;
    }
    finishLocating();
    origin = {lat: fix.lat, lon: fix.lon, label: `Search location from tracking · accuracy about ${Math.round(fix.accuracy)} m · distances stay at this location until you search again`};
    following = true;
    follow();
    return true;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && watchId !== null) stop("Tracking stopped while the page was hidden. Tap Start tracking to resume.");
  });
  window.addEventListener("pagehide", () => stop());
  window.coffeeTracking = {refresh, getFix: () => fix ? {...fix} : null, hasPosition: () => fix !== null,
    prepareSearch, isFollowing: () => following,
    pauseFollow: () => { following = false; }};
})();
