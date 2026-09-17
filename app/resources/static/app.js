"use strict";
const $ = (id) => document.getElementById(id);
let origin = null;
let controller = null;
let generation = 0;
let locating = false;
let routingAvailable = false;
let routeController = null;
let routeGeneration = 0;
let routeMap = null;
let routeLayer = null;
let activeSearch = null;
let cafesMap = null;
let cafesLayer = null;
let cafeClusters = null;
const cafeMarkers = new Map();
let currentPage = 1;
let nameQuery = "";
let totalPages = 0;
let roadResults = null;

function fitCafes() {
  if (cafesMap && cafesLayer) {
    cafesMap.closePopup();
    cafesMap.invalidateSize();
    cafesMap.stop();
    cafesMap.fitBounds(cafesLayer.getBounds(), {padding: [35, 35], maxZoom: 16, animate: false});
  }
}

function focusCafe(key) {
  const marker = cafeMarkers.get(key);
  if (!marker) return;
  window.coffeeTracking?.pauseFollow();
  $("cafes-map-panel").scrollIntoView({block: "start", behavior: "auto"});
  cafesMap.invalidateSize();
  if (cafeClusters?.zoomToShowLayer) {
    cafeClusters.zoomToShowLayer(marker, () => {
      if (cafeMarkers.get(key) === marker) marker.openPopup();
    });
  } else {
    cafesMap.setView(marker.getLatLng(), 17);
    marker.openPopup();
  }
}

function ensureCafesMap() {
  $("cafes-map-panel").hidden = false;
  $("fit-cafes").disabled = !window.L || !cafesLayer;
  if (!window.L) {
    $("cafes-map-note").textContent = "The map could not load. Café details are still available in the list below. Reload to try again.";
    $("cafes-map-note").hidden = false;
    return false;
  }
  if (!cafesMap) {
    const failedTiles = new Set();
    cafesMap = L.map("cafes-map", {scrollWheelZoom: false});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on("tileerror", (event) => {
      failedTiles.add(event.tile);
      $("cafes-map-note").textContent = "Background map unavailable. Location markers and the café list are still available.";
      $("cafes-map-note").hidden = false;
    }).on("tileload", (event) => {
      failedTiles.delete(event.tile);
      $("cafes-map-note").hidden = failedTiles.size === 0;
    }).on("tileunload", (event) => {
      failedTiles.delete(event.tile);
    }).addTo(cafesMap);
    cafesMap.on("dragstart", () => window.coffeeTracking?.pauseFollow());
  }
  cafesMap.invalidateSize();
  return true;
}

