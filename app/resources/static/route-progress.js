"use strict";

// Approximate progress on the displayed polyline, computed locally from GPS.
(() => {
  const radians = value => value * Math.PI / 180;
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  function meters(a, b) {
    const lat = radians(b[1] - a[1]), lon = radians(wrap(b[0] - a[0]));
    const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(lon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function measure(points, fix) {
    const scale = Math.cos(radians(fix.lat));
    const project = p => [radians(wrap(p[0] - fix.lon)) * scale * 6371000,
      radians(p[1] - fix.lat) * 6371000];
    let total = 0;
    const candidates = [];
    for (let i = 1; i < points.length; i++) {
      const a = project(points[i - 1]), b = project(points[i]);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = meters(points[i - 1], points[i]);
      if (!length) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy)));
      candidates.push({offset: Math.hypot(a[0] + t * dx, a[1] + t * dy), along: total + t * length});
      total += length;
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.offset - b.offset);
    const best = candidates[0];
    // At crossings or parallel streets, GPS may not identify the route segment.
    const ambiguous = candidates.some(c => c.offset <= best.offset + Math.max(10, fix.accuracy)
      && Math.abs(c.along - best.along) > 100);
    return {offset: best.offset, remaining: total - best.along, percent: best.along / total * 100, ambiguous};
  }
  let points = null;
  function update(fix) {
    const panel = document.getElementById("route-progress");
    panel.hidden = !points;
    if (!points) return;
    let message;
    if (!fix || Date.now() - fix.timestamp >= 15000) {
      message = "Start tracking and wait for a fresh GPS location to see route progress.";
    } else if (fix.accuracy > 50) {
      message = "GPS accuracy is low. Waiting for a more precise location to estimate progress.";
    } else {
      const result = measure(points, fix);
      if (!result) message = "Progress is unavailable for this route.";
      else if (result.offset > Math.max(30, fix.accuracy * 2)) {
        message = `You appear off route · about ${Math.round(result.offset)} m from the route. Use Search, then Show route on map to get a new route.`;
      } else if (result.ambiguous) {
        message = "Your location is near multiple parts of the route. Progress will update when your position is clearer.";
      } else if (result.remaining <= 20) {
        message = "Near the end of the mapped route. Check the café entrance on the map.";
      } else {
        const remaining = result.remaining < 1000 ? `${Math.round(result.remaining)} m` : `${(result.remaining / 1000).toFixed(1)} km`;
        message = `About ${remaining} remaining along the mapped route · ${Math.round(result.percent)}% complete`;
      }
    }
    if (panel.textContent !== message) panel.textContent = message;
  }
  window.coffeeRouteProgress = {
    measure,
    setRoute: geometry => { points = geometry.coordinates; update(window.coffeeTracking?.getFix()); },
    clear: () => { points = null; update(null); },
    update,
  };
})();
