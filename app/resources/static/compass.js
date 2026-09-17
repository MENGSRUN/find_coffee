"use strict";

// Compass sensor adapter; its lifecycle is owned by the single tracking control.
(() => {
  let enabled = false;
  let generation = 0;
  let heading = null;
  let staleTimer = null;
  let frame = null;

  function render() {
    frame = null;
    window.coffeeTracking?.refresh();
  }

  function publish(value, message) {
    heading = value;
    $("compass-status").textContent = message;
    // Sensor events may arrive faster than display frames; show the latest reading.
    if (frame === null) frame = requestAnimationFrame(render);
  }

  function stop(message = "Phone compass is off.") {
    enabled = false;
    generation += 1;
    clearTimeout(staleTimer);
    window.removeEventListener("deviceorientation", receive);
    window.removeEventListener("deviceorientationabsolute", receive);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    heading = null;
    $("compass-status").textContent = message;
    render();
  }

  function receive(event) {
    if (!enabled || document.hidden) return;
    let value;
    if (Number.isFinite(event.webkitCompassHeading)
        && event.webkitCompassHeading >= 0 && event.webkitCompassHeading < 360) {
      // Safari exposes a compass heading directly, even when absolute is false.
      if (Number.isFinite(event.webkitCompassAccuracy)
          && (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 30)) {
        publish(null, "Compass accuracy is poor. Move away from metal and recalibrate your phone.");
        return;
      }
      value = event.webkitCompassHeading;
    } else if (event.absolute === true && Number.isFinite(event.alpha)
        && event.alpha >= 0 && event.alpha < 360) {
      // 360-alpha is a compass bearing for a screen-up device. Avoid vertical poses
      // where the top edge has little horizontal projection and yaw becomes unstable.
      if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)
          || Math.abs(event.beta) > 60 || Math.abs(event.gamma) > 60) {
        publish(null, "Hold your phone flatter, with the screen facing up, to read the compass.");
        return;
      }
      value = (360 - event.alpha) % 360;
    } else {
      // Relative alpha has no north reference and must not replace a compass bearing.
      return;
    }
    const degrees = Math.round(value) % 360;
    const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
    publish(value, `Phone points ${compass} · ${degrees}°`);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => publish(null,
      "Compass reading is stale. Turn the phone gently or restart tracking."), 5000);
  }

  async function start() {
    if (enabled) return;
    if (!window.isSecureContext || !window.DeviceOrientationEvent) {
      stop("A phone compass needs HTTPS and a supported phone browser. GPS tracking is still available.");
      return;
    }
    enabled = true;
    const token = ++generation;
    publish(null, "Waiting for compass permission and a north-referenced reading…");
    try {
      // Called directly from the tap handler to preserve the required user gesture.
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission(true);
        if (token !== generation) return;
        if (permission !== "granted") { stop("Compass permission denied. Allow motion/orientation access in your browser settings."); return; }
      }
      if (token !== generation) return;
      window.addEventListener("deviceorientation", receive);
      window.addEventListener("deviceorientationabsolute", receive);
      staleTimer = setTimeout(() => publish(null,
        "No north-referenced compass reading is available. Check sensor permissions or try a supported phone browser."), 8000);
    } catch {
      if (token === generation) stop("Compass access failed. Check motion/orientation permissions and try again.");
    }
  }
  window.coffeeCompass = {start, stop, getHeading: () => heading};
})();
