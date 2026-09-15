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
const cafeMarkers = new Map();
let currentPage = 1;
let nameQuery = "";
let totalPages = 0;
let roadResults = null;

function fitCafes() {
  if (cafesMap && cafesLayer) {
    cafesMap.closePopup();
    cafesMap.invalidateSize();
    cafesMap.fitBounds(cafesLayer.getBounds(), {padding: [35, 35], maxZoom: 16});
  }
}

function focusCafe(key) {
  const marker = cafeMarkers.get(key);
  if (!marker) return;
  $("cafes-map-panel").scrollIntoView({block: "start", behavior: "auto"});
  cafesMap.invalidateSize();
  cafesMap.setView(marker.getLatLng(), 17);
  marker.openPopup();
}

function renderCafesMap(cafes, snapshot, roadMode) {
  $("cafes-map-panel").hidden = false;
  $("cafes-map-summary").textContent = `${cafes.length} cafés on this page. Tap a numbered marker for café details.`;
  $("cafes-map-note").hidden = true;
  $("fit-cafes").disabled = !window.L;
  if (!window.L) {
    $("cafes-map-note").textContent = "The map could not load. Café details are still available in the list below. Reload to try again.";
    $("cafes-map-note").hidden = false;
    return;
  }
  if (!cafesMap) {
    cafesMap = L.map("cafes-map", {scrollWheelZoom: false});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on("tileerror", () => {
      $("cafes-map-note").textContent = "Background map unavailable. Location markers and the café list are still available.";
      $("cafes-map-note").hidden = false;
    }).addTo(cafesMap);
  }
  cafesMap.invalidateSize();
  cafesLayer = L.featureGroup().addTo(cafesMap);
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
    }).bindPopup(popup).addTo(cafesLayer);
    cafeMarkers.set(key, marker);
  });
  fitCafes();
}

const configReady = fetch("/api/v1/config").then((response) => {
  if (!response.ok) throw new Error("Configuration unavailable");
  return response.json();
}).then((config) => {
  routingAvailable = config.routing_available;
  if (!routingAvailable) {
    $("distance-mode").value = "straight";
    $("distance-mode").querySelector('[value="road"]').disabled = true;
    $("routing-status").textContent = "Road routing isn’t connected yet. You can browse cafés using clearly labeled straight-line distances.";
    $("routing-status").hidden = false;
  }
}).catch(() => {
  $("distance-mode").value = "straight";
  $("routing-status").textContent = "Routing availability couldn’t be checked. Using straight-line search for now; reload to try again.";
  $("routing-status").hidden = false;
});

const distanceText = (meters) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
const timeText = (seconds) => seconds < 60 ? "<1 min" : `${Math.ceil(seconds / 60)} min`;

function closeRoute() {
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
  cafeMarkers.clear();
  $("cafes-map-panel").hidden = true;
  activeSearch = null;
  $("results").replaceChildren();
  $("result-count").textContent = label;
  $("empty").hidden = true;
  $("distance-note").hidden = true;
  $("search-scope").hidden = true;
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
    content.append(meta);
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
    card.append(badge);
    fragment.append(card);
  });
  $("results").replaceChildren(fragment);
  renderCafesMap(cafes, snapshot, roadMode);
  const total = data.total ?? cafes.length;
  currentPage = snapshot.page;
  totalPages = Math.ceil(total / snapshot.page_size);
  $("result-count").textContent = roadMode
    ? `${total} ${total === 1 ? "café" : "cafés"} ranked by road`
    : `${total} ${total === 1 ? "café" : "cafés"} found`;
  $("search-scope").hidden = false;
  $("search-scope").textContent = roadMode
    ? `Road mode checked ${data.candidate_count} nearby cafés (maximum ${data.candidate_limit}); ${data.unreachable_count} could not be routed. This is a shortlist, not all cafés within your radius. A larger radius does not raise the limit. Cards show both distances for the same café.`
    : `Found ${total} mapped cafés within the straight-line radius. Road mode checks at most 30 nearby cafés, so its count and order can differ. Compare the same café and starting location when checking distances.`;
  $("pagination").hidden = false;
  const start = cafes.length ? (currentPage - 1) * snapshot.page_size + 1 : 0;
  const end = cafes.length ? start + cafes.length - 1 : 0;
  $("page-range").textContent = `${start}–${end} of ${total}`;
  $("page-label").textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
  $("first-page").disabled = $("previous-page").disabled = currentPage <= 1;
  $("next-page").disabled = $("last-page").disabled = currentPage >= totalPages;
  $("distance-note").hidden = cafes.length === 0;
  $("distance-note").textContent = roadMode
    ? `Sorted by road distance among ${data.candidate_count} nearby cafés checked (up to ${data.candidate_limit}). ${data.unreachable_count} unreachable. Search radius is straight-line; routes may be longer. Times are estimates.`
    : "Sorted by straight-line distance, not road distance. Choose Show route on map for a specific route when routing is connected.";
  notice(cafes.length ? "" : nameQuery
    ? "No cafés match this name within the search area. Clear the search or try another name."
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
  const snapshot = {lat: origin.lat, lon: origin.lon, label: origin.label, profile: $("profile").value, distance_mode: $("distance-mode").value,
    page, page_size: $("page-size").value === "all" ? 0 : Number($("page-size").value)};
  controller = new AbortController();
  const active = controller;
  const timeout = setTimeout(() => active.abort(), 40000);
  $("location-info").hidden = false;
  $("location-info").textContent = origin.label;
  notice("Finding your next coffee…");
  try {
    let data = roadResults;
    if (!data) {
      const road = snapshot.distance_mode === "road";
      const response = await fetch("/api/v1/nearby", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({latitude: snapshot.lat, longitude: snapshot.lon, radius_m: Number($("radius").value),
          limit: road ? 50 : (snapshot.page_size || "all"), page: road ? 1 : page, profile: snapshot.profile, distance_mode: snapshot.distance_mode, query: nameQuery}),
        signal: active.signal,
      });
      if (!response.ok) throw await apiError(response);
      data = await response.json();
      if (run !== generation) return;
      if (road) roadResults = data;
    }
    if (run === generation) {
      if (snapshot.page_size === 0) snapshot.page_size = Math.max(data.total ?? data.cafes.length, 1);
      if (snapshot.distance_mode === "road") {
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
$("distance-mode").addEventListener("change", () => { if (!locating) search(); });
$("close-route").addEventListener("click", closeRoute);
$("fit-cafes").addEventListener("click", fitCafes);
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
    }
    routeMap.invalidateSize();
    routeLayer = L.featureGroup().addTo(routeMap);
    const line = L.geoJSON(route.geometry, {style: {color: "#196748", weight: 6}}).addTo(routeLayer);
    const points = route.geometry.coordinates;
    for (const [point, label, color] of [[points[0], "Route start", "#196748"], [points[points.length - 1], "Café arrival", "#a76322"]]) {
      L.circleMarker([point[1], point[0]], {radius: 7, color, fillColor: "#fff", fillOpacity: 1, weight: 3}).bindTooltip(label).addTo(routeLayer);
    }
    routeMap.fitBounds(line.getBounds(), {padding: [30, 30], maxZoom: 18});
  } catch (error) {
    if (run !== routeGeneration || searchRun !== generation) return;
    $("route-status").textContent = error.name === "AbortError" ? "Route request timed out. Please try again." : error.message;
  } finally {
    clearTimeout(timeout);
  }
}
