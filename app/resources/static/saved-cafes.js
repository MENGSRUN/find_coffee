"use strict";

(() => {
  const storageKey = "find-coffee.saved.v1";
  let saved = new Map();
  function normalize(cafe) {
    if (!cafe || !["node", "way", "relation"].includes(cafe.osm_type)
        || typeof cafe.osm_id !== "string" || !/^[1-9][0-9]{0,18}$/.test(cafe.osm_id)
        || typeof cafe.name !== "string" || cafe.name.length > 1000
        || !Number.isFinite(cafe.latitude) || Math.abs(cafe.latitude) > 90
        || !Number.isFinite(cafe.longitude) || Math.abs(cafe.longitude) > 180) return null;
    // Save the business location only, never the user's GPS or route history.
    return {osm_type: cafe.osm_type, osm_id: cafe.osm_id, name: cafe.name,
      latitude: cafe.latitude, longitude: cafe.longitude};
  }
  const key = cafe => `${cafe.osm_type}/${cafe.osm_id}`;
  function read() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(data)) throw new Error();
      saved = new Map(data.map(normalize).filter(Boolean).map(c => [key(c), c]));
    } catch {
      $("saved-status").textContent = "Saved cafés could not be loaded. Browser storage may be unavailable.";
    }
  }
  function change(cafe) {
    const next = new Map(saved), id = key(cafe);
    if (next.has(id)) next.delete(id); else next.set(id, cafe);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next.values()]));
      saved = next;
      $("saved-status").textContent = saved.has(id) ? "Café saved on this browser." : "Café removed from saved places.";
      render();
    } catch {
      $("saved-status").textContent = "Could not save changes. Check browser storage permissions or available space.";
    }
  }
  function updateButton(button) {
    const active = saved.has(button.dataset.savedId);
    button.textContent = active ? "Remove saved café" : "Save café";
    button.setAttribute("aria-pressed", String(active));
  }
  function button(cafe) {
    const normalized = normalize({...cafe, osm_id: String(cafe.osm_id)});
    const result = element("button", "save-cafe");
    result.type = "button";
    result.dataset.savedId = key(cafe);
    updateButton(result);
    result.disabled = !normalized;
    result.addEventListener("click", () => change(normalized));
    return result;
  }
  function render() {
    $("saved-summary").textContent = `Saved cafés (${saved.size})`;
    $("saved-list").replaceChildren();
    for (const cafe of saved.values()) {
      const item = element("li", "");
      item.append(element("strong", "", cafe.name));
      item.append(externalLink("View on OpenStreetMap ↗", `https://www.openstreetmap.org/${key(cafe)}`, ""));
      const explore = element("button", "", "Search near this café");
      explore.type = "button";
      explore.addEventListener("click", () => {
        window.coffeeTracking?.pauseFollow();
        finishLocating();
        origin = {lat: cafe.latitude, lon: cafe.longitude, label: `Searching near saved café: ${cafe.name}`};
        nameQuery = "";
        $("cafe-search").value = "";
        search();
      });
      item.append(explore, button(cafe));
      $("saved-list").append(item);
    }
    document.querySelectorAll(".save-cafe").forEach(updateButton);
  }
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) { saved = new Map(); read(); render(); }
  });
  read();
  window.coffeeSaved = {button};
  render();
})();