function renderCafesMap(cafes, snapshot, roadMode, area) {
  $("cafes-map-summary").textContent = `${cafes.length} cafés on this page. Tap a group to expand it, or a numbered marker for café details.`;
  if (!ensureCafesMap()) return;
  cafesLayer = L.featureGroup().addTo(cafesMap);
  if (area) L.geoJSON(area, {style: {color: "#287b59", weight: 2, fillOpacity: 0.16},
    interactive: false}).addTo(cafesLayer);
  cafeClusters = typeof L.markerClusterGroup === "function" ? L.markerClusterGroup({
    maxClusterRadius: 45, showCoverageOnHover: false, animate: false,
    iconCreateFunction: cluster => {
      const count = cluster.getChildCount();
      const label = document.createElement("span");
      label.textContent = String(count);
      label.setAttribute("aria-label", `${count} cafés. Activate to expand group.`);
      label.title = `${count} cafés — expand group`;
      return L.divIcon({className: "cafe-cluster", html: label, iconSize: [44, 44]});
    },
  }) : L.featureGroup();
  cafeClusters.on("clusterclick", () => window.coffeeTracking?.pauseFollow());
  cafesLayer.addLayer(cafeClusters);
  $("fit-cafes").disabled = false;
  L.circleMarker([snapshot.lat, snapshot.lon], {radius: 9, color: "#fff", weight: 3,
    fillColor: "#2563a6", fillOpacity: 1}).bindTooltip(snapshot.label).addTo(cafesLayer);
  cafes.forEach((cafe, index) => {
    const rank = (snapshot.page - 1) * snapshot.page_size + index + 1;
    const key = `${cafe.osm_type}/${cafe.osm_id}`;
    const popup = element("div", "cafe-popup");
    popup.append(element("strong", "", cafe.name));
    popup.append(element("p", "", roadMode
      ? `${distanceText(cafe.road_distance_m)} along roads · ${timeText(cafe.duration_s)} ${snapshot.profile} · ${distanceText(cafe.distance_m)} straight line`
      : `${distanceText(cafe.distance_m)} · straight line`));
    const listButton = element("button", "map-button", "View café in list");
    listButton.type = "button";
    listButton.addEventListener("click", () => {
      const card = $(`cafe-${index}`);
      card.scrollIntoView({block: "center", behavior: "auto"});
      card.focus({preventScroll: true});
    });
    popup.append(listButton);
    if (routingAvailable) {
      const routeButton = element("button", "map-button", "Show route");
      routeButton.type = "button";
      routeButton.addEventListener("click", () => showRoute(cafe, snapshot));
      popup.append(routeButton);
    }
    const marker = L.marker([cafe.latitude, cafe.longitude], {
      title: `${rank}. ${cafe.name}`, alt: `${rank}. ${cafe.name}`,
      icon: L.divIcon({className: "cafe-marker", html: String(rank), iconSize: [32, 32], iconAnchor: [16, 16]}),
    }).bindPopup(popup);
    cafeMarkers.set(key, marker);
  });
  const markers = [...cafeMarkers.values()];
  if (cafeClusters.addLayers) cafeClusters.addLayers(markers);
  else markers.forEach(marker => cafeClusters.addLayer(marker));
  if (!window.coffeeTracking?.hasPosition() || !window.coffeeTracking?.isFollowing()) fitCafes();
  window.coffeeTracking?.refresh();
}

const configController = new AbortController();
const configTimeout = setTimeout(() => configController.abort(), 5000);
const configReady = fetch("/api/v1/config", {signal: configController.signal}).then((response) => {
  if (!response.ok) throw new Error("Configuration unavailable");
  return response.json();
}).then((config) => {
  if (typeof config?.routing_available !== "boolean") throw new Error("Invalid configuration");
  routingAvailable = config.routing_available;
  if (!routingAvailable) {
    $("distance-mode").value = "straight";
    $("distance-mode").querySelector('[value="road"]').disabled = true;
    $("distance-mode").querySelector('[value="walk_area"]').disabled = true;
    $("routing-status").textContent = "Road routing isn’t connected yet. You can browse cafés using clearly labeled straight-line distances.";
    $("routing-status").hidden = false;
  }
}).catch(() => {
  routingAvailable = false;
  $("distance-mode").value = "straight";
  $("distance-mode").querySelector('[value="road"]').disabled = true;
  $("distance-mode").querySelector('[value="walk_area"]').disabled = true;
  $("routing-status").textContent = "Routing availability couldn’t be checked. Using straight-line search for now; reload to try again.";
  $("routing-status").hidden = false;
}).finally(() => { clearTimeout(configTimeout); syncSearchControls(); });

const distanceText = (meters) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
const timeText = (seconds) => seconds < 60 ? "<1 min" : `${Math.ceil(seconds / 60)} min`;

function closeRoute() {
  window.coffeeRouteProgress?.clear();
  routeController?.abort();
  routeGeneration += 1;
  $("route-panel").hidden = true;
  $("route-instructions").hidden = true;
  $("route-map").hidden = true;
  $("route-map-note").hidden = true;
  $("route-steps").replaceChildren();
  if (routeMap && routeLayer) { routeMap.removeLayer(routeLayer); routeLayer = null; }
}

async function apiError(response) {
  let data;
  try { data = await response.json(); } catch { /* Generic message below. */ }
  return new Error(typeof data?.detail === "string" ? data.detail : "Coffee search is temporarily unavailable. Please try again shortly.");
}

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}

function clearResults(label) {
  closeRoute();
  if (cafesMap && cafesLayer) { cafesMap.removeLayer(cafesLayer); cafesLayer = null; }
  cafeClusters = null;
  cafeMarkers.clear();
  $("cafes-map-panel").hidden = !window.coffeeTracking?.hasPosition();
  $("cafes-map-summary").textContent = "Search to find cafés around your live location.";
  activeSearch = null;
  $("results").replaceChildren();
  $("result-count").textContent = label;
  $("empty").hidden = true;
  $("distance-note").hidden = true;
  $("search-scope").hidden = true;
  $("walk-area-summary").hidden = true;
  $("pagination").hidden = true;
}

function begin() {
  controller?.abort();
  generation += 1;
  clearResults("Searching…");
  $("results").setAttribute("aria-busy", "true");
  return generation;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function externalLink(label, href, className) {
  const link = element("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function cafeDetails(cafe) {
  const details = element("details", "cafe-details");
  details.append(element("summary", "", "Café details"));
  const fields = [["address", "Address"], ["opening_hours", "Opening hours"],
    ["phone", "Phone"], ["website", "Website"]];
  const list = element("dl", "");
  for (const [key, label] of fields) {
    list.append(element("dt", "", label));
    const value = typeof cafe[key] === "string" ? cafe[key].trim() : "";
    const entry = element("dd", "", value || "Not provided in OpenStreetMap");
    if (value && key === "website") {
      try {
        const url = new URL(value);
        if (["https:", "http:"].includes(url.protocol)) {
          entry.replaceChildren(externalLink(value, url.href, ""));
        }
      } catch { /* Unrecognized addresses stay plain text. */ }
    } else if (key === "phone" && /^\+?[0-9 ()-]{3,40}$/.test(value)) {
      const link = element("a", "", value);
      link.href = `tel:${value.replace(/[ ()-]/g, "")}`;
      entry.replaceChildren(link);
    }
    list.append(entry);
  }
  details.append(list, element("p", "", "Community-provided details may be outdated. Opening hours are shown as recorded, not live open/closed status."));
  return details;
}

function render(data, snapshot) {
  const cafes = data.cafes;
  const roadMode = data.distance_mode === "road";
  activeSearch = snapshot;
  const fragment = document.createDocumentFragment();
  cafes.forEach((cafe, index) => {
    const card = element("li", "cafe-card");
    card.id = `cafe-${index}`;
    card.tabIndex = -1;
    card.append(element("span", "rank", String((snapshot.page - 1) * snapshot.page_size + index + 1).padStart(2, "0")));
    const content = element("div", "cafe-content");
    content.append(element("h3", "", cafe.name));
    const meta = element("div", "cafe-meta");
    meta.append(externalLink("View place on OpenStreetMap", `https://www.openstreetmap.org/${encodeURIComponent(cafe.osm_type)}/${encodeURIComponent(cafe.osm_id)}`, ""));
    content.append(meta, cafeDetails(cafe));
    if (window.coffeeSaved) content.append(window.coffeeSaved.button(cafe));
    const mapButton = element("button", "map-button", "View on map");
    mapButton.type = "button";
    mapButton.disabled = !window.L;
    mapButton.addEventListener("click", () => focusCafe(`${cafe.osm_type}/${cafe.osm_id}`));
    content.append(mapButton);
    const routeButton = element("button", "route-button", "Show route on map");
    routeButton.type = "button";
    routeButton.disabled = !routingAvailable;
    routeButton.addEventListener("click", () => showRoute(cafe, snapshot));
    content.append(routeButton);
    const params = new URLSearchParams({api: "1", origin: `${snapshot.lat},${snapshot.lon}`, destination: `${cafe.latitude},${cafe.longitude}`, travelmode: snapshot.profile});
    content.append(externalLink("Get directions ↗", `https://www.google.com/maps/dir/?${params}`, "directions"));
    card.append(content);
    const distance = distanceText(roadMode ? cafe.road_distance_m : cafe.distance_m);
    const badge = element("div", "card-distance", distance);
    badge.append(element("small", "", roadMode ? `${timeText(cafe.duration_s)} · ${snapshot.profile}` : "straight line"));
    if (roadMode) badge.append(element("small", "", `${distanceText(cafe.distance_m)} straight line`));
    if (roadMode && Number.isFinite(cafe.source_snap_distance_m) && Number.isFinite(cafe.destination_snap_distance_m)) {
      badge.append(element("small", "", `Road access: start ${distanceText(cafe.source_snap_distance_m)}, café ${distanceText(cafe.destination_snap_distance_m)}`));
    }
    card.append(badge);
    fragment.append(card);
  });
  $("results").replaceChildren(fragment);
  renderCafesMap(cafes, snapshot, roadMode, data.area);
  $("walk-area-summary").hidden = !data.area;
  $("walk-area-summary").textContent = data.area
    ? `${data.walk_minutes}-minute walking area · estimated reach, not a guaranteed arrival time` : "";
  const total = data.total ?? cafes.length;
  currentPage = snapshot.page;
  totalPages = Math.ceil(total / snapshot.page_size);
  $("result-count").textContent = roadMode
    ? `${total} ${total === 1 ? "café" : "cafés"} ranked by road`
    : `${total} ${total === 1 ? "café" : "cafés"} found`;
  $("search-scope").hidden = false;
  $("search-scope").textContent = data.area
    ? `${total} cafés in the estimated ${data.walk_minutes}-minute walking area. Distances below are straight-line distances.`
    : roadMode
    ? `Road mode checked all ${data.candidate_count} matching cafés; ${data.unreachable_count} could not be routed.`
    : `Found ${total} mapped cafés within the straight-line radius.`;
  $("pagination").hidden = false;
  const start = cafes.length ? (currentPage - 1) * snapshot.page_size + 1 : 0;
  const end = cafes.length ? start + cafes.length - 1 : 0;
  $("page-range").textContent = `${start}–${end} of ${total}`;
  $("page-label").textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
  $("first-page").disabled = $("previous-page").disabled = currentPage <= 1;
  $("next-page").disabled = $("last-page").disabled = currentPage >= totalPages;
  $("distance-note").hidden = cafes.length === 0;
  $("distance-note").textContent = data.area
    ? "Cafés are selected by the walking-area boundary and sorted by straight-line distance. Choose Show route on map to check a café’s estimated walking time."
    : roadMode
    ? `Sorted by road distance among ${data.candidate_count} matching cafés checked. ${data.unreachable_count} unreachable or over 100 m from a routable road. Distances follow roads between matched points; road access gaps are not included. Search radius is straight-line; routes may be longer. Times are estimates.`
    : "Sorted by straight-line distance, not road distance. Choose Show route on map for a specific route when routing is connected.";
  notice(cafes.length ? "" : nameQuery
    ? "No cafés match this name within the search area. Clear the search or try another name."
    : data.area
    ? "No mapped cafés in this walking area. Try a longer walk or another starting point."
    : roadMode
    ? "No reachable cafés found among the nearby places checked. Try a wider radius or another travel mode."
    : "No mapped cafés within this distance. Try a wider radius or explore Phnom Penh.");
}

async function search(page = 1, reuseRoad = false) {
  if (!origin) return;
  if (!reuseRoad) roadResults = null;
  const run = begin();
  await configReady;
  if (run !== generation || !origin) return;
  const snapshot = {lat: origin.lat, lon: origin.lon, label: origin.label, profile: $("distance-mode").value === "walk_area" ? "walking" : $("profile").value, distance_mode: $("distance-mode").value,
    page, page_size: $("page-size").value === "all" ? 0 : Number($("page-size").value)};
  controller = new AbortController();
  const active = controller;
  const timeout = setTimeout(() => active.abort(), snapshot.distance_mode === "road" ? 300000 : 40000);
  $("location-info").hidden = false;
  $("location-info").textContent = origin.label;
  notice(snapshot.distance_mode === "walk_area" ? "Finding your walking area…" : snapshot.distance_mode === "road" ? "Checking routes for all matching cafés… Larger searches may take a few minutes." : "Finding your next coffee…");
  try {
    let data = roadResults;
    if (!data) {
      const road = snapshot.distance_mode !== "straight";
      const response = await fetch("/api/v1/nearby", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({latitude: snapshot.lat, longitude: snapshot.lon, radius_m: Number($("radius").value),
          limit: road ? "all" : (snapshot.page_size || "all"), page: road ? 1 : page, profile: snapshot.profile, distance_mode: snapshot.distance_mode, query: nameQuery, walk_minutes: Number($("walk-minutes").value)}),
        signal: active.signal,
      });
      if (!response.ok) throw await apiError(response);
      data = await response.json();
      if (run !== generation) return;
      if (road) roadResults = data;
    }
    if (run === generation) {
      if (snapshot.page_size === 0) snapshot.page_size = Math.max(data.total ?? data.cafes.length, 1);
      if (snapshot.distance_mode !== "straight") {
        const offset = (page - 1) * snapshot.page_size;
        data = {...data, total: data.total ?? data.cafes.length,
          cafes: data.cafes.slice(offset, offset + snapshot.page_size)};
      }
      render(data, snapshot);
    }
  } catch (error) {
    if (run !== generation) return;
    $("result-count").textContent = "Try again";
    notice(error.name === "AbortError" ? "The search took too long. Check your connection and try again." : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (run === generation) $("results").setAttribute("aria-busy", "false");
  }
}

$("locate").addEventListener("click", () => {
  if (!window.isSecureContext) {
    notice("Your phone needs a secure HTTPS connection to share its location. Open the secure app link, or enter coordinates below.", true);
    return;
  }
  if (!navigator.geolocation) {
    notice("This browser can’t share a location. Enter coordinates or explore Phnom Penh instead.", true);
    return;
  }
  const run = begin();
  origin = null;
  $("location-info").hidden = true;
  locating = true;
  $("locate").disabled = true;
  $("radius").disabled = true;
  notice("Finding your location… Allow location access when your browser asks.");
  navigator.geolocation.getCurrentPosition((position) => {
    if (run !== generation) return;
    finishLocating();
    const {latitude, longitude, accuracy} = position.coords;
    origin = {lat: latitude, lon: longitude, label: `Your current location · accuracy about ${Math.round(accuracy)} m${accuracy > 500 ? " · approximate location; nearby results may be less precise" : ""}`};
    search();
  }, (error) => {
    if (run !== generation) return;
    finishLocating();
    $("results").setAttribute("aria-busy", "false");
    $("result-count").textContent = "Location needed";
    const messages = {1: "Location access was denied. Allow location in your browser’s site settings, or enter coordinates below.", 2: "Your location is unavailable. Check that phone location services are on, then try again.", 3: "Finding your location timed out. Move near a window or outdoors and try again."};
    notice(messages[error.code] || "We couldn’t get your location. Please try again.", true);
  }, {enableHighAccuracy: true, timeout: 20000, maximumAge: 30000});
});

function finishLocating() {
  locating = false;
  $("locate").disabled = false;
  $("radius").disabled = false;
}

$("demo").addEventListener("click", () => {
  finishLocating();
  origin = {lat: 11.5564, lon: 104.9282, label: "Exploring central Phnom Penh · example location, not your GPS"};
  search();
});
$("radius").addEventListener("change", () => { if (!locating) search(); });
$("profile").addEventListener("change", () => { if (!locating) search(); });
function syncSearchControls() {
  const walk = $("distance-mode").value === "walk_area";
  $("walk-control").hidden = $("walk-help").hidden = !walk;
  $("radius-control").hidden = walk;
  $("profile-control").hidden = walk || $("distance-mode").value === "straight";
}
syncSearchControls();
$("distance-mode").addEventListener("change", () => { syncSearchControls(); if (!locating) search(); });
$("walk-minutes").addEventListener("change", () => { if (!locating) search(); });
$("close-route").addEventListener("click", closeRoute);
$("search-map-area").addEventListener("click", () => {
  if (!cafesMap || !Number.isFinite(cafesMap.getZoom())) return;
  const center = cafesMap.getCenter();
  if (Math.abs(center.lat) > 90) { notice("Move the map to a valid location before searching."); return; }
  window.coffeeTracking?.pauseFollow();
  finishLocating();
  origin = {lat: center.lat, lon: center.wrap().lng,
    label: "Searching around the map center · using your selected search area"};
  nameQuery = $("cafe-search").value.trim();
  search();
});
$("fit-cafes").addEventListener("click", () => {
  window.coffeeTracking?.pauseFollow();
  fitCafes();
});
function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPage) return;
  search(page, true).then(() => $("results-heading").scrollIntoView({block: "start", behavior: "auto"}));
}
$("first-page").addEventListener("click", () => goToPage(1));
$("previous-page").addEventListener("click", () => goToPage(currentPage - 1));
$("next-page").addEventListener("click", () => goToPage(currentPage + 1));
$("last-page").addEventListener("click", () => goToPage(totalPages));
$("cafe-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  nameQuery = $("cafe-search").value.trim();
  if (window.coffeeTracking?.prepareSearch() === false) return;
  if (!origin) { notice("Choose Use my location, enter coordinates, or explore Phnom Penh to search cafés."); return; }
  search();
});
$("clear-cafe-search").addEventListener("click", () => {
  $("cafe-search").value = "";
  nameQuery = "";
  if (origin) search();
});
$("page-size").addEventListener("change", () => search(1, true));
$("manual-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  finishLocating();
  origin = {lat: Number($("latitude").value), lon: Number($("longitude").value), label: "Searching around your entered coordinates"};
  search();
});

async function showRoute(cafe, snapshot) {
  if (snapshot !== activeSearch) return;
  closeRoute();
  const run = routeGeneration;
  const searchRun = generation;
  routeController = new AbortController();
  const active = routeController;
  const timeout = setTimeout(() => active.abort(), 40000);
  $("route-panel").hidden = false;
  $("route-title").textContent = `Route to ${cafe.name}`;
  $("route-status").textContent = "Finding the roads and paths to your café…";
  $("route-panel").scrollIntoView({block: "start", behavior: "auto"});
  try {
    const response = await fetch("/api/v1/route", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({latitude: snapshot.lat, longitude: snapshot.lon,
        osm_type: cafe.osm_type, osm_id: cafe.osm_id, profile: snapshot.profile}),
      signal: active.signal,
    });
    if (!response.ok) throw await apiError(response);
    const route = await response.json();
    if (run !== routeGeneration || searchRun !== generation) return;
    $("route-status").textContent = `${distanceText(route.distance_m)} along the route · about ${timeText(route.duration_s)} ${route.profile}`;
    route.steps.forEach((step) => {
      const item = element("li", "", step.instruction);
      item.append(element("small", "", `${step.road || "Unnamed road or path"} · ${distanceText(step.distance_m)}`));
      $("route-steps").append(item);
    });
    $("route-instructions").hidden = false;
    $("route-map").hidden = false;
    if (!window.L) throw new Error("Directions are ready, but the map could not load. Reload the page to retry.");
    if (!routeMap) {
      routeMap = L.map("route-map", {scrollWheelZoom: false});
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on("tileerror", () => {
        $("route-map-note").textContent = "Background map unavailable. The route line and turn instructions are still shown.";
        $("route-map-note").hidden = false;
      }).addTo(routeMap);
      routeMap.on("dragstart", () => window.coffeeTracking?.pauseFollow());
    }
    routeMap.invalidateSize();
    routeLayer = L.featureGroup().addTo(routeMap);
    const line = L.geoJSON(route.geometry, {style: {color: "#196748", weight: 6}}).addTo(routeLayer);
    const points = route.geometry.coordinates;
    for (const [point, label, color] of [[points[0], "Route start", "#196748"], [points[points.length - 1], "Café arrival", "#a76322"]]) {
      L.circleMarker([point[1], point[0]], {radius: 7, color, fillColor: "#fff", fillOpacity: 1, weight: 3}).bindTooltip(label).addTo(routeLayer);
    }
    routeMap.fitBounds(line.getBounds(), {padding: [30, 30], maxZoom: 18});
    window.coffeeRouteProgress?.setRoute(route.geometry);
    window.coffeeTracking?.refresh();
  } catch (error) {
    if (run !== routeGeneration || searchRun !== generation) return;
    $("route-status").textContent = error.name === "AbortError" ? "Route request timed out. Please try again." : error.message;
  } finally {
    clearTimeout(timeout);
  }
}
